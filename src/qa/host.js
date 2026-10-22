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
import { needsStub } from './desktop.js'

export const remote = { acquire, release, holderOf, runOnHost }

/** A lease holder id from a session or branch name: the lease takes letters, digits and . _ : @ - only. */
export const holderId = (s) =>
  String(s)
    .replace(/[^A-Za-z0-9._:@-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'rig-qa'

/**
 * Take the host's lease for `by`, for `ttlMin` minutes. Returns { ok, why, release, renew }; `why`
 * names the holder when it is held. `renew()` takes it again as the same holder, which extends it:
 * a run with no limit that outlives its lease would hand the host's test DB to the next session
 * mid-run, the very thing the lease is for.
 */
export function leaseHost(root, host, by, { ttlMin = 120 } = {}) {
  let r
  const take = () => remote.acquire(root, `host:${host}`, by, { ttlMin })
  try {
    r = take()
  } catch (e) {
    return { ok: false, why: `the lease on ${host} could not be taken: ${e.message}` }
  }
  if (r?.ok)
    return {
      ok: true,
      why: null,
      release: () => safely(() => remote.release(root, `host:${host}`, by)),
      renew: () => {
        try {
          const again = take()
          return again?.ok ? null : (again?.why ?? 'refused')
        } catch (e) {
          return e.message
        }
      },
    }
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
export async function runHost({ root, host, sha, cmd, session, env = {}, limitMs = 0, pattern = null, echo = true, desktop = false }) {
  const started = Date.now()
  const out = linePrefixer(`[${host}] `, (s) => echo && process.stdout.write(s))
  let r
  let error = null
  try {
    r = await remote.runOnHost({ root, host, sha, cmd, session, env, limitMs, desktop, onOutput: (c) => out.push(String(c)) })
  } catch (e) {
    error = e.message
    r = { host, exit: 255, ms: Date.now() - started, dir: null, db: null, log: '' }
  }
  out.end()
  if (error) console.error(`[${host}] rig qa: the run on ${host} did not start: ${error}`)
  error ??= r.why ?? null
  const log = r.log ?? ''
  const failures = parseFailures(log, { pattern })
  // The host's own stubs (src/remote.js) say "<tool>: the desktop is off in test runs" and log no
  // times, so only a failure whose block names the tool counts there; never the time rule.
  const stubbed = [...new Set([...log.matchAll(/^\s*(?:\[[^\]]*\] )?(\S+): the desktop is off in test runs/gm)].map((m) => m[1]))]
  const stub = needsStub(
    log.split('\n').map((text) => ({ t: Number.NaN, text })),
    stubbed.map((tool) => ({ t: Number.NaN, tool })),
    { pattern },
  ).map((x) => x.name)
  return {
    host,
    exit: r.exit,
    ms: r.ms ?? Date.now() - started,
    log,
    dir: r.dir ?? null,
    db: r.db ?? null,
    failures,
    needsStub: stub,
    tally: tally(log, failures),
    error,
  }
}
