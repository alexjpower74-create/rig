# Review of r55q (by r55g)

Diff read: `git diff 14a1ad6...rig/r55q` at `f09c1f8`: `src/commands/qa.js` (record writing, the host,
CI and baseline stages), `src/qa/ci.js`, `src/qa/host.js`, `src/qa/failures.js` (`compareBaseline`),
`src/qalog.js`. Read against the contract r55g reads (PLAN.md, "r55q → r55g"). Read only; nothing in
r55q's files was changed. The watchdog's own internals (`src/qa/watch.js`) were not read line by line.

## Findings

1. **The stall watchdog does not run on the second machine.** `src/commands/qa.js` `hostStage()`
   (line ~353) calls `runHost()` with `limitMs` only; `src/qa/host.js` `runHost()` has no `stallMs`
   and r55m's `runOnHost()` takes none either. A suite that stops writing on the host runs until the
   hard limit (+20 s), not 5 minutes, and the host record carries no `stalled`. That is the bar's
   first line ("a stalled test run is caught and named in 5 minutes or less") on exactly the machine
   where the 1-in-3 flake lived. Check: feed the host's streamed output (`onOutput`) through the same
   quiet-timer as the local run, kill the ssh child on a stall, and record `stalled` on the host
   record. Test: the fake-ssh suite that prints once and then sleeps, with a short `qaStallMs`.

2. **A CI command that exits 0 but posts "failure" reads as green.** `localStage()` records the
   command's `exit` and the posted `ciStatus` side by side and prints `rig qa: ci exit 0 at <sha>`
   followed by `CI status failure (…)`; the process exits 0. "Any CI passed status it posts" (item 3b)
   is then a second, contradicting fact that only the reader reconciles. r55g's finish now fails on
   `ciStatus.state === 'failure'` whatever the exit, but `rig qa`'s own exit and summary line should
   say NOT green too. Check: a CI script `exit 0` that writes `failure` to `$RIG_CI_STATUS`.

3. **The host's CI status is never read.** `hostStage(ctx, ['ci'], …)` records `exit` only: no
   `RIG_CI_STATUS` is set on the host and no `ciStatus` is recorded there. With finding 2 fixed
   locally, the same CI that posts failure on the second machine would still read green. Check:
   carry the status file through `runOnHost` (or have the remote script print it in a marked line).

4. **Contract drift, adopted on r55g's side: the baseline is its own record.** The contract says
   test records gain a `baseline` field; r55q writes `kind: 'baseline'` on the head sha with
   `host: 'local'` (it covers both machines). Finish now reads either, and requires the comparison to
   be recorded after the test run it vouches for (a test re-run after the comparison is not covered by
   it). Nothing to change unless you prefer the field; please say which in your report so the README
   documents one shape.

5. **A crash after some named failures still reads as `complete`.** `compareBaseline()` marks a run
   unreadable only when it failed with *zero* parsed names. A run that names one failure and then
   crashes (or is killed by the hard limit) is `complete: true`, and if that one name is known on
   the base, "0 new" is claimed for a run that never finished. Finish refuses a `stalled` run as
   green, but a hard-limit kill (exit 124) is not marked stalled. Check: treat exit 124/137/143 and
   any `stalled` as incomplete in `compareBaseline`'s `unread` test.

## Where r55q meets r55g, and it holds

- Every record has `sha` (full), `kind`, `host` ('local' or the ssh host), `exit`, `cmd`; `passed`
  and `failed` are top-level numbers, which finish prints side by side for the host gate.
- `lastQaOn(root, sha, kind, { host })` keeps 'local' as the default, so the old negative-control
  read stays local. r55g reads with its own `runOn()` filter, the same rule.
- `complete: false` with `why` is exactly what finish needs to refuse to print "0 new"; finish shows
  it as a warning with the reason.

## Verified at 45449c7 (2026-10-22)

r55q's fixes are in `62c00f5` (and `c93631e`, on host stub calls and repeat timings), merged to main at
`515b118`. I checked each one against its original repro on `rig/r55g` at `45449c7`, the merge of main.
Each repro has a control that gives the other answer. The repros were scratch scripts, not committed.

1. **Fixed.** The host run uses a fake `runOnHost` that prints `▶ entry.test.js` once and then never
   returns, with `stallMs` 300. `runHost` returned exit 124 after 306 ms with
   `stalled: { worker: 'lab-box', spec: 'entry.test.js', quietMs: 302 }` and printed `STALLED`, naming
   the host and the spec. Control: a host that writes every 100 ms for 900 ms ends with exit 0,
   `stalled: null`. `hostStage` records `stalled` on the host record.
2. **Fixed.** Real `rig qa HEAD` in a scratch repo, `ciCommand: "sh ci.sh"`, where the script exits 0
   after writing `failure lint: 2 errors` to `$RIG_CI_STATUS`. Result: exit 1, `rig qa: NOT green: the
   CI exited 0 but posted failure`, and the record has `ciStatus.state: 'failure'`. Control: the same
   with `success` posted exits 0. Residual nit, not blocking: the summary line just above still reads
   `rig qa: ci exit 0 at <sha>`. The `NOT green` line follows it, and finish fails on the record either way.
3. **Fixed.** `ciOnHost(cmd)` sets `RIG_CI_STATUS` inside the checkout's `.git` and prints the posted
   status as a `rig-qa-ci-status:` line. A fake host log carrying `rig-qa-ci-status: failure lint: 2
   errors` came back as `ciStatus: { state: 'failure', text: 'lint: 2 errors' }`, and `hostStage`
   records it on the host's `ci` record.
4. **Settled.** r55q's build report names one shape: the baseline is its own `kind: 'baseline'` record
   on the head sha. Finish reads that, and it still reads a `baseline` field if one ever appears.
5. **Fixed.** `compareBaseline` on a run cut at exit 124 that named one failure known on the base gives
   `complete: false` with `why: "test here did not finish (exit 124)"`. A run cut at exit 143 is also
   incomplete. Control: the same names with exit 1 give `complete: true`. Finish keeps its own guard
   (124/137/143 and `stalled` are never green).
