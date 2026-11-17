// Delivery: how a `rig tell` reaches the agent it names, as a turn, without ever typing into an agent
// that is busy or waiting on a permission prompt.
//
// The message is always filed first (src/inbox.js, `<inbox>/<name>/<stamp>.md`). Then, for a crew
// member running in a Herdr app terminal (the crew record says `backend: "hc"`), its fate is decided
// from hc's own word for the agent's status and always stated:
//
//   idle            typed in now, as one turn (`hc send --if idle`: hc checks and types in one step,
//                   so an agent that starts working in between is refused, never typed into)
//   done / error    the turn ended; typed in now, right after a fresh status read
//   working         queued; a delivery watcher (one per recipient) types it in when the agent is idle
//   blocked         not delivered (exit 3): typing would answer its dialog
//   gone            not delivered (exit 3): the terminal finished or no longer exists
//   no status       filed only: a program that never reports status could be a shell, and a shell
//                   would run the text as a command
//
// Evidence behind this (hc 0.1.21, a throwaway terminal running a stdin reader that reports status
// with OSC 7501, never an agent's pane): a plain `hc send` to a WORKING terminal types at once; hc
// does not queue it. `--if idle` refuses a working, done or error terminal with `status_mismatch`
// (exit 10) and types nothing. A blocked terminal is refused by every send without `--force` (exit 9).
// A finished terminal exits 11, a missing one 3. So busy delivery is ours: the watcher below.
//
// One rule against double delivery: a message is delivered by whoever wins the rename that takes it
// out of `<inbox>/<name>/`. `rig inbox` (and its `--wait` watcher) renames into `read/`; a delivery
// renames into `delivering/<pid>/` first, types, then files it under `read/` (or puts it back when hc
// refused). A rename succeeds once, so two readers never both take one message (Maildir's rule). And a
// recipient whose `rig inbox --wait` watcher is armed is never typed to at all: the watcher's exit is
// what wakes it.
//
// The delivery watcher is this file run as a program (`node src/deliver.js --watch …`). It holds
// `<inbox>/<name>/.deliver.lock` (created exclusively), so a second one exits at once; the lock bounds
// how many run, while the claim rename alone guarantees each message goes in once. It looks every
// RIG_DELIVER_POLL_MS (1 s), re-reads the status right before each send, exits when the queue is
// empty, when the terminal is gone, when an inbox watcher takes over, or at its deadline.

import { spawn } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveMember } from './crew.js'
import { leadDir, parseMessage, watcherState } from './inbox.js'
import { tryRun } from './sh.js'

/** `rig tell`'s exit code for "not delivered": blocked on a prompt, or the terminal is gone. */
export const EXIT_NOT_DELIVERED = 3
export const DEFAULT_DELIVER_POLL_MS = 1000
export const DEFAULT_DELIVER_DEADLINE_MIN = 240

const LOCK = '.deliver.lock'
const LOG = '.deliver.log'
const CLAIMS = 'delivering'

const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}
const json = (s) => {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------------------------------
// hc

/**
 * The terminal's status as hc says it: { state, kind, msg } where state is hc's word (idle, working,
 * done, blocked, error) or null when the program never reported one; { gone: 'finished'|'not_found' }
 * when there is no live terminal; { missing: true } when hc itself cannot be run.
 */
export function hcStatus(terminal) {
  const r = tryRun('hc', ['get', terminal, '--json'])
  const j = json(r.out)
  if (!r.ok && !j) return /ENOENT/.test(r.err) ? { missing: true } : { error: r.err || 'hc get failed' }
  if (j?.error) return j.error.kind === 'not_found' || j.error.kind === 'finished' ? { gone: j.error.kind } : { error: j.error.message }
  if (!j) return { error: 'hc get said nothing readable' }
  if (j.state === 'finished') return { gone: 'finished' }
  const st = j.status ?? null
  return { state: st?.state ?? null, kind: st?.kind ?? null, msg: st?.msg ?? null }
}

/** `hc send`, never with --force. { ok } or { ok: false, kind, message } with hc's error kind. */
export function hcSend(terminal, text, { ifIdle = true } = {}) {
  const r = tryRun('hc', ['send', terminal, text, ...(ifIdle ? ['--if', 'idle'] : []), '--json'])
  const j = json(r.out)
  if (r.ok && !j?.error) return { ok: true, started: j?.started ?? null }
  return { ok: false, kind: j?.error?.kind ?? 'error', message: j?.error?.message ?? (r.err || 'hc send failed') }
}

/** What a blocked agent is blocked on, in hc's words: "permission (Bash(rm x))", or "a prompt". */
export const blockedOn = (s) => [s.kind, s.msg && `(${s.msg})`].filter(Boolean).join(' ') || 'a prompt'

// ---------------------------------------------------------------------------------------------------
// The inbox side: claim, settle, put back

/** Move every waiting message into `delivering/<pid>/`. Only the ones this process won come back. */
export function claimPending(dir) {
  const claimDir = join(dir, CLAIMS, String(process.pid))
  const won = []
  for (const name of pendingNames(dir)) {
    try {
      mkdirSync(claimDir, { recursive: true })
      renameSync(join(dir, name), join(claimDir, name))
    } catch {
      continue // a reader or another deliverer took it first
    }
    won.push({ name, path: join(claimDir, name), ...parseMessage(readFileSync(join(claimDir, name), 'utf8')) })
  }
  return won
}

const pendingNames = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.md') && !f.startsWith('.'))
        .sort()
    : []

/** Delivered: file the claimed messages under `read/`, as `rig inbox` does. Returns their paths. */
export function settle(dir, claimed) {
  mkdirSync(join(dir, 'read'), { recursive: true })
  const out = claimed.map((m) => {
    const to = join(dir, 'read', m.name)
    renameSync(m.path, to)
    return to
  })
  dropClaimDir(dir, process.pid)
  return out
}

/** Not delivered: put the claimed messages back where readers and the next delivery find them. */
export function putBack(dir, claimed) {
  for (const m of claimed) {
    try {
      renameSync(m.path, join(dir, m.name))
    } catch {
      /* already moved */
    }
  }
  dropClaimDir(dir, process.pid)
}

const dropClaimDir = (dir, pid) => {
  try {
    rmdirSync(join(dir, CLAIMS, String(pid)))
  } catch {
    /* not empty or gone */
  }
}

/** A deliverer that died between claim and settle leaves its claim behind: put those messages back. */
export function recoverStale(dir) {
  const root = join(dir, CLAIMS)
  if (!existsSync(root)) return 0
  let n = 0
  for (const pid of readdirSync(root)) {
    if (alive(Number(pid))) continue
    const d = join(root, pid)
    for (const f of readdirSync(d)) {
      try {
        renameSync(join(d, f), join(dir, f))
        n++
      } catch {
        /* someone else recovered it */
      }
    }
    dropClaimDir(dir, pid)
  }
  return n
}

/**
 * The turn the agent receives: one line per message, saying it is a rig tell, who from, and how to
 * answer. The text is the sender's own.
 */
export function turnText(msgs) {
  return msgs
    .map((m) => {
      const from = m.from || 'peer'
      const reply = from === 'peer' ? '' : ` (answer with: rig tell ${from} "…")`
      return `[rig tell from ${from}${reply}] ${m.text.replace(/\s*\n\s*/g, ' ')}`
    })
    .join('\n')
}

// ---------------------------------------------------------------------------------------------------
// One delivery attempt

/**
 * Try to deliver everything waiting for `name` now. Never types into a working or blocked agent.
 * Returns { outcome, status, delivered: [paths] }; outcome is one of
 *   delivered · busy · blocked · gone · silent (no status reported) · watcher (an armed
 *   `rig inbox --wait` takes it) · nothing (no message left to deliver) · error · missing (no hc)
 */
export function deliverNow({ inbox, name, terminal }) {
  const dir = leadDir(inbox, name)
  recoverStale(dir)
  if (watcherState(inbox, name)) return { outcome: 'watcher' }
  const status = hcStatus(terminal)
  const verdict = classify(status)
  if (verdict !== 'send') return { outcome: verdict, status }
  const claimed = claimPending(dir)
  if (!claimed.length) return { outcome: 'nothing', status }
  // idle: hc checks and types in one step. done / error: hc's `--if` only takes idle or working, so
  // the status read just above is the check.
  const sent = hcSend(terminal, turnText(claimed), { ifIdle: status.state === 'idle' })
  if (sent.ok) return { outcome: 'delivered', status, delivered: settle(dir, claimed) }
  putBack(dir, claimed)
  const kind = sent.kind
  if (kind === 'status_mismatch') return { outcome: 'busy', status: { state: 'working' } }
  if (kind === 'blocked') {
    const now = hcStatus(terminal)
    return { outcome: 'blocked', status: now.state === 'blocked' ? now : { state: 'blocked' } }
  }
  if (kind === 'finished' || kind === 'not_found') return { outcome: 'gone', status: { gone: kind } }
  return { outcome: 'error', status: { error: sent.message } }
}

/** What a status means for delivery: send, busy, blocked, gone, silent, error or missing. */
export function classify(s) {
  if (s.missing) return 'missing'
  if (s.gone) return 'gone'
  if (s.error) return 'error'
  if (s.state === 'idle' || s.state === 'done' || s.state === 'error') return 'send'
  if (s.state === 'working') return 'busy'
  if (s.state === 'blocked') return 'blocked'
  return 'silent'
}

// ---------------------------------------------------------------------------------------------------
// The delivery watcher

const lockPath = (dir) => join(dir, LOCK)

/** The live watcher's lock { pid, terminal, since }, or null. */
export function watcherFor(inbox, name) {
  const w = json(existsSync(lockPath(leadDir(inbox, name))) ? readFileSync(lockPath(leadDir(inbox, name)), 'utf8') : '')
  return w && alive(w.pid) ? w : null
}

function acquire(dir, terminal) {
  const p = lockPath(dir)
  for (let i = 0; i < 2; i++) {
    try {
      writeFileSync(p, JSON.stringify({ pid: process.pid, terminal, since: Date.now() }) + '\n', { flag: 'wx' })
      return true
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      const w = json(readFileSync(p, 'utf8'))
      if (w && alive(w.pid)) return false
      // A watcher that died: its lock goes. Delivery stays once-only without the lock (the claim
      // rename decides), so the rare race of two takeovers costs a spare watcher, never a double.
      try {
        unlinkSync(p)
      } catch {
        /* someone else cleared it */
      }
    }
  }
  return false
}

function release(dir) {
  const w = json(existsSync(lockPath(dir)) ? readFileSync(lockPath(dir), 'utf8') : '')
  if (w?.pid === process.pid) rmSync(lockPath(dir), { force: true })
}

const log = (dir, line) => {
  try {
    appendFileSync(join(dir, LOG), `${new Date().toISOString()} pid ${process.pid} ${line}\n`)
  } catch {
    /* the log is a courtesy */
  }
}

/**
 * Make sure one delivery watcher runs for `name`. Returns { pid, started }: the live one, or the one
 * just started. Two tells at once may both start one; the loser of the lock exits before doing anything.
 */
export function ensureWatcher({ inbox, name, terminal, root = null, env = process.env }) {
  const live = watcherFor(inbox, name)
  if (live) return { pid: live.pid, started: false }
  const self = fileURLToPath(import.meta.url)
  const child = spawn(process.execPath, [self, '--watch', JSON.stringify({ inbox, name, terminal, root })], {
    detached: true,
    stdio: 'ignore',
    env,
  })
  child.unref()
  return { pid: child.pid, started: true }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * The watcher's loop. Resolves with why it stopped: empty · gone · watcher · deadline · locked.
 */
export async function runWatcher({ inbox, name, terminal, root = null }, env = process.env) {
  const dir = leadDir(inbox, name)
  mkdirSync(dir, { recursive: true })
  if (!acquire(dir, terminal)) return 'locked'
  log(dir, `watching ${name} (${terminal})`)
  const every = Math.max(20, Number(env.RIG_DELIVER_POLL_MS) || DEFAULT_DELIVER_POLL_MS)
  const until = Date.now() + (Number(env.RIG_DELIVER_DEADLINE_MIN) || DEFAULT_DELIVER_DEADLINE_MIN) * 60_000
  const stop = (why) => {
    release(dir)
    log(dir, `stopped: ${why}`)
    return why
  }
  for (;;) {
    recoverStale(dir)
    if (!pendingNames(dir).length) {
      // Let go, then look once more: a tell that filed just now either sees no lock and starts a
      // watcher, or its message is seen here. Nothing is stranded between the two.
      release(dir)
      if (!pendingNames(dir).length || !acquire(dir, terminal)) {
        log(dir, 'stopped: empty')
        return 'empty'
      }
    }
    // The record may have moved the member to another terminal; follow it.
    const t = (root && resolveMember(root, name)?.terminal) || terminal
    const r = deliverNow({ inbox, name, terminal: t })
    if (r.outcome === 'delivered') log(dir, `delivered ${r.delivered.length} to ${t} (${r.status.state})`)
    if (r.outcome === 'watcher') return stop('watcher')
    if (r.outcome === 'gone' || r.outcome === 'missing') return stop(r.outcome)
    if (Date.now() >= until) return stop('deadline')
    if (r.outcome !== 'delivered') await sleep(every)
  }
}

// Run as a program: the detached watcher `ensureWatcher` starts.
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--watch') {
  const args = json(process.argv[3] || '')
  if (!args?.inbox || !args?.name || !args?.terminal) process.exit(2)
  runWatcher(args).then(
    () => process.exit(0),
    () => process.exit(1),
  )
}
