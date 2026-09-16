# Review — rg1 · QA hygiene and the finish gate (second pass)

Second review, after the author acted on the first eight findings in `9d3ebca` and the lead merged
`rig/rg1` into `main` (`f0f003c`, then `28828ac`). Reviewed the rg1-owned files as they stand on
`main` at `28828ac`, with `git show 9d3ebca` as the diff of record. Read only; nothing was edited.
Finding 1 was reproduced in a temp repo against this tree; finding 2 is by reading.

Of the first-pass findings, 1 (squash-merged slice never reviewed), 3 (two first runs, one slot),
4 (negative run's leftovers not gated), 5 (double jot), 6 (`--wrap` swallowed), 7 (slug rule) and
8 (usage text) are fixed, and each has the paired known-bad case the plan asks for. Finding 2 is
fixed for the shape its test uses and not for the shape a real test command has; see below.

## Findings

### 1. A forwarded signal reaches the bash wrapper, not the test process tree; the lock is freed under a still-running suite
`src/commands/qa.js:126-137` (`holdLock`) sends the signal to `child`, which is the
`bash -o pipefail -c "<cmd>"` wrapper from `runShell` (line 189). `child.kill(sig)` signals that
one pid. Bash does not forward SIGTERM/SIGHUP to a foreground child, so anything the command
itself spawned keeps running in the worktree while bash dies, the `exit` event fires, and the lock
is released.

The test at `test/qa-finish.test.js:185-198` passes for a different reason than it claims: its
command is `sleep 2; touch marker`, so `touch` is bash's *next* command, not a child of the running
one. Killing bash cancels `touch`. It says nothing about a child that outlives bash.

Reproduced on this tree with the shape a real run has (a long-running program followed by anything):
```
rig qa HEAD --run "sh -c 'sleep 4; touch marker'; echo tail"
kill -TERM <rig qa pid>        → exit 143, lock gone
ps                             → sh -c 'sleep 4; touch marker' reparented to pid 4198, still running
rig qa HEAD --run true         → "QA worktree qa pinned"   (took the slot at once)
4 s later                      → .worktrees/qa/marker exists: the orphan wrote into the freed tree
```
`npm test | tail -20`, `npx playwright test; …`, and `npm test && npm run demo` all have this shape.
(Bash exec-optimises a *single* trailing command, which is why `--run "npm test"` alone happens to
work: bash replaces itself with npm and the signal lands on npm.)

Check: give the child its own process group (`spawn(..., { detached: true })`) and signal the group
(`process.kill(-child.pid, sig)`), or stop by working directory with `processesIn(wt.path)` /
`stopProcesses` from `src/procs.js`, which is the rule the plan states and what `rig down` already
does. Then change the test's command to `sh -c 'sleep 2; touch marker'; true` so the marker check
can actually fail: as written it goes green with the orphan.

### 2. Two runs that both see the same stale lock can both take the slot
`src/worktrees.js:196-207`. Stale-lock removal is read-then-`rmSync`, and only the `wx` write after
it is atomic. Interleaving: A reads `qa.lock` (dead pid) → B reads it (dead pid) → A removes it and
writes its own with `wx` → B removes **A's** lock → B writes its own with `wx`. Both print
"removed a stale lock in qa" and "QA worktree qa pinned"; two suites run in one tree; the lock now
names B, so A's `release()` (line 209, it checks the pid) leaves B's lock in place and A's run is
never marked free. The window is a few milliseconds, but the trigger is exactly the crew case after a
crashed run: two peers type `rig qa` after the same failure, and the race test at
`test/qa-finish.test.js:200-213` does not start from a stale lock.

Check: never `rmSync` a lock you did not write. Take over a stale lock atomically instead: write
`<id>.lock.<pid>` then `renameSync` it over `<id>.lock` only after re-reading and confirming the
same dead pid is still there, or claim with `link()`/`open(O_EXCL)` on a takeover file named by the
stale pid so only one taker wins. Add a test that starts two runs with a dead-pid lock in place and
asserts they land on `qa` and `qa-2`.

## Notes for the lead (not rg1's files, or below the bar)

- **`rig down` refuses on a reused pid.** `readQaLock` (worktrees.js:165-171) calls a lock live when
  any process has that pid. After a reboot a lock left by a crashed run can name a pid now held by an
  unrelated program, and `down.js:23-27` then says "a QA run is still using qa: pid N … stop that
  `rig qa`". Nothing in the rig will clear it; the person has to delete `.worktrees/qa.lock` by hand,
  and the message does not say so. Low: write the lock as `pid starttime` or print the lock path in
  the refusal.
- **`%ct` across two machines.** The reviewed gate compares committer times (finish.js:262-265), as
  the plan asks. Reviews on this workflow are committed on the Mac and code on the PC, or the other
  way round; a clock two minutes behind makes a review "older than the last code commit" it was
  written after. Not a defect against the contract; worth knowing when the gate says "review again"
  for a review that is plainly newer. `git log -1 --format=%ct` on both commits shows it.
- The `docs/FINISH.md` at the root is untracked; finish.js:161 exempts it from "no uncommitted work"
  by design, but `check-no-personal-data` and the lead's commit of the final transcript will see it.

## What I could not fault
The reviewed gate after a squash merge and after a later code commit on the branch, the lock beside
the worktree taken with `wx` before any git, the union of test and negative leftovers named by run,
one jot per sha with `.rig/finish.json`, `--wrap` misuse exiting 2, the slug rule matching rg2's
`slugFor`, `qaSlots` ordering and `down`'s use of it, and the usage text. Every one of these has a
test that goes red without its fix, and I read each pair.
