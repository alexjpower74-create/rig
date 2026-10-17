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
