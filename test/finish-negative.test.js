// 5.6.1, tw3: what a negative-control command's exit MEANS, recorded by `rig qa --negative` and gated
// by `rig finish`. A command that exits 1 when the break is caught passes when it is configured as
// such and fails when it is not; one that exits 0 because nothing broke is never "caught"; and the
// older `... || true` shape (exit 0 once every control went red) keeps working.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const RIG = join(here, '..')
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rig-negexit-')))
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')

const { finishChecks } = await import('../src/commands/finish.js')
const { lastNegativeOn, recordQa } = await import('../src/qalog.js')
const { loadPlan, negativeLine } = await import('../src/plan.js')
const { classifyNegative, negativeExpectation } = await import('../src/config.js')

const PLAN = (negLine) => `# Depot draw

## What it's for
A monthly draw.

## Who uses it, on what
Customers, on phones.

## What done looks like
They enter and see "You're in".

## What must not happen
- Nothing is sent without the owner.

## Where it lives
Local only.

## Checks
${negLine}

## Agents

### c1 — Entry page
Owns:
- app/**

Task:
Build the entry page.
`

let n = 0
function repoAt(negLine = '- Negative controls: `npm run negative`', config = {}) {
  const repo = join(tmp, `r${n++}`)
  mkdirSync(repo, { recursive: true })
  git(['init', '-q', '-b', 'main'], repo)
  git(['config', 'user.email', 'test@example.invalid'], repo)
  git(['config', 'user.name', 'Rig Test'], repo)
  writeFileSync(join(repo, '.gitignore'), '.rig/\n.worktrees/\n')
  writeFileSync(join(repo, 'PLAN.md'), PLAN(negLine))
  writeFileSync(join(repo, 'README.md'), '# x\n')
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { negative: 'echo FAIL control; exit 1', hollow: 'exit 1' } }))
  git(['add', '-A'], repo)
  git(['commit', '-qm', 'plan'], repo)
  mkdirSync(join(repo, '.rig'), { recursive: true })
  writeFileSync(
    join(repo, '.rig', 'config.json'),
    JSON.stringify({ worktreeDir: '.worktrees', qaPort: 0, branchPrefix: 'rig/', ...config }),
  )
  return repo
}

function rig(repo, args) {
  const r = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import('${join(RIG, 'src', 'commands', 'qa.js')}').then(m => m.default(process.argv.slice(1)))`,
      '--',
      ...args,
    ],
    { cwd: repo, encoding: 'utf8', env: { ...process.env, HC_TERMINAL_ID: '' } },
  )
  return { status: r.status, out: plain(r.stdout + r.stderr) }
}

/** The negative check as `rig finish` would grade it, with the config and plan as they stand now. */
function gate(repo, cfgExtra = {}) {
  const cfg = { plan: 'PLAN.md', worktreeDir: '.worktrees', branchPrefix: 'rig/', ...cfgExtra }
  const short = git(['rev-parse', '--short', 'main'], repo)
  const c = finishChecks(repo, cfg, loadPlan(join(repo, 'PLAN.md')), 'main').checks.find(
    (x) => x.name === `negative controls red on ${short}`,
  )
  assert.ok(c, 'the negative gate is present')
  return c
}

test('a negative command that exits 1 when the break is caught: caught, and the gate passes when configured as such', () => {
  const repo = repoAt()
  const r = rig(repo, ['main', '--negative', 'echo "control went red"; exit 1', '--negative-expect', 'fail'])
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /negative control ".*" exited 1, expecting non-zero when the break is caught: CAUGHT/)
  const rec = lastNegativeOn(repo, git(['rev-parse', 'main'], repo))
  assert.equal(rec.exit, 1)
  assert.equal(rec.caught, true)
  assert.equal(rec.negativeExpect, 'fail')
  const c = gate(repo, { negativeExpect: 'fail' })
  assert.equal(c.state, 'ok')
  assert.match(c.detail, /exited 1, caught: it exited non-zero/)
})

test('the same record fails the gate when the repo says exit 0 is what a caught break looks like', () => {
  const repo = repoAt()
  rig(repo, ['main', '--negative', 'echo "FAIL: control one"; exit 1', '--negative-expect', 'fail'])
  const c = gate(repo) // nothing says "fail" any more: the default reading is exit 0
  assert.equal(c.state, 'fail')
  assert.match(c.detail, /exited 1, read as expecting non-zero, but the repo now says exit 0/)
})

test('the same command read as "exit 0 is caught" is not caught, and qa says so and exits non-zero', () => {
  const repo = repoAt()
  const r = rig(repo, ['main', '--negative', 'exit 1'])
  assert.notEqual(r.status, 0, 'a negative run that is not caught fails rig qa')
  assert.match(r.out, /NOT CAUGHT/)
  assert.match(r.out, /expected to exit 0 once every control went red/)
  assert.equal(gate(repo).state, 'fail')
})

test('a negative command that exits 0 because nothing broke is not counted as caught', () => {
  const repo = repoAt()
  const r = rig(repo, ['main', '--negative', 'echo "nothing to catch"', '--negative-expect', 'fail'])
  assert.notEqual(r.status, 0, r.out)
  assert.match(r.out, /NOT CAUGHT/)
  const rec = lastNegativeOn(repo, git(['rev-parse', 'main'], repo))
  assert.equal(rec.exit, 0)
  assert.equal(rec.caught, false)
  const c = gate(repo, { negativeExpect: 'fail' })
  assert.equal(c.state, 'fail')
  assert.match(c.detail, /exited 0, not caught: it exited 0, and this command is expected to exit non-zero/)
})

test('the plan line can say it: "(exits non-zero when the break is caught)" is read, run and gated', () => {
  const repo = repoAt('- Negative controls: `echo "FAIL: c"; exit 3` (exits non-zero when the break is caught)')
  assert.equal(loadPlan(join(repo, 'PLAN.md')).negativeExpect, 'fail')
  assert.equal(loadPlan(join(repo, 'PLAN.md')).negativeCommand, 'echo "FAIL: c"; exit 3')
  const r = rig(repo, ['main']) // no flag: the plan's line decides
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /CAUGHT/)
  assert.equal(gate(repo).state, 'ok')
  // known-bad for the parser: without the words the same line reads as exit 0
  assert.equal(negativeLine('- Negative controls: `exit 3`').expect, 'pass')
})

test('existing configs keep working: negativeCommand ending `|| true` exits 0 and is caught', () => {
  const repo = repoAt('- Negative controls: `npm run demo`', { negativeCommand: 'echo "FAIL: control one"; false || true' })
  const r = rig(repo, ['main'])
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /exited 0, expecting exit 0 once every control went red: CAUGHT/)
  assert.equal(gate(repo, { negativeCommand: 'x' }).state, 'ok')
  // and a record written before 5.6.1 (no meaning stored) is read the old way
  const legacy = repoAt()
  recordQa(legacy, { kind: 'negative', sha: git(['rev-parse', 'main'], legacy), exit: 0, cmd: 'npm run demo' })
  assert.equal(gate(legacy).state, 'ok')
  const legacyRed = repoAt()
  recordQa(legacyRed, { kind: 'negative', sha: git(['rev-parse', 'main'], legacyRed), exit: 1, cmd: 'npm run demo' })
  assert.equal(gate(legacyRed).state, 'fail')
})

test('a negative run stopped by the deadline is not caught under either reading', () => {
  for (const expect of ['pass', 'fail']) {
    const repo = repoAt()
    const r = rig(repo, ['main', '--negative', 'sleep 30', '--negative-expect', expect, '--timeout', '0.02'])
    assert.notEqual(r.status, 0, `${expect}: ${r.out}`)
    const rec = lastNegativeOn(repo, git(['rev-parse', 'main'], repo))
    assert.equal(rec.exit, 124)
    assert.equal(rec.caught, false, expect)
    assert.equal(gate(repo, { negativeExpect: expect }).state, 'fail')
  }
})

test('classifyNegative: the whole table, and a bad setting is refused by name', () => {
  const rows = [
    [{ exit: 0, expect: 'pass' }, true],
    [{ exit: 1, expect: 'pass' }, false],
    [{ exit: 1, expect: 'fail', text: 'FAIL: control one' }, true],
    [{ exit: 2, expect: 'fail', failures: ['spec a'] }, true],
    [{ exit: 1, expect: 'fail' }, false], // no sign any control ran
    [{ exit: 1, expect: 'fail', text: 'npm error Missing script: "negativ"' }, false],
    [{ exit: 1, expect: 'fail', text: 'SyntaxError: Unexpected token\nFAIL' }, false],
    [{ exit: 0, expect: 'fail' }, false],
    [{ exit: 124, expect: 'fail' }, false],
    [{ exit: 137, expect: 'fail' }, false],
    [{ exit: 127, expect: 'fail' }, false], // command not found is not a caught break
    [{ exit: 0, expect: 'pass', timedOut: true }, false],
    [{ exit: 1, expect: 'fail', text: 'FAIL', stalled: { worker: 'output' } }, false],
  ]
  for (const [input, caught] of rows) assert.equal(classifyNegative(input).caught, caught, JSON.stringify(input))
  assert.equal(negativeExpectation(undefined, null, 'fail'), 'fail')
  assert.equal(negativeExpectation(), 'pass')
  assert.throws(() => negativeExpectation('sometimes'), /negativeExpect must be "pass" or "fail"/)
})

// ---- rv-561's early review ----------------------------------------------------------------------

test('under "fail", a negative command that never ran its controls is NOT caught (a typo\'d npm script, a syntax error)', () => {
  const sha = (repo) => git(['rev-parse', 'main'], repo)
  // `npm run negativ` (missing script) exits 1: on 58f5f45 this read CAUGHT and passed rig finish.
  const typo = repoAt('- Negative controls: `npm run negativ` (exits non-zero when the break is caught)')
  const r = rig(typo, ['main'])
  assert.notEqual(r.status, 0, r.out)
  assert.match(r.out, /NOT CAUGHT/)
  assert.equal(lastNegativeOn(typo, sha(typo)).caught, false)
  assert.equal(gate(typo).state, 'fail')
  // a script that exits 1 without ever naming a failing control is no evidence either
  const hollow = repoAt('- Negative controls: `npm run hollow` (exits non-zero when the break is caught)')
  assert.notEqual(rig(hollow, ['main']).status, 0)
  assert.equal(gate(hollow).state, 'fail')
  // a syntax error in a node script
  const syn = repoAt('- Negative controls: `node bad.js` (exits non-zero when the break is caught)')
  writeFileSync(join(syn, 'bad.js'), 'const = ;\n')
  git(['add', '-A'], syn)
  git(['commit', '-qm', 'bad'], syn)
  assert.notEqual(rig(syn, ['main']).status, 0)
  assert.equal(gate(syn).state, 'fail')
  // known-good partner: the same plan with a script that names a failing control IS caught
  const real = repoAt('- Negative controls: `npm run negative` (exits non-zero when the break is caught)')
  const ok = rig(real, ['main'])
  assert.equal(ok.status, 0, ok.out)
  assert.equal(gate(real).state, 'ok')
})

test('plan marker: only the exact trailing parenthesis changes the meaning, prose never does', () => {
  const prose = negativeLine(
    '- Negative controls: `npm run demo` (each control expects failure of its guarded test; the script exits 0 once all went red)',
  )
  assert.deepEqual(prose, { cmd: 'npm run demo', expect: 'pass' })
  assert.equal(negativeLine('- Negative controls: `x` (expect: fail)').expect, 'fail')
  assert.equal(negativeLine('- Negative controls: `x` (expect: pass)').expect, 'pass')
  assert.equal(negativeLine('- Negative controls: `x` (exits non-zero when the break is caught)').expect, 'fail')
  assert.equal(negativeLine('- Negative controls: `x`, which exits non-zero when the break is caught').expect, 'pass')
})

test('a line that states the meaning in prose with no backticked command is refused, not guessed', () => {
  const l = negativeLine('- Negative controls: npm run negative, which exits non-zero when the break is caught')
  assert.equal(l.cmd, null)
  assert.match(l.problem, /backticked command/)
  const repo = repoAt('- Negative controls: npm run negative, which exits non-zero when the break is caught')
  const plan = loadPlan(join(repo, 'PLAN.md'))
  assert.equal(plan.negativeCommand, null)
  const r = rig(repo, ['main'])
  assert.equal(r.status, 2, r.out)
  assert.match(r.out, /backticked command/)
  const cfg = { plan: 'PLAN.md', worktreeDir: '.worktrees', branchPrefix: 'rig/' }
  assert.equal(finishChecks(repo, cfg, plan, 'main').checks.find((c) => c.name === 'negative controls line is usable').state, 'fail')
  // a plain bare command with no meaning words still works as it did
  assert.deepEqual(negativeLine('- Negative controls: npm run demo'), { cmd: 'npm run demo', expect: 'pass' })
})

test('--negative-expect that disagrees with the repo says so, and finish names the real repair', () => {
  const repo = repoAt()
  const r = rig(repo, ['main', '--negative', 'echo "FAIL: c"; exit 1', '--negative-expect', 'fail'])
  assert.match(r.out, /note: --negative-expect fail is only for this run: rig finish reads "pass"/)
  assert.match(r.out, /set "negativeExpect": "fail" in \.rig\/config\.json/)
  const c = gate(repo)
  assert.equal(c.state, 'fail')
  assert.match(c.detail, /Set "negativeExpect" in \.rig\/config\.json/)
  // no note when the flag agrees with the repo
  const agree = rig(repo, ['main', '--negative', 'echo "FAIL: c"; exit 1', '--negative-expect', 'fail'])
  assert.match(agree.out, /note: /)
  const quiet = repoAt('- Negative controls: `npm run negative` (expect: fail)')
  assert.doesNotMatch(rig(quiet, ['main', '--negative-expect', 'fail']).out, /note: --negative-expect/)
})
