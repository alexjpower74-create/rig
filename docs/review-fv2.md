# Review — fv2 · Hard numbers you can run

Reviewer: fv1. Read only. Diff: `git diff main...rig/fv2` at e915a9d (`harness/check.js`,
`harness/index.js`, `harness/target.js`, `test/target.test.js`, `examples/target-fixture.html`).

## The fv2 → fv1 contract: holds
- `harness/index.js` exports `countInput` and `timeTo` beside the existing names. `Suite#target`
  takes `(name, { measure, atMost, atLeast, unit = '', breaks, timeout })`, the same signature fv1's
  brief text gives word for word (`s.target(name, { measure, atMost, atLeast, unit, breaks, timeout })`,
  `countInput(page)`). Nothing to change on either side.
- `countInput` wraps the real `tap`/`click`/`type`/`wheel`/`swipe` from `harness/input.js` with their
  signatures intact, so input stays `Input.dispatch*`.
- `report()` gains `targets` only when a suite ran a target. The existing return shape is unchanged
  for suites without one.

## Findings

1. **A counter that is not reset inside `measure` makes the control unable to say VOID.**
   `harness/target.js:37` (`countInput`), used by `harness/check.js` `target()`.
   With an `atMost` bar, if `measure` reads `input.counts().taps` without calling `input.reset()` first,
   the broken run reports the first run's taps plus its own. Example: a working walk of 2 taps and a
   "broken" walk that still takes 2 taps gives 2, then 4. With `atMost: 3` that is a PASS, when it
   should be VOID. The bar looks proven when the break changed nothing. Your own test resets
   (`test/target.test.js:94`) and the doc example does too, so this is about how a caller uses it.
   But it is exactly the "check that cannot fail" this slice exists to stop, and a later caller will
   trip on it. Options to weigh: have `target()` call `measure` with a fresh start
   (e.g. accept `measure(input)` with a counter it resets itself), or warn when two runs return
   counts from the same counter without a reset in between, or at the least a line in the JSDoc
   saying "reset() first, or the broken run inherits the first run's count". fv1 will say
   "reset() at the start of measure" in the brief either way.

2. **A timed-out `measure` keeps driving the page while `restore()` runs.** `harness/check.js`
   `target()` → `read()` → `withTimeout(measure(), ...)`. If the broken run's `measure` times out, the
   promise is abandoned but its input dispatches carry on. `restore()` then runs against a page that
   is still being tapped, and the next check starts on whatever state that leaves. Rare, and
   `check()` has the same shape, so this is a note, not a blocker. Worth one sentence in the doc.

3. **`restore failed` on a PASS stays a PASS.** `harness/check.js`, after the `finally`: if
   `restore()` throws, the result can still be PASS with the note in its detail, and the next check
   runs on a page left broken. This matches `check()` (unchanged behaviour, so correct per the plan).
   Flagging it only so the report says it was a choice.

No findings against the hard rules: no dependencies, no new browser windows (`launch({ headless: true,
port: 9351 })`), no personal data in the diff, and no edits outside fv2's Owns list.
