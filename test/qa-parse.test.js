// Rig 5.5, r55q: failure names read from real runner output, the same on two commits.
//
// node:test (both reporters) and the Rig's own harness are run for real here; rspec, Playwright and
// Jest are not dependencies of the Rig, so their lines are the formats those runners print.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compareBaseline, lastSpecIn, parseFailures, tally } from '../src/qa/failures.js'
import { needsStub } from '../src/qa/desktop.js'
import { detectCi, planSeeds, readCiStatus, withSeed } from '../src/qa/ci.js'
import { globToRe } from '../src/qa/watch.js'
import { optionalValues, resolveRef } from '../src/commands/qa.js'

const here = dirname(fileURLToPath(import.meta.url))
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rig-qa-parse-')))
test.after(() => rmSync(tmp, { recursive: true, force: true }))

const SPEC = `const { test, describe } = require('node:test')
test('passes', () => {})
test('fails plainly', () => { throw new Error('x') })
describe('a group', () => { test('fails inside', () => { throw new Error('y') }) })
test('todo one', { todo: true }, () => { throw new Error('z') })
`
const nodeRun = (reporter) => {
  const f = join(tmp, `n-${reporter}.test.js`)
  writeFileSync(f, SPEC)
  const r = spawnSync(process.execPath, ['--test', `--test-reporter=${reporter}`, f], { encoding: 'utf8' })
  return r.stdout + r.stderr
}

test('node:test, TAP and spec reporters, give the same names; a TODO is not a failure', () => {
  const tap = parseFailures(nodeRun('tap'))
  const spec = parseFailures(nodeRun('spec'))
  assert.ok(tap.includes('fails plainly') && tap.includes('fails inside'), JSON.stringify(tap))
  assert.ok(!tap.includes('todo one') && !tap.includes('passes'), JSON.stringify(tap))
  for (const n of ['fails plainly', 'fails inside']) assert.ok(spec.includes(n), JSON.stringify(spec))
  assert.ok(!spec.some((n) => /failing tests/.test(n)), JSON.stringify(spec))
  const t = tally(nodeRun('tap'))
  assert.equal(t.passed, 1)
})

test('the harness: FAIL, VOID and UNPRV lines, a target named up to its " — "', () => {
  const f = join(tmp, 'h.test.js')
  writeFileSync(
    f,
    `import { suite } from ${JSON.stringify(pathToFileURL(join(here, '..', 'harness', 'check.js')).href)}
await suite('fixture', async (s) => {
  await s.check('green and proven', { assert: () => true, breaks: () => () => {} })
  await s.check('red one', { assert: () => false })
  await s.check('never shown to fail', { assert: () => true })
})`,
  )
  const out = spawnSync(process.execPath, [f], { encoding: 'utf8' }).stdout
  const names = parseFailures(out)
  // "green and proven" breaks nothing, so it is VOID: a failure too.
  assert.deepEqual(names.sort(), ['green and proven', 'never shown to fail', 'red one'])
  assert.deepEqual(parseFailures('  FAIL  taps to book — 4 taps (≤ 3) · broken: 4 taps 12ms'), ['taps to book'])
})

test('rspec, Playwright and Jest lines; line numbers and durations are cut so names hold across commits', () => {
  const rspec = 'Failed examples:\n\nrspec ./spec/cart_spec.rb:12 # Cart totals the lines\nrspec ./spec/x_spec.rb:40\n'
  assert.deepEqual(parseFailures(rspec), ['Cart totals the lines', './spec/x_spec.rb'])
  const pw = [
    '  ✘  3 [chromium] › tests/book.spec.ts:12:5 › booking › picks a Sunday (1.2s)',
    '  1) [chromium] › tests/book.spec.ts:14:5 › booking › picks a Sunday ───────────',
    '  ✘  4 [webkit] › tests/book.spec.ts:30:1 › pays (retry #1) (3.0s)',
  ].join('\n')
  assert.deepEqual(parseFailures(pw), [
    '[chromium] › tests/book.spec.ts › booking › picks a Sunday',
    '[webkit] › tests/book.spec.ts › pays',
  ])
  assert.deepEqual(parseFailures('FAIL src/cart.test.js\n  ● Cart › totals'), ['src/cart.test.js'])
  assert.deepEqual(tally('Tests:       2 failed, 5 passed, 7 total\n'), { passed: 5, failed: 2, names: [] })
  assert.deepEqual(tally('  5 passed (3.1s)\n  1 failed\n').passed, 5)
  assert.deepEqual(tally('12 examples, 1 failure\n'), { passed: 11, failed: 1, names: [] })
})

test('qaFailurePattern names what the built-in runners do not know', () => {
  const out = '[BAD] checkout total\n[OK] login\n'
  assert.deepEqual(parseFailures(out), [])
  assert.deepEqual(parseFailures(out, { pattern: '^\\[BAD\\] (?<name>.+)$' }), ['checkout total'])
})

test('compareBaseline: new, known by where, fixed; needs-a-stub is not new; an unreadable red run is incomplete', () => {
  const b = compareBaseline({
    here: ['a', 'b', 'stub me'],
    there: ['a', 'c'],
    base: ['a', 'b', 'gone'],
    needsStub: ['stub me'],
    runs: [{ exit: 1, failures: ['a'] }],
  })
  assert.deepEqual(b.newFailures, ['c'])
  assert.deepEqual(b.needsStub, ['stub me'])
  assert.deepEqual(b.known, [
    { name: 'a', where: 'both' },
    { name: 'b', where: 'here' },
  ])
  assert.deepEqual(b.fixed, ['gone'])
  assert.equal(b.complete, true)
  const crash = compareBaseline({ here: [], base: [], runs: [{ label: 'test here', exit: 134, failures: [] }] })
  assert.equal(crash.complete, false)
  assert.match(crash.why, /exited 134/)
})

test('needsStub: a failure whose block names the shimmed tool, or that a call landed inside', () => {
  const lines = [
    { t: 100, text: 'ok 1 - adds' },
    { t: 200, text: 'not ok 2 - copies the link' },
    { t: 201, text: '  error: rig qa: xclip is unreachable in a desktop-free run' },
    { t: 500, text: 'not ok 3 - totals the cart' },
  ]
  assert.deepEqual(needsStub(lines, [{ t: 1, tool: 'xclip' }], { slackMs: 0 }), [{ name: 'copies the link', tool: 'xclip' }])
  // No message in the block, but the call came during the spec.
  const quiet = [lines[0], { t: 200, text: 'not ok 2 - copies the link' }, lines[3]]
  assert.deepEqual(needsStub(quiet, [{ t: 150, tool: 'wl-copy' }], { slackMs: 0 }), [{ name: 'copies the link', tool: 'wl-copy' }])
  assert.deepEqual(needsStub(quiet, [], {}), [])
})

test('CI detection order and the status file', () => {
  const d = join(tmp, 'ci')
  rmSync(d, { recursive: true, force: true })
  spawnSync('mkdir', ['-p', join(d, 'bin')])
  assert.equal(detectCi(d), null)
  writeFileSync(join(d, 'Makefile'), 'ci: lint test\n')
  assert.equal(detectCi(d).cmd, 'make ci')
  writeFileSync(join(d, 'bin', 'ci'), '#!/bin/sh\n', { mode: 0o755 })
  assert.equal(detectCi(d).cmd, './bin/ci')
  writeFileSync(join(d, 'package.json'), JSON.stringify({ scripts: { ci: 'x' } }))
  assert.equal(detectCi(d).cmd, 'npm run ci')
  assert.equal(detectCi(d, { ciCommand: './go ci' }).cmd, './go ci')
  assert.equal(detectCi(d, { ciCommand: null }), null)
  const s = join(tmp, 'status')
  writeFileSync(s, '{"state":"failure","description":"lint"}')
  assert.deepEqual(readCiStatus(s), { state: 'failure', text: 'lint' })
  writeFileSync(s, 'passed')
  assert.deepEqual(readCiStatus(s), { state: 'success', text: null })
  writeFileSync(s, '')
  assert.equal(readCiStatus(s), null)
})

test('seeds: listed ones always run, and the flag goes only to runners that take one', () => {
  assert.deepEqual(planSeeds(2, ['7', '9', '11']), ['7', '9', '11'])
  let n = 0
  assert.deepEqual(
    planSeeds(3, ['7'], () => ++n),
    ['7', '1', '2'],
  )
  assert.equal(withSeed('node --test test/a.test.js', 5).cmd, 'node --test-random-seed=5 --test test/a.test.js')
  assert.equal(withSeed('npx jest a.test.js', 5).cmd, 'npx jest a.test.js --seed=5')
  assert.equal(withSeed('bundle exec rspec spec/a_spec.rb', 5).cmd, 'bundle exec rspec spec/a_spec.rb --seed 5')
  assert.equal(withSeed('npm test', 5).how, 'RIG_SEED')
  assert.equal(withSeed('jest a | tee out', 5).how, 'RIG_SEED')
})

test('arguments: --baseline takes a ref only after the commit to grade; --seeds takes a number list', () => {
  assert.equal(resolveRef(['--baseline', 'abc123', '--run', 'x'], 'main'), 'abc123')
  assert.equal(optionalValues(['--baseline', 'abc123'])['--baseline'], null)
  assert.equal(resolveRef(['abc123', '--baseline', 'v5.0.3'], 'main'), 'abc123')
  assert.equal(optionalValues(['abc123', '--baseline', 'v5.0.3'])['--baseline'], 'v5.0.3')
  assert.equal(optionalValues(['--baseline=main~3', 'abc'])['--baseline'], 'main~3')
  assert.equal(resolveRef(['--repeat', '3', '--seeds', '1,2', '--run', 'x'], 'main'), 'main')
  assert.equal(optionalValues(['--repeat', '3', '--seeds', '1,2'])['--seeds'], '1,2')
  assert.equal(resolveRef(['--stall', '2', 'abc'], 'main'), 'abc')
})

test('worker-log globs and the last spec a stream mentioned', () => {
  assert.ok(globToRe('test-results/**/worker-*.log').test('test-results/a/b/worker-3.log'))
  assert.ok(globToRe('test-results/**/worker-*.log').test('test-results/worker-3.log'))
  assert.ok(!globToRe('logs/*.log').test('logs/a/b.log'))
  assert.equal(
    lastSpecIn('running 4 tests\n  ✓  1 [chromium] › tests/a.spec.ts:3:1 › opens (200ms)\n\n'),
    '[chromium] › tests/a.spec.ts:3:1 › opens',
  )
  assert.equal(lastSpecIn('# Subtest: books a table\n'), 'books a table')
  assert.equal(lastSpecIn('nothing here\n'), null)
})

test('a branch name becomes a lease holder id the lease accepts (rig/r55q → rig-r55q)', async () => {
  const { holderId } = await import('../src/qa/host.js')
  assert.equal(holderId('rig/r55q'), 'rig-r55q')
  assert.match(holderId('feature/a b#c'), /^[A-Za-z0-9._:@-]{1,80}$/)
  assert.equal(holderId('///'), 'rig-qa')
})

test('on the host, a failure whose block names a stubbed tool needs a stub; the others do not', async () => {
  const { remote, runHost } = await import('../src/qa/host.js')
  const saved = remote.runOnHost
  let given = null
  remote.runOnHost = async (o) => {
    given = o
    const log =
      'not ok 1 - copies the link\n  xclip: the desktop is off in test runs (rig qa --desktop opts back in)\nnot ok 2 - totals the cart\n'
    return { host: o.host, exit: 1, ms: 5, dir: 'd', db: 'b', log, why: null }
  }
  try {
    const r = await runHost({ root: tmp, host: 'box', sha: 'abc', cmd: 'x', session: 's', echo: false, desktop: true })
    assert.deepEqual(r.needsStub, ['copies the link'])
    assert.deepEqual(r.failures, ['copies the link', 'totals the cart'])
    assert.equal(given.desktop, true, '--desktop reaches runOnHost')
  } finally {
    remote.runOnHost = saved
  }
})
