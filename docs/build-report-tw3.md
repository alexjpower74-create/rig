# Build report: tw3 (gate semantics)

Commit `58f5f45` on `rig/tw3` (plus this report). Owns respected: finish.js, qa.js, plan.js, config.js, two new tests.

## What was built
**Item 4, negative exit meaning.** A negative command's exit is read by an explicit rule, `negativeExpect`:
- `"pass"` (default, today's shape): exit 0 once every control went red (`... || true`). Existing configs unchanged.
- `"fail"`: exits non-zero when the break is caught (`! cmd`, expect-fail).
Set by `--negative-expect pass|fail`, `negativeExpect` in `.rig/config.json`, or on the plan line itself:
`Negative controls: \`npm run negative\` (exits non-zero when the break is caught)`.
`rig qa --negative` records `negativeExpect`, `caught`, `meaning` and prints
`negative control "<cmd>" exited N, expecting …: CAUGHT|NOT CAUGHT (<meaning>)`. A not-caught run makes `rig qa` exit non-zero.
`rig finish` gates on `caught`, prints command, exit and meaning, and fails when the recorded reading differs from what the repo says now ("read as expecting non-zero, but the repo now says exit 0 — re-run"). Records from before 5.6.1 (no `caught`) are read the old way: exit 0 is caught.
Never caught under either reading: deadline/stall (124), exit ≥126 (signal, not found, not executable), and a "fail"-command that exited 0 because nothing broke.

**Item 5, never grade a server.** New `testCommand` config. Test command = `--run`, else `testCommand`, else `devCommand` only if it is not server-shaped (with a note naming it). A server-shaped command (`npm start|dev|serve|watch|preview`, `vite|next|nuxt|astro|webpack|rails dev|start|serve`, `nodemon`, `http-server`, `live-server`, `serve`), from `--run`, `testCommand` or `devCommand`, is refused: exit 2, before any lease or worktree is touched, nothing recorded. Test runs now record `timedOut`; `rig qa` exits 124 for a stopped run; `rig finish` refuses a record with `timedOut`/`stalled` even if it says exit 0. finish's "QA ran the project's test command" warning now compares against `testCommand`.

## Red seen (new tests run against 5.6.0's source, 53813a7, via a scratch worktree)
14 of 15 tests fail on 5.6.0, all pass on 58f5f45:
- exit-1-caught passes when configured / fails otherwise, meaning printed: tests 1, 2, 3 (5.6.0 has no `--negative-expect`, records no meaning, gate read exit 0 only).
- exit 0 because nothing broke is not caught: test 4.
- plan line parse, `|| true` back-compat, deadline-killed negative, classify table: tests 5-8.
- devCommand `npm start` refused / never the test / testCommand wins / server-shape table: 5.6.0 ran `npm start` as the test (the run hung until the stall window, which is the bug itself).
- deadline-killed run never green, gate refuses `exit 0` + `timedOut`: red on 5.6.0.
The one that passes on 5.6.0 ("killed by a signal is not green", exit 137) is a regression guard: 5.6.0 already mapped signals; it pins that behaviour.
Related existing tests: `qa-finish`, `gate-finish` pass; `qa-watch` passes run directly (`node test/qa-watch.test.js`, 7/7); under `node --test` it showed a file-level "test failed" after 45 s with no failing subtest, not investigated (it does not touch my code paths).

## Decided
- Default reading stays "pass" so nothing existing changes.
- Refusal covers `--run` too, not only the devCommand default. A false positive is escaped by naming the real test script.
- A devCommand that is not server-shaped still works (with a note), so older configs with `devCommand: "npm test"` keep running.
- `src/qa/watch.js` already returns 124 for deadline kills; no change needed there.

## For the lead (README / CHANGELOG / USAGE)
- CHANGELOG 5.6.1: "`rig qa --negative` records whether the exit meant the break was caught (`negativeExpect: pass|fail`, `--negative-expect`, or '(exits non-zero when the break is caught)' on the plan's Negative controls line); `rig finish` gates on that and prints it. `rig qa` refuses server commands as the test (new `testCommand`), and a run stopped by the deadline or a signal is never green."
- README config table: `testCommand`, `negativeExpect`. USAGE text is in `src/commands/qa.js` already.

## Left / not done
- No listening-port probe: a non-obviously-named server given as `--run` is only stopped by the deadline (recorded 124, never green), not refused up front.
- `rig fold` (not mine) still falls back `testCommand` then `devCommand`; same server risk there.
- Independent review (`rig review tw3`) not yet run; the full suite is the lead's single run.

## Fix round: rv-561's early review of 58f5f45 (fixed in 4b21f69)
All five findings fixed; the new tests are red on 58f5f45 (5 fail) and green on the fix.
1. HIGH, DONE: under `fail`, a non-zero exit is "caught" only if the output also names a failing control (`parseFailures`, or a FAIL / RED / `not ok` / "went red" line) and shows none of the not-ran shapes (Missing script, SyntaxError, Cannot find module, ENOENT, command not found). Test: a typo'd npm script, an `exit 1` script that names nothing, and a node syntax error are NOT CAUGHT; the same plan with a script that names a failing control is caught. Red on 58f5f45: the typo'd script read CAUGHT.
2. DONE: only a trailing `(exits non-zero when the break is caught)` or `(expect: fail|pass)` sets the meaning; prose never does.
3. DONE: a line with meaning words and no backticked command is refused (`plan.negativeProblem`); `rig qa` exits 2, `rig finish` fails "negative controls line is usable".
4. DONE: kept the flag, scoped to the run. `rig qa` prints a note when it disagrees with the repo, and `rig finish`'s message names the repair (set `negativeExpect` in .rig/config.json or put the marker on the plan line).
5. DONE: tests use `qaPort: 0`.
