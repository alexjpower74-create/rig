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
