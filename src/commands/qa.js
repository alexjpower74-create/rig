import { closeSync, mkdirSync, openSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { mainRoot, loadConfig, currentBranch, currentBranchOrNull } from '../config.js'
import { acquireQaWorktree, cleanWorktree, porcelainLines } from '../worktrees.js'
import { loadPlan } from '../plan.js'
import { git, tryGit } from '../sh.js'
import { recordQa } from '../qalog.js'
import { rigDir } from '../rigdir.js'
import { recordTiming } from '../timings.js'
import { staleBaselines } from '../baselines.js'
import { groups, running } from '../qa/group.js'
import { exitCodeFor, fmtMs, runWatched } from '../qa/watch.js'
import { compareBaseline, parseFailures, tally } from '../qa/failures.js'
import { desktopFreeEnv, makeShims, needsStub, readShimCalls } from '../qa/desktop.js'
import { detectCi, planSeeds, readCiStatus, withSeed } from '../qa/ci.js'
import { ciOnHost, holderId, leaseHost, runHost } from '../qa/host.js'

export { exitCodeFor, groups }

// Never grade the shared tree. Agents are mid-edit in theirs by definition, so a number taken
// there measures a half-finished checkout. QA gets its own worktree, detached at an exact commit,
// on its own port, so every number you report can be traced to a sha.
//
// And `rig qa` never refuses. A QA worktree holds nobody's work, so it is reset and cleaned before
// every pin, and each run takes a worktree no other run is using. What the clean touched, and what
// the tests left behind, is printed by path and recorded: a tree that is not clean right after
// `npm test` is a defect, and `rig finish` will say so.
//
// 5.5: a run cannot hang (the stall watchdog), cannot lie ("0 new" is computed from a second run on
// the base, a repeat names its failing seeds, the second machine's tally sits beside this one), and
// cannot touch the desktop (no display, clipboard tools that fail fast).

export const USAGE = `rig qa [<ref>] [--run "<cmd>"] [--negative "<cmd>"] [--port <n>] [--timeout <min>] [--stall <min>]
       [--baseline [<base>]] [--host <ssh-host> | --no-host] [--ci | --no-ci] [--desktop] [--fresh]
rig qa <ref> --repeat <N> [--seeds [<s1,s2,…>]] --run "<one file>" [--host <ssh-host>]

  <ref>              the commit to pin (a sha, a branch, a tag); defaults to the current branch of
                     the MAIN checkout. Give the sha: "rig qa" alone grades main, not your slice.
  --run "<cmd>"      the test command (default: devCommand in .rig/config.json); recorded as kind
                     "test". rig qa exits with the first non-zero of the test run, then the negative
                     (with the CI and host runs, when they run, counted between the two)
  --negative "<cmd>" the negative-control command (default: negativeCommand in the config or the
                     plan's "Negative controls:" line); recorded as kind "negative" on the same sha
  --port <n>         PORT for the command (default: qaPort, +1 per extra QA worktree in use)
  --timeout <min>    stop a command still running after this many minutes and record exit 124
                     (default: qaTimeoutMinutes in the config, else 60; 0 = no limit)
  --stall <min>      stop a command that has written nothing for this long, naming the worker and
                     the last spec it mentioned; exit 124, recorded as "stalled" (default:
                     qaStallMinutes, else 5; 0 = off). Watches the output, plus every file matching
                     qaWorkerLogs (a glob in the worktree) when set. A run that keeps writing is
                     never stopped by it.
  --baseline [<base>] also run the same command on the merge base with the main checkout's branch
                     (or exactly <base>) in a second QA worktree, and report only NEW failures;
                     known ones are listed with where they also fail (here, there, both). Failure
                     names are read from node:test (spec and TAP), the harness, rspec, Playwright and
                     Jest, plus qaFailurePattern (a regex; its "name" group or first group)
  --host <ssh-host>  run the same command at the same sha on a second machine too (default: qaHost
                     in the config; --no-host skips it), under the host's lease; both tallies are
                     printed side by side. A lease someone else holds refuses the run, by name.
  --by <id>          who holds the lease (default: RIG_SESSION, else the branch you are on)
  --ci / --no-ci     the repo's own local CI command runs, recorded as kind "ci", whenever --run is
                     not given; --ci runs it beside --run too, --no-ci never. Found as ciCommand in
                     the config, else scripts.ci in package.json, an executable bin/ci, script/ci
                     or script/cibuild, or a "ci:" Makefile target. A status it writes to the file
                     in RIG_CI_STATUS ("success"/"failure" or JSON with "state") is recorded.
  --repeat <N>       run one file N times, a seed each (RIG_SEED, and the runner's own flag for
                     node --test, jest, vitest and rspec); reports N green or the failing seeds
  --seeds [<list>]   seeds that always run (comma-separated); fresh ones fill up to N
  --desktop          let the command reach the display and the clipboard. By default DISPLAY and
                     WAYLAND_DISPLAY are unset and xclip, xsel, wl-copy, wl-paste, pbcopy and
                     pbpaste fail at once; a spec that fails with such a call is listed as "needs a
                     stub", not as a new failure
  --fresh            clean ignored files too (git clean -fdx): node_modules is reinstalled
  --help, -h         this text

The worktree is <worktreeDir>/qa when free, else qa-2, qa-3…; a run holds it with <worktreeDir>/<id>.lock.
Tracked files the clean reset and files the run dirtied are printed by path and recorded in
.rig/qa-history.jsonl, which \`rig finish\` reads. Full output is kept in .rig/qa-logs/, and each
stage's wall time goes to .rig/timings.jsonl.
`

const MAX_MINUTES = Math.floor((2 ** 31 - 1) / 60_000)

export default async function qa(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    return
  }
  for (const flag of ['--run', '--negative', '--host', '--repeat', '--by']) {
    if (args.includes(flag) && !argOf(args, flag)) {
      console.error(`rig qa: ${flag} needs a value, e.g. ${EXAMPLES[flag]}. Nothing was run.`)
      process.exit(2)
    }
  }
  const root = mainRoot()
  const cfg = loadConfig(root)
  const limitMs = minutesOf(args, '--timeout', cfg.qaTimeoutMinutes ?? 60, 'qaTimeoutMinutes') * 60_000
  const stallMs = minutesOf(args, '--stall', cfg.qaStallMinutes ?? 5, 'qaStallMinutes') * 60_000
  const repeat = repeatOf(args)
  const host = argOf(args, '--host') || (args.includes('--no-host') ? null : cfg.qaHost || null)
  const pattern = cfg.qaFailurePattern || null
  if (pattern)
    try {
      new RegExp(pattern)
    } catch (e) {
      console.error(`rig qa: qaFailurePattern in .rig/config.json is not a regex (${e.message}). Nothing was run.`)
      process.exit(2)
    }
  const ref = resolveRef(args, currentBranch(root))
  const fresh = args.includes('--fresh')
  const desktop = args.includes('--desktop')

  // The lease first: a refused host refuses the run before a worktree is touched.
  const by = holderId(argOf(args, '--by') || process.env.RIG_SESSION || currentBranchOrNull(process.cwd()) || `qa-${process.pid}`)
  let lease = null
  if (host) {
    // Long enough for the stages that use the host at their limit, and renewed while the run lasts.
    lease = leaseHost(root, host, by, { ttlMin: limitMs ? Math.ceil((2 * limitMs) / 60_000) + 30 : 120 })
    if (!lease.ok) {
      console.error(`rig qa: refused — ${lease.why}. Nothing was run. Wait for it, or run here only with --no-host.`)
      process.exit(75)
    }
    process.on('exit', lease.release)
    setInterval(() => {
      const why = lease.renew()
      if (why) console.error(`\nrig qa: could not renew the lease on ${host}: ${why}`)
    }, 30 * 60_000).unref()
  }

  const wt = acquireQaWorktree(root, cfg, ref, { fresh })
  const port = Number(argOf(args, '--port') || Number(cfg.qaPort) + wt.index)
  holdLock(wt)
  const full = git(['rev-parse', 'HEAD'], wt.path)
  const sha = git(['rev-parse', '--short', 'HEAD'], wt.path)
  const subject = git(['log', '-1', '--pretty=%s'], wt.path)

  for (const n of wt.notes) console.log(`note: ${n}`)
  console.log(`QA worktree ${wt.id} pinned to ${ref} @ ${sha}`)
  console.log(`  ${subject}`)
  console.log(`  ${wt.path}`)
  console.log(`  port ${port}`)
  if (wt.reset.length)
    console.log(`  reset ${wt.reset.length} tracked file${wt.reset.length === 1 ? '' : 's'}: ${wt.reset.join(', ')} (a test wrote it)`)
  if (wt.removed.length)
    console.log(
      `  removed ${wt.removed.length} untracked path${wt.removed.length === 1 ? '' : 's'}: ${wt.removed.join(', ')}${fresh ? ' (--fresh: ignored files too)' : ''}`,
    )
  if (host) console.log(`  host ${host} (leased by ${by})`)
  console.log(desktop ? '  desktop: reachable (--desktop)' : '  desktop-free: no display, clipboard tools fail fast (--desktop to allow)')
  console.log(`  stall watchdog: ${stallMs ? fmtMs(stallMs) : 'off'}${cfg.qaWorkerLogs ? `, worker logs ${cfg.qaWorkerLogs}` : ''}`)
  warnStaleBaselines(wt.path)
  console.log(`\nEvery number you report from here belongs to ${sha}. Say the sha when you report it.`)

  const shims = desktop ? null : makeShims()
  if (shims) process.on('exit', shims.remove)
  const baseEnv = { ...process.env, PORT: String(port), RIG_QA_SHA: sha }
  const ctx = { root, cfg, wt, ref, full, sha, port, pattern, limitMs, stallMs, shims, host, by, desktop, lease }
  ctx.env = shims ? desktopFreeEnv(baseEnv, shims) : baseEnv

  if (repeat) process.exit(await repeatRuns(ctx, args, repeat))

  const runFlag = argOf(args, '--run')
  const cmd = runFlag || cfg.devCommand
  const negative = argOf(args, '--negative') || cfg.negativeCommand || planNegative(root, cfg)
  const wantCi = !args.includes('--no-ci') && (!runFlag || args.includes('--ci'))
  const ci = wantCi ? detectCi(wt.path, cfg) : null
  if (!cmd && !negative && !ci) {
    console.log('\nNo dev command configured. Set "devCommand" in .rig/config.json or pass --run "<cmd>".')
    return
  }

  let exit = 0
  // A CI that exits 0 but posted "failure" is not green (r55g review 2): the posted verdict counts.
  const fail = (r) => {
    const code = r.exit !== 0 ? r.exit : r.ciStatus?.state === 'failure' ? 1 : 0
    if (exit === 0 && code !== 0) exit = code
  }
  ctx.seen = new Set()
  const heads = []

  // The test run, here and on the host at the same time: two machines, one wait.
  if (cmd) {
    const both = ci && ci.cmd === cmd
    const [here, there] = await Promise.all([
      localStage(ctx, both ? ['test', 'ci'] : ['test'], cmd, { ci: both ? ci : null }),
      host ? hostStage(ctx, both ? ['test', 'ci'] : ['test'], cmd) : null,
    ])
    fail(here)
    if (there) fail(there)
    heads.push({ here, there })
    if (there) sideBySide(here, there, host)
  }
  if (ci && ci.cmd !== cmd) {
    console.log(`\nlocal CI: ${ci.cmd}   (${ci.from})`)
    const [here, there] = await Promise.all([localStage(ctx, ['ci'], ci.cmd, { ci }), host ? hostStage(ctx, ['ci'], ci.cmd) : null])
    fail(here)
    if (there) fail(there)
    if (there) sideBySide(here, there, host)
    if (!cmd) heads.push({ here, there })
  }

  // The base, with the same command, so "0 new" is computed and never typed.
  if (args.includes('--baseline') || args.some((a) => a.startsWith('--baseline='))) {
    const { here, there } = heads[0] ?? {}
    if (!here) console.log('\nrig qa: --baseline needs a test or CI command to compare; none ran.')
    else await baselineStage(ctx, args, here, there)
  }

  if (negative) {
    const r = await localStage(ctx, ['negative'], negative)
    fail(r)
  }
  lease?.release()
  process.exit(exit)
}

const EXAMPLES = {
  '--run': '--run "npm test"',
  '--negative': '--negative "npm run demo"',
  '--host': '--host build-box',
  '--repeat': '--repeat 10',
  '--by': '--by r55q',
}

/**
 * A number of minutes from a flag or the config. A limit that does not parse must not quietly
 * become no limit: `--timeout 10m`, a value of `--fresh` taken for the minutes, or a bad config
 * value all stop here. setTimeout holds at most 2^31 - 1 ms; past that Node fires after 1 ms, so
 * "99999" meant to be generous stopped every run at once (fv2). Refuse it and point at 0.
 */
function minutesOf(args, flag, fallback, key) {
  const given = args.includes(flag)
  const raw = given ? argOf(args, flag) : fallback
  const minutes = typeof raw === 'number' ? raw : /^\d+(\.\d+)?$/.test(raw ?? '') ? Number(raw) : Number.NaN
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > MAX_MINUTES) {
    const from = given ? flag : `${key} in .rig/config.json`
    console.error(
      `rig qa: ${from} takes a number of minutes up to ${MAX_MINUTES} (0 = no limit), not ${JSON.stringify(raw ?? null)}. Nothing was run.`,
    )
    process.exit(2)
  }
  return minutes
}

function repeatOf(args) {
  if (!args.includes('--repeat')) {
    if (args.includes('--seeds')) {
      console.error('rig qa: --seeds goes with --repeat <N>. Nothing was run.')
      process.exit(2)
    }
    return null
  }
  const raw = argOf(args, '--repeat')
  if (!/^\d+$/.test(raw ?? '') || Number(raw) < 1 || Number(raw) > 1000) {
    console.error(`rig qa: --repeat takes a whole number of runs from 1 to 1000, not ${JSON.stringify(raw)}. Nothing was run.`)
    process.exit(2)
  }
  if (!argOf(args, '--run')) {
    console.error('rig qa: --repeat reruns one file: give it with --run "<cmd for that file>". Nothing was run.')
    process.exit(2)
  }
  const seeds = optionalValues(args)['--seeds']
  return { n: Number(raw), seeds: seeds ? seeds.split(',').filter(Boolean) : [] }
}

/** The log file for one run: .rig/qa-logs/<short>-<what>-<time>.log, opened for writing. */
function openLog(root, sha, what) {
  const name = `${sha}-${what}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`
  const dir = join(rigDir(root), 'qa-logs')
  const path = join(dir, name)
  try {
    mkdirSync(dir, { recursive: true })
    return { fd: openSync(path, 'a'), path: `.rig/qa-logs/${name}` }
  } catch {
    return { fd: null, path: null }
  }
}

/**
 * One local run of `cmd` in the QA worktree, recorded once per kind in `kinds` (the test command and
 * the CI command are one run when they are the same command).
 */
async function localStage(ctx, kinds, cmd, { ci = null } = {}) {
  const { root, wt, sha, full, ref, port } = ctx
  const kind = kinds[0]
  console.log(`\n$ ${cmd}   (PORT=${port}${kind === 'negative' ? ', negative control' : ''}${kinds.includes('ci') ? ', local CI' : ''})\n`)
  const statusFile = kinds.includes('ci') ? join(rigDir(root), `ci-status-${process.pid}-${Date.now()}`) : null
  const env = statusFile ? { ...ctx.env, RIG_CI_STATUS: statusFile } : ctx.env
  const callsBefore = ctx.shims ? readShimCalls(ctx.shims.log).length : 0
  const log = openLog(root, sha, kinds.join('+'))
  const r = await runWatched(cmd, {
    cwd: wt.path,
    env,
    limitMs: ctx.limitMs,
    stallMs: ctx.stallMs,
    workerLogs: ctx.cfg.qaWorkerLogs || null,
    log: log.fd,
  })
  if (log.fd !== null) closeSync(log.fd)
  const failures = parseFailures(r.text, { pattern: ctx.pattern })
  const calls = ctx.shims ? readShimCalls(ctx.shims.log).slice(callsBefore) : []
  const stub = needsStub(r.lines, calls, { pattern: ctx.pattern })
  const t = tally(r.text, failures)
  const ciStatus = statusFile ? readCiStatus(statusFile) : null
  if (statusFile) tryRm(statusFile)
  const left = dirtiedBy(wt.path)
  const dirtied = left.tracked.filter((p) => !ctx.seen.has(p))
  const untracked = left.untracked.filter((p) => !ctx.seen.has(p))
  for (const p of [...dirtied, ...untracked]) ctx.seen.add(p)
  for (const k of kinds) {
    recordQa(root, {
      kind: k,
      ref,
      sha: full,
      short: sha,
      cmd,
      exit: r.exit,
      dirtied,
      untracked,
      worktree: wt.id,
      host: 'local',
      ms: r.ms,
      desktop: ctx.desktop,
      failures: failures.slice(0, 200),
      passed: t.passed,
      failed: t.failed,
      needsStub: stub.map((s) => s.name),
      stalled: r.stalled,
      log: log.path,
      ...(k === 'ci' ? { ciFrom: ci?.from ?? null, ciStatus } : {}),
    })
    timing(root, `qa:${k}`, r.ms, full, 'local', r.exit === 0)
  }
  console.log(
    `\nrig qa: ${kinds.join(' + ')} exit ${r.exit} at ${sha}${r.exit === 0 ? '' : '  (NOT green)'}  ${fmtMs(r.ms)}  — recorded in .rig/qa-history.jsonl`,
  )
  if (r.stalled)
    console.log(
      `rig qa: stalled: worker ${r.stalled.worker}, last spec ${r.stalled.spec ?? 'none named'}, quiet ${fmtMs(r.stalled.quietMs)}`,
    )
  if (failures.length && kind !== 'negative') console.log(`rig qa: ${failures.length} failing: ${list(failures)}`)
  if (stub.length) {
    console.log(
      `rig qa: needs a stub (reached for ${[...new Set(stub.map((s) => s.tool))].join(', ')}, which a desktop-free run takes away):`,
    )
    for (const s of stub) console.log(`  ${s.name}   (${s.tool})`)
  } else if (calls.length)
    console.log(
      `rig qa: clipboard tools were called ${calls.length}× (${[...new Set(calls.map((c) => c.tool))].join(', ')}) and failed fast; no failing spec matched them`,
    )
  if (kinds.includes('ci')) printCiStatus(ciStatus, r.exit, '')
  if (dirtied.length || untracked.length) console.log(dirtyMessage(dirtied, untracked))
  return { ...r, cmd, failures, needsStub: stub.map((s) => s.name), tally: t, ciStatus, label: `${kind} here` }
}

function printCiStatus(status, exit, where) {
  const said = status ? `${status.state}${status.text ? ` (${status.text})` : ''}` : 'not posted (RIG_CI_STATUS left empty)'
  console.log(`rig qa: CI status${where} ${said}`)
  if (exit === 0 && status?.state === 'failure')
    console.log(`rig qa: NOT green${where}: the CI exited 0 but posted failure, and the posted verdict counts`)
}

/** The same run on the host, recorded with host: '<ssh-host>'. */
async function hostStage(ctx, kinds, cmd, { seed = null, record = true } = {}) {
  const { root, host, full, sha, ref, by } = ctx
  const env = { RIG_QA_SHA: sha, ...(seed ? { RIG_SEED: seed } : {}) }
  const ci = kinds.includes('ci')
  const r = await runHost({
    root,
    host,
    sha: full,
    cmd: ci ? ciOnHost(cmd) : cmd,
    session: by,
    env,
    limitMs: ctx.limitMs,
    stallMs: ctx.stallMs,
    pattern: ctx.pattern,
    desktop: ctx.desktop,
    ci,
  })
  if (record)
    for (const k of kinds) {
      recordQa(root, {
        kind: k,
        ref,
        sha: full,
        short: sha,
        cmd,
        exit: r.exit,
        host,
        ms: r.ms,
        dir: r.dir,
        db: r.db,
        failures: r.failures.slice(0, 200),
        passed: r.tally.passed,
        failed: r.tally.failed,
        needsStub: r.needsStub,
        stalled: r.stalled,
        error: r.error,
        ...(k === 'ci' ? { ciStatus: r.ciStatus } : {}),
      })
      timing(root, 'qa:host', r.ms, full, host, r.exit === 0)
    }
  if (record) {
    console.log(`\nrig qa: ${kinds.join(' + ')} on ${host} exit ${r.exit} at ${sha}  ${fmtMs(r.ms)}`)
    if (r.stalled) console.log(`rig qa: stalled on ${host}, last spec ${r.stalled.spec ?? 'none named'}, quiet ${fmtMs(r.stalled.quietMs)}`)
    if (ci) printCiStatus(r.ciStatus, r.exit, ` on ${host}`)
  }
  return { ...r, label: `${kinds[0]} on ${host}` }
}

/** Both machines' tallies, side by side. */
export function sideBySide(here, there, host) {
  const rows = [
    ['', 'here', host],
    ['exit', here.exit, there.exit],
    ['passed', here.tally.passed ?? '—', there.tally.passed ?? '—'],
    ['failed', here.tally.failed, there.tally.failed],
    ['time', fmtMs(here.ms), fmtMs(there.ms)],
  ]
  const w = [8, Math.max(...rows.map((r) => String(r[1]).length)) + 3]
  console.log('')
  for (const r of rows) console.log(`  ${String(r[0]).padEnd(w[0])}${String(r[1]).padEnd(w[1])}${r[2]}`)
  const onlyHere = here.failures.filter((f) => !there.failures.includes(f))
  const onlyThere = there.failures.filter((f) => !here.failures.includes(f))
  if (onlyHere.length) console.log(`  fails only here: ${list(onlyHere)}`)
  if (onlyThere.length) console.log(`  fails only on ${host}: ${list(onlyThere)}`)
}

/**
 * Run the same command on the base in a second pinned QA worktree, and add the comparison to the
 * head's test record. The base run is skipped only when every head run is green with no failures,
 * because then nothing can be new whatever the base does.
 */
async function baselineStage(ctx, args, here, there) {
  const { root, cfg, full, sha, ref } = ctx
  const explicit = optionalValues(args)['--baseline']
  const baseBranch = cfg.base || currentBranch(root)
  let baseSha
  let base
  if (explicit) {
    base = explicit
    const r = tryGit(['rev-parse', '--verify', `${explicit}^{commit}`], root)
    if (!r.ok) return console.error(`\nrig qa: --baseline ${explicit} is not a commit here; no baseline recorded.`)
    baseSha = r.out
  } else {
    const r = tryGit(['merge-base', full, baseBranch], root)
    if (!r.ok) return console.error(`\nrig qa: no merge base between ${sha} and ${baseBranch}; no baseline recorded.`)
    base = `merge-base with ${baseBranch}`
    baseSha = r.out
  }
  const baseShort = baseSha.slice(0, 7)
  const runs = [here, there].filter(Boolean)
  const record = (baseline) => {
    recordQa(root, { kind: 'baseline', ref, sha: full, short: sha, host: 'local', cmd: here.cmd, baseline })
    printBaseline(baseline, ctx.host)
  }
  if (baseSha === full) {
    return record({
      base,
      baseSha,
      ...compareBaseline({ here: here.failures, there: there?.failures, base: here.failures, runs }),
      note: 'the commit is its own base',
    })
  }
  if (runs.every((r) => r.exit === 0 && r.failures.length === 0)) {
    return record({
      base,
      baseSha,
      newFailures: [],
      known: [],
      fixed: [],
      needsStub: [],
      complete: true,
      why: null,
      note: 'the head is green; nothing can be new, base not run',
    })
  }
  const cmd = here.cmd
  const bwt = acquireQaWorktree(root, cfg, baseSha, {})
  process.on('exit', bwt.release)
  const port = ctx.port + 50 + bwt.index
  console.log(`\n── baseline: ${base} @ ${baseShort} in ${bwt.id} (port ${port}) ──\n$ ${cmd}\n`)
  const log = openLog(root, baseShort, 'baseline')
  const r = await runWatched(cmd, {
    cwd: bwt.path,
    env: { ...ctx.env, PORT: String(port), RIG_QA_SHA: baseShort },
    limitMs: ctx.limitMs,
    stallMs: ctx.stallMs,
    workerLogs: cfg.qaWorkerLogs || null,
    log: log.fd,
  })
  if (log.fd !== null) closeSync(log.fd)
  bwt.release()
  timing(root, 'qa:baseline', r.ms, full, 'local', r.exit === 0)
  const baseFailures = parseFailures(r.text, { pattern: ctx.pattern })
  const cmp = compareBaseline({
    here: here.failures,
    there: there?.failures ?? null,
    base: baseFailures,
    needsStub: [...new Set([...(here.needsStub ?? []), ...(there?.needsStub ?? [])])],
    runs: [...runs, { label: `the base run (${baseShort})`, exit: r.exit, failures: baseFailures, stalled: r.stalled }],
  })
  record({ base, baseSha, baseExit: r.exit, baseFailed: baseFailures.length, baseLog: log.path, stalled: r.stalled, ...cmp })
}

function printBaseline(b, host) {
  console.log(`\nrig qa: baseline ${b.base} @ ${b.baseSha.slice(0, 7)}${b.note ? ` (${b.note})` : ''}`)
  if (!b.complete) {
    console.log(`  NOT COMPUTED: ${b.why}. "0 new" cannot be claimed from this run.`)
  } else if (b.newFailures.length === 0) console.log(`  0 new failures${b.known.length ? `, ${b.known.length} known` : ''}`)
  if (b.newFailures.length) {
    console.log(`  ${b.newFailures.length} NEW (pass on the base, fail here):`)
    for (const n of b.newFailures) console.log(`    ${n}`)
  }
  if (b.known.length) {
    console.log(`  known (also fail on the base), and where they fail now${host ? ` (here / ${host} / both)` : ''}:`)
    for (const k of b.known) console.log(`    ${k.name}   ${k.where === 'there' ? host : k.where}`)
  }
  if (b.needsStub?.length) console.log(`  needs a stub, not counted as new: ${list(b.needsStub)}`)
  if (b.fixed?.length) console.log(`  fixed (fail on the base, pass here): ${list(b.fixed)}`)
}

/**
 * --repeat N: the one file, N times, a seed each, here and on the host at the same time. Recorded
 * as kind "repeat", never "test": a single file green N times is a flake proof, not a suite pass,
 * and must not stand in for one at the finish gate.
 */
async function repeatRuns(ctx, args, { n, seeds: listed }) {
  const { root, wt, full, sha, ref, host } = ctx
  const cmd = argOf(args, '--run')
  const seeds = planSeeds(n, listed)
  const how = withSeed(cmd, seeds[0]).how
  console.log(`\nrepeat: ${seeds.length} run${seeds.length === 1 ? '' : 's'} of ${cmd}`)
  console.log(
    `  seeds ${seeds.join(', ')}${listed.length ? ` (listed: ${listed.join(', ')})` : ''}; passed as RIG_SEED${how === 'RIG_SEED' ? '' : ` and ${how}`}`,
  )
  const series = async (machine) => {
    const out = []
    for (const seed of seeds) {
      const c = withSeed(cmd, seed).cmd
      if (machine === 'local') {
        const clean = cleanWorktree(wt.path)
        if (clean.reset.length || clean.removed.length)
          console.log(`  (reset before seed ${seed}: ${[...clean.reset, ...clean.removed].join(', ')})`)
        console.log(`\n── seed ${seed} ──\n$ ${c}\n`)
        const r = await runWatched(c, { cwd: wt.path, env: { ...ctx.env, RIG_SEED: seed }, limitMs: ctx.limitMs, stallMs: ctx.stallMs })
        out.push({ seed, exit: r.exit, ms: r.ms, stalled: r.stalled, failures: parseFailures(r.text, { pattern: ctx.pattern }) })
      } else {
        const r = await hostStage(ctx, ['repeat'], c, { seed, record: false })
        out.push({ seed, exit: r.exit, ms: r.ms, failures: r.failures })
      }
    }
    return out
  }
  const [here, there] = await Promise.all([series('local'), host ? series('host') : null])
  let exit = 0
  for (const [machine, res] of [
    ['local', here],
    [host, there],
  ]) {
    if (!res) continue
    const failedSeeds = res.filter((r) => r.exit !== 0).map((r) => r.seed)
    const ms = res.reduce((a, r) => a + r.ms, 0)
    recordQa(root, {
      kind: 'repeat',
      ref,
      sha: full,
      short: sha,
      cmd,
      host: machine,
      exit: failedSeeds.length ? 1 : 0,
      ms,
      repeat: { n: seeds.length, seeds, failedSeeds, how },
      failures: [...new Set(res.flatMap((r) => r.failures))].slice(0, 200),
    })
    timing(root, machine === 'local' ? 'qa:repeat' : 'qa:host', ms, full, machine, failedSeeds.length === 0)
    if (failedSeeds.length) exit = 1
  }
  console.log(`\nrig qa: repeat at ${sha}`)
  console.log(`  ${'seed'.padEnd(12)}${'here'.padEnd(10)}${host ?? ''}`)
  for (let i = 0; i < seeds.length; i++) {
    const cell = (r) => (r ? (r.exit === 0 ? 'green' : r.stalled ? 'STALLED' : `exit ${r.exit}`) : '')
    console.log(`  ${seeds[i].padEnd(12)}${cell(here[i]).padEnd(10)}${there ? cell(there[i]) : ''}`)
  }
  for (const [machine, res] of [
    ['here', here],
    [host, there],
  ]) {
    if (!res) continue
    const bad = res.filter((r) => r.exit !== 0)
    console.log(
      bad.length
        ? `rig qa: ${machine}: ${bad.length} of ${res.length} FAILED, seeds ${bad.map((r) => r.seed).join(', ')}`
        : `rig qa: ${machine}: ${res.length} of ${res.length} green`,
    )
  }
  ctx.lease?.release?.()
  return exit
}

function timing(root, stage, ms, sha, host, ok) {
  try {
    recordTiming(root, { stage, ms, sha, host, ok })
  } catch (e) {
    console.error(`rig qa: could not record the ${stage} timing: ${e.message}`)
  }
}

function warnStaleBaselines(dir) {
  let stale = []
  try {
    stale = staleBaselines(dir) ?? []
  } catch (e) {
    console.log(`  note: snapshot baselines could not be checked: ${e.message}`)
    return
  }
  if (!stale.length) return
  console.log(`  WARNING: ${stale.length} snapshot baseline${stale.length === 1 ? ' was' : 's were'} recorded before the base moved:`)
  for (const b of stale)
    console.log(`    ${b.file}  recorded from ${String(b.recordedFrom).slice(0, 7)}, ${b.behind} commit${b.behind === 1 ? '' : 's'} behind`)
}

const list = (names, max = 8) =>
  names.length > max ? `${names.slice(0, max).join(', ')} … and ${names.length - max} more` : names.join(', ')

function tryRm(p) {
  try {
    rmSync(p, { force: true })
  } catch {}
}

/**
 * What a run left behind, by path: `tracked` files it modified or deleted and `untracked` files
 * it created. The lock and the run's own `.rig/` are not the tests' doing.
 */
export function dirtiedBy(path) {
  const lines = porcelainLines(path).filter((l) => !l.slice(3).startsWith('.rig/'))
  const pathOf = (l) => {
    const p = l.slice(3)
    return p.includes(' -> ') ? p.split(' -> ')[1] : p
  }
  return {
    tracked: lines.filter((l) => !l.startsWith('??')).map(pathOf),
    untracked: lines.filter((l) => l.startsWith('??')).map(pathOf),
  }
}

export function dirtyMessage(tracked, untracked = []) {
  const n = (k, w) => `${k.length} ${w}${k.length === 1 ? '' : 's'}`
  const parts = []
  if (tracked.length) parts.push(`dirtied ${n(tracked, 'tracked file')}: ${tracked.join(', ')}`)
  if (untracked.length) parts.push(`left ${n(untracked, 'untracked file')}: ${untracked.join(', ')}`)
  return `the tests ${parts.join(' and ')} — untrack it (git rm --cached) or have the test restore it; check-no-personal-data and \`rig finish\` see a dirty tree`
}

/** The plan's negative-control command, if rg2's parser found one; null without a plan. */
function planNegative(root, cfg) {
  try {
    return loadPlan(join(root, cfg.plan)).negativeCommand || null
  } catch {
    return null
  }
}

/**
 * Release the run lock however this process ends: normal exit, ctrl-c, or a kill.
 *
 * A signal is passed on to the command still running in the worktree, and the lock is released only
 * once that child has exited. Releasing first said "free" while `npm test` was still writing into
 * the tree, and the next `rig qa` reset and re-pinned it under the running suite: the one thing the
 * lock exists to stop. The child is ours, running in the worktree we hold, so stopping it keeps the
 * rule that a process is only ever stopped by the working directory it is in.
 */
function holdLock(wt) {
  process.on('exit', wt.release)
  for (const [sig, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ]) {
    process.on(sig, () => {
      // The whole process group, not just the bash wrapper: bash does not pass SIGTERM on to a
      // foreground child, so signalling bash alone left `npx playwright test` running in a tree the
      // lock had just called free. And the lock waits for the whole group, not for bash.
      Promise.all([...running].map((child) => groups.stop(child, sig))).then(() => {
        wt.release()
        process.exit(code)
      })
    })
  }
}

const VALUE_FLAGS = new Set(['--ref', '--branch', '--port', '--run', '--negative', '--timeout', '--stall', '--host', '--repeat', '--by'])

/**
 * Flags whose value is optional, and when the next argument is theirs: `--seeds [<list>]` takes a
 * comma list of numbers; `--baseline [<base>]` takes a ref only once the commit to grade is known, so
 * in `rig qa --baseline 3f2a1b9` the sha is graded against the merge base, and in
 * `rig qa 3f2a1b9 --baseline v5.0.3` against v5.0.3. `--flag=value` always works.
 */
const OPTIONAL_VALUE = {
  '--baseline': { re: /^[^-\s]\S*$/, afterRef: true },
  '--seeds': { re: /^\d+(,\d+)*$/, afterRef: false },
}

/** One walk over the arguments: the bare ref and the optional values, by the rules above. */
function walkArgs(args) {
  let bare = null
  const values = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (VALUE_FLAGS.has(a)) {
      i++
      continue
    }
    const eq = Object.keys(OPTIONAL_VALUE).find((f) => a.startsWith(`${f}=`))
    if (eq) {
      values[eq] = a.slice(eq.length + 1) || null
      continue
    }
    const opt = OPTIONAL_VALUE[a]
    if (opt) {
      const next = args[i + 1]
      if (next !== undefined && opt.re.test(next) && (!opt.afterRef || bare !== null)) {
        values[a] = next
        i++
      } else values[a] = null
      continue
    }
    if (!a.startsWith('-') && bare === null) bare = a
  }
  return { bare, values }
}

/** The values of the optional-value flags: { '--baseline': ref|null, '--seeds': list|null }. */
export const optionalValues = (args) => walkArgs(args).values

/**
 * The commit to pin. `--ref` and `--branch` win; otherwise the first bare argument; otherwise the
 * current branch.
 *
 * The bare argument used to be ignored. `rig qa 3f2a1b9` pinned the worktree to the current branch
 * instead, printed that branch's sha, and exited cleanly — so every lead following a rulebook that
 * said "rig qa <sha>" graded main while believing it had graded the slice. It was right only when
 * main happened to be at that sha.
 */
export function resolveRef(args, fallback) {
  const flagged = argOf(args, '--ref') || argOf(args, '--branch')
  if (flagged) return flagged
  return walkArgs(args).bare ?? fallback
}

/**
 * Run a command line and resolve with its exit status. Uses bash with `pipefail` when bash exists,
 * so `npm test | tail -20` fails when the tests fail instead of reporting tail's success — the
 * other way a red QA run came back 0.
 *
 * `limitMs` stops a command still running past it and resolves 124, as GNU timeout does. On
 * 2026-10-16 a suite left a server listening after a failed check, never exited, and a lead waiting
 * on `rig qa` sat silent for three hours: a hang has to end as a failure with a name. `stallMs` does
 * the same for a run that has stopped writing (src/qa/watch.js).
 */
export function runShell(cmd, opts = {}) {
  return runWatched(cmd, opts).then((r) => r.exit)
}

function argOf(args, name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}
