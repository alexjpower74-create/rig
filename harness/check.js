// A check that cannot fail measured nothing.
//
// Every green assertion here has to earn it twice: once against the real page, and once against a
// page you have deliberately broken. If the assertion still passes while the thing it watches is
// broken, it is not green — it is VOID, and the run fails. That single rule is the difference
// between a suite that catches regressions and a suite that just runs.

const C = {
  pass: s => `\x1b[32m${s}\x1b[0m`,
  fail: s => `\x1b[31m${s}\x1b[0m`,
  void_: s => `\x1b[35m${s}\x1b[0m`,
  warn: s => `\x1b[33m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`
}

export class Suite {
  constructor (name, opts = {}) {
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
  async check (name, { assert, breaks, timeout = 10_000 } = {}) {
    const started = Date.now()
    const rec = { name, state: null, detail: '', ms: 0 }

    let ok
    try { ok = await withTimeout(assert(), timeout, name) }
    catch (e) { ok = false; rec.detail = e.message }

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
      try { stillPasses = await withTimeout(assert(), timeout, name + ' (control)') }
      catch { stillPasses = false }
    } finally {
      if (typeof restore === 'function') { try { await restore() } catch (e) { rec.detail = 'restore failed: ' + e.message } }
    }

    if (stillPasses) {
      rec.state = 'VOID'
      rec.detail = 'passed even with the thing under test broken — this assertion measures nothing'
    } else {
      rec.state = 'PASS'
    }
    return this.#record(rec, started)
  }

  #record (rec, started) {
    rec.ms = Date.now() - started
    this.results.push(rec)
    const tag = { PASS: C.pass('PASS '), FAIL: C.fail('FAIL '), VOID: C.void_('VOID '), UNPROVEN: C.warn('UNPRV') }[rec.state]
    console.log(`  ${tag} ${rec.name} ${C.dim(rec.ms + 'ms')}`)
    if (rec.detail) console.log(`        ${C.dim(rec.detail)}`)
    return rec
  }

  report () {
    const by = s => this.results.filter(r => r.state === s).length
    const pass = by('PASS'), fail = by('FAIL'), voids = by('VOID'), unproven = by('UNPROVEN')
    console.log(`\n${this.name}: ${pass} passed, ${fail} failed, ${voids} void, ${unproven} unproven`)
    if (voids) console.log(C.void_('  VOID checks passed against a broken page. They are not evidence of anything.'))
    if (unproven && this.requireNegativeControl) console.log(C.warn('  UNPROVEN checks are failing this run (requireNegativeControl).'))
    const bad = fail + voids + (this.requireNegativeControl ? unproven : 0)
    return { pass, fail, voids, unproven, ok: bad === 0 }
  }
}

export async function suite (name, fn, opts) {
  const s = new Suite(name, opts)
  console.log(`\n${name}`)
  try { await fn(s) } catch (e) { console.log(`  ${C.fail('ERROR')} ${e.message}`); s.results.push({ name: 'suite', state: 'FAIL', detail: e.message, ms: 0 }) }
  const r = s.report()
  if (!r.ok) process.exitCode = 1
  return r
}

function withTimeout (p, ms, what) {
  // The timer must keep the event loop alive while the check is in flight: with an unref'd timer, a check whose
  // promise never settles let Node 22 run out of work and exit before the timeout could fire (CI, 2026-09-13:
  // "Promise resolution is still pending but the event loop has already resolved"). Clear it once the race settles
  // so a passing check does not hold the process open for the full timeout.
  let timer
  const deadline = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timed out after ${ms}ms: ${what}`)), ms) })
  return Promise.race([Promise.resolve(p), deadline]).finally(() => clearTimeout(timer))
}
