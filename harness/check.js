// A check that cannot fail measured nothing.
//
// Every green assertion here has to earn it twice: once against the real page, and once against a
// page you have deliberately broken. If the assertion still passes while the thing it watches is
// broken, it is not green — it is VOID, and the run fails. That single rule is the difference
// between a suite that catches regressions and a suite that just runs.
//
// target() is the same rule for a number: a bar like "at most 3 taps" is checked against the real
// page, then against a broken one, and the number is printed beside its bar every time.

import { describe, formatBound, formatValue, insideBar } from './target.js'

const C = {
  pass: (s) => `\x1b[32m${s}\x1b[0m`,
  fail: (s) => `\x1b[31m${s}\x1b[0m`,
  void_: (s) => `\x1b[35m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
}

export class Suite {
  constructor(name, opts = {}) {
    this.name = name
    this.results = []
    this.requireNegativeControl = opts.requireNegativeControl ?? false
  }

  /**
   * check(name, { assert, breaks, timeout })
   *   assert()  -> truthy for pass. Throwing counts as a failure.
   *   breaks()  -> deliberately break the thing under test. Return a function that restores it.
   *               Omit only when you genuinely cannot break it; the result is reported UNPROVEN.
   */
  async check(name, { assert, breaks, timeout = 10_000 } = {}) {
    const started = Date.now()
    const rec = { name, state: null, detail: '', ms: 0 }

    let ok
    try {
      ok = await withTimeout(assert(), timeout, name)
    } catch (e) {
      ok = false
      rec.detail = e.message
    }

    if (!ok) {
      rec.state = 'FAIL'
      return this.#record(rec, started)
    }

    if (!breaks) {
      rec.state = 'UNPROVEN'
      rec.detail = 'no negative control — this check has never been shown to fail'
      return this.#record(rec, started)
    }

    let restore
    let stillPasses
    try {
      restore = await withTimeout(breaks(), timeout, name + ' (breaks)')
      try {
        stillPasses = await withTimeout(assert(), timeout, name + ' (control)')
      } catch {
        stillPasses = false
      }
    } finally {
      if (typeof restore === 'function') {
        try {
          await restore()
        } catch (e) {
          rec.detail = 'restore failed: ' + e.message
        }
      }
    }

    if (stillPasses) {
      rec.state = 'VOID'
      rec.detail = 'passed even with the thing under test broken — this assertion measures nothing'
    } else {
      rec.state = 'PASS'
    }
    return this.#record(rec, started)
  }

  /**
   * target(name, { measure, atMost, atLeast, unit, breaks, timeout })
   *   measure() -> a finite number: taps, ms, bytes, frames. Anything else is a FAIL that names
   *               what came back. Throwing is a FAIL with the error as its detail.
   *   atMost / atLeast -> the bar, inclusive. Set one or both; with neither, target() throws.
   *   unit      -> printed after the number: 'taps' gives `2 taps (≤ 3)`.
   *   breaks()  -> break the thing the bar protects and return a restore function, as in check().
   *               measure() runs again while it is broken. If that number is still inside the bar,
   *               the bar cannot tell broken from working and the result is VOID. If the broken run
   *               produces no number at all, that is VOID too: the bar was never seen crossed.
   *               Omit it and the result is UNPROVEN, exactly as check() reports it.
   *   timeout   -> per measure() call, default 10 s.
   *
   *   await s.target('accept a Sunday', {
   *     measure: async () => { input.reset(); await acceptShift(input); return input.counts().taps },
   *     atMost: 3, unit: 'taps',
   *     breaks: addAConfirmStep,
   *   })
   *   //  PASS  accept a Sunday — 2 taps (≤ 3) · broken: 4 taps
   *
   * The record in s.results keeps kind: 'target', value, brokenValue, bound { atMost, atLeast }
   * and unit, beside the state, detail and ms every check has.
   */
  async target(name, { measure, atMost, atLeast, unit = '', breaks, timeout = 10_000 } = {}) {
    if (typeof measure !== 'function') throw new TypeError(`target "${name}": measure must be a function that returns a number`)
    if (atMost === undefined && atLeast === undefined) {
      throw new TypeError(`target "${name}": set atMost, atLeast or both — a target with no bar measures nothing`)
    }
    for (const [k, v] of [
      ['atMost', atMost],
      ['atLeast', atLeast],
    ]) {
      if (v !== undefined && !Number.isFinite(v)) throw new TypeError(`target "${name}": ${k} must be a finite number, got ${describe(v)}`)
    }
    if (atMost !== undefined && atLeast !== undefined && atLeast > atMost) {
      throw new TypeError(`target "${name}": atLeast (${atLeast}) is above atMost (${atMost}) — nothing could pass`)
    }

    const started = Date.now()
    const bound = {}
    if (atMost !== undefined) bound.atMost = atMost
    if (atLeast !== undefined) bound.atLeast = atLeast
    const rec = { name, kind: 'target', state: null, detail: '', ms: 0, value: null, brokenValue: null, bound, unit }

    const read = async (what) => {
      try {
        const v = await withTimeout(measure(), timeout, what)
        return Number.isFinite(v) ? { value: v } : { why: `measure() returned ${describe(v)}, not a finite number` }
      } catch (e) {
        return { why: e.message }
      }
    }

    const first = await read(name)
    if (first.why) {
      rec.state = 'FAIL'
      rec.detail = first.why
      return this.#record(rec, started)
    }
    rec.value = first.value
    if (!insideBar(rec.value, bound)) {
      rec.state = 'FAIL'
      rec.detail = `${formatValue(rec.value, unit)} is outside the bar ${formatBound(bound)}`
      return this.#record(rec, started)
    }

    if (!breaks) {
      rec.state = 'UNPROVEN'
      rec.detail = 'no negative control — this bar has never been shown to fail'
      return this.#record(rec, started)
    }

    let restore
    let broken = { why: 'breaks() did not finish' }
    try {
      restore = await withTimeout(breaks(), timeout, name + ' (breaks)')
      broken = await read(name + ' (control)')
    } catch (e) {
      broken = { why: e.message }
    } finally {
      if (typeof restore === 'function') {
        try {
          await restore()
        } catch (e) {
          rec.detail = 'restore failed: ' + e.message
        }
      }
    }

    const restoreNote = rec.detail
    if (broken.why) {
      rec.state = 'VOID'
      rec.detail = `the broken run gave no number (${broken.why}), so the bar was never seen crossed`
    } else {
      rec.brokenValue = broken.value
      if (insideBar(broken.value, bound)) {
        rec.state = 'VOID'
        rec.detail = 'the number stayed inside the bar with the thing broken — this bar measures nothing'
      } else {
        rec.state = 'PASS'
        rec.detail = ''
      }
    }
    if (restoreNote) rec.detail = rec.detail ? `${rec.detail}; ${restoreNote}` : restoreNote
    return this.#record(rec, started)
  }

  #record(rec, started) {
    rec.ms = Date.now() - started
    this.results.push(rec)
    const tag = { PASS: C.pass('PASS '), FAIL: C.fail('FAIL '), VOID: C.void_('VOID '), UNPROVEN: C.warn('UNPRV') }[rec.state]
    console.log(`  ${tag} ${rec.kind === 'target' ? targetLine(rec) : rec.name} ${C.dim(rec.ms + 'ms')}`)
    if (rec.detail) console.log(`        ${C.dim(rec.detail)}`)
    return rec
  }

  report() {
    const by = (s) => this.results.filter((r) => r.state === s).length
    const pass = by('PASS'),
      fail = by('FAIL'),
      voids = by('VOID'),
      unproven = by('UNPROVEN')
    console.log(`\n${this.name}: ${pass} passed, ${fail} failed, ${voids} void, ${unproven} unproven`)
    if (voids) console.log(C.void_('  VOID checks passed against a broken page. They are not evidence of anything.'))
    if (unproven && this.requireNegativeControl) console.log(C.warn('  UNPROVEN checks are failing this run (requireNegativeControl).'))
    const bad = fail + voids + (this.requireNegativeControl ? unproven : 0)
    const targets = this.results.filter((r) => r.kind === 'target')
    if (!targets.length) return { pass, fail, voids, unproven, ok: bad === 0 }
    const t = (s) => targets.filter((r) => r.state === s).length
    const tc = { pass: t('PASS'), fail: t('FAIL'), voids: t('VOID'), unproven: t('UNPROVEN') }
    console.log(C.dim(`  of which targets: ${tc.pass} passed, ${tc.fail} failed, ${tc.voids} void, ${tc.unproven} unproven`))
    return { pass, fail, voids, unproven, ok: bad === 0, targets: tc }
  }
}

export async function suite(name, fn, opts) {
  const s = new Suite(name, opts)
  console.log(`\n${name}`)
  try {
    await fn(s)
  } catch (e) {
    console.log(`  ${C.fail('ERROR')} ${e.message}`)
    s.results.push({ name: 'suite', state: 'FAIL', detail: e.message, ms: 0 })
  }
  const r = s.report()
  if (!r.ok) process.exitCode = 1
  return r
}

/** `accept a Sunday — 2 taps (≤ 3) · broken: 4 taps`. A run with no number says so instead. */
function targetLine(rec) {
  const now = rec.value === null ? 'no number' : formatValue(rec.value, rec.unit)
  const broken = rec.brokenValue === null ? '' : ` · broken: ${formatValue(rec.brokenValue, rec.unit)}`
  return `${rec.name} — ${now} ${formatBound(rec.bound)}${broken}`
}

function withTimeout(p, ms, what) {
  // The timer must keep the event loop alive while the check is in flight: with an unref'd timer, a check whose
  // promise never settles let Node 22 run out of work and exit before the timeout could fire (CI, 2026-09-13:
  // "Promise resolution is still pending but the event loop has already resolved"). Clear it once the race settles
  // so a passing check does not hold the process open for the full timeout.
  let timer
  const deadline = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`timed out after ${ms}ms: ${what}`)), ms)
  })
  return Promise.race([Promise.resolve(p), deadline]).finally(() => clearTimeout(timer))
}
