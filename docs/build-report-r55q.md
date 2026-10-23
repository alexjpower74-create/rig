# Build report: r55q, QA that cannot hang, lie, or touch the desktop

Branch `rig/r55q`, on top of 14a1ad6. Items 3b, 4, 7, 8 and 16, and the `rig qa` side of 3, 9 and
15. Every commit's author and committer is the repo owner. Nothing was pushed.

## What was built

| Item | State | Where |
| --- | --- | --- |
| 7. Stall watchdog | DONE | `src/qa/watch.js` (`runWatched`), host side in `src/qa/host.js` |
| 8. Desktop-free runs, needs-a-stub | DONE | `src/qa/desktop.js` |
| 4. Baseline: "0 new" computed from two runs | DONE | `src/qa/failures.js` (`parseFailures`, `compareBaseline`), `baselineStage` in qa.js |
| 3b. Local CI, with its posted status | DONE | `src/qa/ci.js` (`detectCi`, `readCiStatus`), `ciOnHost` |
| 3. Second machine (rig qa side) | DONE | `src/qa/host.js` (`leaseHost`, `runHost`), `hostStage`, `sideBySide` |
| 16. Repeat across seeds | DONE | `repeatRuns`, `planSeeds`, `withSeed` |
| 9. Timings (rig qa side) | DONE | `recordTiming` for `qa:test`, `qa:negative`, `qa:ci`, `qa:host`, `qa:baseline`; repeats under their own names, `qa:repeat` and `qa:host:repeat`, so `rig status --eta` leaves them out of the round total |
| 15. Stale baselines warning (rig qa side) | DONE, waiting on r55u | `warnStaleBaselines` calls `staleBaselines(<QA worktree>)` |

### How a run goes now

1. The host lease is taken first (with `--host` or `qaHost`). A lease someone else holds refuses
   the run by name, with exit 75, before any worktree is touched.
2. The QA worktree is pinned, as before. The header now also says desktop-free or not, the stall
   window, the host, and any stale snapshot baselines.
3. The test command runs here and on the host at the same time. Output still reaches the terminal
   live (host lines are prefixed `[host] `). It is also kept with timestamps, written to
   `.rig/qa-logs/`, and read for failure names, tallies and needs-a-stub.
4. The repo's local CI runs when `--run` was not given (or with `--ci`), here and on the host, as
   kind `ci`. Its posted status is recorded, and a posted `failure` makes the run NOT green even
   when the CI exited 0.
5. `--baseline` runs the same command on the merge base (or on an exact `<base>`) in a second
   pinned QA worktree. Only new failures are reported; known ones are listed with where they fail
   now (here, there, both). A head with no failures skips the base run, because nothing can be new.
6. The negative control runs, as before.
7. The exit is the first non-zero of test, CI, host and negative. On a stall it is 124.

### Records (the contract r55g reads)

Every `.rig/qa-history.jsonl` entry keeps today's fields (`kind`, `ref`, `sha`, `short`, `cmd`,
`exit`, `dirtied`, `untracked`, `worktree`) and adds:

- `host`: `'local'` or the ssh host.
- `ms`, `failures` (names, capped at 200), `passed` (null when no runner printed a count), `failed`.
- `needsStub`: spec names.
- `stalled`: `{ worker, spec, quietMs }` or null.
- `log`: a path under `.rig/qa-logs/`.
- `desktop`: true when run with `--desktop`.
- For kind `ci`: `ciFrom` and `ciStatus` (`{ state: 'success'|'failure', text }` or null).

Host records also carry `dir`, `db` and `error`.

The baseline is its own record, `kind: 'baseline'`, on the head sha with `host: 'local'` (r55g
review 4). It holds `baseline: { base, baseSha, baseExit, baseFailed, baseLog, newFailures,
known: [{ name, where }], fixed, needsStub, complete, why, note }`. It stays a separate record, not
a field on the test record, because it is computed after both machines' head runs and covers
both; r55g's finish reads it that way. The README should document this one shape.

A repeat is recorded as `kind: 'repeat'` with `repeat: { n, seeds, failedSeeds, how }`, one record
per machine, and never as `kind: 'test'`. A single file green N times is a flake proof, not a
suite pass, and it must not stand in for one at the finish gate.

`lastQaOn(root, sha, kind, { host = 'local' })` now counts local runs only. Before this, a newer
host record or repeat record on the same sha could have answered "the tests passed here".
`lastBaselineOn(root, sha)` is new.

## The checks, and the red each was seen

Tests: `test/qa-watch.test.js` (harness, 7 checks), `test/qa-baseline.test.js` (harness, 12 checks,
plus 1 that switches on with r55m's timings), `test/qa-host-real.test.js` (harness, 6 checks; it
needs r55m's fake ssh and skips by name until that is merged), `test/qa-parse.test.js` (node:test,
16 tests). In a harness check, PASS means the negative control was run and made the assertion
fail; a control that did not would read VOID.

| Check (plan / task) | How it was made red | Number beside the bar |
| --- | --- | --- |
| A suite that stops writing is stopped and named within the window | `--stall 0`: the hung suite is not stopped or named (the control ends at `--timeout 0.2`) | stopped after 3288 ms quiet on a 3000 ms window (bar: window + one 300 ms poll = 3300 ms, asserted < 5000); default window 5 min, its own check (red with `qaStallMinutes: 7`) |
| One that keeps writing is not stopped | a window (0.6 s) shorter than the suite's pace (0.8 s): stopped | 8 s run on a 3 s window, never stopped |
| Progress written only to a worker log counts | `qaWorkerLogs` removed: stopped | — |
| A hung worker is named by its log and last spec | `qaWorkerLogs` removed: blames the output and the first spec | — |
| "0 new" from two real runs in a fixture | grade the branch that adds a failure instead: not 0 new | — |
| A new failure is shown as new | `--baseline <the head itself>`: nothing is new | — |
| A red run with no nameable failure never claims "0 new" | a green run (exit 0) is complete | — |
| A clipboard spec is "needs a stub" and the real tool is never reached | `--desktop`: the fake real `xclip` further down PATH is reached (marker file appears) and nothing needs a stub | — |
| The clipboard spec fails fast, not a hang | `--desktop` with an `xclip` that blocks: the run hangs to its limit | under 12 s |
| `scripts.ci` runs as kind `ci` with its posted status | `ciCommand: null`: no CI run | — |
| A CI that exits 0 but posts failure is not green (r55g 2) | posts `success`: green | — |
| `--run` alone skips CI; `--ci` runs it | no `--ci`: no CI record | — |
| `--repeat` names the failing seeds; listed seeds run | seeds `8,10`: green | — |
| N green, and a repeat is not a suite pass | an odd seed in the list | — |
| `--host`: same sha there, lease taken and given back, tallies side by side | lease held by another session: refused | — |
| A lease held by someone else is refused by name, nothing runs | no holder: runs | — |
| `--repeat` with a host names a seed that fails only there | no failing seed there | — |
| Known failures say here / there / both | the host does not fail the known one: `here`, not `both` | — |
| End to end through r55m's real code (6 checks) | the host's env trips a spec; the lease held by the same session renews; a host suite that keeps writing is not stalled; CI posts success; no clipboard call | host stall caught in about 9.7 s on a 3 s window, including ssh and checkout |
| Timings `qa:test` and `qa:negative` recorded | no negative control run: no `qa:negative` (checked on the r55m merge) | — |
| Unit: harness summary line is not a failure | real bug: `VOID checks passed against a broken page` was parsed as a failing test (fixed, f09c1f8) | — |
| Unit: lease holder from a branch name | `holderId` swapped for identity: `rig/r55q` is refused by r55m's `acquire` | — |
| Unit: host lease kept while a run may be going | guard removed: released under a running suite | — |
| Unit: r55g review 1, 3, 5 | run against the previous commit: the host stall test hung to the 5 s test timeout; the CI marked line and the cut-run rule failed | — |

Existing tests: none changed. One wording was kept on purpose: `test/qa-finish.test.js` (r55g's)
matches the USAGE line "first non-zero of the test run, then the negative", so the new stages are
described on the line under it.

Grading:
- `npm run check` exits 0 on 62c00f5: Biome, the 20-file suite, and `check-no-personal-data`.
- `rig qa f09c1f8 --run "npm test" --baseline`: test exit 0 in 8 min, `0 new failures` (the head
  is green, so the base run was skipped), negative exit 0.
- `rig qa 62c00f5 --run "npm test" --baseline`: test exit 1, baseline `1 NEW`. The failure was
  `taste.test.js` › "--lan: the board answers on the network address with its token; without
  --lan it does not", timed out at its 10 s budget (12.3 s) on a loaded machine (the run took
  9.8 min against 8 min before). It is not in r55q's files, and it passed in `npm run check` on
  the same tree and in the base run. Evidence, with the new flake proof:
  `rig qa 62c00f5 --repeat 3 --run "node test/taste.test.js"` gave 3 of 3 green, with the `--lan`
  check at 9388, 9721 and 8408 ms against its 10 s budget. So it is a load flake in r55w's taste
  suite with under 1 s of headroom, not a regression. Its owner may want a larger timeout there.
- The final pinned run is on the branch tip (the commit that last touched this report), and the
  lead has its sha and exit lines through `tell-lead`: grading is the last step, so no commit
  follows it.

## Found in passing, and fixed

- **The harness's VOID summary read as a failure.** It would have shown as a new failure on any
  branch with a VOID check. Fixed in f09c1f8.
- **A host lease released under a running suite.** Seen on a local merge with r55m: SIGTERM to
  `rig qa` mid-run left the host suite running (`runOnHost` takes no signal), and rig qa's exit
  handler gave the lease back under it. The lease is now left to expire while a host run may still
  be going (8936ffd).
- **`acquire` refuses a branch-name holder.** r55m's `acquire` throws on `rig/r55q`, which is
  rig qa's default holder. The id is now made safe (`holderId`, 4566680).
- **"failed 0" beside "exit 1" (lead, the host run on 949e12b).** The run went red on a harness
  VOID, which is not a failure, so the tally printed 0. A red exit with no FAIL line is now
  `failed ?`, with `void` and `unproven` rows when either machine has any, and the line "not
  counted: exit 1 but no FAIL line; 1 void: <name>". It is recorded as `tallyConflict`. Red first:
  the CLI check in `qa-baseline` and the unit test in `qa-parse`.
- **Two runs on one branch shared the host lease (Zyro's review of 949e12b, P1).** With no `--by`
  and no RIG_SESSION, every run held the lease as the branch name. A second run at once was
  therefore a renewal, and it ran in the first run's host checkout. Each invocation now holds the
  lease as `<label>.<8 hex>` (`leaseToken`), and renews and gives it back under that token, so
  a second run is refused with exit 75. The session dir and test DB stay per label: the lease
  keeps every other run out of them, and the runner keeps that checkout and its `node_modules`
  warm between runs. A dir per token would reinstall on every run and leave a dir behind each
  time. Red first: `qa-host-real`, two concurrent runs (its control runs them one after the
  other). `lease.js` did not need a change.
- **r55g's delta review of 6a6cedd, three fixes:**
  - *The base ran only here.* With a host, `--baseline` now runs the base on the host too, at the
    same time as here, with the same command. `compareBaseline` compares each machine with its own
    base and never across: a failure counts as known only on the machine whose base also failed it.
    A host head with no host base is incomplete. The record keeps `baseThere`. In the reviewer's
    repro (a failure only on the host, at the head and at the base), "1 new" is now "0 new, 1
    known, fake", and finish waives the host run on it.
  - *A renewal refused mid-run is no longer only printed.* rig qa says "lost the lease on <h>:
    <h> is leased by <holder>", stops the host run through its signal, and records the stage as
    exit 75 with that error. A later host stage does not start.
  - *A refusal by a run's token names the command that frees it*:
    `rig lease host:<h> --by <token> --release`.

## Decided

- **Watchdog rule.** A stall is no growth anywhere (the output and every worker log) for the
  window. That keeps "a run that keeps writing is never stopped" absolute.
- **Who gets named.** Among worker logs that grew during the run, prefer one a process in the
  command's group still has open (Linux `/proc/*/fd`), and of those the one quiet longest: the
  worker that hung stopped first. With no worker logs, the output is named. The spec is the last
  spec, file, Playwright title or TAP subtest that stream mentioned.
- **A stall exits 124**, like the hard limit. The record's `stalled` field tells them apart.
- **Flags.** `--stall <min>` sets the window (0 = off). `qaStallMinutes` and `qaWorkerLogs` (a
  glob relative to the worktree) are the config keys.
- **Command I/O.** stdin is closed (nobody answers a prompt in QA). Output is piped and teed, so a
  runner that colours only on a TTY prints plain text. That is the cost of reading the output.
- **Desktop shims** live in a temp dir per run. Each logs `epoch-ms\ttool\targs` to the file in
  `RIG_QA_SHIMS`, prints why on stderr, and exits 1.
- **Needs a stub.** A failing spec counts when its own block names a tool that was called, or when
  a call landed between the previous result line and this failure. Under parallel runners the
  second rule can blame a neighbour. The spec is still listed as a failure and the run still exits
  non-zero; it is only not counted as new.
- **Failure names.** node:test (TAP and spec), harness (FAIL/VOID/UNPRV), rspec (the description,
  else the path), Playwright (project › file › title, line numbers and retries cut), Jest (file),
  plus `qaFailurePattern` (its `name` group or first group).
- **When "0 new" is incomplete.** Any red run with no parsable name, and any run cut by a limit, a
  signal (exit ≥ 128) or the watchdog. "0 new" is then never printed.
- **The base.** `--baseline` alone means the merge base of the sha with `cfg.base`, else the main
  checkout's branch. `--baseline <ref>` means exactly that ref. In `rig qa --baseline <sha>` the
  sha is the graded ref, because a value is taken only after the ref is known. The base run gets
  port qaPort + 50 + slot, and it is skipped when every head run is green with no failures.
- **The exit stays honest.** rig qa's exit is the head runs' exit, not "0 new". Finish reads the
  baseline record for the comparison.
- **CI detection order.** `ciCommand` in the config (null or "" means none), then `scripts.ci` in
  package.json (`npm run ci`), an executable `bin/ci`, `script/ci` or `script/cibuild`, then a
  `ci:` Makefile target (`make ci`). Detection reads the pinned commit.
- **When CI runs.** By default when `--run` is not given, with `--ci` beside `--run`, never with
  `--no-ci`. When the CI command is the test command it runs once and is recorded as both kinds.
- **"CI passed" status.** The CI writes one line to the file in `RIG_CI_STATUS`:
  `success`/`failure` (or pass, fail, error…), optionally followed by text, or JSON with `state`.
  An unreadable status counts as failure. On the host the file sits in the checkout's `.git` and
  comes back as one `rig-qa-ci-status:` line. No network and no hosted API: a status posted only
  to a hosted service is not read.
- **Seeds.** `RIG_SEED` always. The runner's own flag for `node --test` (`--test-random-seed`,
  which also randomizes the order), Jest (`--seed=`), Vitest (`--sequence.shuffle
  --sequence.seed=`) and rspec (`--seed`), chosen by the leading word only. Never added to
  pipelines or `npm test`. Listed seeds always run, even beyond N. The worktree is cleaned between
  seeds, and what was reset is printed.
- **Lease holder.** `--by`, else `RIG_SESSION`, else the current branch, made safe for the lease
  (`rig/r55q` becomes `rig-r55q`). The ttl is 2 × the limit + 30 min (120 with no limit), renewed
  every 30 min. A lease someone else holds exits 75 before anything runs; `--no-host` runs here
  only.
- **Host runs start at the same time as the local run.** Two machines, one wait. They also get the
  stall watchdog, on the streamed output.
- **Stale baselines** are checked in the pinned QA worktree (the baselines as they are at that
  sha), and printed as a WARNING in the header.

## For the lead

### USAGE (`rig qa --help` prints this, from `src/commands/qa.js`)

The full text is `USAGE` in `src/commands/qa.js`. For `bin/rig.js`, please replace the qa summary
line with:

```
qa: 'grade from a clean QA worktree pinned to an exact commit: rig qa <sha> (--run, --negative, --baseline [<base>], --host <h>, --ci, --repeat N --seeds, --stall <min>, --desktop, --fresh; exits with the first non-zero)',
```

and the short help block with:

```
rig qa [<ref>] [--run "<cmd>"] [--negative "<cmd>"] [--baseline [<base>]] [--host <ssh-host>] [--ci|--no-ci]
       [--stall <min>] [--timeout <min>] [--desktop] [--fresh]
rig qa <ref> --repeat <N> [--seeds <s1,s2>] --run "<one file>" [--host <ssh-host>]
  Every run is watched (no output for 5 min: stopped and named), desktop-free (no display, clipboard
  tools fail fast), and recorded per machine. --baseline reports only new failures against the base.
```

### README paragraph

> **rig qa cannot hang, lie, or touch the desktop.** Every run is watched for output. If nothing
> is written anywhere for 5 minutes (`--stall`, `qaStallMinutes`; per-worker logs with
> `qaWorkerLogs`), rig qa names the worker and the last spec it mentioned, stops the whole process
> group, and exits 124. A run that keeps writing is never stopped. Runs have no display, and
> `xclip`, `xsel`, `wl-copy`, `wl-paste`, `pbcopy` and `pbpaste` fail at once. A spec that fails
> because it reached for one is listed as "needs a stub", not as a regression (`--desktop` opts
> back in). `--baseline` runs the same command on the merge base in a second pinned worktree and
> reports only new failures; known ones are listed with where they still fail. "0 new" is
> computed from both runs, and it is never claimed when a run crashed, timed out or stalled. When
> the repo has its own local CI (`ciCommand`, `scripts.ci`, `bin/ci`, `script/cibuild`, or
> `make ci`), rig qa runs exactly that command and records the status it posts to
> `$RIG_CI_STATUS`. `--host <ssh-host>` runs the same sha on a second machine under that host's
> lease, and prints both tallies side by side. `--repeat N --seeds 7,9` reruns one file across
> seeds on both machines and names every failing seed.

## What's left, and what I need from others

- **r55m's answers to my review (edf29fd) are verified at 8d1783a**; see docs/review-r55m.md,
  "Verified".
  - `runOnHost` now honours the AbortSignal rig qa passes on a stall. A stalled host suite is
    gone at once, and the lease is given back after the abort.
  - `acquire` refuses instead of throwing.
  - Host stub calls come back as `stubCalls`, which rig qa now uses for needs-a-stub (c93631e).
  - Left, low: when `rig qa` itself is killed mid host run, it keeps the lease to expire, because
    it cannot wait for the abort; ssh's lifeline still stops the host suite. The time rule for
    needs-a-stub does not apply on the host (no line times, and the host's clock).
- **The `--lan` taste check has under 1 s of headroom on its 10 s budget** under load (above).
  It is r55w's file; I only measured it.
- **r55u: `staleBaselines` is wired but returns nothing until r55u's body lands.** I cannot test
  the warning end to end on this branch: no fixture records `RECORDED_FROM` yet. After the merge,
  a check of the form "a baseline recorded from an old sha prints WARNING" belongs in a test.
- **`test/qa-host-real.test.js` and the timings check switch on when r55m is merged.** Both were
  run green, controls red, on a local merge of `rig/r55m`.
- **Not stall-watched:** the negative-control command shares `runWatched`, so it is watched. The
  base run is watched too. Repeats are watched per seed. Nothing is left unwatched.
- **Not built:** `needsStub` for paths that call clipboard tools by absolute path
  (`/usr/bin/xclip`). PATH shims cannot catch those; unsetting DISPLAY still makes them fail.
