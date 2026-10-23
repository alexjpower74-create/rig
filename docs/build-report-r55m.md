# Build report: r55m, two machines, leases, measured time

Branch `rig/r55m`. Items 3 (the runner), 9 (the record and the estimate) and 10 (leases) of
`docs/PLAN-5.5.md`. Each one is built, its checks are tests in `test/machines-*.test.js`, and every
check has been seen red.

## What was built

| Item | Status | Where |
|---|---|---|
| 3: `runOnHost`, the second-machine runner | DONE | `src/remote.js` |
| 9: `recordTiming`, `readTimings`, `estimate` | DONE | `src/timings.js` |
| 10: `acquire`, `release`, `holderOf` (+ `leasesOn`), `rig lease` | DONE | `src/lease.js`, `src/commands/lease.js` |
| Fake ssh host, test kit | DONE | `test/fixtures/fake-ssh/ssh`, `test/fixtures/fake-ssh/kit.js` |
| Review of r55u | DONE | `docs/review-r55u.md` |

### The runner (`runOnHost`)
- **Nothing pushed.** The commit is named by a temporary ref (`refs/rig/qa/<session>`, deleted
  straight after) and sent as a `git bundle` on ssh's stdin. The first ssh call asks the host what it
  already has. The bundle then carries only the missing commits (`^<theirs>` prerequisites), and
  nothing at all when the host already has the commit (`sent: false`).
- **One checkout per session** at `<qaHostDir>/<session>`, default `~/.rig-qa/<repo>/<session>`.
  `git checkout --force --detach <sha>` then `git clean -ffdx -e node_modules`, and the run refuses
  (exit 3, with the reason) unless `HEAD` is exactly that sha.
- **Deps** install only when the lockfile's blob id changed: `npm ci`, `pnpm install
  --frozen-lockfile` or `yarn install --frozen-lockfile`, and `npm install` when there is no lockfile.
  The marker is `.git/rig-deps`, so installs are cached per session checkout.
- **Env.** `RIG_TEST_DB=<repo>_<session>` (letters, digits, `_`), `RIG_QA_SHA`, plus the caller's
  `env`. Desktop-free unless `desktop: true`: `DISPLAY`, `WAYLAND_DISPLAY`, `XAUTHORITY`,
  `DBUS_SESSION_BUS_ADDRESS` and `WAYLAND_SOCKET` are unset, and `xclip`, `xsel`, `wl-copy`/`wl-paste`,
  `pbcopy`/`pbpaste`, `xdotool`, `ydotool` and `osascript` are shadowed by stubs that fail at once
  with a message that names `--desktop`. Both lists are exported (`DESKTOP_VARS`, `DESKTOP_TOOLS`), so
  r55q's local run can use the same ones.
- **Deadlines.** Every ssh call runs with `BatchMode=yes`, `ConnectTimeout` (default 10 s), and
  `ServerAliveInterval=15`/`ServerAliveCountMax=4`. `limitMs` runs a watchdog on the host: the
  command's process group gets SIGTERM at the limit and SIGKILL 5 s later, and the result is 124.
  If the host goes silent, a local backstop at limit + 20 s kills ssh. Whatever the command leaves
  running (a server still listening) is stopped when it exits, because it would otherwise hold ssh's
  pipes open: that is the 2026-10-16 three-hour hang, reproduced over ssh.
- **Exit.** The host prints `rig-qa: exit N` as its last line. Without that line, a 255 is ssh's
  own failure, and `why` gives ssh's reason. The result also carries `why`, `sent` and the resolved
  `dir`.
- The command runs under `bash -o pipefail` when the host has bash (as `rig qa` does locally).
  `/opt/homebrew/bin` and `/usr/local/bin` are added at the END of PATH when they exist and are
  missing, because a non-interactive ssh session on macOS does not have them and `npm` would not be
  found. (Until the fix below they went first, which shadowed the host's own PATH.)

### Leases
- One POSIX sh script does every lease. It runs locally for `db:<name>` and over ssh for
  `host:<h>` and `db:<name>@<h>`, so the local and remote leases cannot drift apart.
- Where they live: `${XDG_STATE_HOME:-~/.local/state}/rig/leases/<name>.json` on the machine that
  holds the resource. Never in a repo's `.rig/`.
- Each call is one critical section under an atomic `mkdir` guard (`<name>.lock`): read the holder,
  decide, write the new holder via temp file and `mv`. A guard older than a minute is treated as the
  leftover of a crashed call and removed.
- **Expiry is judged by the holder machine's clock**, so two clients whose clocks disagree still
  agree on who holds a lease.
- The same holder renews (the original `at` is kept, `until` moves). A lease past its ttl is taken
  over, and `tookOver` names whose it was. Release is the holder's only. An unreachable host is a
  refusal with ssh's reason: `holderOf` throws rather than answering "free".

### Timings
- `recordTiming` appends `{ at, stage, ms, sha, host, ok }` to `.rig/timings.jsonl` through `rigDir`.
- `readTimings` skips a torn line instead of failing.
- `estimate(root, stages, { host })` takes the median of finished (ok) runs per stage. An even
  count gives the mean of the middle two. A stage with no runs gives `medianMs: null` and `n: 0`;
  then `totalMs` is null and `note` names the stages with no data. With no stages and no records,
  the note is `no timings recorded yet`.

## Checks: each seen red, and how

Every check uses the harness's `breaks`. The control imports a **mutant**, a copy of the real source
with one guard taken out or the naive behaviour put back (`mutant()` in the kit). A check whose
control still passes is VOID, and the run fails. Beyond the harness controls, I broke the real
source by hand once per file and watched the suite go red:
- `timings.js`: median turned into a mean, 2 FAIL.
- `lease.js`: refusal removed, 5 FAIL.
- `remote.js`: branch tip checked out instead of the sha, 3 FAIL.

Every file was restored afterwards.

**`test/machines-lease.test.js`** (10 checks, 1 target)
| Check | Red by |
|---|---|
| A second holder is refused: two clones with separate state dirs ("two machines"), as separate processes running `rig lease`, against one fake ssh host. Exit 1, holder printed | lease script without the REFUSED branch, run through a mutant `rig lease` |
| The lease lives on the host, not in either repo nor this machine | host lease run locally (`shOn(null, …)`) |
| Same holder renews; others cannot release; holder can | release that ignores the holder |
| A lease past its ttl is taken over (real 1 s ttl, 2.1 s wait); `tookOver` names the old holder | expiry ignored |
| 8 processes race for one lease with a deliberately slow section: exactly one wins, no guard left | same slow section with the mkdir guard removed |
| A db lease is seen by every repo on the machine | REFUSED branch removed |
| `db:<name>@<host>` lives on that host | `@host` ignored |
| **Target:** unreachable host refuses, never "free": **2006 ms (≤ 5000)**, broken **16007 ms** | `ConnectTimeout` dropped from the ssh options |
| List per machine, live and expired | empty list loop |
| A bare name is an error that says `host:` or `db:` | command that passes the bare name on |

**`test/machines-remote.test.js`** (14 checks, 4 targets)
| Check | Red by |
|---|---|
| Checks out exactly the sha (older commit, not the tip) and returns its exit (7) | bundle `HEAD`, check out the fetched ref, no sha guard |
| Exits come back as they are: `true`, `exit 7`, `false \| true` give 0, 7, 1 | host exit line that always says 0 |
| Nothing pushed: no remote, no `refs/rig` left here; a host with the commit gets no bundle | temp ref not deleted |
| Per-session checkout and test DB; env with quotes reaches the command | one shared dir and one DB name |
| Desktop-free: the host's own `DISPLAY`/`WAYLAND_DISPLAY` unset, a real `xclip` on the host never reached; `desktop: true` reaches both | desktop block disabled |
| Deps install on lockfile change only (c1, c2, c3, c3 → 2 installs) | always install |
| **Target:** unreachable host is 255 with reason: **1010 ms (≤ 5000)**, broken **8011 ms** | `ConnectTimeout` dropped |
| **Target:** password-locked host is 255 at once: **9–25 ms (≤ 3000)**, broken **8012 ms** | `BatchMode` dropped |
| **Target:** past `limitMs` → 124 and nothing left on the host: **2165 ms (≤ 8000)**, broken **40168 ms** (local backstop at 21.5 s, sleeper lives to 40 s) | no host watchdog |
| **Target:** a process the suite left running does not hold ssh open: **31–85 ms (≤ 5000)**, broken **12032 ms** | no group kill after the command |
| Output streams while the command runs | output delivered only at close |
| An unknown sha is refused before ssh is asked | guard removed |
| The command line parses identically under sh, bash, zsh and fish | arguments left unquoted |
| Every runner ssh call carries BatchMode and ConnectTimeout | one hand-rolled call in the log |

**`test/machines-timings.test.js`** (7 checks)
| Check | Red by |
|---|---|
| Medians exact on fixture data: 200 (odd), 25 (even), total 225 | mean instead of median (250) |
| Failed runs do not count | ok filter removed |
| A stage with no data: "no data for fold", totalMs null | missing stages ignored |
| No records at all: note says so | note dropped, total 0 |
| `host` narrows to one machine | host filter removed |
| `recordTiming` goes through rigDir: `.rig/` is ignored by git | plain `mkdir` of `.rig/` |
| A torn last line is skipped | parse error propagates |

The fake ssh host (`test/fixtures/fake-ssh/ssh`):
- each host is a temp dir used as HOME;
- the command runs the way real ssh runs it: its words joined by spaces, parsed by the host's
  shell, in a clean `env -i` environment, so nothing of ours leaks through;
- `unreachable` honours `ConnectTimeout` and hangs without it; `locked` honours `BatchMode` and
  hangs without it;
- every call is logged.

No test reaches a real machine, the clipboard or the display.

## Decided
- **Extra result fields** beyond the stubs; the contract's fields are unchanged.
  - `runOnHost` also returns `why`, `sent` and `stubCalls`, and takes `dir`, `desktop`,
    `connectTimeoutSec` and `signal` (abort gives exit 143).
  - `acquire` also returns `tookOver` and `renewed`, and takes `connectTimeoutSec`; so do `release`
    and `holderOf`.
- **`holderOf` throws** when the machine cannot be asked. Unknown must never read as free.
- **Expiry is judged by the holder machine's clock** (above). Ttl is in minutes; the shortest
  is 1 s.
- **`--by` is required** to take or give back a lease. `rig lease <res>` with no `--by` only reports
  the holder, so taking a lease is never implied by the branch you happen to be on.
- **A bare resource name** is accepted only when it equals the config's `qaHost` (it becomes
  `host:<it>`). Anything else is an error that says `host:` or `db:`.
- **`db:<name>@<host>`** puts a db lease on the host. Not in the task, and cheap.
- **`rig lease --list [--host h]`** lists the leases on one machine.
- **Deps marker** is the lockfile's git blob id. Portable: no `sha256sum` on macOS needed.
- **Failed runs are left out of medians.** A run cut short at its first failure says nothing about
  how long a green one takes.
- **`estimate()` with no stages** estimates every stage that has a record.
- **Remote scripts** contain no `\\` pairs, and `remoteCommand` throws if one appears. Fish treats
  them differently inside single quotes; the four-shell check covers the rest.

## For the lead: USAGE and README text

`bin/rig.js` USAGE for `lease` (replaces the current one-liner):
```
rig lease <host:<ssh-host>|db:<name>[@<ssh-host>]> --by <id> [--ttl <min>]   take or renew (default ttl 120 min)
rig lease <resource> --by <id> --release                                    give it back (holder only)
rig lease <resource>                                                        who holds it
rig lease --list [--host <ssh-host>]                                        every lease on one machine
Refused while someone else holds an unexpired lease: prints the holder and exits 1.
A host lease lives on that host (over ssh), so every machine sees it; a db lease lives in
$XDG_STATE_HOME/rig/leases (default ~/.local/state/rig/leases), seen by every repo here.
```

README paragraph:
> **Two machines, one lease each.** `rig qa --host <ssh-host>` runs the same suite on a second
> machine at exactly the same sha. The commit travels as a `git bundle` over ssh, so nothing is
> pushed. It lands in a checkout per session with its own test DB name (`RIG_TEST_DB`). An
> unreachable or password-locked host fails in seconds with ssh's reason, never a hang. Shared
> things are leased: `rig lease host:<h> --by <id>` is refused while someone else holds it, and it
> names who holds it and until when. A host lease lives on the host, so two sessions on two
> machines see the same lease. Leases expire (`--ttl`, default 120 min), and an expired one is
> taken over. Every stage's wall time is recorded in `.rig/timings.jsonl`, and
> `rig status --eta` prints only medians of those measurements, saying "no data" where there are none.

## For other slices
- **r55q** (`src/qa/host.js` on `rig/r55q` calls my API correctly):
  - pass `desktop: true` through to `runOnHost` when `rig qa --desktop` is given; today the host
    run is always desktop-free;
  - print `r.why` when the exit is 255, 124 or 3; it holds ssh's reason, the limit, or the failed
    checkout;
  - take the host lease with `ttlMin` at least the run's limit, or renew it during a long run.
    A 120 min default lease can expire under a 3-hour suite, and the next session would then take
    it over legitimately.
- **r55q / r55u**: a `--repeat` run on the host is recorded as `qa:host`, which pulls the `qa:host`
  median used by `rig status --eta` upward (see `docs/review-r55u.md` item 6). Suggest
  `qa:host:repeat`.
- **Everyone recording timings**: pass the main root (`mainRoot()`) to `recordTiming`, as qa, fold
  and review do today, or the estimate reads a worktree's empty `.rig/`.

## Left undone and limits
- **Never run against a real second machine.** The plan forbids it in tests, and I did not do it by
  hand either. Everything here is proven on the fake ssh: same argument joining, clean environment,
  real git, real sh. The first real `rig qa --host` is the lead's to watch. The things only a real
  host can show are the host's own login-shell quirks, sshd's handling of a killed client, and macOS
  `date -r` / `find -mmin` (both POSIX-documented BSD forms, but untested here).
- Since edf29fd, a run whose caller aborts, dies or loses the link is stopped on the host through
  the stdin lifeline, whether or not `limitMs` is set. One case is unproven: a link that hangs
  without closing (no FIN, no keepalive answer). That is cut by ssh's keepalives after about 60 s,
  and real sshd behaviour there has only been reasoned about, not seen.
- The stale-guard sweep has a narrow window: two calls that both find a dead guard more than a
  minute old may both remove it. The `mkdir` that follows is still atomic, so only one of them
  enters. This only arises after a crash inside a section that normally lasts milliseconds.
- Not supported: Windows hosts, and hosts without POSIX sh and git.
- Nothing here is visible on a screen, so there are no screenshots; the CLI output below is the
  real thing, against the fake host.

```
$ rig lease host:box --by r55m --ttl 45
leased host:box to r55m until 2026-10-22T22:20:53Z
$ rig lease host:box --by r55q                       [exit 1]
rig lease: refused, host:box is held by r55m since 2026-10-22T21:35:53Z, until 2026-10-22T22:20:53Z (45 min left)
$ rig lease host:box --by r55q --release             [exit 1]
rig lease: host:box is held by r55m until 2026-10-22T22:20:53Z, not by r55q
$ rig lease --list --host box
leases on box
  host:box  held by r55m since 2026-10-22T21:35:53Z, until 2026-10-22T22:20:53Z (45 min left)
$ rig lease host:box --by r55m --release
released host:box (r55m)
$ rig lease host:unreachable --by r55m               [exit 1, after ConnectTimeout]
rig lease: not taken: ssh unreachable: connect to host unreachable port 22: Connection timed out
```

## Against the references
- **Buildkite / GitHub Actions timeouts.** Matched: a limit on the run, a kill of the whole group,
  and a named 124. Gone past: what a run leaves behind is stopped as well, so ssh never waits on an
  orphan. Not done: "no output for N minutes". That is r55q's watchdog, which reads the streamed
  output this runner provides.
- **PagerDuty: every alert has an owner and a deadline.** Every lease has `by` and `until`, every
  refusal names both, and an expired lease is taken over rather than waited on forever.
- **Anti-reference, a lease that is a comment in a chat channel.** This one lives on the resource,
  behind an atomic guard, on that machine's clock.
- **Anti-reference, a watchdog that only checks the process is alive.** The limit target measures
  until the last process of the run is gone, not until ssh returns.

## Fixes after r55q's review (docs/review-r55m.md on rig/r55q, eefd10f; reviewed at fcaba91)
Each fix's check was written first and seen red on fcaba91's code, then made green. Each keeps a
harness control (a mutant with the fix taken out) that is red on every run.

| Finding | Fix | Check | Red first / control |
|---|---|---|---|
| 1. A host run cannot be stopped by its caller | `runOnHost` takes `signal` (an AbortSignal). The bundle now goes with its byte size (`head -c`), and after it ssh's stdin stays open as the run's lifeline. On abort, stdin is closed and ssh is stopped; the host reads the EOF and stops the run's whole process group (TERM, then KILL after 5 s). The result is exit 143 with `why` "stopped by the caller…". An already-aborted signal returns 143 before ssh is asked. The same lifeline covers a caller that dies, a dropped link and the local backstop. | **Target:** abort to the host's last process gone: **108 ms (≤ 5000)**, broken **14983 ms** | on fcaba91, NaN: the sleeper outlived the abort by 15 s. Control: no lifeline. |
| 2. `acquire` throws on a branch-name holder | `acquire` and `release` return `{ ok: false, why }` for a bad resource, holder or ttl, and never throw. `by` may contain `/` (`rig/r55q`); it reaches the holder file only through `printf %s`. `holderOf` still throws when it cannot answer, by design: unknown is never "free". | branch name taken and released; quote, ttl 0, bad resource → refusals, no throw | on fcaba91: `must be a session id` thrown. Control: old holder pattern plus the throw. |
| 3. Host stubs log no calls | Each stub appends `<tool> <epoch-ms> <args>` to `.git/rig-no-desktop/calls`. After the command, the runner prints `rig-qa: stub <tool> <ms> <args>` for each call, and `runOnHost` returns `stubCalls: [{ tool, t, args }]` (t in the host's epoch ms; whole seconds × 1000 where `date` has no `%N`, as on macOS). | a spec that sends its stub's stderr to /dev/null is still recorded, with the args | on fcaba91: no record. Control: the stub lines not printed. |
| 4. Lease ttl for long runs | No change, as the review says. rig qa asks for 2 × limit + 30 min and renews. | n/a | n/a |

**For r55q:** `src/qa/host.js` can now read `r.stubCalls` and use the same time rule as local
runs, instead of matching "the desktop is off" in the log; both work today. `signal` is honoured
as your code already passes it. With r55q's branch merged in a throwaway worktree, their
`qa-host-real` (6/6), my `machines-remote` (16/16) and `machines-lease` all pass.

The merged run also exposed a flake in my own takeover check: a 1 s ttl against a host clock that
counts whole seconds. It is now 2 s, and was green three runs in a row.

## Fix after the first real two-machine run (main 515b118, Linux PC + a Mac over ssh)
- **Found:** `deps install when the lockfile changed, and only then` failed on the Mac only.
- **Cause:** the runner put `/opt/homebrew/bin` first on the host's PATH. Homebrew's real `npm`
  then shadowed whatever the host's own PATH chose; in the test, that was the fake `npm` on the fake
  host's PATH. On Linux that dir has no npm, so the check passed.
- **Fix (e90950f):** each extra dir is appended only when it exists and is missing.
- **Check:** "the host's own PATH comes first…" runs on Linux too. It asserts that the command
  sees the host PATH unchanged at the front, extras only after it, and `npm` resolving to the
  host's own. It was red on the old line before the fix, and its control (the old line restored)
  is red on every run.
- **Seen on both machines** with
  `rig qa e90950f --run "node test/machines-remote.test.js" --host <the Mac> --no-ci`:
  - `rig qa: test exit 0 at e90950f`
  - `rig qa: test on <the Mac> exit 0 at e90950f`
  - 17/17 passed on each, 0 void; negative exit 0.
- **Lesson:** a second OS finds what the fakes share with the first. The fake host here inherits
  this machine's PATH, so it never had a Homebrew `npm` to be shadowed.

## Fix after 5.5.0: stopping a run under dash (GitHub's Ubuntu runner)
- **Found:** three targets were red on GitHub's Ubuntu runner, against bars of 8 s and 5 s:
  - limit, 40 s;
  - leftover process, 12 s;
  - abort, 15 s.
- **Cause:** dash, which is Debian's and Ubuntu's `/bin/sh`, turns job control off when there is no
  tty. So `set -m` gave the command no process group of its own, and every `kill -TERM -$pid`
  killed nothing. The runs then waited out the sleeper or the backstop. This was a real bug for any
  Debian or Ubuntu host, not only in the test.
- **Fix (13eac68):**
  - The command now always gets its own group: `setsid` where there is one (Linux); otherwise
    bash's job control, which needs no tty (macOS has `/bin/bash`, and no `setsid`); otherwise
    `set -m`. The bash launcher writes the group down, and every stop reads it from there.
  - The lifeline starts at once, so an abort in the first moment is not missed.
  - The lifeline reads ssh's stdin through fd 3. With no job control, a background list's own stdin
    is `/dev/null`.
  - The lifeline uses the shell's own `read`, so stopping it leaves no `cat` behind.
- **Fake ssh (fbf1105):** `FAKE_SSH_SHELL=<shell>` makes that shell the host's login shell, and the
  `sh` the command names.
- **Checks (all three suites seen red, then green):**
  - "under dash as the host sh, a limit, a leftover process and an abort each stop the run" runs
    wherever dash exists (Ubuntu CI, macOS). Its control removes the command's own group. This PC
    has no dash, so the check prints that and runs on CI and the Mac only.
  - "with no setsid (macOS), bash's job control gives the command its group…" runs on Linux too,
    through a mutant that hides `setsid`. Its control is the bash launcher without `set -m`.
  - The three existing stop targets have their controls moved to the new lines.
  - The PATH check (6015ccd) now expects the fake's own `sh` first when `FAKE_SSH_SHELL` is set.
- **Red first, on the Mac under dash, at fbf1105** (the test change, old runner),
  `rig qa fbf1105 --run "FAKE_SSH_SHELL=/bin/dash node test/machines-remote.test.js" --host <the Mac> --no-ci`:
  - the three targets were red at 40184 ms, 12187 ms and 15032 ms, the same as CI;
  - the dash check failed;
  - result: `test on <the Mac> exit 1 at fbf1105`.
- **Green at 6015ccd**,
  `rig qa 6015ccd --run 'FAKE_SSH_SHELL=$(command -v dash) node test/machines-remote.test.js' --host <the Mac> --no-ci`
  (dash on the Mac, the normal sh on this PC):
  - `rig qa: test exit 0 at 6015ccd`, 18/18 passed;
  - `rig qa: test on <the Mac> exit 0 at 6015ccd`, 19/19 passed, 0 void;
  - under dash the targets took 2335 ms, 317 ms and 109 ms; negative exit 0.
- **Locally:** with `FAKE_SSH_SHELL=/bin/bash`, 18/18 passed.

## Verification run (code sha 8d1783a; the commit after it changes this report only)
- `npm run check` on 8d1783a: **exit 0**. That covers `biome ci .`, `test/run.js: 19 file(s) green`
  and `check-no-personal-data` clean. This is a re-run after the PC rebooted around 20:00 and killed
  the first runs.
- `rig qa 8d1783a56e0b035c396f572fac3aebdb5728e4ca --run "npm test" --negative "npm run demo"`:
  - `rig qa: test exit 0 at 8d1783a` and `rig qa: negative exit 0 at 8d1783a`;
  - the three machines suites inside it: leases 11, runner 16, timings 7 passed, 0 void.
- Earlier, on fcaba91 (before r55q's review): `npm run check` exit 0, and `rig qa` test 0 /
  negative 0. One `taste.test.js` check failed in a run made while my runner suite was also
  running; run alone it is 36/36. That test is load-sensitive; it is not mine and I did not touch it.
- Review of r55u: all six findings verified fixed at ac55143 (`docs/review-r55u.md`, c74a91e).
- Review of r55m by r55q (eefd10f): findings 1 to 3 fixed in edf29fd, each check seen red first;
  the flaky takeover check fixed in e5151f0. r55q verifies.
- **`npm run check` at 6015ccd** (this PC): EXIT 0; `test/run.js: 35 file(s) green`. That includes
  r55q's suites, which run `rig qa --host` through this runner (8/8 and 21/21).
