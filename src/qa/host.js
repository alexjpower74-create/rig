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
import { diffNames, lastSpecIn, parseFailures, parseMarks, tally } from './failures.js'
import { parseCiStatus } from './ci.js'
import { fmtMs } from './watch.js'
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
      // Not while a run there may still be going: rig qa cannot stop a run on the host (runOnHost
      // takes no signal), and a lease given back under it hands the host and its test DB to the
      // next session mid-run. Left held, it expires at its ttl, which outlasts the run's limit.
      release: () => {
        if (inFlight > 0) {
          if (!warned) console.error(`rig qa: a run on ${host} may still be going; its lease is left to expire, not given back`)
          warned = true
          return
        }
        safely(() => remote.release(root, `host:${host}`, by))
      },
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

/** Runs on a host that have started and not yet come back. */
let inFlight = 0
let warned = false

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
export async function runHost({
  root,
  host,
  sha,
  cmd,
  session,
  env = {},
  limitMs = 0,
  stallMs = 0,
  pattern = null,
  echo = true,
  desktop = false,
  ci = false,
}) {
  const started = Date.now()
  const out = linePrefixer(`[${host}] `, (s) => echo && process.stdout.write(s))
  let seen = ''
  let all = ''
  let last = started
  const abort = new AbortController()
  let r
  let error = null
  let stalled = null
  inFlight++
  // Called now, not on a later tick: a signal that lands at once must find the run in flight.
  const running = (async () =>
    remote.runOnHost({
      root,
      host,
      sha,
      cmd,
      session,
      env,
      limitMs,
      desktop,
      signal: abort.signal,
      onOutput: (c) => {
        last = Date.now()
        seen = (seen + String(c)).slice(-16 * 1024)
        all += String(c)
        out.push(String(c))
      },
    }))()
    // The run is "in flight" until runOnHost itself comes back, not until rig qa stops waiting on
    // it: a run abandoned on a stall may still be going, and its lease must not be given back.
    .finally(() => {
      inFlight--
    })
  // The same watchdog as a local run, on the output the host streams back. runOnHost is asked to
  // stop through the signal (r55m review, finding 1); rig qa stops waiting either way.
  const watchdog =
    stallMs > 0 &&
    new Promise((resolve) => {
      const timer = setInterval(
        () => {
          const quiet = Date.now() - last
          if (quiet < stallMs) return
          clearInterval(timer)
          stalled = { worker: host, spec: lastSpecIn(seen), quietMs: quiet }
          console.error(
            `\n[${host}] rig qa: STALLED — nothing from ${host} for ${fmtMs(quiet)} (window ${fmtMs(stallMs)}). ` +
              `Last spec: ${stalled.spec ?? 'none named'}. Stopping the wait (exit 124).`,
          )
          abort.abort()
          resolve({ host, exit: 124, ms: Date.now() - started, dir: null, db: null, log: all })
        },
        Math.max(50, Math.min(1000, Math.floor(stallMs / 10))),
      )
      running.finally(() => clearInterval(timer)).catch(() => {})
    })
  try {
    r = await (watchdog ? Promise.race([running, watchdog]) : running)
  } catch (e) {
    error = e.message
    r = { host, exit: 255, ms: Date.now() - started, dir: null, db: null, log: '' }
  }
  out.end()
  if (error) console.error(`[${host}] rig qa: the run on ${host} did not start: ${error}`)
  error ??= r.why ?? null
  // The full output: runOnHost's log, else everything streamed (a run abandoned on a stall).
  const log = r.log || all
  const failures = parseFailures(log, { pattern })
  const marks = parseMarks(log)
  const diff = diffNames(log, { exit: r.exit, pattern })
  // The host's own stubs (src/remote.js) say "<tool>: the desktop is off in test runs" and, since
  // r55m's edf29fd, also come back as `stubCalls`. Their times are the host's clock and the output
  // lines carry none, so only a failure whose block names a called tool counts there; never the
  // time rule.
  const stubbed = [
    ...new Set([
      ...[...log.matchAll(/^\s*(?:\[[^\]]*\] )?(\S+): the desktop is off in test runs/gm)].map((m) => m[1]),
      ...(r.stubCalls ?? []).map((c) => c.tool),
    ]),
  ]
  const stub = needsStub(
    log.split('\n').map((text) => ({ t: Number.NaN, text })),
    stubbed.map((tool) => ({ t: Number.NaN, tool })),
    { pattern },
  ).map((x) => x.name)
  const posted = ci ? [...log.matchAll(/^rig-qa-ci-status: (.*)$/gm)].pop()?.[1] : null
  return {
    host,
    exit: r.exit,
    ms: r.ms ?? Date.now() - started,
    log,
    dir: r.dir ?? null,
    db: r.db ?? null,
    failures,
    diff,
    unproven: marks.unproven,
    void: marks.void,
    needsStub: stub,
    stubCalls: r.stubCalls ?? [],
    tally: tally(log, failures, r.exit),
    stalled,
    ciStatus: posted ? parseCiStatus(posted) : null,
    error,
  }
}

/**
 * The CI command as it runs on the host: RIG_CI_STATUS points into the host checkout's .git, and
 * what the command wrote there comes back as one marked line, "rig-qa-ci-status: <text>", printed
 * after it with its exit kept. Nothing beyond the command line runOnHost already sends.
 */
export function ciOnHost(cmd) {
  return [
    'RIG_CI_STATUS="$(git rev-parse --absolute-git-dir)/rig-ci-status"; export RIG_CI_STATUS; rm -f "$RIG_CI_STATUS"',
    `( ${cmd} )`,
    // No backslashes: the command crosses ssh and a login shell (fish reads them differently).
    `c=$?; [ -s "$RIG_CI_STATUS" ] && echo "rig-qa-ci-status: $(head -c 500 "$RIG_CI_STATUS" | tr -s '[:space:]' ' ')"; exit $c`,
  ].join('; ')
}
