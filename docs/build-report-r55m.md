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
  `/opt/homebrew/bin` and `/usr/local/bin` go first on PATH, because a non-interactive ssh session on
  macOS does not have them and `npm` would not be found.

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
  - `runOnHost` also returns `why` and `sent`, and takes `dir`, `desktop` and `connectTimeoutSec`.
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
- When the local backstop kills ssh (the host went silent), the remote command is stopped only by
  its own watchdog. Without `limitMs` there is no watchdog, so a run with no limit whose link drops
  can keep running on the host until it ends. `rig qa` always passes a limit.
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

## Verification run (code sha fcaba91; every later commit changes docs only)
- `npm run check` on fcaba91: **exit 0**. That covers `biome ci .`, `test/run.js: 19 file(s) green`,
  and `check-no-personal-data` clean.
  - A first run, made while my runner suite was also running, failed one `taste.test.js` check
    ("t2 report names every repo"). Run alone it is 36/36, and the clean re-run above is green.
    That test is load-sensitive; it is not mine and I did not touch it.
- `rig qa fcaba917dbfe1360804da6900037dbc82e0616df --run "npm test"`:
  - `rig qa: test exit 0 at fcaba91` and `rig qa: negative exit 0 at fcaba91`;
  - the three machines suites inside it: 10, 14 and 7 passed, 0 void.
- Review of r55u: all six findings verified fixed at ac55143 (`docs/review-r55u.md`, c74a91e).
- Review of r55m (by r55q): brief written with `rig review r55m --by r55q` (`.rig/REVIEW-r55m.md`
  in the main checkout). No findings yet; I verify any fixes when they come.
