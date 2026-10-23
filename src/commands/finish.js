import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { mainRoot, loadConfig, currentBranch } from '../config.js'
import { loadPlan, missingBrief } from '../plan.js'
import { worktreePath, dirtyFiles } from '../worktrees.js'
import { reportPath } from '../reports.js'
import { lastNegativeOn, readQa } from '../qalog.js'
import { git, tryGit } from '../sh.js'
import { jot, appsTouch, ghIssueClose, ghAvailable, wrap } from '../desk.js'
import { rigDir } from '../rigdir.js'
import { drift } from '../drift.js'
import { staleBaselines } from '../baselines.js'
import { builderVendor, vendorGate } from '../vendor.js'
import { roundDecisions, roundStart, DECISIONS } from '../decisions.js'
import { foldHolds, latestFolds } from '../fold.js'

// r55q's CI detection (src/qa/ci.js). Loaded when present, so this file also runs on a branch that
// predates it; without it, only a configured ciCommand makes the CI gate required.
const ciModule = await import('../qa/ci.js').catch(() => null)

/** The files detectCi() looks at. */
const CI_FILES = ['package.json', 'bin/ci', 'script/ci', 'script/cibuild', 'Makefile']

/**
 * The repo's CI command as of this sha: ciCommand in the config (null or "" there means none), else
 * what r55q's detectCi finds in the commit itself (package.json scripts.ci, an executable bin/ci or
 * script/ci, a Makefile ci target). The commit's files are copied to a scratch dir with their modes,
 * because the checkout on disk may be at another commit. Returns { cmd, from } or null.
 */
export function ciCommandAt(root, sha, cfg = {}, detect = ciModule?.detectCi) {
  if (Object.hasOwn(cfg, 'ciCommand')) return cfg.ciCommand ? { cmd: cfg.ciCommand, from: 'ciCommand in .rig/config.json' } : null
  if (typeof detect !== 'function') return null
  const dir = mkdtempSync(join(tmpdir(), 'rig-ci-'))
  try {
    for (const f of CI_FILES) {
      const entry = tryGit(['ls-tree', sha, '--', f], root)
      if (!entry.ok || !entry.out) continue
      const [mode, type] = entry.out.split(/\s+/)
      if (type !== 'blob') continue
      const body = tryGit(['show', `${sha}:${f}`], root)
      if (!body.ok) continue
      mkdirSync(dirname(join(dir, f)), { recursive: true })
      writeFileSync(join(dir, f), body.out + '\n')
      if (mode === '100755') chmodSync(join(dir, f), 0o755)
    }
    return detect(dir, cfg)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// Ship means told. `rig finish` is the gate between "the agents stopped" and "it is done": it
// refuses to call a build finished while a slice is unmerged, a tree is dirty, or the tests have not
// run green on the very commit being called done — and when it passes, it writes the finished report
// in the shape a person can trust: what changed, the proof, the pictures, where it lives, what is
// staged for the owner, and what is still owed.

const G = (s) => `\x1b[32m${s}\x1b[0m`,
  R = (s) => `\x1b[31m${s}\x1b[0m`,
  Y = (s) => `\x1b[33m${s}\x1b[0m`

export const USAGE = `rig finish [--base <ref>] [--since <ref>] [--no-review] [--no-vendor] [--no-fetch] [--no-desk] [--no-write] [--wrap "<message>"]

  --base <ref>       the branch every slice must be on (default: the current branch)
  --since <ref>      where this round started, for decisions (default: the oldest slice branch point)
  --no-review        an unreviewed slice warns instead of failing; FINISH.md says so
  --no-vendor        a missing second-vendor pass warns instead of failing; FINISH.md says so
  --no-fetch         print drift against the live base without fetching it first
  --no-desk          do not close issues, jot, or touch the registry even when every gate passes
  --no-write         do not write docs/FINISH.md
  --wrap "<msg>"     after a pass, run \`wrap <slug> "<msg>"\` (the lead's call; crews never pass it)
  --help, -h         this text

Drift against the live base is printed first. Gates: every slice merged, reviewed (docs/review-<id>.md
on base, newer than the slice's last code commit), nothing uncommitted, QA green on this sha, the same
on qaHost when one is configured, the repo's own CI command green on each machine it ran on (and on
every machine when ciCommand is set), negative controls green on this same sha when the config or plan
names them, the QA run left its tree clean, "0 new" against the base baseline when one was recorded,
a pass from a second model vendor on this sha (rig review --vendor), and no decision made this round
still open (${DECISIONS}). Only when every gate passes does it close the slice issues, jot, and touch
the registry.
`

export default function finish(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    return
  }
  if (args.includes('--wrap') && !argOf(args, '--wrap')) {
    console.error('rig finish: --wrap needs a message, e.g. --wrap "shipped 3.0". Nothing was run.')
    process.exit(2)
  }
  if (args.includes('--wrap') && args.includes('--no-desk')) {
    console.error('rig finish: --wrap and --no-desk contradict each other (wrap is a desk action). Nothing was run.')
    process.exit(2)
  }
  const root = mainRoot()
  const cfg = loadConfig(root)
  const plan = loadPlan(join(root, cfg.plan))
  const base = argOf(args, '--base') || currentBranch(root)
  const opts = { noReview: args.includes('--no-review'), noVendor: args.includes('--no-vendor') }
  if (args.includes('--since')) {
    const want = argOf(args, '--since')
    const r = want && tryGit(['rev-parse', '--verify', '-q', `${want}^{commit}`], root)
    if (!r?.ok) {
      console.error(`rig finish: --since needs a commit; "${want ?? ''}" is not one here. Nothing was run.`)
      process.exit(2)
    }
    opts.since = { ref: r.out, from: `--since ${want}` }
  }
  // Drift before the gates: a base that moved is a rebuild, and it has to be known before anything
  // here is read as "ready".
  opts.drift = printDrift(root, {
    base: liveBaseOf(root, cfg, base),
    head: base,
    slices: plan.agents,
    fetch: !args.includes('--no-fetch'),
  })
  console.log('')
  const result = finishChecks(root, cfg, plan, base, opts)
  result.desk =
    result.failed || args.includes('--no-desk')
      ? { skipped: result.failed ? 'a gate failed' : '--no-desk', actions: [] }
      : deskActions(root, cfg, plan, result, { wrap: argOf(args, '--wrap') })

  console.log(`${plan.title} — finish gate on ${base} @ ${result.short}\n`)
  for (const c of result.checks) {
    const tag = c.state === 'ok' ? G('  ok  ') : c.state === 'fail' ? R(' FAIL ') : Y(' warn ')
    console.log(`${tag} ${c.name}${c.detail ? '  — ' + c.detail : ''}`)
  }

  if (opts.noReview) console.log(Y('\n--no-review: unreviewed slices warn instead of failing; FINISH.md says so.'))
  if (opts.noVendor) console.log(Y('\n--no-vendor: no second-vendor pass is required; FINISH.md says so.'))
  if (result.decisions?.list.length) {
    console.log(`\nDecisions ${result.decisions.scope}:`)
    for (const d of result.decisions.list) console.log(`  ${d.kind === 'open' ? R('OPEN') : G(' ok ')}  ${d.id}  ${d.what}  — ${d.status}`)
  }
  if (!args.includes('--no-write')) {
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'docs', 'FINISH.md'), finishReport(plan, result, opts))
    console.log('\nwrote docs/FINISH.md')
  }
  if (result.failed) {
    console.log(
      R(`\nnot finished: ${result.checks.filter((c) => c.state === 'fail').length} gate(s) failed.`) +
        ' Nothing was closed, jotted or touched.',
    )
    process.exitCode = 1
  } else {
    console.log(G('\nfinished: every gate passed.') + " Review the report, then ship (deploys, releases and posts are the owner's call).")
    console.log('\nDesk:')
    for (const a of result.desk.actions)
      console.log(`  ${a.ran ? (a.ok ? G('done') : R('failed')) : Y('skip')}  ${a.what}${a.why ? '  — ' + a.why : ''}`)
    if (result.desk.skipped) console.log(`  skipped (${result.desk.skipped})`)
    console.log(`\nnext: wrap ${result.desk.slug} "${result.desk.line}"`)
  }
}

/**
 * The desk work a passing finish does, and only a passing one: close each slice's issue with the
 * QA line, jot one line to the decision log, touch the registry. `wrap` runs only when the lead
 * passed `--wrap`: a crew may not end a session on the owner's behalf.
 */
export function deskActions(root, cfg, plan, r, { wrap: wrapMessage = null } = {}) {
  const actions = []
  const slug = cfg.slug || slugFor(root.split('/').pop())
  const cmd = r.qa?.cmd || 'QA'
  const line = `${plan.title}: finished at ${r.short}; ${cmd} exit 0; ${plan.agents.length} slices`
  // `rig finish` then `rig finish --wrap` is the normal sequence, and the log must not get the same
  // line twice. What was jotted is remembered per sha in .rig/finish.json.
  const donePath = join(root, '.rig', 'finish.json')
  let done = {}
  if (existsSync(donePath)) {
    try {
      done = JSON.parse(readFileSync(donePath, 'utf8'))
    } catch {
      done = {}
    }
  }
  const already = done[r.sha]

  const issuesPath = join(root, '.rig', 'issues.json')
  let issues = null
  if (existsSync(issuesPath)) {
    try {
      issues = JSON.parse(readFileSync(issuesPath, 'utf8'))
    } catch {
      issues = null
    }
  }
  if (!issues)
    actions.push({ what: 'close slice issues', ran: false, why: 'no .rig/issues.json (rig up opens them when gh and a remote exist)' })
  else {
    const gh = ghAvailable(root)
    for (const a of plan.agents) {
      const entry = issues[a.id]
      if (!entry?.number) {
        actions.push({ what: `close ${a.id} issue`, ran: false, why: 'no issue recorded' })
        continue
      }
      if (!gh.ok) {
        actions.push({ what: `close ${a.id} issue #${entry.number}`, ran: false, why: gh.why })
        continue
      }
      const res = ghIssueClose(root, entry.number, `Finished: \`${cmd}\` exit 0 on \`${r.short}\` (rig finish)`)
      actions.push({ what: `close ${a.id} issue #${entry.number}`, ...res })
    }
  }
  if (already?.jotted) {
    actions.push({ what: `jot "[${slug}] ${line}"`, ran: false, why: `already jotted on ${r.short} (${already.jotted})` })
    actions.push({ what: `apps touch ${slug}`, ran: false, why: `already touched on ${r.short}` })
  } else {
    const j = jot(`[${slug}] ${line}`)
    actions.push({ what: `jot "[${slug}] ${line}"`, ...j })
    const t = appsTouch(slug)
    actions.push({ what: `apps touch ${slug}`, ...t })
    if (j.ran && j.ok) {
      done[r.sha] = { jotted: new Date().toISOString(), slug }
      rigDir(root)
      writeFileSync(donePath, JSON.stringify(done, null, 2) + '\n')
    }
  }
  if (wrapMessage) actions.push({ what: `wrap ${slug} "${wrapMessage}"`, ...wrap(slug, wrapMessage) })
  return { slug, line, actions, skipped: null }
}

function argOf(args, name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}

/**
 * The live base to compare with: \`liveBase\` in the config, else the base branch's upstream, else
 * origin/<base> when it exists, else null (nothing to compare with, and drift says so).
 */
export function liveBaseOf(root, cfg, base) {
  if (cfg.liveBase) return cfg.liveBase
  const local = String(base).replace(/^refs\/heads\//, '')
  const up = tryGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${local}@{upstream}`], root)
  if (up.ok && up.out) return up.out
  if (tryGit(['rev-parse', '--verify', '-q', `refs/remotes/origin/${local}`], root).ok) return `origin/${local}`
  return null
}

/** Run drift() and print it, first, in four lines at most. Returns what drift() returned (or null). */
export function printDrift(root, { base, head = 'HEAD', slices = [], fetch = true }) {
  if (!base) {
    console.log(Y('drift: no live base to compare with (no upstream, no origin/<base>; set liveBase in .rig/config.json)'))
    return null
  }
  let d
  try {
    d = drift(root, { base, head, slices, fetch })
  } catch (e) {
    d = { base, head, moved: false, since: [], touched: [], safe: [], merges: null, conflicts: [], error: e.message }
  }
  if (d.error) {
    console.log(Y(`drift vs ${d.base}: could not check — ${d.error}`))
    return d
  }
  if (!d.moved) {
    console.log(G(`drift vs ${d.base}: none`) + ' — the live base has nothing this stack lacks')
    return d
  }
  const merge =
    d.merges === false ? R(`does NOT merge (${d.conflicts.join(', ') || 'conflicts'})`) : d.merges ? 'still merges' : 'merge unknown'
  console.log(Y(`drift vs ${d.base}: moved ${d.since.length} commit(s)`) + `; ${merge}`)
  if (d.touched.length)
    console.log(`  touched: ${d.touched.map((t) => `${t.file}${t.slices.length ? ` (${t.slices.join(', ')})` : ''}`).join(', ')}`)
  if (d.safe.length) console.log(`  safe: ${d.safe.length} owned file(s) untouched`)
  console.log('  the base moved: rebuild the round before reviews (rig rebase <id>), not after them')
  return d
}

/** The drift gate, from what drift() returned: a stack that no longer merges fails; a moved base warns. */
export function driftCheck(d) {
  if (!d) return { state: 'warn', detail: 'no live base to compare with' }
  if (d.error) return { state: 'warn', detail: `could not check: ${d.error}` }
  if (!d.moved) return { state: 'ok', detail: `${d.base} has not moved` }
  if (d.merges === false)
    return {
      state: 'fail',
      detail: `${d.base} moved ${d.since.length} commit(s) and the stack no longer merges: ${d.conflicts.join(', ')}`,
    }
  return {
    state: 'warn',
    detail: `${d.base} moved ${d.since.length} commit(s)${d.touched.length ? `, touching ${d.touched.length} owned file(s)` : ''}; rebuild before calling it ready`,
  }
}

/**
 * The newest QA record of this kind on exactly this sha, on one machine: 'local' (records written
 * before hosts existed are local) or an ssh host. A run on the second machine never answers for this one.
 */
export function runOn(root, sha, kind, host = 'local') {
  const isHost = (e) => (host === 'local' ? !e.host || e.host === 'local' : e.host === host)
  return (
    readQa(root)
      .filter((e) => e.sha === sha && (e.kind || 'test') === kind && isHost(e))
      .pop() || null
  )
}

/** Run every gate. Returns { checks: [{ name, state: ok|fail|warn, detail }], failed, sha, short, qa, shots }. */
export function finishChecks(root, cfg, plan, base, opts = {}) {
  const checks = []
  const add = (name, state, detail = '') => checks.push({ name, state, detail })
  const sha = git(['rev-parse', base], root)
  const short = git(['rev-parse', '--short', base], root)
  const unmerged = new Set()

  // 1. Every slice's work is on base.
  for (const a of plan.agents) {
    const branch = cfg.branchPrefix + a.id
    const ref = `refs/heads/${branch}` // full ref: a same-named tag must not answer for the branch
    const exists = tryGit(['show-ref', '--verify', '--quiet', ref], root).ok
    if (!exists) {
      // No branch is fine when the slice's report is on base. No branch and no report is a slice that
      // was never built, and "merged" must not be the word for that.
      const reported = tryGit(['cat-file', '-e', `${base}:${reportPath(a)}`], root).ok
      add(
        `${a.id} merged`,
        reported ? 'ok' : 'fail',
        reported ? 'no branch left' : `no branch and no ${reportPath(a)} on ${base}: was ${a.id} ever built?`,
      )
      continue
    }
    const ahead = Number(tryGit(['rev-list', '--count', `${base}..${ref}`], root).out || 0)
    if (ahead === 0) {
      add(`${a.id} merged`, 'ok')
      continue
    }
    const applied = branchApplied(root, base, ref)
    if (!applied) unmerged.add(a.id)
    add(
      `${a.id} merged`,
      applied ? 'ok' : 'fail',
      applied ? 'squash or rebase merge (every change already on base)' : `${branch} has ${ahead} commit(s) not on ${base}`,
    )
  }

  // 1b. Review before merge, by default. Every slice on a crew night had real defects that only
  // cross-review found. A slice that changed code needs `docs/review-<id>.md` on base, and it must
  // be newer than the slice's last code commit, or it reviewed something else.
  for (const a of plan.agents) {
    const rv = reviewState(root, plan, a, base, cfg, { unmerged: unmerged.has(a.id) })
    const state = rv.ok ? 'ok' : opts.noReview ? 'warn' : 'fail'
    add(`${a.id} reviewed`, state, rv.detail + (state === 'warn' ? ' (--no-review)' : ''))
  }

  // 2. Nothing verified is sitting uncommitted.
  const trees = [{ id: 'main', path: root }, ...plan.agents.map((a) => ({ id: a.id, path: worktreePath(root, cfg, a.id) }))]
  const dirty = trees
    .filter((t) => existsSync(t.path))
    .map((t) => ({ ...t, files: dirtyFiles(t.path).filter((f) => !f.startsWith('.rig/') && f !== 'docs/FINISH.md') }))
    .filter((t) => t.files.length)
  add(
    'no uncommitted work',
    dirty.length ? 'fail' : 'ok',
    dirty.map((t) => `${t.id}: ${t.files.slice(0, 3).join(', ')}${t.files.length > 3 ? ` …+${t.files.length - 3}` : ''}`).join('; '),
  )

  // 0. Drift, as a gate: printed before everything, and a stack that no longer merges is not ready.
  if ('drift' in opts) {
    const dc = driftCheck(opts.drift)
    add('the stack merges with the live base', dc.state, dc.detail)
  }

  // 3. The tests ran, and passed, on exactly this commit. Passed means exit 0, or (Chromium's test
  // expectations) every failure is one the base already has: a complete "0 new" comparison recorded
  // on this sha after the run. A stalled or killed run (124, 137, 143) never finished: never green.
  const qa = runOn(root, sha, 'test')
  const hostQa = cfg.qaHost ? runOn(root, sha, 'test', cfg.qaHost) : null
  const baselineRun = runOn(root, sha, 'baseline')
  // A waiver is bound to the exact run the comparison read (second-vendor review, 949e12b #2): a
  // local-only "0 new" says nothing about a host run it never saw. r55q's `baseline.compared` names
  // each run by host, command and record time; an older record without it covers only the local run
  // with its own command, recorded before it. Either way every failure the run names must be one the
  // comparison found known on the base, on that run's side.
  const hostOf = (run) => run.host || 'local'
  const covers = (rec, run) => {
    if (rec === run) return true // a baseline field on the run itself
    const b = rec.baseline
    if (Array.isArray(b.compared))
      return b.compared.some((c) => (c.host || 'local') === hostOf(run) && c.cmd === run.cmd && c.at === run.at)
    return hostOf(run) === 'local' && rec.cmd === run.cmd && String(rec.at) >= String(run.at)
  }
  const waiver = (run) => {
    if (!run || run.exit === 0) return { ok: false }
    if (run.stalled || [124, 137, 143].includes(run.exit)) return { ok: false, why: 'it never finished' }
    const rec = baselineRun?.baseline ? baselineRun : run.baseline ? run : null
    const b = rec?.baseline
    if (!b) return { ok: false }
    if (b.complete === false || (b.newFailures || []).length) return { ok: false }
    if (!covers(rec, run))
      return { ok: false, why: `the baseline on this sha did not compare this run (${hostOf(run)}, ${run.cmd}): rerun it with --baseline` }
    const sides = rec === run ? null : hostOf(run) === 'local' ? ['here', 'both'] : ['there', 'both']
    const known = new Set((b.known || []).filter((k) => !sides || sides.includes(k.where)).map((k) => k.name))
    const names = run.failures || []
    const unknown = names.filter((x) => !known.has(x))
    if (!names.length) return { ok: false, why: 'it named no failure to compare' }
    if (unknown.length)
      return { ok: false, why: `not known on the base: ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? ' …' : ''}` }
    return {
      ok: true,
      why: `exited ${run.exit}, but every failure is known on the base: 0 new against ${String(b.baseSha || '').slice(0, 7) || b.base}`,
    }
  }
  const knownOnly = (run) => (waiver(run).ok ? waiver(run).why : null)
  const failWhy = (run) => `exited ${run.exit}${waiver(run).why ? ` (not waived: ${waiver(run).why})` : ''}`
  const qaState = (run) => (run.exit === 0 || knownOnly(run) ? 'ok' : 'fail')
  if (!qa) add(`QA green on ${short}`, 'fail', `no \`rig qa ${short} --run …\` recorded on this commit`)
  else add(`QA green on ${short}`, qaState(qa), qa.exit === 0 ? qa.cmd : knownOnly(qa) || `last run ${failWhy(qa)}: ${qa.cmd}`)
  if (qa && cfg.devCommand && qa.cmd !== cfg.devCommand)
    add('QA ran the project’s test command', 'warn', `ran "${qa.cmd}", the config's devCommand is "${cfg.devCommand}"`)

  // 3a. The second machine, when there is one: a second OS caught 34 platform-only failures and a
  // 1-in-3 flake the first never showed. Its tally has to be on this sha too.
  const hosts = ['local', ...(cfg.qaHost ? [cfg.qaHost] : [])]
  if (cfg.qaHost) {
    if (!hostQa) add(`QA green on ${cfg.qaHost}`, 'fail', `no \`rig qa ${short} --host ${cfg.qaHost}\` recorded on this commit`)
    else
      add(
        `QA green on ${cfg.qaHost}`,
        qaState(hostQa),
        `${tally(hostQa)} beside ${qa ? tally(qa) : 'no local run'} here${hostQa.exit === 0 ? '' : ` — ${knownOnly(hostQa) || failWhy(hostQa)}`}`,
      )
  }

  // 3a'. The repo's own CI command is the gate where it has one; the rig's checks come on top. When
  // it is configured it must have run; when it ran anywhere, it must have run (and passed) everywhere.
  const ciRuns = hosts.map((h) => ({ host: h, run: runOn(root, sha, 'ci', h) }))
  const ci = ciCommandAt(root, sha, cfg, 'detectCi' in opts ? opts.detectCi : undefined)
  if (ci || ciRuns.some((c) => c.run)) {
    for (const { host, run } of ciRuns) {
      const name = `CI command green on ${short}${hosts.length > 1 ? ` (${host})` : ''}`
      if (!run)
        add(
          name,
          'fail',
          `${ci ? `"${ci.cmd}" (${ci.from})` : 'the CI command'} has no run recorded on this commit${host === 'local' ? '' : ` on ${host}`}: \`rig qa ${short}${host === 'local' ? '' : ` --host ${host}`}\``,
        )
      // A CI command can exit 0 and still post "failure" (r55q reads RIG_CI_STATUS): both must agree.
      // The record must be of today's command: ciCommand lives in untracked config, so changing it
      // leaves the sha alone, and a pass of the old command is stale evidence (949e12b #4).
      else if (ci && run.cmd !== ci.cmd)
        add(
          name,
          'fail',
          `stale: the run recorded${host === 'local' ? '' : ` on ${host}`} is of "${run.cmd}", today's CI command is "${ci.cmd}" (${ci.from}): \`rig qa ${short}${host === 'local' ? '' : ` --host ${host}`}\``,
        )
      else if (run.ciStatus?.state === 'failure')
        add(name, 'fail', `${run.cmd} posted failure${run.ciStatus.text ? `: ${run.ciStatus.text}` : ''}`)
      else add(name, run.exit === 0 ? 'ok' : 'fail', run.exit === 0 ? run.cmd : `exited ${run.exit}: ${run.cmd}`)
    }
  }

  // 3a''. "0 new" is a computed fact against the base's own run, shown when it was computed: a
  // `kind: 'baseline'` record on this sha (one comparison for both machines), or a `baseline` field
  // on the test run itself.
  const baselines = baselineRun?.baseline
    ? [{ b: baselineRun.baseline, where: '' }]
    : [qa, hostQa].filter((r) => r?.baseline).map((r) => ({ b: r.baseline, where: r.host && r.host !== 'local' ? ` on ${r.host}` : '' }))
  for (const { b, where } of baselines) {
    const known = (b.known || []).map((k) => `${k.name} (${k.where})`)
    const fresh = b.newFailures || []
    const name = `0 new failures against ${b.base || 'the base'}${where}`
    if (fresh.length) add(name, 'fail', `${fresh.length} new: ${fresh.slice(0, 5).join(', ')}${fresh.length > 5 ? ' …' : ''}`)
    else if (b.complete === false) add(name, 'warn', `not computed: ${b.why || 'the base run did not finish'}`)
    else
      add(
        name,
        'ok',
        `0 new, ${known.length} known on ${String(b.baseSha || '').slice(0, 7) || 'the base'}${known.length ? `: ${known.slice(0, 5).join(', ')}` : ''}`,
      )
  }
  for (const run of [qa, hostQa].filter((r) => r?.needsStub?.length))
    add('specs that need a stub', 'warn', `${run.needsStub.join(', ')} reach for the desktop (clipboard or display)`)

  // 3b. The negatives went red again on THIS sha. Four source-patching controls silently went NOT
  // RED after a formatter moved the strings they anchored on; the sha changed, so the record must.
  if (wantsNegative(cfg, plan)) {
    const neg = lastNegativeOn(root, sha)
    const why = 'formatting moves the strings source-patching controls anchor on; re-run `rig qa ' + short + ' --negative`'
    if (!neg) add(`negative controls red on ${short}`, 'fail', `no negative run recorded on this commit — ${why}`)
    else
      add(
        `negative controls red on ${short}`,
        neg.exit === 0 ? 'ok' : 'fail',
        neg.exit === 0 ? neg.cmd : `last negative run exited ${neg.exit}: ${neg.cmd} — ${why}`,
      )
  }

  // 3c. The tree was clean right after the tests. A file a test writes is invisible in a suite's
  // own output and shows up as a dirty tree at the next commit, or in someone else's pre-commit check.
  // Source-patching negative controls are the runs most likely to leave a patched file behind, so
  // the negative run's leftovers count too, named by run.
  const negRun = lastNegativeOn(root, sha)
  const left = [...(qa?.dirtied || []).map((f) => `${f} (test run)`), ...(negRun?.dirtied || []).map((f) => `${f} (negative run)`)]
  if (qa)
    add(
      'QA left the tree clean',
      left.length ? 'fail' : 'ok',
      left.length ? `${left.length} file(s) written: ${left.join(', ')} — untrack it or have the test restore it` : '',
    )

  // 3c'. After a fold, only message-only rewrites: every stamped commit's tree is on the branch as stamped.
  const folds = latestFolds(root)
  const baseName = String(base).replace(/^refs\/heads\//, '')
  for (const [branch, stamp] of folds) {
    const isSlice = plan.agents.some((a) => cfg.branchPrefix + a.id === branch)
    if (branch !== baseName && !isSlice) continue
    const ref = branch === baseName ? sha : `refs/heads/${branch}`
    if (branch !== baseName && !tryGit(['show-ref', '--verify', '--quiet', ref], root).ok) continue
    const h = foldHolds(root, ref, stamp)
    add(`fold on ${branch} holds`, h.state, h.detail)
  }

  // 3d. A reviewer from a second model vendor passed exactly this sha. Same-vendor reviews passed
  // nine real defects that one from another vendor found.
  const vg = vendorGate(root, sha, cfg)
  const vendorState = vg.state === 'ok' ? 'ok' : opts.noVendor ? 'warn' : 'fail'
  add(`second-vendor pass on ${short}`, vendorState, vg.detail + (vendorState === 'warn' ? ' (--no-vendor)' : ''))

  // 3e. Every decision made this round is built, scheduled for a named round, or out of scope.
  const since = opts.since || roundStart(root, sha, plan.agents, cfg.branchPrefix)
  const dec = roundDecisions(root, sha, since)
  const open = dec.round.filter((d) => d.kind === 'open')
  if (!dec.round.length && !dec.older.length) add('decisions closed', 'ok', `no decisions in ${DECISIONS}`)
  else
    add(
      'decisions closed',
      open.length ? 'fail' : 'ok',
      open.length
        ? `${open.length} open ${dec.scope}: ${open.map((d) => d.id).join(', ')} — rig decision <id> --built | --scheduled <round> | --not-in-scope`
        : `${dec.round.length} ${dec.scope}, none open`,
    )
  const olderOpen = dec.older.filter((d) => d.kind === 'open')
  if (olderOpen.length) add('older decisions', 'warn', `${olderOpen.map((d) => d.id).join(', ')} still open from an earlier round`)

  // 3f. Snapshot baselines recorded before the base moved past them.
  let stale = []
  try {
    stale = staleBaselines(root, { base }) || []
  } catch {
    stale = []
  }
  if (stale.length)
    add('snapshot baselines current', 'warn', stale.map((b) => `${b.file} (${b.behind} behind ${b.recordedFrom.slice(0, 7)})`).join(', '))

  // 4. Every slice left its reasoning on base.
  for (const a of plan.agents) {
    const p = reportPath(a)
    const onBase = tryGit(['cat-file', '-e', `${base}:${p}`], root).ok
    add(`${a.id} report`, onBase ? 'ok' : 'warn', onBase ? p : `${p} is not on ${base}`)
  }

  // 5. Someone asked for the red.
  const reportTexts = plan.agents
    .map((a) => tryGit(['show', `${base}:${reportPath(a)}`], root))
    .filter((r) => r.ok)
    .map((r) => r.out)
  const anyRed = reportTexts.some((t) => /negative control|went red|made it red|goes red|\bVOID\b/i.test(t))
  add('a check was shown to go red', anyRed ? 'ok' : 'warn', anyRed ? '' : 'no report mentions a negative control; ask for the red')

  // 6. The brief was a brief: "done" is only checkable against a stated "what done looks like".
  const gaps = missingBrief(plan)
  add('the plan’s brief is complete', gaps.length ? 'warn' : 'ok', gaps.length ? `missing: ${gaps.join(', ')}` : '')

  // 7. Pictures, and a README that says how to open it.
  const shots = findShots(root)
  add(
    'screenshots',
    shots.length ? 'ok' : 'warn',
    shots.length ? `${shots.length} in docs/` : 'none under docs/ — show it before calling it done',
  )
  add('README', existsSync(join(root, 'README.md')) ? 'ok' : 'warn', existsSync(join(root, 'README.md')) ? '' : 'missing')

  return {
    checks,
    failed: checks.some((c) => c.state === 'fail'),
    sha,
    short,
    qa,
    hostQa,
    shots,
    vendor: { ...vg, builder: builderVendor(cfg) },
    decisions: { list: dec.round, scope: dec.scope },
    drift: opts.drift ?? null,
  }
}

/** "exit 0, 412 passed" from a QA record, with whatever tallies it carries. */
function tally(run) {
  const parts = [`exit ${run.exit}`]
  for (const k of ['passed', 'failed', 'skipped']) if (typeof run[k] === 'number') parts.push(`${run[k]} ${k}`)
  if (run.tally && typeof run.tally === 'object')
    for (const [k, v] of Object.entries(run.tally)) if (!parts.some((p) => p.endsWith(k))) parts.push(`${v} ${k}`)
  return parts.join(', ')
}

/** The registry slug for a directory name: the same rule as `rig init` (rg2's slugFor). */
export function slugFor(name) {
  return (
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'app'
  )
}

/**
 * Would merging `ref` into `base` change anything? Squash and rebase merges leave the branch's own
 * commits "ahead" forever, so this asks the question that matters: if the merged tree is base's
 * own tree, every change is already there. (`git cherry` compares commit by commit and misses a
 * squash of several commits.) Older git without merge-tree --write-tree falls back to cherry.
 */
export function branchApplied(root, base, ref) {
  const mt = tryGit(['merge-tree', '--write-tree', base, ref], root)
  if (mt.ok) return mt.out.split('\n')[0] === git(['rev-parse', `${base}^{tree}`], root)
  if (/conflict/i.test(mt.out + mt.err)) return false
  const cherry = tryGit(['cherry', base, ref], root)
  const lines = cherry.ok ? cherry.out.split('\n').filter(Boolean) : []
  return lines.length > 0 && lines.every((l) => l.startsWith('-'))
}

/** cfg.negativeCommand, the plan's own, or a Checks section that speaks of negatives. */
export function wantsNegative(cfg, plan) {
  return Boolean(cfg.negativeCommand || plan.negativeCommand || /negative/i.test(plan.checks || ''))
}

/**
 * Is this slice's code reviewed? A slice that only changed `docs/` needs no review. Otherwise the
 * review file has to be on base and at least as new as the slice's last code commit there.
 *
 * "Last code commit" is the newest commit on base touching the slice's Owns globs outside `docs/`,
 * or any non-docs file on the slice's unmerged branch. Timestamps are compared with `%ct`, as the
 * plan asks; a review committed together with the code counts.
 */
export function reviewState(root, _plan, a, base, cfg = {}, { unmerged } = {}) {
  const reviewPath = `docs/review-${a.id}.md`
  const specs = a.owns.map((g) => `:(glob)${g}`).concat([':(exclude,glob)docs/**'])
  const last = tryGit(['log', '-1', '--format=%ct %h', base, '--', ...specs], root)
  let codeAt = last.ok && last.out ? Number(last.out.split(' ')[0]) : 0
  let codeRef = last.ok && last.out ? last.out.split(' ')[1] : null
  const ref = `refs/heads/${cfg.branchPrefix || 'rig/'}${a.id}`
  // Only a branch holding work that is NOT on base can be "newer than the review". After a squash
  // or rebase merge the three-dot diff still lists every file the slice changed, so that diff alone
  // said "unreviewed" forever while the merged gate said "merged". The merged gate's answer is
  // reused; called on its own, it is computed the same way.
  const branchExists = tryGit(['show-ref', '--verify', '--quiet', ref], root).ok
  if (branchExists && (unmerged ?? !branchApplied(root, base, ref))) {
    const changed = tryGit(['diff', '--name-only', `${base}...${ref}`], root)
    const code = changed.ok ? changed.out.split('\n').filter((f) => f && !f.startsWith('docs/')) : []
    if (code.length) {
      codeAt = Infinity
      codeRef = ref.replace('refs/heads/', '')
    }
  }
  if (!codeAt) return { ok: true, detail: 'no code changes outside docs/' }
  const rv = tryGit(['log', '-1', '--format=%ct', base, '--', reviewPath], root)
  const reviewAt = rv.ok && rv.out ? Number(rv.out) : 0
  if (!reviewAt) return { ok: false, detail: `${reviewPath} is not on ${base}: run \`rig review ${a.id}\` and merge the reviewer's file` }
  if (reviewAt < codeAt) return { ok: false, detail: `${reviewPath} is older than the last code commit (${codeRef}); review again` }
  return { ok: true, detail: reviewPath }
}

function findShots(root) {
  const out = []
  const walk = (dir, depth) => {
    if (depth > 3 || !existsSync(dir)) return
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p, depth + 1)
      else if (/\.(png|jpe?g|webp)$/i.test(e.name)) out.push(p.slice(root.length + 1))
    }
  }
  walk(join(root, 'docs'), 0)
  return out
}

/** The finished report, in the shape a person can check: changed, proof, pictures, lives, staged, owed. */
export function finishReport(plan, r, opts = {}) {
  const fails = r.checks.filter((c) => c.state !== 'ok')
  const desk = r.desk || { skipped: 'not run', actions: [] }
  const deskLines = desk.skipped
    ? [`- skipped: ${desk.skipped}`]
    : desk.actions
        .map((a) => `- ${a.ran ? (a.ok ? '✓' : '✗') : '–'} ${a.what}${a.why ? ' — ' + a.why : ''}`)
        .concat([`- next: \`wrap ${desk.slug} "${desk.line}"\``])
  return `# ${plan.title} — finished report

Commit: \`${r.short}\`${r.failed ? '  **(gates failing — not finished)**' : ''}

## What changed
${plan.done ? plan.done : '(the plan has no "What done looks like" section)'}

## The proof
${r.qa ? `- \`${r.qa.cmd}\` exited **${r.qa.exit}** on \`${r.short}\` (${r.qa.at})` : '- No QA run recorded on this commit.'}
${r.checks.map((c) => `- ${c.state === 'ok' ? '✓' : c.state === 'fail' ? '✗' : '!'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`).join('\n')}
${opts.noReview ? '\nRun with `--no-review`: unreviewed slices were downgraded to warnings.\n' : ''}${opts.noVendor ? '\nRun with `--no-vendor`: **no second-vendor pass was required** on this sha; the gate was downgraded to a warning.\n' : ''}
## Second-vendor review
${
  r.vendor?.verdict
    ? `- ${r.vendor.verdict.verdict} from ${r.vendor.verdict.vendor} on \`${r.short}\` (${r.vendor.verdict.at}): ${r.vendor.verdict.what}`
    : `- none recorded on \`${r.short}\``
}${r.vendor?.builder ? `\n- builders: ${r.vendor.builder.vendor || 'unknown'} (${r.vendor.builder.from})` : ''}

## Decisions
${r.decisions?.list.length ? r.decisions.list.map((d) => `- ${d.id} (${d.status}): ${d.what} — ${d.source}`).join('\n') : '- none this round'}

## Drift
${
  !r.drift
    ? '- not checked (no live base)'
    : r.drift.error
      ? `- could not check against ${r.drift.base}: ${r.drift.error}`
      : r.drift.moved
        ? `- ${r.drift.base} moved ${r.drift.since.length} commit(s); ${r.drift.merges === false ? 'the stack does not merge' : 'the stack still merges'}`
        : `- ${r.drift.base} has not moved`
}

## Desk
${deskLines.join('\n')}

## The pictures
${
  r.shots.length
    ? r.shots
        .slice(0, 40)
        .map((s) => `- \`${s}\``)
        .join('\n')
    : '- none yet'
}

## Where it lives
${plan.lives || '(the plan does not say)'}

## Hard rules this build had to keep
${(plan.mustNotRules || []).length ? plan.mustNotRules.map((x) => '- ' + x).join('\n') : '- (none stated)'}

## Staged for the owner, and still owed
${plan.openQuestions ? plan.openQuestions : '- (no open questions in the plan)'}
${fails.length ? '\n' + fails.map((c) => `- ${c.name}: ${c.detail}`).join('\n') : ''}
`
}
