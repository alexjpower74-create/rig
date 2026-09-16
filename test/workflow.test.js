// Rig 2.0: the workflow built in — a brief that reaches every agent, fresh-eyes review, the finish
// gate, and the rulebook. Every check is shown to go red. Gate checks are broken by changing the
// repository's state, which is the honest control for a gate: the same code must give the other answer.

import { suite } from '../harness/check.js'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync, readFileSync, lstatSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rig-flow-')))

const FILLED = `# Depot draw

## What it's for
Customers scan a QR at the counter and enter a monthly draw.

## Who uses it, on what
Depot customers, on their phones.

## What done looks like
A customer enters in under 30 seconds and sees "You're in".

### Phone
The entry page fits a 390-pixel screen without scrolling.

## What must not happen
- Never claim a refund amount it can't back up.
- Nothing is sent to a customer without the owner.

## Where it lives
New private project, local only.

## Agents

### c1 — Entry page
Owns:
- app/**

Task:
Build the entry page.

## Open questions
- Which prize?
`

function repoAt (name, planText) {
  const repo = join(tmp, name)
  mkdirSync(join(repo, 'docs', 'shots'), { recursive: true })
  git(['init', '-q', '-b', 'main'], repo)
  git(['config', 'user.email', 'test@example.invalid'], repo)
  git(['config', 'user.name', 'Rig Test'], repo)
  writeFileSync(join(repo, '.gitignore'), '.rig/\n.worktrees/\n')
  writeFileSync(join(repo, 'PLAN.md'), planText)
  writeFileSync(join(repo, 'README.md'), '# Depot draw\n')
  git(['add', '-A'], repo); git(['commit', '-qm', 'plan'], repo)
  return repo
}

await suite('rig 2.0, workflow', async s => {
  const { parsePlan, missingBrief, loadPlan } = await import('../src/plan.js')
  const { briefFor } = await import('../src/brief.js')
  const { reviewBrief } = await import('../src/commands/review.js')
  const { finishChecks } = await import('../src/commands/finish.js')
  const { recordQa, qaLogPath } = await import('../src/qalog.js')
  const { addRule } = await import('../src/commands/rule.js')
  const { ensureRulebook } = await import('../src/commands/init.js')

  // ---------------------------------------------------------------------------------------------
  // The brief.
  let planText = FILLED
  const ctx = { branch: 'rig/c1', path: '/x', planPath: 'PLAN.md', reportPath: 'docs/build-report-c1.md' }
  await s.check('every agent’s brief carries the plan’s “must not happen” rules word for word', {
    assert: async () => {
      const plan = parsePlan(planText)
      const text = briefFor(plan, plan.agents[0], ctx)
      return text.includes("- Never claim a refund amount it can't back up.") && text.includes('- Nothing is sent to a customer without the owner.')
    },
    breaks: async () => { planText = FILLED.replace(/## What must not happen[\s\S]*?## Where/, '## Where'); return () => { planText = FILLED } }
  })

  let scopedText = FILLED
  await s.check('a ### subheading in the brief is not a slice (slices live under ## Agents)', {
    assert: async () => {
      const p = join(tmp, 'scoped-plan.md'); writeFileSync(p, scopedText)
      try { return loadPlan(p).agents.map(a => a.id).join(',') === 'c1' } catch { return false }
    },
    // Without an ## Agents section the old reading applies, and ### Phone becomes a slice with no files.
    breaks: async () => { scopedText = FILLED.replace('## Agents\n', ''); return () => { scopedText = FILLED } }
  })

  let badId = '..'
  await s.check('a slice id that is a path (like ..) is refused before anything uses it', {
    assert: async () => {
      const p = join(tmp, 'id-plan.md'); writeFileSync(p, FILLED.replace('### c1 — Entry page', `### ${badId} — Entry page`))
      try { loadPlan(p); return false } catch (e) { return /not a plain name/.test(e.message) }
    },
    breaks: async () => { badId = 'c9'; return () => { badId = '..' } }
  })

  const template = readFileSync(join(here, '..', 'templates', 'PLAN.md'), 'utf8').replaceAll('{{PROJECT}}', 'x')
  let filled = FILLED
  await s.check('an unfilled brief is caught (template placeholders count as empty); a filled one is not', {
    assert: async () => missingBrief(parsePlan(template)).length === 5 && missingBrief(parsePlan(filled)).length === 0,
    breaks: async () => { filled = FILLED.replace('- Never claim a refund amount it can\'t back up.\n- Nothing is sent to a customer without the owner.', '- <a hard rule>'); return () => { filled = FILLED } }
  })

  // ---------------------------------------------------------------------------------------------
  // Review.
  const repo = repoAt('repo', FILLED)
  git(['branch', 'rig/c1'], repo)
  execFileSync('git', ['checkout', '-q', 'rig/c1'], { cwd: repo })
  mkdirSync(join(repo, 'app'))
  writeFileSync(join(repo, 'app', 'entry.js'), 'export const entry = 1\n')
  writeFileSync(join(repo, 'docs', 'build-report-c1.md'), '# c1\nThe entry check went red when the form was removed (negative control).\n')
  writeFileSync(join(repo, 'docs', 'shots', 'entry-390.png'), 'png')
  git(['add', '-A'], repo); git(['commit', '-qm', 'c1: entry page'], repo)
  execFileSync('git', ['checkout', '-q', 'main'], { cwd: repo })
  const cfg = { plan: 'PLAN.md', worktreeDir: '.worktrees', branchPrefix: 'rig/' }

  let reviewBase = 'main'
  await s.check('a review brief points a fresh reviewer at exactly that slice’s diff and the hard rules', {
    assert: async () => {
      const plan = loadPlan(join(repo, 'PLAN.md'))
      const r = reviewBrief(plan, plan.agents[0], { root: repo, base: reviewBase, branch: 'rig/c1' })
      return r.files.includes('app/entry.js') && r.text.includes('git diff main...rig/c1') && r.text.includes('Never claim a refund amount') && /Read only/.test(r.text)
    },
    breaks: async () => { reviewBase = 'rig/c1'; return () => { reviewBase = 'main' } }
  })

  // ---------------------------------------------------------------------------------------------
  // The finish gate.
  await s.check('finish refuses while a slice’s work is not on base', {
    assert: async () => {
      const r = finishChecks(repo, cfg, loadPlan(join(repo, 'PLAN.md')), 'main')
      return r.failed && r.checks.some(c => c.name === 'c1 merged' && c.state === 'fail')
    },
    breaks: async () => {
      const before = git(['rev-parse', 'main'], repo)
      git(['merge', '-q', '--ff-only', 'rig/c1'], repo)
      return () => { git(['reset', '-q', '--hard', before], repo) }
    }
  })

  git(['merge', '-q', '--ff-only', 'rig/c1'], repo)
  // 3.0: review before merge is a gate; c1 changed app/, so its review has to be on base.
  writeFileSync(join(repo, 'docs', 'review-c1.md'), '# Review c1\nno findings\n')
  git(['add', '-A'], repo); git(['commit', '-qm', 'review c1'], repo)
  const head = git(['rev-parse', 'HEAD'], repo)
  const writeLog = entries => { rmSync(qaLogPath(repo), { force: true }); for (const e of entries) recordQa(repo, e) }

  writeLog([{ sha: head, exit: 0, cmd: 'npm test' }])
  await s.check('finish passes when merged, clean, and QA exited 0 on this exact commit', {
    assert: async () => { const r = finishChecks(repo, cfg, loadPlan(join(repo, 'PLAN.md')), 'main'); return !r.failed },
    breaks: async () => { recordQa(repo, { sha: head, exit: 1, cmd: 'npm test' }); return () => writeLog([{ sha: head, exit: 0, cmd: 'npm test' }]) }
  })

  const oldSha = git(['rev-parse', 'HEAD~1'], repo)
  writeLog([{ sha: oldSha, exit: 0, cmd: 'npm test' }])
  await s.check('a green QA run on a different commit does not count', {
    assert: async () => { const r = finishChecks(repo, cfg, loadPlan(join(repo, 'PLAN.md')), 'main'); return r.failed && r.checks.some(c => /QA green/.test(c.name) && c.state === 'fail') },
    breaks: async () => { recordQa(repo, { sha: head, exit: 0, cmd: 'npm test' }); return () => writeLog([{ sha: oldSha, exit: 0, cmd: 'npm test' }]) }
  })

  // A plan with a second slice nobody built: no branch, no report.
  const TWO = FILLED.replace('## Open questions', '### c2 — Admin page\nOwns:\n- admin/**\n\nTask:\nBuild it.\n\n## Open questions')
  const repo2 = repoAt('repo2', TWO)
  writeFileSync(join(repo2, 'docs', 'build-report-c1.md'), '# c1\nnegative control went red\n')
  git(['add', '-A'], repo2); git(['commit', '-qm', 'c1 report'], repo2)
  recordQa(repo2, { sha: git(['rev-parse', 'HEAD'], repo2), exit: 0, cmd: 'npm test' })
  await s.check('a slice that was never built (no branch, no report) fails the gate instead of reading “merged”', {
    assert: async () => { const r = finishChecks(repo2, cfg, loadPlan(join(repo2, 'PLAN.md')), 'main'); return r.checks.some(c => c.name === 'c2 merged' && c.state === 'fail') },
    breaks: async () => {
      writeFileSync(join(repo2, 'docs', 'build-report-c2.md'), '# c2\n'); git(['add', '-A'], repo2); git(['commit', '-qm', 'c2 report'], repo2)
      return () => { git(['reset', '-q', '--hard', 'HEAD~1'], repo2) }
    }
  })

  // A squash merge leaves the branch's commits "ahead" forever; its changes are on base all the same.
  const repo3 = repoAt('repo3', FILLED)
  git(['branch', 'rig/c1'], repo3)
  execFileSync('git', ['checkout', '-q', 'rig/c1'], { cwd: repo3 })
  mkdirSync(join(repo3, 'app')); writeFileSync(join(repo3, 'app', 'entry.js'), 'export const entry = 1\n')
  git(['add', '-A'], repo3); git(['commit', '-qm', 'c1 part 1'], repo3)
  writeFileSync(join(repo3, 'app', 'entry.js'), 'export const entry = 2\n')
  git(['add', '-A'], repo3); git(['commit', '-qm', 'c1 part 2'], repo3)
  execFileSync('git', ['checkout', '-q', 'main'], { cwd: repo3 })
  execFileSync('git', ['merge', '-q', '--squash', 'rig/c1'], { cwd: repo3 })
  git(['commit', '-qm', 'squash c1'], repo3)
  await s.check('a squash-merged slice counts as merged', {
    assert: async () => { const r = finishChecks(repo3, cfg, loadPlan(join(repo3, 'PLAN.md')), 'main'); return r.checks.some(c => c.name === 'c1 merged' && c.state === 'ok') },
    breaks: async () => {
      execFileSync('git', ['checkout', '-q', 'rig/c1'], { cwd: repo3 })
      writeFileSync(join(repo3, 'app', 'more.js'), 'unmerged\n'); git(['add', '-A'], repo3); git(['commit', '-qm', 'c1 part 3, never merged'], repo3)
      execFileSync('git', ['checkout', '-q', 'main'], { cwd: repo3 })
      return () => { git(['branch', '-f', 'rig/c1', 'rig/c1~1'], repo3) }
    }
  })

  // ---------------------------------------------------------------------------------------------
  // The rulebook.
  const book = join(tmp, 'AGENTS.md')
  const naiveAdd = (file, text) => { writeFileSync(file, (existsSync(file) ? readFileSync(file, 'utf8') : '') + `\n## Rules learned\n- ${text} (2026-09-14)\n`); return true }
  let add = addRule
  await s.check('a rule added twice is written once, under one "Rules learned" heading', {
    assert: async () => {
      writeFileSync(book, '# Project\n\n## Standing rules\n- Plan first.\n')
      add(book, 'Never round refunds up.', '2026-09-14')
      add(book, 'Never round refunds up.', '2026-09-14')
      const t = readFileSync(book, 'utf8')
      return t.split('Never round refunds up.').length === 2 && t.split('## Rules learned').length === 2
    },
    breaks: async () => { add = naiveAdd; return () => { add = addRule } }
  })

  const proj = join(tmp, 'proj')
  const agentsOnly = (root) => { writeFileSync(join(root, 'AGENTS.md'), '# rules\n'); return ['wrote AGENTS.md'] }
  let rulebook = ensureRulebook
  await s.check('init links CLAUDE.md to AGENTS.md so every agent tool reads one rulebook', {
    assert: async () => {
      rmSync(proj, { recursive: true, force: true }); mkdirSync(proj)
      rulebook(proj, 'proj')
      try { return existsSync(join(proj, 'AGENTS.md')) && lstatSync(join(proj, 'CLAUDE.md')).isSymbolicLink() } catch { return false }
    },
    breaks: async () => { rulebook = agentsOnly; return () => { rulebook = ensureRulebook } }
  })
})

rmSync(tmp, { recursive: true, force: true })
