import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { mainRoot, loadConfig, currentBranch } from '../config.js'
import { loadPlan, missingBrief } from '../plan.js'
import { worktreePath, dirtyFiles } from '../worktrees.js'
import { reportPath } from '../reports.js'
import { lastQaOn } from '../qalog.js'
import { git, tryGit } from '../sh.js'

// Ship means told. `rig finish` is the gate between "the agents stopped" and "it is done": it
// refuses to call a build finished while a slice is unmerged, a tree is dirty, or the tests have not
// run green on the very commit being called done — and when it passes, it writes the finished report
// in the shape a person can trust: what changed, the proof, the pictures, where it lives, what is
// staged for the owner, and what is still owed.

const G = s => `\x1b[32m${s}\x1b[0m`, R = s => `\x1b[31m${s}\x1b[0m`, Y = s => `\x1b[33m${s}\x1b[0m`

export default function finish (args) {
  const root = mainRoot()
  const cfg = loadConfig(root)
  const plan = loadPlan(join(root, cfg.plan))
  const base = argOf(args, '--base') || currentBranch(root)
  const result = finishChecks(root, cfg, plan, base)

  console.log(`${plan.title} — finish gate on ${base} @ ${result.short}\n`)
  for (const c of result.checks) {
    const tag = c.state === 'ok' ? G('  ok  ') : c.state === 'fail' ? R(' FAIL ') : Y(' warn ')
    console.log(`${tag} ${c.name}${c.detail ? '  — ' + c.detail : ''}`)
  }

  if (!args.includes('--no-write')) {
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'docs', 'FINISH.md'), finishReport(plan, result))
    console.log('\nwrote docs/FINISH.md')
  }
  if (result.failed) {
    console.log(R(`\nnot finished: ${result.checks.filter(c => c.state === 'fail').length} gate(s) failed.`))
    process.exitCode = 1
  } else {
    console.log(G('\nfinished: every gate passed.') + ' Review the report, then ship (deploys, releases and posts are the owner\'s call).')
  }
}

function argOf (args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }

/** Run every gate. Returns { checks: [{ name, state: ok|fail|warn, detail }], failed, sha, short, qa, shots }. */
export function finishChecks (root, cfg, plan, base) {
  const checks = []
  const add = (name, state, detail = '') => checks.push({ name, state, detail })
  const sha = git(['rev-parse', base], root)
  const short = git(['rev-parse', '--short', base], root)

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
    // Squash and rebase merges leave the branch's own commits "ahead" forever, so ask the question
    // that matters: would merging this branch into base change anything? If the merged tree is base's
    // own tree, every change is already there. (`git cherry` compares commit by commit and misses a
    // squash of several commits.) Older git without merge-tree --write-tree falls back to cherry.
    let applied = false
    const mt = tryGit(['merge-tree', '--write-tree', base, ref], root)
    if (mt.ok) {
      applied = mt.out.split('\n')[0] === git(['rev-parse', `${base}^{tree}`], root)
    } else if (!/conflict/i.test(mt.out + mt.err)) {
      const cherry = tryGit(['cherry', base, ref], root)
      const lines = cherry.ok ? cherry.out.split('\n').filter(Boolean) : []
      applied = lines.length > 0 && lines.every(l => l.startsWith('-'))
    }
    add(`${a.id} merged`, applied ? 'ok' : 'fail', applied ? 'squash or rebase merge (every change already on base)' : `${branch} has ${ahead} commit(s) not on ${base}`)
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
export function finishReport (plan, r) {
  const fails = r.checks.filter(c => c.state !== 'ok')
  return `# ${plan.title} — finished report

Commit: \`${r.short}\`${r.failed ? '  **(gates failing — not finished)**' : ''}

## What changed
${plan.done ? plan.done : '(the plan has no "What done looks like" section)'}

## The proof
${r.qa ? `- \`${r.qa.cmd}\` exited **${r.qa.exit}** on \`${r.short}\` (${r.qa.at})` : '- No QA run recorded on this commit.'}
${r.checks.map(c => `- ${c.state === 'ok' ? '✓' : c.state === 'fail' ? '✗' : '!'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`).join('\n')}

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
