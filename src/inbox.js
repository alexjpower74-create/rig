// The lead's inbox: how a peer reports itself. A peer finishing, blocking or asking a question runs
// `rig tell <lead> "<one line>"`; the lead keeps `rig inbox <lead> --wait` running as a background
// job, and its exit is what wakes the lead. Before this, a question typed into a peer's own pane
// reached nobody, and a finished peer sat idle until someone happened to look.
//
// One message is one file, `<inbox>/<lead>/<stamp>-<pid>-<rand>.md`, written to a dot-tmp name in the
// same directory and renamed into place, so a reader never sees half a message. Reading files it under
// `read/`. The layout matches the bash `tell-lead`/`lead-inbox` scripts this replaces (`from:`, `at:`,
// a blank line, the text), so an inbox they filled reads the same.
//
// Where the inbox lives, first that is set: RIG_INBOX_DIR, `inboxDir` in .rig/config.json (a `~/`
// prefix is the home directory; point it at an older layout such as `~/.claude/inbox` to keep one),
// $XDG_STATE_HOME/rig/inbox, ~/.local/state/rig/inbox. The default names no vendor.

import { mkdirSync, writeFileSync, renameSync, readdirSync, readFileSync, existsSync, rmSync, watch } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'

/** How often `--wait` looks, at most. The bar is 60 s from `rig tell` to a woken lead; 5 s is the cap. */
export const MAX_POLL_MS = 5000
export const DEFAULT_POLL_MS = 2000
/** How long a watcher waits for one message before it gives up and says so. */
export const DEFAULT_WAIT_MIN = 240

const expandHome = (p) => (p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)

/** The directory that holds every lead's inbox. */
export function inboxRoot(cfg = {}, env = process.env) {
  if (env.RIG_INBOX_DIR) return expandHome(env.RIG_INBOX_DIR)
  if (cfg.inboxDir) return expandHome(cfg.inboxDir)
  if (env.XDG_STATE_HOME) return join(env.XDG_STATE_HOME, 'rig', 'inbox')
  return join(env.HOME || homedir(), '.local', 'state', 'rig', 'inbox')
}

/** The lead's name: `lead` in config, else RIG_LEAD. Null when neither says. */
export function leadName(cfg = {}, env = process.env) {
  return cfg.lead || env.RIG_LEAD || null
}

/** A lead name becomes a directory: plain names only, so `../x` cannot write somewhere else. */
export function checkLead(lead) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(lead || '') || lead.includes('..'))
    throw new Error(`"${lead}" is not a lead name. Use letters, digits, ., - and _ (the lead's own name, e.g. lead or onyx).`)
  return lead
}

export function leadDir(root, lead) {
  return join(root, checkLead(lead))
}

/**
 * Who is telling: RIG_AGENT_ID, else the slice id (the branch under the rig's prefix), else
 * CODEX_PERSONA, else "peer".
 */
export function senderId(env = process.env, { branch, branchPrefix = 'rig/' } = {}) {
  if (env.RIG_AGENT_ID) return env.RIG_AGENT_ID
  if (branch && branchPrefix && branch.startsWith(branchPrefix) && branch.length > branchPrefix.length)
    return branch.slice(branchPrefix.length)
  if (env.CODEX_PERSONA) return env.CODEX_PERSONA
  return 'peer'
}

const pad = (n) => String(n).padStart(2, '0')
const stamp = (d) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
const human = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`

/** Write one message, atomically. Returns the file's path. */
export function tellMessage(root, lead, from, text, now = new Date()) {
  const dir = leadDir(root, lead)
  mkdirSync(dir, { recursive: true })
  const name = `${stamp(now)}-${process.pid}-${randomBytes(3).toString('hex')}.md`
  const tmp = join(dir, `.${name}.tmp`)
  writeFileSync(tmp, `from: ${from}\nat: ${human(now)}\n\n${text.trim()}\n`)
  renameSync(tmp, join(dir, name))
  return join(dir, name)
}

/** Messages waiting in a lead's inbox, oldest first: [{ name, path }]. Dot files are writes in flight. */
export function pending(root, lead) {
  const dir = leadDir(root, lead)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('.'))
    .sort()
    .map((name) => ({ name, path: join(dir, name) }))
}

/** Parse a message file into { from, at, text }. */
export function parseMessage(body) {
  const [head, ...rest] = body.split(/\n\n/)
  const field = (k) => head.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1]?.trim() ?? ''
  return { from: field('from'), at: field('at'), text: rest.join('\n\n').trim() }
}

/**
 * Take every waiting message: read it, file it under `read/`, and return them oldest first as
 * [{ name, from, at, text }]. A message another reader filed first is skipped, not doubled.
 */
export function takeAll(root, lead) {
  const dir = leadDir(root, lead)
  const out = []
  for (const m of pending(root, lead)) {
    let body
    try {
      body = readFileSync(m.path, 'utf8')
      mkdirSync(join(dir, 'read'), { recursive: true })
      renameSync(m.path, join(dir, 'read', m.name))
    } catch {
      continue
    }
    out.push({ name: m.name, ...parseMessage(body) })
  }
  return out
}

export function formatMessage(m) {
  return `=== ${m.from || 'peer'} · ${m.at} · ${m.name} ===\n${m.text}\n`
}

// The watcher marks itself, so `rig up` can say whether the lead is listening.
const markPath = (root, lead) => join(leadDir(root, lead), '.watcher.json')

export function watcherState(root, lead, now = Date.now()) {
  const p = markPath(root, lead)
  if (!existsSync(p)) return null
  try {
    const w = JSON.parse(readFileSync(p, 'utf8'))
    let alive = true
    try {
      process.kill(w.pid, 0)
    } catch (e) {
      alive = e.code === 'EPERM'
    }
    return alive && w.until > now ? w : null
  } catch {
    return null
  }
}

/**
 * Block until at least one message lands, or the deadline. Resolves to the messages (filed under
 * read/) or [] at the deadline. Looks on every change the directory reports, and polls besides at
 * `pollMs` (capped at 5 s): fs.watch can miss events on some filesystems, the poll cannot.
 */
export function waitForMessages(root, lead, { deadlineMs, pollMs = DEFAULT_POLL_MS } = {}) {
  const dir = leadDir(root, lead)
  mkdirSync(dir, { recursive: true })
  const every = Math.max(10, Math.min(MAX_POLL_MS, pollMs))
  const until = Date.now() + deadlineMs
  writeFileSync(markPath(root, lead), JSON.stringify({ pid: process.pid, since: Date.now(), until }) + '\n')
  return new Promise((resolve) => {
    let watcher = null
    let timer = null
    let done = false
    const finish = (msgs) => {
      if (done) return
      done = true
      clearInterval(timer)
      watcher?.close()
      try {
        const w = JSON.parse(readFileSync(markPath(root, lead), 'utf8'))
        if (w.pid === process.pid) rmSync(markPath(root, lead), { force: true })
      } catch {
        /* gone already */
      }
      resolve(msgs)
    }
    const look = () => {
      if (done) return
      const msgs = takeAll(root, lead)
      if (msgs.length) return finish(msgs)
      if (Date.now() >= until) finish([])
    }
    try {
      // RIG_INBOX_WATCH=0 turns the watch off (a filesystem that drops its events): the poll alone.
      if (process.env.RIG_INBOX_WATCH === '0') throw new Error('watch off')
      watcher = watch(dir, () => look())
      watcher.on('error', () => {})
    } catch {
      watcher = null
    }
    timer = setInterval(look, every)
    look()
  })
}
