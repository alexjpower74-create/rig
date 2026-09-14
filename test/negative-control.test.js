// Positive control for the harness itself: prove that check.js CAN report failure.
//
// Every other suite here ends green, and a harness that only ever prints PASS would make them all
// look the same. So this file feeds harness/check.js deliberately broken inputs — an assertion that
// is false, a "negative control" that does not actually break anything, a control that is missing —
// and asserts on what the harness reports and on the exit code it sets. If the harness ever loses
// the ability to go red, this is the test that goes red.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { suite, Suite } from '../harness/check.js'

/** Run fn with console.log captured; return { value, log } and leave the exit code untouched. */
async function quietly (fn) {
  const lines = []
  const orig = console.log
  const exitBefore = process.exitCode
  console.log = (...a) => lines.push(a.join(' '))
  try { return { value: await fn(), log: lines.join('\n'), exitCode: process.exitCode } }
  finally { console.log = orig; process.exitCode = exitBefore }
}
const plain = s => s.replace(/\x1b\[[0-9;]*m/g, '')

test('a false assertion is reported as FAIL and fails the run', async () => {
  const r = await quietly(() => suite('broken input', async t => {
    await t.check('the sky is green', {
      assert: () => false,
      breaks: () => () => {}
    })
  }))
  assert.equal(r.value.fail, 1)
  assert.equal(r.value.pass, 0)
  assert.equal(r.value.ok, false)
  assert.equal(r.exitCode, 1, 'suite() must set process.exitCode=1 on failure')
  assert.match(plain(r.log), /FAIL\s+the sky is green/)
  assert.match(plain(r.log), /broken input: 0 passed, 1 failed, 0 void, 0 unproven/)
})

test('an assertion that throws is a FAIL with the error as its detail', async () => {
  const r = await quietly(() => suite('throwing input', async t => {
    await t.check('explodes', { assert: () => { throw new Error('kaboom') }, breaks: () => () => {} })
  }))
  assert.equal(r.value.fail, 1)
  assert.equal(r.value.ok, false)
  assert.match(plain(r.log), /kaboom/)
})

test('an assertion that survives its own negative control is VOID, not PASS', async () => {
  // The classic vacuous check: `breaks` claims to break the page but changes nothing the assertion
  // reads. It must not be allowed to count as evidence.
  const r = await quietly(() => suite('vacuous input', async t => {
    await t.check('always true', {
      assert: () => true,
      breaks: () => () => {}          // "breaks" nothing
    })
  }))
  assert.equal(r.value.voids, 1)
  assert.equal(r.value.pass, 0)
  assert.equal(r.value.ok, false)
  assert.equal(r.exitCode, 1)
  assert.match(plain(r.log), /VOID\s+always true/)
  assert.match(plain(r.log), /measures nothing/)
})

test('a check with no negative control is UNPROVEN, and fails when the suite requires one', async () => {
  const lax = await quietly(() => suite('no control, lax', async t => {
    await t.check('unbroken', { assert: () => true })
  }))
  assert.equal(lax.value.unproven, 1)
  assert.equal(lax.value.ok, true, 'without requireNegativeControl an UNPROVEN check is tolerated')
  assert.match(plain(lax.log), /UNPRV\s+unbroken/)

  const strict = await quietly(() => suite('no control, strict', async t => {
    await t.check('unbroken', { assert: () => true })
  }, { requireNegativeControl: true }))
  assert.equal(strict.value.unproven, 1)
  assert.equal(strict.value.ok, false)
  assert.equal(strict.exitCode, 1)
})

test('a hanging assertion is cut off by its timeout and reported as FAIL', async () => {
  const r = await quietly(() => suite('hanging input', async t => {
    await t.check('never settles', { timeout: 50, assert: () => new Promise(() => {}), breaks: () => () => {} })
  }))
  assert.equal(r.value.fail, 1)
  assert.match(plain(r.log), /timed out after 50ms/)
})

test('a suite body that throws is a FAIL, not a silent green', async () => {
  const r = await quietly(() => suite('body throws', async () => { throw new Error('setup died') }))
  assert.equal(r.value.fail, 1)
  assert.equal(r.value.ok, false)
  assert.match(plain(r.log), /ERROR\s+setup died/)
})

test('control: a real check with a real negative control still PASSes and restores the thing it broke', async () => {
  // Without this the tests above could pass against a harness that reports everything as broken.
  let value = 1
  const r = await quietly(() => suite('good input', async t => {
    await t.check('value is 1', {
      assert: () => value === 1,
      breaks: () => { value = 2; return () => { value = 1 } }
    })
  }))
  assert.equal(r.value.pass, 1)
  assert.equal(r.value.ok, true)
  assert.equal(r.exitCode, undefined, 'a green suite must not touch process.exitCode')
  assert.equal(value, 1, 'restore() ran')
  assert.match(plain(r.log), /PASS\s+value is 1/)
})

test('Suite records every outcome in results, in order', async () => {
  const s = new Suite('direct')
  await quietly(async () => {
    await s.check('pass', { assert: () => true, breaks: () => { let f = false; return () => { f = true } } })
  })
  // the breaks above returned a restore but never changed what assert reads: VOID
  await quietly(() => s.check('fail', { assert: () => false }))
  await quietly(() => s.check('unproven', { assert: () => true }))
  assert.deepEqual(s.results.map(r => r.state), ['VOID', 'FAIL', 'UNPROVEN'])
})
