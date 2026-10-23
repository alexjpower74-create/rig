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

## Delta at 6912595 (2026-10-22)

r55q's code commits after `45449c7`: `fea7f44` (host log kept in `.rig/qa-logs/`, a tally that
contradicts the exit recorded as `failed: null` with `tallyConflict`) and `6912595` (VOID and UNPRV
are their own marks, never failures). Read on `rig/r55g` at `630430f`, the merge of main, which holds
both. Read only; the other commits in the range are other slices' or docs.

Holds: the host's full output is written even for a run abandoned on a stall (`all`, not the 16 KB
tail); finish prints only numeric tallies, so a `failed: null` drops out instead of reading as 0; the
harness parser now takes `FAIL` lines only, which ends the "1 failing" line r55g's UNPRV check caused.

1. **A green base's UNPRV check is a "new failure" when the head is red for another reason.**
   `diffNames` adds a run's VOID and UNPRV names only when its exit is non-zero, so the same unproven
   check is in the head's diff (red) and missing from the base's (green). Repro on
   `src/qa/failures.js`: base `UNPRV the identity check` + `PASS x` at exit 0, head the same UNPRV +
   `FAIL x` at exit 1; `compareBaseline` gives `newFailures: ["x", "the identity check"]`. Control:
   with the base also red, the UNPRV name reads as known and only `x` is new. Finish's verdict does
   not change (`x` fails it anyway), but the list names a check as new that the base carries too.
   Check: diff the marks by name against the base's marks whatever the base's exit (or add the base's
   marks to its side of the diff). Low.
2. **Nit:** `runHost` keeps every streamed byte in `all` for the life of the run. A chatty suite on
   the host holds its whole output in memory twice (`seen`'s tail is bounded, `all` is not); writing
   to the log fd as it streams would bound it. Not blocking.

## Delta at 6a6cedd (2026-10-23)

r55q's commits since `6912595`: `70fdf59` (a red run with no FAIL line tallies as `?`; each run holds
the host lease under its own token, Zyro's #1 on 949e12b) and `6a6cedd` (`baseline.compared`). Read
on `rig/r55q` (main is at 949e12b and has neither); repros in a scratch merge of `rig/r55q` and
`rig/r55g` (2615858), with leases under a scratch `XDG_STATE_HOME`. Read only.

The lease token holds. Two tokens for one label differ (`rig-r55g.12f74fc8`, `rig-r55g.f590fb1a`).
While the first holds the lease, the second is refused, and so is the bare label (`rig-r55g`), which
used to renew it. A stranger's release and the bare label's release are both refused, naming the
holder. The holder's own renewal is `renewed: true`. After it expires, another token takes it over
(`tookOver` names the first), and from then on the first's renewal and its release are refused.
`compared` matches the records exactly: Zyro's baseline repro is still refused by r55g's finish on
the merge ("did not compare this run (fake, …)").

1. **A host failure that the base also has on the host reads as new.** `baselineStage` runs the base
   only here. A failure that shows only on the second machine, at the head and at the base alike, is
   then in the host head's list and missing from the base's, so it is new. Repro: a command that
   prints `FAIL  remote regression` and exits 1 only on the host, at both shas. `rig qa <head>
   --baseline <base>` with `qaHost: fake` exits 1, and the baseline says `1 new: remote regression`.
   The opposite case, a host failure counted as known because the *local* base failed the same test,
   is a loose waiver. A second OS is where the platform-only failures live, so "0 new" on the host
   needs the base run on the host too, or the record should say the host side was not compared.
   Medium. Finish fails either way, so this blocks nothing unsafe; it only costs a waiver the host
   should get.
2. **A renewal refused mid-run is only printed.** If a run's lease lapses (the process was suspended
   past its TTL) and another run takes it, the first run's 30-minute `renew()` is refused (see above).
   `qa.js` prints `could not renew the lease` and keeps running on the host beside the new holder,
   which is the concurrent use the token was added to stop. Check: on a refused renewal, mark the run
   so it is not recorded green, or stop it, the same way a stall stops a run. Low: it needs a suspend
   longer than the TTL.
3. **Nit: an interrupted run locks its own session out.** On Ctrl-C during a host stage the release is
   skipped on purpose (`inFlight`). The token is random, so the same session's next run is now refused
   for up to the TTL (120 min with no limit), where before it renewed. That is the safe choice, but the
   refusal's advice ("Wait for it, or run here only with --no-host") could also say this is the
   session's own earlier run, and that `rig lease host:<h> --by <token> --release` frees it once that
   run is known to be gone.

## Verified at 56a92c1 (2026-10-23)

r55q's fix for the three findings above is `56a92c1`, on `rig/r55q` (main has not taken it yet).
I reran my repros on a scratch merge of `56a92c1` with `rig/r55g` at `239ee75`, using the fake-ssh
kit and the real lease script on the fake host. Each repro has a control that gives the other answer.
The scripts were scratch, not committed.

1. **Fixed.** With `qaHost: fake`, `rig qa <head> --baseline <base>` now runs the base on the host
   too, and each machine is compared with its own base.
   - A failure that shows only on the host, at both shas, is known there:
     `0 new, 1 known …: remote regression (there)`. r55g's finish, matching through `compared`, waives
     the host run: `QA green on fake: ok … every failure is known on the base`. That is the first time
     the host waiver has worked end to end.
   - The cross case is the control: the host fails `X` at the head, and only the local base fails `X`.
     The result is `1 new: X`, and the host gate fails. The local base no longer waives anything on the
     host.
2. **Fixed.** The renewal interval is set to 500 ms, and the host command sleeps 6 s. 1.5 s in, the
   lease file on the fake host is rewritten to another holder.
   - `rig qa` exits 75 after 1.6 s. The host record has `exit: 75`, and its error names the new holder.
     No `sleep` was left running.
   - Control: the same run without the steal exits 0 after 6.2 s.
3. **Fixed.** The refusal names the token, and the command that frees it:
   `rig lease host:fake --by <token> --release`.
   - Residual nit, not blocking: the same advice is added to the lost-lease message, where the holder
     is a live run somebody else is still using ("if that is an earlier rig qa run of yours that is
     gone" keeps it honest).
   - Also there: the host prints `the run on fake did not start` for a run that started and was
     stopped.

## Delta at 363c011 (2026-10-23)

r55q's `363c011`: before giving the host lease back, `rig qa` now waits up to 15 s for the host runs it
stopped to come back (`hostRunsSettled`), and `qa-host-real` gives each check a fake host of its own.
Read on `rig/r55q`. The repro used a detached checkout of `363c011` with the fake-ssh kit, and a
wrapper ssh, like r55q's own, that takes 4 s to die on TERM. Read only.

Holds:
- **A host run that never comes back.** The wait is bounded at 15 s. After that `inFlight` is still
  above 0, the release is skipped, and the lease expires at its TTL. That is the safe side, as before.
- **A lease taken over meanwhile.** The release goes out under this run's own token. With another
  holder it is refused (`NOTYOURS`, shown in my lease repro at 6a6cedd), so nothing of theirs is freed.
  A lost lease has already cleared the renewal timer.
- **Ctrl-C during the wait.** Read, not run. The SIGINT handler exits 130, and the exit hook's release
  sees `inFlight > 0`. The lease is left to expire: the documented nit at 6a6cedd, now with the release
  command in the refusal.
- **`--repeat`** also waits before it exits.

1. **5.5.1 note (low, not introduced here): a later host stage starts while the stalled one is still
   dying, in the same session checkout.** The wait runs only at the end of `rig qa`. After a host stall
   resolves the test stage (exit 124), the CI stage, or the base run on the host, starts a new
   `runOnHost` at once. It runs in the same per-label checkout and test DB, while the stalled run's ssh
   is still alive.
   - Repro: `qaHost: fake`, a host test command that prints once and sleeps, `--stall 0.05`, a
     `ciCommand` that stamps its start on the host, and the 4 s slow ssh. Exit 124. The stalled ssh died
     at +7.4 s; the host CI started at +3.5 s, an overlap of about 4 s.
   - The run is already red (124), so the gate is not fooled. But the host CI record on that sha may
     have run beside a dying suite.
   - Check: `await hostRunsSettled()` before each later host stage too. If it times out, skip the
     remaining host stages and say why.

## Delta at 62aa1a3 (2026-10-23)

Read-only review of r55q's 62aa1a3 (test-only): the qa fixtures run `node --test test/*.test.js`
instead of `node --test test/`, because before Node 26 `node --test` takes a directory argument as one
test file, so every fixture run gained a failure named after the directory.

**How it was checked.** Only Node 26 is on this machine, so a `node` shim first on PATH stands in for
Node 22: under `--test`, any directory argument is replaced by one test file that throws (one failing
test named after it), and everything else goes to the real node. With the shim, `node --test test/`
fails one test and `node --test test/*.test.js` passes, as on Node 22. Each of the three suites was run
under the shim at 62aa1a3^ and at 62aa1a3, each in a scratch worktree of its own:

| suite | 62aa1a3^ (Node 22-like) | 62aa1a3 (Node 22-like) |
|---|---|---|
| qa-baseline | exit 1: 5 FAIL (0 new, host base, known where, host tallies) | exit 0: 21 passed, 0 void, 0 unproven |
| qa-host-real | exit 1: 3 FAIL (side by side, host-only failure, needs a stub) | exit 0: 8 passed, 0 void, 0 unproven |
| qa-watch | exit 1: 1 FAIL (needs a stub) and 1 VOID (fails fast) | exit 0: 7 passed, 0 void, 0 unproven |

**Holds.** The left column is the red the CI on Ubuntu showed, reproduced here. The right column
is green, and every one of its 36 controls still went red under the shim; the harness would print
VOID for any control that passed. So the glob did not weaken a check: each one still tells its broken
case apart on Node 22-like behaviour. The VOID at 62aa1a3^ is worth noting. The "fails fast" check
passed under its own control because the directory run failed at once whether or not the clipboard
shim hung, and the glob makes that check meaningful again on older Node. No directory-form
`node --test test/` is left in `src/`, `docs/` or `test/`. The other fixture runs name single files
(`test/a.test.js`, `test/flaky.test.js`), and a bare `node --test` globs its defaults on every Node.

**Nit (not a finding).** The glob is expanded by whichever shell runs the command. On the host that
is the remote login shell, and zsh stops with "no matches found" where bash would pass the pattern
through to node. Every fixture that uses the glob has `test/*.test.js` files, so nothing hits this
today. A fixture repo without tests would fail with a shell error, not a test failure.

No findings. Nothing for 5.5.1 beyond the nit.
