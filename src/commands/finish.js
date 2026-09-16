import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { mainRoot, loadConfig, currentBranch } from '../config.js'
import { loadPlan, missingBrief } from '../plan.js'
import { worktreePath, dirtyFiles } from '../worktrees.js'
import { reportPath } from '../reports.js'
import { lastQaOn, lastNegativeOn } from '../qalog.js'
import { git, tryGit } from '../sh.js'
import { jot, appsTouch, ghIssueClose, ghAvailable, wrap } from '../desk.js'

// Ship means told. `rig finish` is the gate between "the agents stopped" and "it is done": it
// refuses to call a build finished while a slice is unmerged, a tree is dirty, or the tests have not
// run green on the very commit being called done — and when it passes, it writes the finished report
// in the shape a person can trust: what changed, the proof, the pictures, where it lives, what is
// staged for the owner, and what is still owed.

const G = s => `\x1b[32m${s}\x1b[0m`, R = s => `\x1b[31m${s}\x1b[0m`, Y = s => `\x1b[33m${s}\x1b[0m`

export const USAGE = `rig finish [--base <ref>] [--no-review] [--no-desk] [--no-write] [--wrap "<message>"]

  --base <ref>       the branch every slice must be on (default: the current branch)
  --no-review        an unreviewed slice warns instead of failing; FINISH.md says so
  --no-desk          do not close issues, jot, or touch the registry even when every gate passes
  --no-write         do not write docs/FINISH.md
  --wrap "<msg>"     after a pass, run \`wrap <slug> "<msg>"\` (the lead's call; crews never pass it)
  --help, -h         this text

Gates: every slice merged, reviewed (docs/review-<id>.md on base, newer than the slice's last code
commit), nothing uncommitted, QA green on this sha, negative controls green on this same sha when the
config or plan names them, and the QA run left its tree clean. Only when every gate passes does it
close the slice issues, jot, and touch the registry.
`

export default function finish (args) {
  if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); return }
  if (args.includes('--wrap') && !argOf(args, '--wrap')) { console.error('rig finish: --wrap needs a message, e.g. --wrap "shipped 3.0". Nothing was run.'); process.exit(2) }
  if (args.includes('--wrap') && args.includes('--no-desk')) { console.error('rig finish: --wrap and --no-desk contradict each other (wrap is a desk action). Nothing was run.'); process.exit(2) }
  const root = mainRoot()
  const cfg = loadConfig(root)
  const plan = loadPlan(join(root, cfg.plan))
  const base = argOf(args, '--base') || currentBranch(root)
  const opts = { noReview: args.includes('--no-review') }
  const result = finishChecks(root, cfg, plan, base, opts)
  result.desk = result.failed || args.includes('--no-desk')
    ? { skipped: result.failed ? 'a gate failed' : '--no-desk', actions: [] }
    : deskActions(root, cfg, plan, result, { wrap: argOf(args, '--wrap') })

  console.log(`${plan.title} — finish gate on ${base} @ ${result.short}\n`)
  for (const c of result.checks) {
    const tag = c.state === 'ok' ? G('  ok  ') : c.state === 'fail' ? R(' FAIL ') : Y(' warn ')
    console.log(`${tag} ${c.name}${c.detail ? '  — ' + c.detail : ''}`)
  }

  if (opts.noReview) console.log(Y('\n--no-review: unreviewed slices warn instead of failing; FINISH.md says so.'))
  if (!args.includes('--no-write')) {
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'docs', 'FINISH.md'), finishReport(plan, result, opts))
    console.log('\nwrote docs/FINISH.md')
  }
  if (result.failed) {
    console.log(R(`\nnot finished: ${result.checks.filter(c => c.state === 'fail').length} gate(s) failed.`) + ' Nothing was closed, jotted or touched.')
    process.exitCode = 1
  } else {
    console.log(G('\nfinished: every gate passed.') + ' Review the report, then ship (deploys, releases and posts are the owner\'s call).')
    console.log('\nDesk:')
    for (const a of result.desk.actions) console.log(`  ${a.ran ? (a.ok ? G('done') : R('failed')) : Y('skip')}  ${a.what}${a.why ? '  — ' + a.why : ''}`)
    if (result.desk.skipped) console.log(`  skipped (${result.desk.skipped})`)
    console.log(`\nnext: wrap ${result.desk.slug} "${result.desk.line}"`)
  }
}

/**
 * The desk work a passing finish does, and only a passing one: close each slice's issue with the
 * QA line, jot one line to the decision log, touch the registry. `wrap` runs only when the lead
 * passed `--wrap`: a crew may not end a session on the owner's behalf.
 */
export function deskActions (root, cfg, plan, r, { wrap: wrapMessage = null } = {}) {
  const actions = []
  const slug = cfg.slug || slugFor(root.split('/').pop())
  const cmd = r.qa?.cmd || 'QA'
  const line = `${plan.title}: finished at ${r.short}; ${cmd} exit 0; ${plan.agents.length} slices`
  // `rig finish` then `rig finish --wrap` is the normal sequence, and the log must not get the same
  // line twice. What was jotted is remembered per sha in .rig/finish.json.
  const donePath = join(root, '.rig', 'finish.json')
  let done = {}
  if (existsSync(donePath)) { try { done = JSON.parse(readFileSync(donePath, 'utf8')) } catch { done = {} } }
  const already = done[r.sha]

  const issuesPath = join(root, '.rig', 'issues.json')
  let issues = null
  if (existsSync(issuesPath)) { try { issues = JSON.parse(readFileSync(issuesPath, 'utf8')) } catch { issues = null } }
  if (!issues) actions.push({ what: 'close slice issues', ran: false, why: 'no .rig/issues.json (rig up opens them when gh and a remote exist)' })
  else {
    const gh = ghAvailable(root)
    for (const a of plan.agents) {
      const entry = issues[a.id]
      if (!entry?.number) { actions.push({ what: `close ${a.id} issue`, ran: false, why: 'no issue recorded' }); continue }
      if (!gh.ok) { actions.push({ what: `close ${a.id} issue #${entry.number}`, ran: false, why: gh.why }); continue }
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
      mkdirSync(join(root, '.rig'), { recursive: true })
      writeFileSync(donePath, JSON.stringify(done, null, 2) + '\n')
    }
  }
  if (wrapMessage) actions.push({ what: `wrap ${slug} "${wrapMessage}"`, ...wrap(slug, wrapMessage) })
  return { slug, line, actions, skipped: null }
}

function argOf (args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }

/** Run every gate. Returns { checks: [{ name, state: ok|fail|warn, detail }], failed, sha, short, qa, shots }. */
export function finishChecks (root, cfg, plan, base, opts = {}) {
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
      add(`${a.id} merged`, reported ? 'ok' : 'fail', reported ? 'no branch left' : `no branch and no ${reportPath(a)} on ${base}: was ${a.id} ever built?`)
      continue
    }
    const ahead = Number(tryGit(['rev-list', '--count', `${base}..${ref}`], root).out || 0)
    if (ahead === 0) { add(`${a.id} merged`, 'ok'); continue }
    const applied = branchApplied(root, base, ref)
    if (!applied) unmerged.add(a.id)
    add(`${a.id} merged`, applied ? 'ok' : 'fail', applied ? 'squash or rebase merge (every change already on base)' : `${branch} has ${ahead} commit(s) not on ${base}`)
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
  const trees = [{ id: 'main', path: root }, ...plan.agents.map(a => ({ id: a.id, path: worktreePath(root, cfg, a.id) }))]
  const dirty = trees.filter(t => existsSync(t.path)).map(t => ({ ...t, files: dirtyFiles(t.path).filter(f => !f.startsWith('.rig/') && f !== 'docs/FINISH.md') })).filter(t => t.files.length)
  add('no uncommitted work', dirty.length ? 'fail' : 'ok', dirty.map(t => `${t.id}: ${t.files.slice(0, 3).join(', ')}${t.files.length > 3 ? ` …+${t.files.length - 3}` : ''}`).join('; '))

  // 3. The tests ran, and passed, on exactly this commit.
  const qa = lastQaOn(root, sha)
  if (!qa) add(`QA green on ${short}`, 'fail', `no \`rig qa ${short} --run …\` recorded on this commit`)
  else add(`QA green on ${short}`, qa.exit === 0 ? 'ok' : 'fail', qa.exit === 0 ? qa.cmd : `last run exited ${qa.exit}: ${qa.cmd}`)
  if (qa && cfg.devCommand && qa.cmd !== cfg.devCommand) add('QA ran the project’s test command', 'warn', `ran "${qa.cmd}", the config's devCommand is "${cfg.devCommand}"`)

  // 3b. The negatives went red again on THIS sha. Four source-patching controls silently went NOT
  // RED after a formatter moved the strings they anchored on; the sha changed, so the record must.
  if (wantsNegative(cfg, plan)) {
    const neg = lastNegativeOn(root, sha)
    const why = 'formatting moves the strings source-patching controls anchor on; re-run `rig qa ' + short + ' --negative`'
    if (!neg) add(`negative controls red on ${short}`, 'fail', `no negative run recorded on this commit — ${why}`)
    else add(`negative controls red on ${short}`, neg.exit === 0 ? 'ok' : 'fail', neg.exit === 0 ? neg.cmd : `last negative run exited ${neg.exit}: ${neg.cmd} — ${why}`)
  }

  // 3c. The tree was clean right after the tests. A file a test writes is invisible in a suite's
  // own output and shows up as a dirty tree at the next commit, or in someone else's pre-commit check.
  // Source-patching negative controls are the runs most likely to leave a patched file behind, so
  // the negative run's leftovers count too, named by run.
  const negRun = lastNegativeOn(root, sha)
  const left = [...(qa?.dirtied || []).map(f => `${f} (test run)`), ...(negRun?.dirtied || []).map(f => `${f} (negative run)`)]
  if (qa) add('QA left the tree clean', left.length ? 'fail' : 'ok', left.length ? `${left.length} file(s) written: ${left.join(', ')} — untrack it or have the test restore it` : '')

  // 4. Every slice left its reasoning on base.
  for (const a of plan.agents) {
    const p = reportPath(a)
    const onBase = tryGit(['cat-file', '-e', `${base}:${p}`], root).ok
    add(`${a.id} report`, onBase ? 'ok' : 'warn', onBase ? p : `${p} is not on ${base}`)
  }

  // 5. Someone asked for the red.
  const reportTexts = plan.agents.map(a => tryGit(['show', `${base}:${reportPath(a)}`], root)).filter(r => r.ok).map(r => r.out)
  const anyRed = reportTexts.some(t => /negative control|went red|made it red|goes red|\bVOID\b/i.test(t))
  add('a check was shown to go red', anyRed ? 'ok' : 'warn', anyRed ? '' : 'no report mentions a negative control; ask for the red')

  // 6. The brief was a brief: "done" is only checkable against a stated "what done looks like".
  const gaps = missingBrief(plan)
  add('the plan’s brief is complete', gaps.length ? 'warn' : 'ok', gaps.length ? `missing: ${gaps.join(', ')}` : '')

  // 7. Pictures, and a README that says how to open it.
  const shots = findShots(root)
  add('screenshots', shots.length ? 'ok' : 'warn', shots.length ? `${shots.length} in docs/` : 'none under docs/ — show it before calling it done')
  add('README', existsSync(join(root, 'README.md')) ? 'ok' : 'warn', existsSync(join(root, 'README.md')) ? '' : 'missing')

  return { checks, failed: checks.some(c => c.state === 'fail'), sha, short, qa, shots }
}

/** The registry slug for a directory name: the same rule as `rig init` (rg2's slugFor). */
export function slugFor (name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app'
}

/**
 * Would merging `ref` into `base` change anything? Squash and rebase merges leave the branch's own
 * commits "ahead" forever, so this asks the question that matters: if the merged tree is base's
 * own tree, every change is already there. (`git cherry` compares commit by commit and misses a
 * squash of several commits.) Older git without merge-tree --write-tree falls back to cherry.
 */
export function branchApplied (root, base, ref) {
  const mt = tryGit(['merge-tree', '--write-tree', base, ref], root)
  if (mt.ok) return mt.out.split('\n')[0] === git(['rev-parse', `${base}^{tree}`], root)
  if (/conflict/i.test(mt.out + mt.err)) return false
  const cherry = tryGit(['cherry', base, ref], root)
  const lines = cherry.ok ? cherry.out.split('\n').filter(Boolean) : []
  return lines.length > 0 && lines.every(l => l.startsWith('-'))
}

/** cfg.negativeCommand, the plan's own, or a Checks section that speaks of negatives. */
export function wantsNegative (cfg, plan) {
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
export function reviewState (root, plan, a, base, cfg = {}, { unmerged } = {}) {
  const reviewPath = `docs/review-${a.id}.md`
  const specs = a.owns.map(g => `:(glob)${g}`).concat([':(exclude,glob)docs/**'])
  const last = tryGit(['log', '-1', '--format=%ct %h', base, '--', ...specs], root)
  let codeAt = last.ok && last.out ? Number(last.out.split(' ')[0]) : 0
  let codeRef = last.ok && last.out ? last.out.split(' ')[1] : null
  const ref = `refs/heads/${(cfg.branchPrefix || 'rig/')}${a.id}`
  // Only a branch holding work that is NOT on base can be "newer than the review". After a squash
  // or rebase merge the three-dot diff still lists every file the slice changed, so that diff alone
  // said "unreviewed" forever while the merged gate said "merged". The merged gate's answer is
  // reused; called on its own, it is computed the same way.
  const branchExists = tryGit(['show-ref', '--verify', '--quiet', ref], root).ok
  if (branchExists && (unmerged ?? !branchApplied(root, base, ref))) {
    const changed = tryGit(['diff', '--name-only', `${base}...${ref}`], root)
    const code = changed.ok ? changed.out.split('\n').filter(f => f && !f.startsWith('docs/')) : []
    if (code.length) { codeAt = Infinity; codeRef = ref.replace('refs/heads/', '') }
  }
  if (!codeAt) return { ok: true, detail: 'no code changes outside docs/' }
  const rv = tryGit(['log', '-1', '--format=%ct', base, '--', reviewPath], root)
  const reviewAt = rv.ok && rv.out ? Number(rv.out) : 0
  if (!reviewAt) return { ok: false, detail: `${reviewPath} is not on ${base}: run \`rig review ${a.id}\` and merge the reviewer's file` }
  if (reviewAt < codeAt) return { ok: false, detail: `${reviewPath} is older than the last code commit (${codeRef}); review again` }
  return { ok: true, detail: reviewPath }
}

function findShots (root) {
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
export function finishReport (plan, r, opts = {}) {
  const fails = r.checks.filter(c => c.state !== 'ok')
  const desk = r.desk || { skipped: 'not run', actions: [] }
  const deskLines = desk.skipped
    ? [`- skipped: ${desk.skipped}`]
    : desk.actions.map(a => `- ${a.ran ? (a.ok ? '✓' : '✗') : '–'} ${a.what}${a.why ? ' — ' + a.why : ''}`).concat([`- next: \`wrap ${desk.slug} "${desk.line}"\``])
  return `# ${plan.title} — finished report

Commit: \`${r.short}\`${r.failed ? '  **(gates failing — not finished)**' : ''}

## What changed
${plan.done ? plan.done : '(the plan has no "What done looks like" section)'}

## The proof
${r.qa ? `- \`${r.qa.cmd}\` exited **${r.qa.exit}** on \`${r.short}\` (${r.qa.at})` : '- No QA run recorded on this commit.'}
${r.checks.map(c => `- ${c.state === 'ok' ? '✓' : c.state === 'fail' ? '✗' : '!'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`).join('\n')}
${opts.noReview ? '\nRun with `--no-review`: unreviewed slices were downgraded to warnings.\n' : ''}
## Desk
${deskLines.join('\n')}

## The pictures
${r.shots.length ? r.shots.slice(0, 40).map(s => `- \`${s}\``).join('\n') : '- none yet'}

## Where it lives
${plan.lives || '(the plan does not say)'}

## Hard rules this build had to keep
${(plan.mustNotRules || []).length ? plan.mustNotRules.map(x => '- ' + x).join('\n') : '- (none stated)'}

## Staged for the owner, and still owed
${plan.openQuestions ? plan.openQuestions : '- (no open questions in the plan)'}
${fails.length ? '\n' + fails.map(c => `- ${c.name}: ${c.detail}`).join('\n') : ''}
`
}
