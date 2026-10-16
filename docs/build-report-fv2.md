# Build report — fv2 · Hard numbers you can run

Branch `rig/fv2`. Commits: e915a9d (target, countInput, timeTo, fixture, test), de84444 (key-count
test hardened), 8a5e2cc (counters reset before each measure run, from fv1's review), and this report.

## What I built

- DONE **`Suite#target(name, { measure, atMost, atLeast, unit = '', breaks, timeout })`** in
  `harness/check.js`, documented in its JSDoc. Every line prints the number beside its bar and the
  broken run's number. Real output from the fixture at 8a5e2cc:

  ```
    PASS  accept a Sunday — 2 taps (≤ 3) · broken: 4 taps 263ms
    VOID  accept a Sunday (break misspelt) — 2 taps (≤ 3) · broken: 2 taps 166ms
          the number stayed inside the bar with the thing broken — this bar measures nothing
    FAIL  accept a Sunday in one tap — 2 taps (≤ 1) 83ms
          2 taps is outside the bar (≤ 1)
    FAIL  accept a Sunday (returns counts()) — no number (≤ 3) 84ms
          measure() returned an object {"taps":2,"keys":0,"gestures":0,"ms":83}, not a finite number

  accept a shift: 1 passed, 2 failed, 1 void, 0 unproven
    of which targets: 1 passed, 2 failed, 1 void, 0 unproven
  ```

  The result record keeps `kind: 'target'`, `value`, `brokenValue`, `bound { atMost, atLeast }` and
  `unit`. `report()` counts targets in the same four totals, and for a suite that has targets it
  adds one dim line and a `targets` key. A suite with no targets prints and returns exactly what
  Rig 4 did. `check()` is unchanged.
- DONE **`countInput(page)`** in `harness/target.js`. It wraps `tap`, `click`, `type`, `wheel` and
  `swipe` from `harness/input.js`, so all input stays `Input.dispatch*`. `counts()` returns
  `{ taps, keys, gestures, ms }`, and `reset()` zeroes the counts and restarts the clock. `.page` is
  the page itself.
- DONE **`timeTo(fn)`**: the milliseconds `await fn()` took, to 0.1 ms. Errors pass through.
- DONE all three are exported from `harness/index.js`; the existing exports are untouched.
- DONE `examples/target-fixture.html`: an "Open shifts" list where accepting Sunday is 2 taps.
  `?confirm` adds a tick-box and Confirm, which makes it 4. At each step exactly one control carries
  `[data-next]`, and the test's walk taps whatever that is, after a hit-test, so the count comes from
  the flow and is not written into the test. Light and dark styles, 52 px targets.
- DONE `test/target.test.js`: 16 node:test cases, headless Chrome on port 9351, about 5.5 s.

## What I verified, and the red I saw

QA at **8a5e2cc**: `rig qa 8a5e2cc --run "npm ci --no-audit --no-fund && npm run check"` →
`rig qa: test exit 0 at 8a5e2cc` and `rig qa: negative exit 0 at 8a5e2cc`. Biome is clean, all
12 test files are green, the personal-data scan is clean, and `npm run demo` still prints exactly one
VOID and one FAIL. `rig qa 8a5e2cc --run "node test/target.test.js"` gave 16 of 16, test exit 0.
(The first run at de84444 was also test exit 0 for `npm run check`.)

The test shows the four required outcomes on the real page: a PASS at 2 → 4; a VOID from a
misspelt break (`?confrim`) at 2 → 2; a FAIL at 2 over `≤ 1`; and a non-number (`counts()` instead
of `counts().taps`) as a named FAIL. The **Rig 4 `Suite`** comes from `git show 7d40d97:harness/check.js`
and runs the same body: `ERROR t.target is not a function`, `ok: false`, exit code 1. The same body
against the new Suite is green, so the missing method is the only cause of the red.

Each check was seen red by swapping broken or old code into the committed files. Every run's
output went to a file, and each exit code was read from that file, not through a pipe:

| Swapped in | Exit | Went red |
|---|---|---|
| Rig 4 `harness/check.js` (7d40d97) | 1 | 13 of 15 tests, including PASS, VOID, FAIL, non-number, Rig 4 suite |
| broken run's number ignored (no VOID) | 1 | VOID test, report() counts |
| `measure()` result coerced with `Number()` | 1 | non-number test (`'2'` became a PASS) |
| `countInput.tap` not counted | 1 | countInput test |
| unit dropped from the printed line | 1 | 6 tests that read the line |
| off-by-one bound (`> atMost + 1`) | 1 | FAIL, PASS, Rig 4 suite tests |
| keys counted in UTF-16 units | **0 — survived** | nothing: `é✓` is 2 units and 2 code points |
| ↳ same, after de84444 (`é🙂`) | 1 | countInput test, `9 !== 8` |
| de84444 `check.js` without the reset (fv1's finding) | 1 | forgetful-measure test, `'PASS' !== 'VOID'` |

The surviving mutant was a real gap in the test, and de84444 closes it.

The walk has its own control: covering the Accept button makes it refuse with `#accept is covered`
instead of tapping through. The countInput test counts the input the page actually received
(click, touchstart, keydown and wheel listeners) and checks that it matches the counter. It also
shows that input sent around the counter is not counted, and that input which throws is not counted.

I looked at screenshots of the fixture: the list, and the confirm sheet over the scrim. Both render
cleanly at 390×844. They live in my scratch only, because `docs/shots/` is fv3's.

## From review (fv1, docs/review-fv2.md on rig/fv1 at 9162c27)

1. DONE A counter that was not reset inside `measure` let the broken run inherit the first run's taps
   (2 + 2 = 4), so a break that changed nothing read PASS. The fix, which the lead decided, is a
   guarantee and not a doc line: `countInput` registers each counter (weakly) and `target()` calls
   `resetCounters()` before every measure run, the real one and the broken one. A test with a
   measure that never resets comes out VOID at 8a5e2cc and PASS with de84444's `check.js`. fv1
   verified both.
2. DONE The JSDoc now says that a measure cut off by its timeout is not stopped and may still
   dispatch input while `restore()` runs.
3. DONE A restore failure on a PASS stays a PASS, with the failure in the detail (see Decided).

## Decided

- If the broken run gives **no number** (it throws, times out or returns a non-number), the result is
  **VOID**: "the broken run gave no number (…), so the bar was never seen crossed". `check()` treats
  a throwing control as a PASS. A bar, though, is a claim about a number, and a walk that crashes is
  not evidence that the number would have crossed the bar. A `breaks()` that throws is also VOID.
- A restore failure on a PASS stays a PASS, as in `check()`, and the detail line names the failure.
  (The lead's decision.)
- Bounds are inclusive: `atMost: 3` lets 3 through, like Lighthouse's `maxNumericValue`.
- Usage errors are `TypeError`s, thrown before anything is measured, and nothing is recorded.
  Covered: no bound, a non-finite or non-number bound, `atLeast > atMost`, and a missing `measure`.
  Inside `suite()` one turns the run red through the existing ERROR path.
- With a bar that misses on the real run, the broken run is skipped and `brokenValue` stays `null`.
  There is nothing left to prove.
- A tap or a click is one tap, and the page also gets a click from a tap. Keys are code points,
  which is how `type()` sends them. A wheel or swipe is one gesture, however many ticks it takes.
  Input that throws is not counted.
- Numbers print as integers when they are integers, and to 2 decimals otherwise. `timeTo` keeps 0.1 ms.

## Left undone / for others

- **harness/cdp.js (no owner):** `page.goto` races the load against a 30 s `setTimeout` it never
  clears, so any suite that uses `goto` stays alive 30 s after its last test. My test loads pages
  through its own `Page.loadEventFired` listener instead. The lead will fix it on main after the
  merges, with a test.
- **fv3:** swap your own counter for `countInput` once this is on main. Note that `target()` now
  resets every live counter before each measure run, so a count that must cover the whole walk has
  to be taken inside `measure`.
- **QA note:** a fresh QA worktree has no `node_modules`, so `rig qa <sha> --run "npm run check"`
  exits 127 (`biome: command not found`). Use `--run "npm ci && npm run check"`.
- Nothing is waiting on Alexander from this slice.
