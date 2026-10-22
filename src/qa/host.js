// The second machine: the same command, at the same sha, on an SSH host, under a lease.
//
// A second OS once caught 34 platform-only failures and a 1-in-3 flake the first machine never
// showed. Two sessions once wiped each other's test DB on that machine, so a run there holds the
// host's lease for as long as it uses it, and a lease someone else holds is a refusal with their
// name, never a queue nobody can see.
//
// The transport and the lease are r55m's (src/remote.js, src/lease.js). They sit behind `remote`
// so a test can put a fake machine there; no test reaches a real one.

import { acquire, holderOf, release } from '../lease.js'
import { runOnHost } from '../remote.js'
import { parseFailures, tally } from './failures.js'

export const remote = { acquire, release, holderOf, runOnHost }

/**
 * Take the host's lease for `by`. Returns { ok, why }; `why` names the holder when it is held.
 */
export function leaseHost(root, host, by) {
  let r
  try {
    r = remote.acquire(root, `host:${host}`, by)
  } catch (e) {
    return { ok: false, why: `the lease on ${host} could not be taken: ${e.message}` }
  }
  if (r?.ok) return { ok: true, why: null, release: () => safely(() => remote.release(root, `host:${host}`, by)) }
  const h = r?.holder
  return {
    ok: false,
    why: h
      ? `${host} is leased by ${h.by} since ${h.at}${h.until ? `, until ${h.until}` : ''}`
      : `the lease on ${host} was refused: ${r?.why ?? 'no reason given'}`,
  }
}

function safely(f) {
  try {
    f()
  } catch {}
}

/** Prefix every whole line of a stream of chunks; the partial last line waits for the next chunk. */
export function linePrefixer(prefix, write) {
  let part = ''
  return {
    push(chunk) {
      const lines = (part + chunk).split('\n')
      part = lines.pop()
      for (const l of lines) write(`${prefix}${l}\n`)
    },
    end() {
      if (part) write(`${prefix}${part}\n`)
      part = ''
    },
  }
}

/**
 * Run `cmd` at `sha` on `host`. Never throws: a transport failure is exit 255 with the reason.
 * @returns {Promise<{ host, exit, ms, log, dir, db, failures: string[], tally, error: string|null }>}
 */
export async function runHost({ root, host, sha, cmd, session, env = {}, limitMs = 0, pattern = null, echo = true }) {
  const started = Date.now()
  const out = linePrefixer(`[${host}] `, (s) => echo && process.stdout.write(s))
  let r
  let error = null
  try {
    r = await remote.runOnHost({ root, host, sha, cmd, session, env, limitMs, onOutput: (c) => out.push(String(c)) })
  } catch (e) {
    error = e.message
    r = { host, exit: 255, ms: Date.now() - started, dir: null, db: null, log: '' }
  }
  out.end()
  if (error) console.error(`[${host}] rig qa: the run on ${host} did not start: ${error}`)
  const log = r.log ?? ''
  const failures = parseFailures(log, { pattern })
  return {
    host,
    exit: r.exit,
    ms: r.ms ?? Date.now() - started,
    log,
    dir: r.dir ?? null,
    db: r.db ?? null,
    failures,
    tally: tally(log, failures),
    error,
  }
}
