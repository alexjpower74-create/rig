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
import { compareBaseline, diffNames, lastSpecIn, parseFailures, parseMarks, tally } from '../src/qa/failures.js'
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
  // Only FAIL is a failure. "green and proven" breaks nothing, so it is VOID; the one with no
  // control is UNPRV. Each is listed under its own word (lead, r55q fix 3).
  assert.deepEqual(parseFailures(out), ['red one'])
  assert.deepEqual(parseMarks(out), { void: ['green and proven'], unproven: ['never shown to fail'] })
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
  assert.deepEqual(tally('Tests:       2 failed, 5 passed, 7 total\n'), {
    passed: 5,
    failed: 2,
    names: [],
    conflict: null,
    void: 0,
    unproven: 0,
  })
  assert.deepEqual(tally('  5 passed (3.1s)\n  1 failed\n').passed, 5)
  assert.deepEqual(tally('12 examples, 1 failure\n'), { passed: 11, failed: 1, names: [], conflict: null, void: 0, unproven: 0 })
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
    baseThere: ['a'],
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
  assert.match(crash.why, /did not finish \(exit 134\)/)
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
  // node's flag only where that node takes it (Node 22 refuses to start with it); never a backslash
  // or a single quote, which the trip over ssh and a login shell would change.
  const nodeSeed = withSeed('node --test test/a.test.js', 5).cmd
  assert.equal(nodeSeed, 'node $(node --test-random-seed=1 -e 0 >/dev/null 2>&1 && echo --test-random-seed=5) --test test/a.test.js')
  assert.ok(!/[\\']/.test(nodeSeed))
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

test('the host lease is not given back while a run there may still be going', async () => {
  const { remote, runHost, leaseHost } = await import('../src/qa/host.js')
  const saved = { ...remote }
  const released = []
  let finish
  remote.acquire = () => ({ ok: true, holder: null, why: null })
  remote.release = (_r, res) => released.push(res)
  remote.runOnHost = (o) => new Promise((r) => (finish = () => r({ host: o.host, exit: 0, ms: 1, log: '' })))
  try {
    const lease = leaseHost(tmp, 'box', 'r55q')
    const run = runHost({ root: tmp, host: 'box', sha: 'abc', cmd: 'x', session: 's', echo: false })
    lease.release() // what rig qa's exit handler does when a signal ends it mid-run
    assert.deepEqual(released, [], 'released under a running host suite')
    finish()
    await run
    lease.release()
    assert.deepEqual(released, ['host:box'])
  } finally {
    Object.assign(remote, saved)
  }
})

test('a run killed by a limit, a signal or the watchdog never makes "0 new" complete, even with names (r55g review 5)', () => {
  for (const run of [
    { label: 'test here', exit: 124, failures: ['a'] },
    { label: 'test here', exit: 137, failures: ['a'] },
    { label: 'test here', exit: 1, failures: ['a'], stalled: { worker: 'output', spec: null, quietMs: 1 } },
  ]) {
    const b = compareBaseline({ here: ['a'], base: ['a'], runs: [run] })
    assert.equal(b.complete, false, JSON.stringify(run))
    assert.match(b.why, /did not finish|stalled/)
  }
  assert.equal(compareBaseline({ here: ['a'], base: ['a'], runs: [{ exit: 1, failures: ['a'] }] }).complete, true)
})

test('a host run that stops writing is stopped waiting on, named, and its lease kept (r55g review 1)', async () => {
  const { remote, runHost, leaseHost } = await import('../src/qa/host.js')
  const saved = { ...remote }
  const released = []
  let aborted = false
  remote.acquire = () => ({ ok: true, holder: null, why: null })
  remote.release = (_r, res) => released.push(res)
  remote.runOnHost = (o) => {
    o.onOutput('running tests/payment.spec.js\n')
    o.signal?.addEventListener('abort', () => {
      aborted = true
    })
    return new Promise(() => {}) // the host never comes back
  }
  try {
    const lease = leaseHost(tmp, 'box', 'r55q')
    const t = Date.now()
    const r = await runHost({ root: tmp, host: 'box', sha: 'abc', cmd: 'x', session: 's', echo: false, stallMs: 300 })
    assert.equal(r.exit, 124)
    assert.deepEqual({ worker: r.stalled.worker, spec: r.stalled.spec }, { worker: 'box', spec: 'tests/payment.spec.js' })
    assert.ok(Date.now() - t < 2000, `took ${Date.now() - t} ms`)
    assert.ok(aborted, 'the abort signal reached runOnHost')
    lease.release()
    assert.deepEqual(released, [], 'the lease is kept: the run on the host was never seen to end')
  } finally {
    Object.assign(remote, saved)
  }
})

test('the CI status a host run posts is read from its marked line (r55g review 3)', async () => {
  const { remote, runHost, ciOnHost } = await import('../src/qa/host.js')
  const saved = remote.runOnHost
  let sent = null
  remote.runOnHost = async (o) => {
    sent = o.cmd
    const log = 'ci: lint ok\nrig-qa-ci-status: failure lint found 2\n'
    return { host: o.host, exit: 0, ms: 1, log }
  }
  try {
    const r = await runHost({ root: tmp, host: 'box', sha: 'abc', cmd: ciOnHost('npm run ci'), session: 's', echo: false, ci: true })
    assert.match(sent, /RIG_CI_STATUS=/)
    assert.match(sent, /npm run ci/)
    assert.deepEqual(r.ciStatus, { state: 'failure', text: 'lint found 2' })
  } finally {
    remote.runOnHost = saved
  }
})

test('on the host, the stub calls runOnHost returns count even when the spec swallowed the stub message', async () => {
  const { remote, runHost } = await import('../src/qa/host.js')
  const saved = remote.runOnHost
  remote.runOnHost = async (o) => ({
    host: o.host,
    exit: 1,
    ms: 1,
    log: 'not ok 1 - copies the link\n  Command failed: xclip -selection clipboard\nnot ok 2 - totals the cart\n',
    stubCalls: [{ tool: 'xclip', t: 1, args: '-selection clipboard' }],
  })
  try {
    const r = await runHost({ root: tmp, host: 'box', sha: 'abc', cmd: 'x', session: 's', echo: false })
    assert.deepEqual(r.needsStub, ['copies the link'])
  } finally {
    remote.runOnHost = saved
  }
})

test('a tally that contradicts the exit is not printed as a number (real run on 515b118)', () => {
  // A test may print a fixture suite's summary inside a passing run (target.test.js did, with a VOID;
  // since VOID is not a failure, the case here is a fixture suite with one FAIL it expects).
  const nested = [
    '✔ PASS: 2 taps is inside the bar (539ms)',
    'accept a shift: 0 passed, 1 failed, 0 void, 0 unproven',
    '  of which targets: 0 passed, 1 failed, 0 void, 0 unproven',
    '  FAIL t2 report names every repo  not in the report: lantern',
    'rig 5.5, workflow: 12 passed, 0 failed, 0 void, 0 unproven',
  ].join('\n')
  const green = tally(nested, null, 0)
  assert.equal(green.failed, null, JSON.stringify(green))
  assert.match(green.conflict, /exited 0/)
  // The same output from a red run is consistent: a count, no conflict.
  assert.equal(tally(nested, null, 1).conflict, null)
  // "of which targets" breaks a suite's own count down; it is not a second suite.
  const own = 'suite: 3 passed, 1 failed, 0 void, 0 unproven\n  of which targets: 1 passed, 1 failed, 0 void, 0 unproven\n'
  assert.deepEqual([tally(own, null, 1).passed, tally(own, null, 1).failed], [3, 1])
  // A red exit with nothing counted is a conflict too: no "failed 0" beside a failing run.
  assert.match(tally('all fine\n', null, 2).conflict, /exit 2 but no FAIL line/)
})

test('a red exit explained only by a VOID or UNPRV is a conflict that names them (main 949e12b)', () => {
  const out =
    '  VOID  comps on a phone: a rating tapped after a swipe still counts 7269ms\nrig taste: 38 passed, 0 failed, 1 void, 0 unproven\n'
  const t = tally(out, null, 1)
  assert.equal(t.failed, null)
  assert.equal(t.void, 1)
  assert.equal(t.conflict, 'exit 1 but no FAIL line; 1 void: comps on a phone: a rating tapped after a swipe still counts')
  const u = tally('  UNPRV folds without a control 3ms\n', null, 1)
  assert.equal(u.conflict, 'exit 1 but no FAIL line; 1 unproven: folds without a control')
  assert.equal(tally('all fine\n', null, 2).conflict, 'exit 2 but no FAIL line')
  // A FAIL line beside the VOID explains the exit: a number, no conflict.
  assert.equal(tally(`${out}  FAIL  another 2ms\n`, null, 1).conflict, null)
})

test('compareBaseline never waives across machines: each side is compared with its own base (r55g delta, 6a6cedd)', () => {
  // On the host at the head and at the base alike: known there, not new.
  const b = compareBaseline({ here: [], there: ['remote regression'], base: [], baseThere: ['remote regression'], runs: [] })
  assert.deepEqual(b.newFailures, [])
  assert.deepEqual(b.known, [{ name: 'remote regression', where: 'there' }])
  // Failed by the local base only: the host's failure is still new.
  const x = compareBaseline({ here: [], there: ['shared name'], base: ['shared name'], baseThere: [], runs: [] })
  assert.deepEqual(x.newFailures, ['shared name'])
  assert.deepEqual(x.known, [])
  // Known on both machines only when each base failed it.
  const both = compareBaseline({ here: ['a'], there: ['a'], base: ['a'], baseThere: ['a'], runs: [] })
  assert.deepEqual(both.known, [{ name: 'a', where: 'both' }])
  // A host head with no host base is not compared there: no "0 new" claimed.
  const none = compareBaseline({ here: [], there: ['r'], base: ['r'], runs: [] })
  assert.equal(none.complete, false)
  assert.match(none.why, /the base was not run on the host/)
})

test('UNPRV and VOID count toward the new-failure diff only when the run exited non-zero', () => {
  // The real line from main: r55g's gate-fold check with no negative control, in a run that exited 0.
  const out = '  UNPRV the folded commits keep the identity from git config, not the session’s environment 3ms\n  PASS  folds 2ms\n'
  assert.deepEqual(parseFailures(out), [])
  assert.deepEqual(diffNames(out, { exit: 0 }), [])
  assert.deepEqual(diffNames(out, { exit: 1 }), ['the folded commits keep the identity from git config, not the session’s environment'])
  const b = compareBaseline({ here: diffNames(out, { exit: 0 }), base: [], runs: [{ exit: 0, failures: [] }] })
  assert.deepEqual(b.newFailures, [])
  // A green run with an UNPRV line is not a tally conflict: nothing failed.
  assert.equal(tally(out, null, 0).conflict, null)
  assert.equal(tally(out, null, 0).failed, 0)
})
