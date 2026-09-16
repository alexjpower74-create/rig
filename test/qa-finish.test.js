// Rig 3.0, rg1: QA worktrees that never refuse, and the finish gate that reviews, re-runs the
// negatives on THIS sha, and checks the tree was clean after the tests. Every check has a paired
// known-bad case: the same code must give the other answer when the repository's state changes.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync, readFileSync, existsSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn, spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const RIG = join(here, '..')
const git = (args, cwd, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } }).trim()
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rig-qa-')))
const plain = s => s.replace(/\x1b\[[0-9;]*m/g, '')

const { finishChecks, finishReport } = await import('../src/commands/finish.js')
const { recordQa, qaLogPath, lastQaOn, lastNegativeOn } = await import('../src/qalog.js')
const { loadPlan } = await import('../src/plan.js')
const { readQaLock } = await import('../src/worktrees.js')

const PLAN = (checks = '') => `# Depot draw

## What it's for
Customers scan a QR at the counter and enter a monthly draw.

## Who uses it, on what
Depot customers, on their phones.

## What done looks like
A customer enters in under 30 seconds and sees "You're in".

## What must not happen
- Nothing is sent to a customer without the owner.

## Where it lives
New private project, local only.
${checks ? `\n## Checks\n${checks}\n` : ''}
## Agents

### c1 — Entry page
Owns:
- app/**

Task:
Build the entry page.
`

function repoAt (name, planText = PLAN()) {
  const repo = join(tmp, name)
  mkdirSync(join(repo, 'docs'), { recursive: true })
  git(['init', '-q', '-b', 'main'], repo)
  git(['config', 'user.email', 'test@example.invalid'], repo)
  git(['config', 'user.name', 'Rig Test'], repo)
  writeFileSync(join(repo, '.gitignore'), '.rig/\n.worktrees/\nnode_modules/\n')
  writeFileSync(join(repo, 'PLAN.md'), planText)
  writeFileSync(join(repo, 'README.md'), '# Depot draw\n')
  writeFileSync(join(repo, 'log.txt'), 'evidence\n')
  git(['add', '-A'], repo); git(['commit', '-qm', 'plan'], repo)
  mkdirSync(join(repo, '.rig'), { recursive: true })
  writeFileSync(join(repo, '.rig', 'config.json'), JSON.stringify({ worktreeDir: '.worktrees', qaPort: 5199, branchPrefix: 'rig/' }))
  return repo
}
const cfg = { plan: 'PLAN.md', worktreeDir: '.worktrees', branchPrefix: 'rig/' }
const commit = (repo, msg, env) => { git(['add', '-A'], repo); git(['commit', '-qm', msg], repo, env); return git(['rev-parse', 'HEAD'], repo) }

/** Run a rig command module in a child process, cwd = repo, like `rig <cmd>` would. */
function rig (cmd, repo, args, env = {}) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import('${join(RIG, 'src', 'commands', cmd + '.js')}').then(m => m.default(process.argv.slice(1)))`, '--', ...args],
  { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env } })
  return { status: r.status, out: plain(r.stdout + r.stderr) }
}
const rigBg = (cmd, repo, args) => spawn(process.execPath, ['--input-type=module', '-e',
  `import('${join(RIG, 'src', 'commands', cmd + '.js')}').then(m => m.default(process.argv.slice(1)))`, '--', ...args],
{ cwd: repo, stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---------------------------------------------------------------------------------------------
// rig qa

test('a tracked file written by the test command is recorded as dirtied, then reset and reported on the next pin', () => {
  const repo = repoAt('dirty')
  const first = rig('qa', repo, ['HEAD', '--run', 'echo more >> log.txt; echo junk > junk.txt'])
  assert.equal(first.status, 0)
  assert.match(first.out, /the tests dirtied 1 tracked file: log\.txt and left 1 untracked file: junk\.txt/)
  const entry = lastQaOn(repo, git(['rev-parse', 'HEAD'], repo))
  assert.deepEqual(entry.dirtied, ['log.txt'])
  assert.equal(entry.kind, 'test')

  const second = rig('qa', repo, ['HEAD', '--run', 'true'])
  assert.equal(second.status, 0)
  assert.match(second.out, /reset 1 tracked file: log\.txt \(a test wrote it\)/)
  assert.match(second.out, /removed 1 untracked path: junk\.txt/)
  assert.equal(readFileSync(join(repo, '.worktrees', 'qa', 'log.txt'), 'utf8'), 'evidence\n')

  // Known-bad: a run that writes nothing records nothing, and the next pin resets nothing.
  const clean = rig('qa', repo, ['HEAD', '--run', 'true'])
  assert.deepEqual(lastQaOn(repo, git(['rev-parse', 'HEAD'], repo)).dirtied, [])
  assert.doesNotMatch(clean.out, /reset \d+ tracked/)
  assert.doesNotMatch(clean.out, /dirtied/)
})

test('ignored files survive the clean unless --fresh', () => {
  const repo = repoAt('fresh')
  rig('qa', repo, ['HEAD', '--run', 'mkdir -p node_modules && echo x > node_modules/keep'])
  rig('qa', repo, ['HEAD', '--run', 'true'])
  assert.ok(existsSync(join(repo, '.worktrees', 'qa', 'node_modules', 'keep')), 'node_modules kept without --fresh')
  const fresh = rig('qa', repo, ['HEAD', '--fresh', '--run', 'true'])
  assert.match(fresh.out, /removed 1 untracked path: node_modules\//)
  assert.ok(!existsSync(join(repo, '.worktrees', 'qa', 'node_modules', 'keep')), '--fresh removed it')
})

test('a second rig qa while a lock is live takes qa-2; a stale lock is removed with a note', async () => {
  const repo = repoAt('lock')
  const bg = rigBg('qa', repo, ['HEAD', '--run', 'sleep 6'])
  const lock = join(repo, '.worktrees', 'qa', '.rig', 'qa.lock')
  for (let i = 0; i < 100 && !existsSync(lock); i++) await sleep(50)
  assert.ok(existsSync(lock), 'the first run wrote its lock before running')
  assert.equal(readQaLock(join(repo, '.worktrees', 'qa')).live, true)

  const second = rig('qa', repo, ['HEAD', '--run', 'true'])
  assert.equal(second.status, 0)
  assert.match(second.out, /qa is in use by pid \d+/)
  assert.match(second.out, /QA worktree qa-2 pinned/)
  assert.match(second.out, /port 5200/)
  assert.equal(lastQaOn(repo, git(['rev-parse', 'HEAD'], repo)).worktree, 'qa-2')

  // SIGTERM releases the lock.
  bg.kill('SIGTERM')
  await new Promise(r => bg.on('exit', r))
  assert.ok(!existsSync(lock), 'the lock is gone after SIGTERM')

  // Known-bad for "in use": with no live lock, the next run takes qa again.
  const third = rig('qa', repo, ['HEAD', '--run', 'true'])
  assert.match(third.out, /QA worktree qa pinned/)

  // A stale lock (dead pid) is not "in use".
  writeFileSync(lock, '999999\n')
  const fourth = rig('qa', repo, ['HEAD', '--run', 'true'])
  assert.match(fourth.out, /removed a stale lock in qa \(pid 999999 is not running\)/)
  assert.match(fourth.out, /QA worktree qa pinned/)
  assert.ok(!existsSync(lock))
})

test('a branch checkout sitting in a QA slot is never reset: the run skips it', () => {
  const repo = repoAt('slot')
  git(['worktree', 'add', '-q', join(repo, '.worktrees', 'qa'), '-b', 'someone'], repo)
  writeFileSync(join(repo, '.worktrees', 'qa', 'log.txt'), 'uncommitted work\n')
  const r = rig('qa', repo, ['HEAD', '--run', 'true'])
  assert.equal(r.status, 0)
  assert.match(r.out, /qa is on branch someone, not a QA worktree: left alone/)
  assert.match(r.out, /QA worktree qa-2 pinned/)
  assert.equal(readFileSync(join(repo, '.worktrees', 'qa', 'log.txt'), 'utf8'), 'uncommitted work\n')
})

test('--negative runs in the same pinned worktree and is recorded as kind negative', () => {
  const repo = repoAt('neg')
  const r = rig('qa', repo, ['HEAD', '--run', 'true', '--negative', 'echo "$RIG_QA_SHA" > /dev/null; exit 3'])
  assert.equal(r.status, 3, 'the negative exit is rig qa’s exit when the test run was green')
  const sha = git(['rev-parse', 'HEAD'], repo)
  assert.equal(lastQaOn(repo, sha).exit, 0)
  assert.equal(lastNegativeOn(repo, sha).exit, 3)
  assert.equal(lastNegativeOn(repo, sha).kind, 'negative')
  // Known-bad: the negative entry must not answer for the test entry.
  rmSync(qaLogPath(repo)); recordQa(repo, { kind: 'negative', sha, exit: 0, cmd: 'x' })
  assert.equal(lastQaOn(repo, sha), null)
})

test('--help prints usage and creates nothing; --run with no command runs nothing', () => {
  const repo = repoAt('help')
  const h = rig('qa', repo, ['--help'])
  assert.equal(h.status, 0)
  assert.match(h.out, /^rig qa \[<ref>\]/)
  assert.ok(!existsSync(join(repo, '.worktrees')), 'no worktree was made')
  assert.ok(!existsSync(qaLogPath(repo)))
  const bad = rig('qa', repo, ['HEAD', '--run'])
  assert.equal(bad.status, 2)
  assert.ok(!existsSync(join(repo, '.worktrees')))
})

// ---------------------------------------------------------------------------------------------
// The finish gate.

/** A repo where c1 built app/, merged, reported, and QA ran green on HEAD. Not reviewed yet. */
function builtRepo (name, checks) {
  const repo = repoAt(name, PLAN(checks))
  git(['checkout', '-qb', 'rig/c1'], repo)
  mkdirSync(join(repo, 'app'))
  writeFileSync(join(repo, 'app', 'entry.js'), 'export const entry = 1\n')
  writeFileSync(join(repo, 'docs', 'build-report-c1.md'), '# c1\nnegative control went red\n')
  commit(repo, 'c1: entry page', { GIT_COMMITTER_DATE: '2026-09-15T10:00:00Z', GIT_AUTHOR_DATE: '2026-09-15T10:00:00Z' })
  git(['checkout', '-q', 'main'], repo)
  git(['merge', '-q', '--ff-only', 'rig/c1'], repo)
  const head = git(['rev-parse', 'HEAD'], repo)
  recordQa(repo, { kind: 'test', sha: head, exit: 0, cmd: 'npm test', dirtied: [] })
  return repo
}
const review = (repo, date = '2026-09-15T12:00:00Z') => {
  writeFileSync(join(repo, 'docs', 'review-c1.md'), `# Review c1\nno findings (${date})\n`)
  return commit(repo, 'review c1', { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date })
}
const check = (repo, name, opts) => finishChecks(repo, cfg, loadPlan(join(repo, 'PLAN.md')), 'main', opts).checks.find(c => c.name === name)
const requal = (repo, sha) => { recordQa(repo, { kind: 'test', sha, exit: 0, cmd: 'npm test', dirtied: [] }) }

test('an unreviewed slice fails the gate; --no-review warns and FINISH.md says so; a review on base passes', () => {
  const repo = builtRepo('review')
  assert.equal(check(repo, 'c1 reviewed').state, 'fail')
  assert.match(check(repo, 'c1 reviewed').detail, /docs\/review-c1\.md is not on main/)
  const warned = finishChecks(repo, cfg, loadPlan(join(repo, 'PLAN.md')), 'main', { noReview: true })
  assert.equal(warned.checks.find(c => c.name === 'c1 reviewed').state, 'warn')
  assert.match(finishReport(loadPlan(join(repo, 'PLAN.md')), warned, { noReview: true }), /Run with `--no-review`/)
  assert.doesNotMatch(finishReport(loadPlan(join(repo, 'PLAN.md')), warned, {}), /Run with `--no-review`/)

  const head = review(repo); requal(repo, head)
  assert.equal(check(repo, 'c1 reviewed').state, 'ok')
  const r = finishChecks(repo, cfg, loadPlan(join(repo, 'PLAN.md')), 'main')
  assert.equal(r.failed, false, r.checks.filter(c => c.state === 'fail').map(c => c.name + ': ' + c.detail).join('; '))
})

test('a review older than the slice’s last code commit does not count', () => {
  const repo = builtRepo('stale-review')
  review(repo, '2026-09-15T09:00:00Z') // before the 10:00 code commit
  assert.equal(check(repo, 'c1 reviewed').state, 'fail')
  assert.match(check(repo, 'c1 reviewed').detail, /older than the last code commit/)
  // Known-good: a review committed after the code passes (same code, later review).
  review(repo, '2026-09-15T13:00:00Z')
  assert.equal(check(repo, 'c1 reviewed').state, 'ok')
  // And code committed after that review makes it stale again.
  writeFileSync(join(repo, 'app', 'entry.js'), 'export const entry = 2\n')
  commit(repo, 'c1: more', { GIT_COMMITTER_DATE: '2026-09-15T14:00:00Z', GIT_AUTHOR_DATE: '2026-09-15T14:00:00Z' })
  assert.equal(check(repo, 'c1 reviewed').state, 'fail')
})

test('a slice that changed only docs/ needs no review', () => {
  const repo = repoAt('docs-only', PLAN().replace('- app/**', '- docs/notes/**'))
  mkdirSync(join(repo, 'docs', 'notes')); writeFileSync(join(repo, 'docs', 'notes', 'a.md'), 'x\n'); commit(repo, 'notes')
  assert.equal(check(repo, 'c1 reviewed').state, 'ok')
  assert.match(check(repo, 'c1 reviewed').detail, /no code changes/)
})

test('negative controls must be green on THIS sha: a run on the previous sha does not count', () => {
  const repo = builtRepo('negative', '- `npm run demo` prints one VOID and one FAIL (the negative controls).')
  const old = git(['rev-parse', 'HEAD'], repo)
  const head = review(repo); requal(repo, head)
  const name = `negative controls red on ${git(['rev-parse', '--short', 'HEAD'], repo)}`
  assert.equal(check(repo, name).state, 'fail')
  assert.match(check(repo, name).detail, /formatting moves the strings/)

  recordQa(repo, { kind: 'negative', sha: old, exit: 0, cmd: 'npm run demo' })
  assert.equal(check(repo, name).state, 'fail', 'a green negative run on the pre-format commit does not count')

  recordQa(repo, { kind: 'negative', sha: head, exit: 1, cmd: 'npm run demo' })
  assert.equal(check(repo, name).state, 'fail', 'a red negative run on this sha does not count')

  recordQa(repo, { kind: 'negative', sha: head, exit: 0, cmd: 'npm run demo' })
  assert.equal(check(repo, name).state, 'ok')
  assert.equal(finishChecks(repo, cfg, loadPlan(join(repo, 'PLAN.md')), 'main').failed, false)

  // Known-bad for the trigger: a plan with no negatives and no config command has no such gate.
  const quiet = builtRepo('no-negative'); const h2 = review(quiet); requal(quiet, h2)
  assert.equal(finishChecks(quiet, cfg, loadPlan(join(quiet, 'PLAN.md')), 'main').checks.some(c => /negative controls/.test(c.name)), false)
  assert.equal(finishChecks(quiet, { ...cfg, negativeCommand: 'npm run demo' }, loadPlan(join(quiet, 'PLAN.md')), 'main').checks.some(c => /negative controls/.test(c.name) && c.state === 'fail'), true)
})

test('a QA run that dirtied the tree fails the gate by name', () => {
  const repo = builtRepo('dirtied')
  const head = review(repo)
  recordQa(repo, { kind: 'test', sha: head, exit: 0, cmd: 'npm test', dirtied: ['gate/negative-control.log'] })
  assert.equal(check(repo, 'QA left the tree clean').state, 'fail')
  assert.match(check(repo, 'QA left the tree clean').detail, /gate\/negative-control\.log/)
  requal(repo, head)
  assert.equal(check(repo, 'QA left the tree clean').state, 'ok')
})

// ---------------------------------------------------------------------------------------------
// The desk: only on a pass.

function stubs () {
  const bin = join(tmp, 'bin'); mkdirSync(bin, { recursive: true })
  const log = join(tmp, 'desk.log')
  const stub = (name, body = '') => {
    writeFileSync(join(bin, name), `#!/bin/sh\nprintf '%s\\n' "${name} $*" >> "${log}"\n${body}\n`)
    chmodSync(join(bin, name), 0o755)
  }
  stub('jot'); stub('apps'); stub('wrap')
  stub('gh', 'case "$2" in view) echo \'{"state":"OPEN"}\';; esac\nexit 0')
  return { bin, log, lines: () => existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [] }
}

test('a passing finish closes the slice issue, jots and touches the registry; a failing one does none of it', () => {
  const d = stubs()
  const env = { PATH: `${d.bin}:${process.env.PATH}` }
  const repo = builtRepo('desk')
  writeFileSync(join(repo, '.rig', 'config.json'), JSON.stringify({ worktreeDir: '.worktrees', branchPrefix: 'rig/', slug: 'depot-draw' }))
  writeFileSync(join(repo, '.rig', 'issues.json'), JSON.stringify({ c1: { number: 7, url: 'https://example.invalid/issues/7' } }))
  git(['remote', 'add', 'origin', 'https://example.invalid/depot.git'], repo)

  // Unreviewed: a gate fails, and nothing touches the desk.
  const fail = rig('finish', repo, [], env)
  assert.equal(fail.status, 1)
  assert.match(fail.out, /Nothing was closed, jotted or touched/)
  assert.deepEqual(d.lines(), [])
  assert.match(readFileSync(join(repo, 'docs', 'FINISH.md'), 'utf8'), /## Desk\n- skipped: a gate failed/)

  const head = review(repo); requal(repo, head)
  const short = git(['rev-parse', '--short', 'HEAD'], repo)
  const pass = rig('finish', repo, [], env)
  assert.equal(pass.status, 0, pass.out)
  const lines = d.lines()
  assert.ok(lines.includes('gh auth status'))
  assert.ok(lines.includes('gh issue view 7 --json state'))
  assert.ok(lines.includes(`gh issue close 7 --comment Finished: \`npm test\` exit 0 on \`${short}\` (rig finish)`), lines.join('\n'))
  assert.ok(lines.includes(`jot [depot-draw] Depot draw: finished at ${short}; npm test exit 0; 1 slices`), lines.join('\n'))
  assert.ok(lines.includes('apps touch depot-draw'))
  assert.ok(!lines.some(l => l.startsWith('wrap ')), 'wrap never runs without --wrap')
  assert.match(pass.out, /next: wrap depot-draw "Depot draw: finished at/)
  const finishMd = readFileSync(join(repo, 'docs', 'FINISH.md'), 'utf8')
  assert.match(finishMd, /## Desk\n- ✓ close c1 issue #7/)
  assert.match(finishMd, /- ✓ jot /)

  // --wrap runs wrap; --no-desk runs nothing.
  rmSync(d.log)
  rig('finish', repo, ['--wrap', 'shipped the draw'], env)
  assert.ok(d.lines().includes('wrap depot-draw shipped the draw'))
  rmSync(d.log)
  const nodesk = rig('finish', repo, ['--no-desk'], env)
  assert.equal(nodesk.status, 0)
  assert.deepEqual(d.lines(), [])
})

test('desk tools that are not on PATH are skipped with a reason, never thrown', () => {
  const repo = builtRepo('nodesk-tools')
  const head = review(repo); requal(repo, head)
  const r = rig('finish', repo, [], { PATH: dirname(process.execPath) + ':/usr/bin:/bin' })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /skip {2}jot .*— jot is not on PATH/)
  assert.match(r.out, /skip {2}close slice issues .*— no \.rig\/issues\.json/)
})
