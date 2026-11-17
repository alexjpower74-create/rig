# Review: tw3, gate semantics (negative exit meaning, qa never grades a server)

## Early review at 58f5f45 (2026-11-17)

Read: `git diff main...rig/tw3` (src/config.js, src/plan.js, src/commands/qa.js, src/commands/finish.js,
two new test files). Ran: `node --test test/finish-negative.test.js test/qa-not-a-server.test.js` on a
detached checkout of 58f5f45, with `WAYLAND_DISPLAY`, `DISPLAY` and `HC_TERMINAL_ID` unset: 15/15 pass
while port 5199 is free (see finding 5).

What holds up:
- The local runner always returns a number (`exitCodeFor` maps a signal to 128+n, a deadline to 124),
  so `classifyNegative` never sees `null`. Host runs come back as 124 or 143 too (`src/remote.js`).
- A stopped run is never green: `qaState` checks `timedOut || stalled`, and the waiver still refuses
  124/137/143. A test covers the "exit 0 but timedOut" record.
- Old records with no stored meaning are read the old way, exit 0 = caught, and a test pins that.
- A server is refused before any lease or worktree is touched (asserted: no `.worktrees`).
- Commit author and committer are the owner. No home paths or AI names in the diff.

### 1. HIGH: under `negativeExpect: "fail"`, a negative command that never ran its controls reads as "caught"
`src/config.js:206` (`classifyNegative`). Under "fail", any exit from 1 to 125 counts as caught. Only
124, signals (128 and up), 126 and 127 are excluded. A negative command that breaks for an unrelated
reason exits 1 or 2:
- a typo'd npm script (`npm run negativ` gives "Missing script", exit 1; checked);
- a syntax error or missing import in the control script (node exits 1);
- a missing fixture or a wrong working directory.

Each of these is recorded `caught: true`, prints CAUGHT, and passes `rig finish`. That is the exact
fooling the bar rules out ("`rig finish` cannot be fooled by … a negative command that exits 1 when
the break is caught"). Under "fail", a non-zero exit cannot tell "the guard caught the break" apart
from "the guard never ran", so the exit alone can't carry the meaning.

Scenario: plan line ``- Negative controls: `npm run negativ` (exits non-zero when the break is caught)``
leads to `rig qa <sha>`, then "CAUGHT", then a green finish gate, with no control having run.

Fix direction (your choice): under "fail", require positive evidence beyond the exit. For example, the
run must name at least one failure (`parseFailures(r.text)` / `tally.failed > 0`, which qa already
computes in `localStage`). Or: the command is run against the unbroken tree too and must exit 0
there (expect-fail runners do this). At the very least, refuse the known not-ran shapes (npm
"Missing script", `ERR_MODULE_NOT_FOUND`, `SyntaxError`). Add a test that is red today: under "fail",
a missing npm script is CAUGHT.

### 2. MEDIUM: the plan-line reader flips meaning on prose that only mentions failure
`src/plan.js:173`. `\bexpects? (?:fail|failure)\b` anywhere in the line's prose sets "fail". A line
describing the old `|| true` shape is read backwards. Checked:
``- Negative controls: `npm run demo` (each control expects failure of its guarded test; the script exits 0 once all went red)``
gives `{ cmd: 'npm run demo', expect: 'fail' }`. The demo then exits 0 and is read as NOT CAUGHT. That
is a fail-closed failure, so it isn't a security hole, but it is "a gate whose meaning flips depending
on how a script was written" (plan anti-reference). Fix: accept only the exact marker forms you
document, "(exits non-zero when the break is caught)" and "(expect: fail)", inside the trailing
parenthesis, and say so in the USAGE text.

### 3. LOW: a line with no backticks keeps the prose in the command
`src/plan.js:174`. `- Negative controls: npm run negative, which exits non-zero when the break is caught`
gives `cmd: "npm run negative, which exits non-zero when the break is caught"`, which npm runs with
those words as script arguments. The 5.6.0 parser had the same shape, but 5.6.1 now invites people to
write the meaning on that line. Fix: when the meaning words are found outside parentheses and there
is no backtick span, refuse the line ("put the command in backticks") rather than guess.

### 4. LOW–MEDIUM: `--negative-expect` records a meaning the gate never honours
`src/commands/qa.js:136` reads the flag first. `src/commands/finish.js:500` reads only config and
plan. So `rig qa <sha> --negative-expect fail` prints CAUGHT and exits 0, then `rig finish` fails it
with "re-run `rig qa <sha> --negative`". Re-running as told can't fix it: without the flag, the same
exit reads NOT CAUGHT. Your own test pins this ("the same record fails the gate…"), so it is a
decision, but the person is left without a path. Either drop the flag, or have qa warn when the flag
disagrees with config/plan, and make finish's message name the real repair: set `negativeExpect` in
.rig/config.json or put the marker on the plan line.

### 5. LOW: the deadline test depends on port 5199 being free
`test/qa-not-a-server.test.js:45` fixes `qaPort: 5199`, and the deadline test (`:132`) runs a real
`node server.js; true`. If anything holds 5199, which another run of this same file did while I ran
it, the server dies with EADDRINUSE. `; true` then turns that into exit 0 before the deadline, and the
test fails with `actual: 0`. The lead's single full-suite run on a busy machine can trip on this. Fix:
`qaPort: 0` (the server already does `Number(PORT)||0`), or a port found free at test time.

### Not findings, noted
- Server refusal by name (`serverShaped`) is a heuristic. The real guard is the deadline, and that is
  tested with a server that the heuristic does *not* catch (`node server.js`). Good.
- `finish` changed its warn from `devCommand` to `testCommand`; correct now that devCommand isn't the test.

Severity summary: 1 high, 1 medium, 1 low–medium, 2 low.
