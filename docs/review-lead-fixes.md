# Review of the lead's fixes after the final QA hung (by fv2)

Reviewed: e4ac688 (each run gets a browser of its own) and 8ac8712 (`rig qa --timeout`), both written
by the lead after the final QA of 5.0 hung for three hours. fv2 did not write either one, edited no
files, and ran its probes from an ignored scratch copy, now removed.

## e4ac688: launch() owns its endpoint

At e4ac688, `test/launch-port.test.js`: 2 PASS, about 7 s each. The taste suite: 31 passed, 225 s wall.

1. **Platforms.** Puppeteer finds its endpoint the same way, from "DevTools listening on ws://…" on
   stderr, on macOS and Windows, so no new timeout is expected there. Only Linux was tested.
   - Suggested: fall back to `<user-data-dir>/DevToolsActivePort` when stderr is silent (a
     `RIG_CHROME` wrapper that swallows it).
   - **Real gap:** a port taken on both 127.0.0.1 and ::1 (any runner without IPv6). Chrome prints
     "Cannot start http server for devtools." and no URL. launch() waited 10 s and blamed the
     install, and the second check went red on such a runner.
2. **stderr drain.** Sound: the stream flows with no listener, so it cannot fill. The pipe closed
   about 17 ms after close() began and Node exited at about 302 ms. Suggested hedge:
   `proc.stderr.destroy()` in close() and fail().
3. **The control.** It reproduces the incident: the second suite drives the first one's browser and
   dies when it closes. But the two guards cover for each other: with either one removed alone,
   both checks still pass. Neither had been shown to fail on its own.
4. **10 min per file** is 2.7× the slowest suite here. A slow CI runner is often 2–3× slower.
   Suggested 20 min. Noted: the taste suite's CLI child is orphaned when run.js stops the suite.

## 8ac8712: rig qa --timeout

1. **Bug.** A SIGTERM-ignoring command behind a pipe (`node stubborn.cjs | cat`, the shape of
   `npm test | tail`): bash died on SIGTERM, runShell answered 124 at 1.0 s, and the SIGKILL timer
   was unref'd, so it never fired once rig qa exited. The command was still alive 7 s later, in the
   worktree, with the lock released. The signal path in holdLock had the same shape.
2. **30 min** covers `npm ci` and browser installs too. Suggested 60.
3. **Bad values switch the limit off.** `--timeout 10m`, `abc`, `-5`, `""`, or `--fresh` taken as the
   value all gave a limit of 0, meaning no limit.

## What the lead changed (c238a03)

- `groups.stop()` waits until the whole process group is gone (SIGKILL at 5 s, not unref'd) before
  runShell answers 124. holdLock waits on it before freeing the lock.
- `--timeout` and `qaTimeoutMinutes` accept only a number of minutes ≥ 0; anything else exits 2.
  The default is 60.
- listeningOn refuses "Cannot start http server for devtools" at once, by name. DevToolsActivePort
  answers after 1 s of stderr silence. stderr is destroyed on close and on failure.
- `test/launch-port.test.js` has four checks, each with its own control. `test/run.js` allows
  20 min per file.

## Re-check of c238a03 and 0170f1b (by fv2)

Every finding above is fixed. At c238a03: launch-port (4 PASS), crew (16 PASS) and qa-finish exit 0.
The pipe probe now resolves 124 at 6.0 s with the process gone (it was 1.0 s with it alive at
8ac8712). Bad `--timeout` values exit 2. A port taken on both addresses is refused by name. Each
guard has its own control. At 0170f1b: launch-port has 5 PASS in 29 s.

New:

1. **PID 1.** `rig qa` running as PID 1 (a container without an init) inherits the group's orphans
   as zombies it never reaps, so kill(-pgid, 0) said "alive" for ever. Reproduced with
   `unshare -Urpf --mount-proc`: still waiting at 2+ min, against 6 s normally.
2. **A reused pgid** can't happen on Linux in practice. The ceiling from (1) bounds the worst case.
3. **setTimeout overflow.** At 35792 minutes and above, Node fires after 1 ms, so `--timeout 99999`
   stopped every run within about 50 ms.
4. **Check 5's scope.** It covers a browser with no page open. A page left open holds its WebSocket
   and keeps Node alive, as in Rig 4.
5. **Unref changes one behaviour.** A headed window that a script leaves open now vanishes when the
   script ends. Suggested: document it, or add `launch({ keepAlive: true })`.
6. **Profiles leak.** The reaper killed browsers but left their rig-chrome-* folders in tmp.

fv2 also confirmed the lead's diagnosis of the stall at c238a03: close() called destroy() on a null
stderr in the old-harness copy, the throw skipped the second close(), and that Chrome held Node open.

## What the lead changed (after the re-check)

- `groups.left()` reads /proc on Linux and counts zombies as gone; `groups.stop()` resolves at the
  latest 5 s after the SIGKILL, naming anything still listed. Checked as PID 1 in an unprivileged
  PID namespace (control: the kill-based test, which waits until the ceiling).
- `--timeout` / `qaTimeoutMinutes` above 35791 are refused.
- Check 5 is named for its scope. `launch({ keepAlive: true })` keeps the ref. The reaper hands the
  profiles to a detached process that removes them 1.5 s after exit, once Chrome's helpers have
  stopped writing (an rmSync in 'exit' was rewritten by them at once).

## Verification of 73f1bac (by fv2)

Pass, no release-blocking defects. launch-port 5 PASS (34 s), crew 17 PASS (27 s) including the
PID 1 check, qa-finish exit 0 (99999 refused, 35791 run). Its own pipe probe as PID 1 under
`unshare -Urpf --mount-proc` resolves 124 at 6.0 s. At c238a03 it was still waiting after 2 min.

- **The /proc parse.** It held against comm names built to fool it: `a) Z 1 1 (b`,
  `z) X 0 0 ) )` and `p q) Z`. Each was listed with its true state.
- **keepAlive.** Behaves as documented.
- **The profile cleaner.** Removed every profile after a normal exit and after SIGTERM.
- **spawn() in 'exit'.** Safe: the child exists before the handler returns.

Two nice-to-haves:

- (a) One profile the cleaner cannot remove stopped it before the rest.
- (b) A process that leaves the group (`setsid`, `detached`) is neither stopped nor waited for. Not
  new in 5.0.

The lead made the cleaner try each profile on its own, with retries. Before and after, with the
first profile made unremovable (a 0555 subfolder): the old cleaner exits 1 and leaves the second
profile; the new one exits 0 and removes it. (b) is a line in the README.

## 5.0.2: a refused launch always says why (fresh-eyes review)

GitHub's runner went red on 5.0.1's port checks, though the second suite was refused each time. A
printout added to the check showed the cause. fail() removed the profile while Chrome's helpers were
still writing into it. rmSync threw "ENOTEMPTY … rig-chrome-…", and that error replaced "Port N is
already in use". The fix: wrap the removal in try, retry it, and hand anything left to the detached
cleaner.

Reviewed by a fresh agent that wrote neither commit (d25c860, cef38be). **PASS, no defects.**
- **The exit handling is sound:** no double settle, the timer always fires, no delay on success.
- **Both stand-in controls go red for the right reason,** locally and on CI.
- **On the Mac:** `node test/launch-port.test.js` passes 7 of 7, and both stand-in controls go red
  for their own reason. macOS words the locked one as ENOTEMPTY, the runner's own error. This was
  run by the lead after the review, which had only reasoned about macOS.
- **d25c860 alone** was red on CI from ENOTEMPTY; the try/catch in cef38be is the real fix.

Suggestions taken:
- The exit ordering is hardening, not a cause: Chrome 155 keeps running when its port is taken. The
  CHANGELOG and a comment now say so.
- A profile left after the retries goes to the detached cleaner.
- The read-only check is skipped, by name, under root, where its control could never go red.
- The 300 ms exit timer is cleared in settle().

Not taken: the up-to-1.5 s retry on a failure path, which is acceptable.

Verification of the follow-ups (by the same reviewer): **PASS.** Both controls' regexes, applied to
the current cdp.js, give exactly the old shape and pass `node --check`. Each still goes red for its
own reason. One more note was taken: a profile came back after its removal (a helper wrote it
back), so fail() now always hands the profile to the cleaner, not only when the removal throws. The
root skip line now names the check.
