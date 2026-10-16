// A bar with a hard number, and the instruments to read it.
//
// "Fast enough" and "only a couple of taps" are not bars: nobody can be shown to have missed them.
// A bar is a number with a bound, like a Lighthouse budget or a size-limit line: `2 taps (≤ 3)`.
// Suite#target (harness/check.js) checks the bound and prints the number either way. This file
// holds what you measure with:
//
//   countInput(page)  counts the real input a walk took: taps, keys, gestures and elapsed ms.
//   timeTo(fn)        the milliseconds an async fn took, for bars like "found in under 10 s".
//
// Every input still goes through harness/input.js, so it stays real Input.dispatch* events. The
// counter only counts what it forwarded; it never invents an event and never skips one.

import { click, swipe, tap, type, wheel } from './input.js'

/**
 * countInput(page) -> a counter that drives the page and counts what it did.
 *
 *   const input = countInput(page)
 *   await input.tap(x, y)                 // same signatures as harness/input.js
 *   await input.click(x, y)
 *   await input.type('Sunday')
 *   await input.wheel({ dy: 800 })
 *   await input.swipe({ dy: -400 })
 *   input.counts()                        // { taps: 2, keys: 6, gestures: 2, ms: 1840 }
 *   input.reset()                         // zero the counts and restart the clock
 *
 * What counts as one:
 *   taps      a tap or a click (one press, wherever it landed)
 *   keys      one per character typed (a code point, as type() sends them)
 *   gestures  a wheel or a swipe, however many ticks or steps it took
 *   ms        wall time since countInput() or the last reset()
 *
 * An input that throws is not counted: it did not reach the page. `input.page` is the page itself,
 * for reads and hit-tests that are not input.
 *
 * Suite#target resets every live counter before each measure() run, the real one and the broken
 * one, so a measure that forgets reset() cannot hand the broken run the first run's taps and turn
 * a VOID into a PASS. A count that must span a target() call belongs inside measure().
 */
export function countInput(page) {
  let taps = 0
  let keys = 0
  let gestures = 0
  let started = performance.now()

  const counter = {
    page,
    async tap(x, y) {
      await tap(page, x, y)
      taps++
    },
    async click(x, y, opts) {
      await click(page, x, y, opts)
      taps++
    },
    async type(text, opts) {
      await type(page, text, opts)
      keys += [...String(text)].length
    },
    async wheel(opts) {
      await wheel(page, opts)
      gestures++
    },
    async swipe(opts) {
      await swipe(page, opts)
      gestures++
    },
    counts() {
      return { taps, keys, gestures, ms: Math.round(performance.now() - started) }
    },
    reset() {
      taps = 0
      keys = 0
      gestures = 0
      started = performance.now()
    },
  }
  live.add(new WeakRef(counter))
  return counter
}

// Every counter countInput() has made and the program still holds. Weak, so a finished walk's
// counter (and the page it points at) can still be collected.
const live = new Set()

/** Reset every live counter. Suite#target calls this before each measure() run. */
export function resetCounters() {
  for (const ref of live) {
    const c = ref.deref()
    if (c) c.reset()
    else live.delete(ref)
  }
}

/**
 * timeTo(fn) -> the milliseconds `await fn()` took, to a tenth of a millisecond.
 *
 *   await s.target('search finds the shift', {
 *     measure: () => timeTo(() => searchFor('Sunday')),
 *     atMost: 10_000, unit: 'ms',
 *     breaks: slowTheIndexDown,
 *   })
 *
 * If fn throws, so does timeTo: a run that failed has no time worth reporting.
 */
export async function timeTo(fn) {
  const t0 = performance.now()
  await fn()
  return Math.round((performance.now() - t0) * 10) / 10
}

// ── Formatting, shared with Suite#target ─────────────────────────────────────────────────────

/** `2 taps`, `412.5 ms`, `7` — the number as a person reads it, with its unit. */
export function formatValue(value, unit = '') {
  const n = Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
  return unit ? `${n} ${unit}` : n
}

/** `(≤ 3)`, `(≥ 60)`, `(≥ 2, ≤ 5)` — the bar, as printed beside every number. */
export function formatBound({ atMost, atLeast }) {
  const parts = []
  if (atLeast !== undefined) parts.push(`≥ ${formatValue(atLeast)}`)
  if (atMost !== undefined) parts.push(`≤ ${formatValue(atMost)}`)
  return `(${parts.join(', ')})`
}

/** True when value sits inside the bar. Bounds are inclusive: `atMost: 3` lets 3 through. */
export function insideBar(value, { atMost, atLeast }) {
  if (atMost !== undefined && value > atMost) return false
  if (atLeast !== undefined && value < atLeast) return false
  return true
}

/** What came back from measure(), named for a person: `undefined`, `NaN`, `the string "2"`. */
export function describe(v) {
  if (v === undefined || v === null) return String(v)
  if (typeof v === 'number') return String(v) // NaN, Infinity, -Infinity
  if (typeof v === 'string') return `the string ${JSON.stringify(v)}`
  if (typeof v === 'bigint') return `the bigint ${v}n`
  if (typeof v === 'object') {
    let s
    try {
      s = JSON.stringify(v)
    } catch {
      s = Object.prototype.toString.call(v)
    }
    if (s && s.length > 80) s = s.slice(0, 77) + '...'
    return `${Array.isArray(v) ? 'an array' : 'an object'} ${s}`
  }
  return `a ${typeof v}`
}
