// Suite#target, countInput and timeTo, against a real page with real input.
//
// The fixture (examples/target-fixture.html) is a shift list where accepting Sunday takes 2 taps.
// With ?confirm a confirm step joins the flow and it takes 4. The walk below taps whatever the page
// marks as the next step, hit-tested first, until the shift is accepted, so the count is what the
// flow really costs. The bar is "at most 3 taps".
//
// Shown here, each by a state the harness reports, not by a log line we hope for:
//   a PASS whose broken run crossed the bar; a VOID whose break did not move the number;
//   a FAIL over the bar; a non-number from measure() reported as a FAIL; and the Rig 4 Suite,
//   which has no target(), turning the same suite red.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { click, countInput, isHittable, launch, Suite, sleep, suite, timeTo } from '../harness/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = pathToFileURL(join(here, '..', 'examples', 'target-fixture.html')).href
// The commit Rig 5 starts from (PLAN.md, "Where we're starting from"): its Suite has no target().
const RIG4 = '7d40d97'

/** Run fn with console.log captured; return { value, log, exitCode } and leave the exit code untouched. */
async function quietly(fn) {
  const lines = []
  const orig = console.log
  const exitBefore = process.exitCode
  console.log = (...a) => lines.push(a.join(' '))
  try {
    return { value: await fn(), log: lines.join('\n'), exitCode: process.exitCode }
  } finally {
    console.log = orig
    process.exitCode = exitBefore
  }
}
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')

let browser
let page
let input
// What the page is loaded with. A break changes it; its restore puts it back.
let query = ''

before(async () => {
  browser = await launch({ headless: true, port: 9351, width: 390, height: 844 })
  page = await browser.newPage('about:blank')
  page.on('Page.loadEventFired', () => loaded?.())
  input = countInput(page)
})

// page.goto() races the load against a 30 s timer it never clears, which held this file open for
// 30 s after its last test (harness/cdp.js is outside this slice; reported in build-report-fv2.md).
// One listener, one pending load, nothing left running.
let loaded
async function load(url) {
  const done = new Promise((res) => {
    loaded = res
  })
  await page.send('Page.navigate', { url })
  await done
  loaded = undefined
}
after(async () => {
  await page?.close()
  await browser?.close()
})

/** Tap the page's next step, hit-tested, until the shift is accepted. Throws rather than loop forever. */
async function acceptSunday(by = input) {
  for (let i = 0; i < 12; i++) {
    const at = await page.eval(`(() => {
      if (document.body.dataset.state === 'accepted') return 'accepted'
      const el = document.querySelector('[data-next]')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, sel: '#' + el.id }
    })()`)
    if (at === 'accepted') return
    if (!at) throw new Error('the page offers no next step and the shift is not accepted')
    if (!(await isHittable(page, at.sel))) throw new Error(`${at.sel} is covered: a tap at its centre would miss`)
    await by.click(at.x, at.y)
    await sleep(30)
  }
  throw new Error('still not accepted after 12 taps')
}

/** Load the fixture fresh and count the taps it takes to accept Sunday. */
async function tapsToAccept() {
  await load(fixture + query)
  input.reset()
  await acceptSunday()
  return input.counts().taps
}

const addConfirmStep = () => {
  query = '?confirm'
  return () => {
    query = ''
  }
}

test('PASS: 2 taps is inside the bar, and the confirm step pushes the broken run to 4', async () => {
  const s = new Suite('accept a shift')
  const r = await quietly(() => s.target('accept a Sunday', { measure: tapsToAccept, atMost: 3, unit: 'taps', breaks: addConfirmStep }))
  const rec = r.value
  assert.equal(rec.state, 'PASS', rec.detail)
  assert.equal(rec.kind, 'target')
  assert.equal(rec.value, 2)
  assert.equal(rec.brokenValue, 4)
  assert.deepEqual(rec.bound, { atMost: 3 })
  assert.equal(rec.unit, 'taps')
  assert.match(plain(r.log), /^ {2}PASS {2}accept a Sunday — 2 taps \(≤ 3\) · broken: 4 taps \d+ms$/m)
  assert.equal(query, '', 'the restore ran')
  assert.equal(await tapsToAccept(), 2, 'and the page is back to 2 taps')
})

test('VOID: a break that misses the flow leaves the number at 2, inside the bar', async () => {
  // A typo in the flag: the page ignores ?confrim, so the "broken" page is the working one.
  const misspelt = () => {
    query = '?confrim'
    return () => {
      query = ''
    }
  }
  const s = new Suite('accept a shift')
  const r = await quietly(() => s.target('accept a Sunday', { measure: tapsToAccept, atMost: 3, unit: 'taps', breaks: misspelt }))
  assert.equal(r.value.state, 'VOID')
  assert.equal(r.value.value, 2)
  assert.equal(r.value.brokenValue, 2)
  assert.match(r.value.detail, /the number stayed inside the bar with the thing broken/)
  assert.match(plain(r.log), /VOID {2}accept a Sunday — 2 taps \(≤ 3\) · broken: 2 taps/)
  assert.equal(s.report().ok, false, 'a VOID target fails the run')
})

test('FAIL: a bar of 1 tap is missed by the real flow, and the number is printed against it', async () => {
  const s = new Suite('accept a shift')
  const r = await quietly(() => s.target('accept a Sunday', { measure: tapsToAccept, atMost: 1, unit: 'taps', breaks: addConfirmStep }))
  assert.equal(r.value.state, 'FAIL')
  assert.equal(r.value.value, 2)
  assert.equal(r.value.brokenValue, null, 'no control is run for a bar already missed')
  assert.match(plain(r.log), /FAIL {2}accept a Sunday — 2 taps \(≤ 1\) \d+ms/)
  assert.match(r.value.detail, /2 taps is outside the bar \(≤ 1\)/)
})

test('FAIL: measure() returning the counts object instead of a number is named, not coerced', async () => {
  // The likely slip: returning input.counts() rather than input.counts().taps.
  const s = new Suite('accept a shift')
  const r = await quietly(() =>
    s.target('accept a Sunday', {
      measure: async () => {
        await tapsToAccept()
        return input.counts()
      },
      atMost: 3,
      unit: 'taps',
      breaks: addConfirmStep,
    }),
  )
  assert.equal(r.value.state, 'FAIL')
  assert.equal(r.value.value, null)
  assert.match(r.value.detail, /measure\(\) returned an object \{"taps":2,"keys":0,"gestures":0,"ms":\d+\}, not a finite number/)
  assert.match(plain(r.log), /FAIL {2}accept a Sunday — no number \(≤ 3\)/)
})

test('FAIL: every other non-number is named too', async () => {
  const s = new Suite('non-numbers')
  const cases = [
    [undefined, 'undefined'],
    [null, 'null'],
    [Number.NaN, 'NaN'],
    [Number.POSITIVE_INFINITY, 'Infinity'],
    ['2', 'the string "2"'],
    [true, 'a boolean'],
  ]
  for (const [v, named] of cases) {
    const r = await quietly(() => s.target(`returns ${named}`, { measure: () => v, atMost: 3, breaks: () => () => {} }))
    assert.equal(r.value.state, 'FAIL', named)
    assert.equal(r.value.detail, `measure() returned ${named}, not a finite number`)
  }
  // The paired good case: a plain number in the same shape passes.
  let n = 2
  const ok = await quietly(() =>
    s.target('returns 2', {
      measure: () => n,
      atMost: 3,
      breaks: () => {
        n = 9
        return () => {
          n = 2
        }
      },
    }),
  )
  assert.equal(ok.value.state, 'PASS')
})

test('a measure() that throws or hangs is a FAIL with the reason', async () => {
  const s = new Suite('broken measures')
  const thrown = await quietly(() =>
    s.target('throws', {
      measure: () => {
        throw new Error('the button was never found')
      },
      atMost: 3,
    }),
  )
  assert.equal(thrown.value.state, 'FAIL')
  assert.equal(thrown.value.detail, 'the button was never found')
  const hung = await quietly(() => s.target('hangs', { measure: () => new Promise(() => {}), atMost: 3, timeout: 50 }))
  assert.equal(hung.value.state, 'FAIL')
  assert.match(hung.value.detail, /timed out after 50ms/)
})

test('a broken run that gives no number is VOID: the bar was never seen crossed', async () => {
  let broken = false
  const s = new Suite('no number when broken')
  const r = await quietly(() =>
    s.target('accept', {
      measure: () => {
        if (broken) throw new Error('walk crashed')
        return 2
      },
      atMost: 3,
      breaks: () => {
        broken = true
        return () => {
          broken = false
        }
      },
    }),
  )
  assert.equal(r.value.state, 'VOID')
  assert.match(r.value.detail, /the broken run gave no number \(walk crashed\)/)
  assert.equal(broken, false, 'restored')
})

test('no breaks is UNPROVEN, exactly as check() reports it', async () => {
  const r = await quietly(() =>
    suite('unproven target', async (t) => {
      await t.target('accept a Sunday', { measure: tapsToAccept, atMost: 3, unit: 'taps' })
    }),
  )
  assert.equal(r.value.unproven, 1)
  assert.equal(r.value.ok, true, 'tolerated without requireNegativeControl, like check()')
  assert.match(plain(r.log), /UNPRV accept a Sunday — 2 taps \(≤ 3\)/)
  const strict = await quietly(() =>
    suite('unproven target, strict', async (t) => t.target('x', { measure: () => 1, atMost: 3 }), { requireNegativeControl: true }),
  )
  assert.equal(strict.value.ok, false)
  assert.equal(strict.exitCode, 1)
})

test('atLeast bars, and both bounds, print and judge correctly', async () => {
  const s = new Suite('bounds')
  let fps = 60
  const drop = () => {
    fps = 24
    return () => {
      fps = 60
    }
  }
  const floor = await quietly(() => s.target('scroll stays smooth', { measure: () => fps, atLeast: 55, unit: 'fps', breaks: drop }))
  assert.equal(floor.value.state, 'PASS')
  assert.match(plain(floor.log), /scroll stays smooth — 60 fps \(≥ 55\) · broken: 24 fps/)
  const band = await quietly(() => s.target('band', { measure: () => 3, atLeast: 3, atMost: 3 }))
  assert.equal(band.value.state, 'UNPROVEN', 'bounds are inclusive')
  assert.match(plain(band.log), /band — 3 \(≥ 3, ≤ 3\)/)
  const under = await quietly(() => s.target('too few', { measure: () => 2.456, atLeast: 3, unit: 's' }))
  assert.equal(under.value.state, 'FAIL')
  assert.match(plain(under.log), /too few — 2\.46 s \(≥ 3\)/)
})

test('usage errors throw before anything is measured', async () => {
  const s = new Suite('usage')
  let measured = 0
  const measure = () => ++measured
  await assert.rejects(() => s.target('no bar', { measure }), /set atMost, atLeast or both/)
  await assert.rejects(() => s.target('upside down', { measure, atLeast: 5, atMost: 3 }), /atLeast \(5\) is above atMost \(3\)/)
  await assert.rejects(() => s.target('NaN bar', { measure, atMost: Number.NaN }), /atMost must be a finite number, got NaN/)
  await assert.rejects(() => s.target('string bar', { measure, atMost: '3' }), /atMost must be a finite number, got the string "3"/)
  await assert.rejects(() => s.target('no measure', { atMost: 3 }), /measure must be a function/)
  assert.equal(measured, 0)
  assert.equal(s.results.length, 0, 'a usage error records nothing')
  // Inside suite() a usage error turns the run red, like any throw in the body.
  const r = await quietly(() => suite('usage in a suite', (t) => t.target('no bar', { measure })))
  assert.equal(r.value.ok, false)
  assert.match(plain(r.log), /ERROR target "no bar": set atMost, atLeast or both/)
})

test('report() counts targets in the same four states, beside checks', async () => {
  const r = await quietly(() =>
    suite('mixed', async (t) => {
      let n = 1
      const bump = () => {
        n = 5
        return () => {
          n = 1
        }
      }
      await t.target('pass', { measure: () => n, atMost: 3, breaks: bump })
      await t.target('void', { measure: () => 1, atMost: 3, breaks: () => () => {} })
      await t.target('fail', { measure: () => 9, atMost: 3 })
      await t.target('unproven', { measure: () => 1, atMost: 3 })
      await t.check('a plain check', { assert: () => n === 1, breaks: bump })
    }),
  )
  assert.deepEqual(
    { pass: r.value.pass, fail: r.value.fail, voids: r.value.voids, unproven: r.value.unproven },
    { pass: 2, fail: 1, voids: 1, unproven: 1 },
  )
  assert.deepEqual(r.value.targets, { pass: 1, fail: 1, voids: 1, unproven: 1 })
  assert.match(plain(r.log), /mixed: 2 passed, 1 failed, 1 void, 1 unproven/)
  assert.match(plain(r.log), /of which targets: 1 passed, 1 failed, 1 void, 1 unproven/)
  // A suite with no targets reports exactly as Rig 4 did.
  const old = await quietly(() => suite('checks only', (t) => t.check('c', { assert: () => true })))
  assert.equal('targets' in old.value, false)
  assert.doesNotMatch(plain(old.log), /of which targets/)
})

test('the Rig 4 Suite, which has no target(), makes the same suite red', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-old-suite-'))
  try {
    const src = execFileSync('git', ['show', `${RIG4}:harness/check.js`], { cwd: here, encoding: 'utf8' })
    assert.doesNotMatch(src, /target\(/, 'the Rig 4 file really is the one without target()')
    writeFileSync(join(dir, 'check.js'), src)
    const old = await import(pathToFileURL(join(dir, 'check.js')).href)
    const body = (t) => t.target('accept a Sunday', { measure: tapsToAccept, atMost: 3, unit: 'taps', breaks: addConfirmStep })

    const red = await quietly(() => old.suite('accept a shift', body))
    assert.equal(red.value.ok, false)
    assert.equal(red.exitCode, 1)
    assert.match(plain(red.log), /ERROR t\.target is not a function/)

    // The same body against this Suite is green: the red above is the missing method, nothing else.
    const green = await quietly(() => suite('accept a shift', body))
    assert.equal(green.value.ok, true)
    assert.equal(green.exitCode, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('countInput counts what it delivered, and the page saw the same input', async () => {
  await load(fixture)
  // What the page itself receives, counted in the page: the counter's numbers must match these.
  await page.eval(`(() => {
    window.__seen = { clicks: 0, touches: 0, keys: 0, wheels: 0 }
    addEventListener('click', () => __seen.clicks++, true)
    addEventListener('touchstart', () => __seen.touches++, true)
    addEventListener('keydown', () => __seen.keys++, true)
    addEventListener('wheel', () => __seen.wheels++, true)
  })()`)
  const c = countInput(page)
  assert.deepEqual({ ...c.counts(), ms: 0 }, { taps: 0, keys: 0, gestures: 0, ms: 0 })
  await c.click(200, 400)
  await c.tap(200, 400)
  await c.type('Sunday')
  await c.type('é✓') // two characters, however many bytes
  await c.wheel({ x: 200, y: 400, dy: 300, ticks: 5, ms: 5 })
  await c.swipe({ x: 200, y: 600, dy: -200, steps: 4, ms: 5 })
  await sleep(50)
  const got = c.counts()
  assert.equal(got.taps, 2)
  assert.equal(got.keys, 8)
  assert.equal(got.gestures, 2)
  assert.ok(got.ms >= 50, `ms runs from creation: ${got.ms}`)
  const seen = await page.eval('window.__seen')
  assert.equal(seen.clicks, 2, 'the click reached the page, and so did the tap (a tap is a click to the page too)')
  assert.equal(seen.touches, 2, 'the tap and the swipe each began a touch')
  assert.equal(seen.keys, 8, 'every key reached the page')
  assert.equal(seen.wheels, 5, 'one wheel gesture, delivered as its 5 ticks')

  // Control: input sent around the counter is not counted. The counter counts what it forwarded.
  await click(page, 200, 400)
  assert.equal(c.counts().taps, 2)
  assert.equal(await page.eval('window.__seen.clicks'), 3, 'but the page did get it')

  // An input that throws reached nothing and is not counted.
  const dead = countInput({
    send: async () => {
      throw new Error('target closed')
    },
  })
  await assert.rejects(() => dead.click(1, 1), /target closed/)
  assert.equal(dead.counts().taps, 0)

  c.reset()
  const z = c.counts()
  assert.deepEqual({ taps: z.taps, keys: z.keys, gestures: z.gestures }, { taps: 0, keys: 0, gestures: 0 })
  assert.ok(z.ms < 50, `reset restarts the clock: ${z.ms}`)
  assert.equal(c.page, page)
})

test('timeTo returns the milliseconds an async fn took, and passes its errors through', async () => {
  const ms = await timeTo(() => sleep(120))
  assert.ok(ms >= 115 && ms < 1000, `slept 120 ms, measured ${ms}`)
  const fast = await timeTo(async () => {})
  assert.ok(fast < 20, `an empty fn is near 0: ${fast}`)
  await assert.rejects(() => timeTo(() => Promise.reject(new Error('never found'))), /never found/)

  // As a bar: the walk is found in well under 3 s, and a slowed walk crosses it.
  let delay = 0
  const s = new Suite('time')
  const r = await quietly(() =>
    s.target('accept a Sunday in time', {
      measure: () =>
        timeTo(async () => {
          await tapsToAccept()
          await sleep(delay)
        }),
      atMost: 3000,
      unit: 'ms',
      breaks: () => {
        delay = 3200
        return () => {
          delay = 0
        }
      },
    }),
  )
  assert.equal(r.value.state, 'PASS', r.value.detail)
  assert.ok(r.value.brokenValue > 3000)
  assert.match(plain(r.log), /accept a Sunday in time — [\d.]+ ms \(≤ 3000\) · broken: [\d.]+ ms/)
})

test('acceptSunday drives with input a person could make: every tap lands on the step it meant', async () => {
  // Control for the walk itself: cover the Accept button and the walk must refuse, not tap through.
  await load(fixture)
  await input.click(...(await centre('#shift-sun')))
  await page.eval(`(() => {
    const o = document.createElement('div')
    Object.assign(o.style, { position: 'fixed', inset: 0, zIndex: 99 })
    document.body.appendChild(o)
  })()`)
  await assert.rejects(() => acceptSunday(), /#accept is covered/)
})

async function centre(sel) {
  return page.eval(
    `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()`,
  )
}
