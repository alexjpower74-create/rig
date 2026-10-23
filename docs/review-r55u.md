# Review of r55u (upstream: drift, rebase, baselines), by r55m

Reviewed `rig/r55u` at `a75bc05` (diff from the scaffold `14a1ad6`): `src/drift.js`,
`src/baselines.js`, `src/commands/rebase.js`, `src/commands/status.js`. I read the diff only and
changed none of it. `harness/snapshot.js` and the tests I only skimmed. Findings are ranked, most
serious first. The finder (r55m) verifies each fix.

## 1. Defect: drift's fetch overrides the repo's own `core.sshCommand`, so a repo that fetches with its own key can never fetch

`src/drift.js:148`: `fetchBase` runs git with
`GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes'`. Git gives `GIT_SSH_COMMAND`
precedence over `core.sshCommand` (and `GIT_SSH`). A repo whose config names its own ssh command (a
deploy key, `ssh -i ~/.ssh/<key>`, a jump host) then fetches with plain ssh and the default key, and
gets refused. The cost: `rig status`, `fold` and `finish` print "fetch from origin failed" every time
and compare against a stale base, which is the exact failure item 11 exists to prevent.

Seen, not inferred. A clone with `core.sshCommand` set to a logging script:
plain `git fetch` ran the script; with `GIT_SSH_COMMAND='ssh -o BatchMode=yes …'` the script was
never called and ssh used its defaults (`core.sshCommand NOT used`).

Fix: keep what the user configured and add the batch flag to it, e.g.
`const base = process.env.GIT_SSH_COMMAND || tryGit(['config', 'core.sshCommand'], root).out || (process.env.GIT_SSH ? null : 'ssh')`
and set `GIT_SSH_COMMAND` to `${base} -o BatchMode=yes -o ConnectTimeout=10` only when `base` is
set (leave `GIT_SSH` users alone; `GIT_TERMINAL_PROMPT=0` still covers https). Test: a fixture whose
`core.sshCommand` is a fake ssh script must see that script called; red with today's line.

## 2. Defect: `rig rebase` ignores a failed fetch, then rebases onto the stale base and reports success

`src/commands/rebase.js:57` and `:59` call `fetchBase(...)` and throw the result away. `drift` then
runs with `fetch: false` (`:61`), so `d.error` never mentions the fetch, and `formatDrift` prints
"origin/main moved N commit(s)" as if it were current. Offline, or with finding 1, the rebase lands
on yesterday's base and prints `rebased rig/<id> onto origin/main`. The owner then rebuilds the round
on a base that is already behind, and nothing said so. `rig status` gets this right (it prints
`f.why` in yellow). rebase should do the same, and refuse unless `--no-fetch` was asked for: a
rebase is the one command where a stale base is the whole point.

Test: a fixture with an unreachable remote URL; `rig rebase` must print the fetch failure and exit
non-zero (or proceed only with `--no-fetch`).

## 3. Risk: `rig status` can wait 30 s on every call when the remote cannot be reached

`FETCH_TIMEOUT_MS = 30_000` (`src/drift.js:14`), and status fetches by default (`status.js:33`). The ssh
command has BatchMode but no ConnectTimeout. On a network that drops packets (a laptop on a train,
a VPN down) each `rig status` sits silent for 30 s before it prints anything. Add `-o ConnectTimeout=10`
to the ssh command (see 1), and print `fetching origin…` before the fetch so the wait has a name.

## 4. Risk: `rig rebase` rewrites the branch inside the slice's live worktree

`checkoutFor` (`rebase.js:93`, `:283`) uses the worktree where the branch is checked out, which during
a build is the slice agent's own tree. The dirty check stops uncommitted work being lost, but an agent
mid-task (between a commit and its next edit, or running a test) has its tree rewritten under it,
and its next `git commit -- <paths>` lands on the rebased branch with no warning. Suggest: refuse,
naming the slice, when that slice's pane is live (herdr says working), unless `--force`; or say in the
output that the owner's tree moved and what their new base is.

## 5. Note: `staleBaselines` says nothing when it could not check

`src/baselines.js:35` returns `[]` when the base does not resolve, which is the same answer as "every
baseline is fresh". r55q's `warnStaleBaselines` then prints nothing. Return a reason (`{ stale: [],
why }`, or throw for the caller's `catch`, which r55q already has) so "could not check" is never read
as "none stale".

## 6. Note for the lead: what the eta total adds up

`roundStages` and `formatEta` (`status.js`) sum every stage median, `qa:host` included. Two things
make that total wrong without anyone noticing:
- if `rig qa` runs the host suite alongside the local one, the round takes max(local, host), not
  their sum;
- r55q records a `--repeat` run on the host as `qa:host` (`qa.js:546` on `rig/r55q`), so one
  10-seed repeat pushes the `qa:host` median up for every later estimate.

Both are stage-naming questions between r55q and r55u (`qa:host:repeat` would fix the second). The
numbers are still measured, not guessed, so this is not a bar violation. I raise it so the lead can
decide.

## What holds up

- `mergeTree` treats exit 1 with a tree id as "does not merge" and anything else as "could not run",
  with the reason. That is the right split; a git older than 2.38 is a stated unknown, never a pass.
- `--no-renames` in `changedFiles` (a move upstream shows as delete plus add, so an owned file moved
  away is never hidden) and `-M` in `supersededFiles` (so the ask note can say "moved to …") are each
  the right choice for their job.
- Aborting a conflicted rebase and leaving the branch as it was, with the conflicting files named, is
  the right default. So is `--drop` refusing without `--covered`.
- `formatEta` never fills in a missing stage: it prints "no data" and a measured floor, which meets
  the bar. It reads `estimate()` exactly as the contract defines it.

## Verified at ac55143 (2026-10-22)

I read the diff `a75bc05..ac55143` (`src/drift.js`, `src/commands/rebase.js`, `src/commands/status.js`,
`src/baselines.js` and the three upstream test files). Then I ran `test/upstream-drift.test.js`,
`test/upstream-rebase.test.js` and `test/upstream-baselines.test.js` in a clean detached worktree at
ac55143: **16, 10 and 7 passed, 0 failed, 0 void.** Every fix's check is a harness check whose
control is the reviewed code, so each was seen red as well as green.

| Finding | Verdict | How I checked |
|---|---|---|
| 1. fetch overrode `core.sshCommand` | **fixed** | `fetchEnv()` uses GIT_SSH_COMMAND, else `core.sshCommand`, else `ssh`, adding `-o BatchMode=yes -o ConnectTimeout=10`; a `GIT_SSH` program is left alone. That is the same order git itself uses (env, then config, then GIT_SSH). **My repro, re-run against ac55143's `fetchBase`:** a clone whose `core.sshCommand` is a logging script. The script was called, with both options added, and the fetch succeeded and brought in the new upstream commit; before the fix the script was never called. Checks "review 1: the fetch uses the repo's own core.sshCommand…" and "review 1: GIT_SSH_COMMAND is kept and extended…" pass. |
| 2. rebase ignored a failed fetch | **fixed** | The fetch result is now read. On a failure, the reason is printed, the branch is untouched, and the exit is 1. `--no-fetch` goes on and says it is using the last fetch. A local base (nothing to fetch) still proceeds. Check "review 2: a fetch that fails stops the rebase…" passes. |
| 3. silent 30 s status wait | **fixed** | `ConnectTimeout=10` is in the ssh command, and `fetching <remote>/<branch>…` is printed before the wait, in both status and rebase. Check "review 3: rig status names the fetch before it waits on it" passes. |
| 4. rebase in a live worktree | **fixed** | Refused while herdr reports the slice's agent working or blocked, unless `--force`. After any rebase in the slice's own tree, the output says the tree moved and to tell the owner. tmux, which cannot report agent state, falls back to the note only; that is acceptable. The checks use a fake `herdr`, and nothing is typed into a pane. "review 4" ×2 pass. |
| 5. `staleBaselines` silent when it could not check | **fixed** | It now throws with the reason. r55q's `warnStaleBaselines` already catches that and prints "could not be checked: …". Check "review 5: … never 'none stale'" passes. |
| 6. eta total (lead's decision) | **fixed** | `roundTotal` counts qa:test and qa:host once, at the longer, and does the same for `qa:ci` here and `qa:ci@<host>` there. Repeat stages never enter the round, and the floor counts a side-by-side pair once. It reads `estimate(root, [stage], { host })` exactly as `src/timings.js` defines it. Three checks pass. Still open, and r55q's to do: rig/r55q records host repeats as `qa:host`, not `qa:host:repeat`. |

Residual, low and not blocking: an ssh wrapper that rejects `-o` options (rare) now gets two added.
Git already sends its own `-o SendEnv=GIT_PROTOCOL` and a `-G` probe to such a command, so a wrapper
that cannot take options was already broken. **All six findings verified; nothing further from r55m.**

## Delta at 9ab94a0 (2026-10-22)

Scope: r55u's own commits on `rig/r55u` after ac55143 (first-parent, merges of main left out). Two
of them change code: 6c1006d (`src/taste/capture.js`, `test/taste.test.js`) and e80d49e
(`test/taste.test.js`). 3de1d59 and 9ab94a0 are docs only. I read the diff `3de1d59..e80d49e`, read
`harness/check.js` for how a thrown control is graded, and ran `captureAll` against a local test page
in a detached worktree at e80d49e and in a tree unpacked from 3de1d59. This was read-only: nothing on
`rig/r55u` was changed.

**Finding 1 (medium): `settle()` replaces a page's own image `onload`, so the shot is wrong.**
`src/taste/capture.js` waits on images with `i.onload = i.onerror = r`. This assigns the property and
throws away any handler the page set itself. Pages often add an image after load and reveal it in
that image's `onload`: a fade-in, or a placeholder swapped out. Such a page is now shot in its
unrevealed state. 3de1d59's fixed pause shot it correctly.

Repro: a local page adds an image after `load`, and its `onload` turns the body teal.

| Capture | First pixel of the desktop shot |
|---|---|
| At e80d49e | `255,255,255` (white) |
| At 3de1d59 | `58,143,143` (teal) |
| e80d49e with only that line changed to `addEventListener('load', r)` / `('error', r)` | `58,143,143` (teal) |

The suite's new check, "a page that fills in after load…", reveals with `fetch`, not an image, so it
cannot see this. The fix is `addEventListener` (or `img.decode()`), plus a check whose page sets
`img.onload` after load.

**Finding 2 (low): when the fast-second-tap check gives up, its control counts as red.**
"a fast second tap is queued onto the next card, never dropped" now retries its set-up up to three
times. After three misses, it throws. `harness/check.js` catches a throw in the control run as
`stillPasses = false`, so it grades the check PASS. On a machine loaded enough to miss three times,
the control is therefore "seen red" without the dropped-tap rule ever being exercised: the proof is
vacuous, the thing the commit set out to stop. The same throw in the assert run gives FAIL, where
"could not set up" would be the honest result. A fix: report the missed set-up as an inconclusive
result the harness can tell apart, or have the control return `true` (pass) when it never got a
landed tap, so the run comes out VOID rather than PASS.

Looked at and fine:
- The click counter, installed ahead of the page's script, makes "did the tap register" a fact.
- `saved()` waits on the page's own empty queue in place of the sleeps.
- One frame for Done on an ended round is enough: `done()` returns at once when `ended` is set.
- Number keys accept a board that has already moved on.
- The 90 s per-check hang guard.
- `oldTaste()` reads 3de1d59 with `git archive`, and CI checks out full history (`fetch-depth: 0`).
  Locally, a failed archive throws out of `breaks()`, which fails the run loudly rather than voiding
  it.

**Two findings (one medium, one low); the rest of the delta is sound.**

## Verified at e7ebcab (2026-10-22)

I read e7ebcab (`src/taste/capture.js`, `test/taste.test.js`). Then I re-ran my repro and
`test/taste.test.js` in a clean detached worktree at e7ebcab: **39 passed, 0 failed, 0 void, 0
unproven** (2 of them targets), exit 0.

| Finding | Verdict | How I checked |
|---|---|---|
| 1. `settle()` replaced a page's own image `onload` | **fixed** | `settle()` now uses `addEventListener('load'/'error', r, { once: true })`. **My repro against e7ebcab's `captureAll`:** a page that adds an image after `load` and turns teal in its `onload` is shot `58,143,143` (teal); at e80d49e it was white. The new check, "a page that reveals itself in an image's own onload…", passes, and its control is e80d49e's capture, so it was seen red as well. |
| 2. the fast-tap give-up graded its control red | **fixed** | A set-up that never lands now fails the real run and passes the control run, so the check grades VOID rather than PASS. A meta-check runs the real check in an inner suite with every control set-up forced to miss, and requires VOID. Its control is e80d49e's throw. The meta-check passes, so it was seen red too. `oldTaste()` now throws when `git archive` fails. |

One note, not blocking: the meta-check's inner real run still needs a landed tap, so on a machine
loaded enough to miss three times, it fails rather than reading as inconclusive. That is the honest
result. **Both delta findings verified fixed; nothing further from r55m.**
