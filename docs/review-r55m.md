# Review of r55m: two machines, leases, measured time

Reviewer: r55q. Read-only: findings only, no edits to r55m's files.
Reviewed: `rig/r55m` at fcaba91 (46b1c81..fcaba91), mostly `src/remote.js`, `src/lease.js`,
`src/timings.js`, `src/commands/lease.js` and the fake-ssh kit, from the side that calls them
(`rig qa --host`, r55q).

How I checked: I merged `rig/r55m` into a throwaway detached worktree and ran my suites against the
real code (`qa-parse`, `qa-baseline`, `qa-host-real`) plus `machines-lease` and `machines-timings`.
All green. `test/qa-host-real.test.js` drives `rig qa --host box` end to end through your
`runOnHost`, your lease and your fake ssh: same sha on both, tallies side by side, a host-only
failure named, another session's lease refusing the run by name, and a host clipboard spec listed
as needs-a-stub. Each control was seen red.

The contract holds: `recordTiming`, `readTimings`, `estimate`, `acquire`/`release`/`holderOf` and
`runOnHost` match the stub signatures, and the slice touches only its own files.

## Findings

### 1. A host run cannot be stopped by its caller, so a signal to `rig qa` leaves it running (medium, seen)

`runOnHost` spawns ssh and takes no `AbortSignal` (or any other handle). When `rig qa` gets a
SIGTERM (a `rig job` deadline, a lead's own timeout, a closed pane), it stops its local process
groups and exits. The ssh child is not in any group it stops, and `process.exit` does not take
children with it.

Seen on the merge: `rig qa HEAD --host box --run "sleep 25"`, SIGTERM after 4 s. After `rig qa`
exited, the host's runner `sh -c … rig-qa ~/.rig-qa/app/t …` and `sleep 25` were still running in
the fake host's directory. With `--timeout 0` the remote watchdog has no limit, so the run goes on
indefinitely, holding the session's checkout and its test DB.

Also: rig qa's stall watchdog cannot cover host runs for the same reason. It can see the output
through `onOutput`, but it has nothing to stop.

Suggested repair: take `signal` in the opts. On abort, kill the ssh child, and make the remote
side die with its connection. One way is to have the runner read stdin after the bundle and kill
`-$pid` on EOF. Another is `ssh -tt`, but that changes output. `rig qa` will pass the signal from
its SIGINT/SIGTERM handler and from the stall watchdog.

What r55q did meanwhile (8936ffd): `rig qa` no longer gives the host lease back while a run there
is in flight. Before that fix, the orphaned run above lost its lease at once, which is the
DB-wiping case the lease exists to stop. The lease now expires at its ttl, which rig qa sets to
outlast the run's limit.

### 2. `acquire` throws where its contract returns a refusal (low, seen)

The stub contract is `@returns {{ ok, holder, why }}`. `acquire` throws on a `by` outside
`[A-Za-z0-9._:@-]`, on a bad ttl and on a bad resource. The natural default holder for a slice is
its branch, `rig/r55q`, and that throws `lease: --by "rig/r55q" must be a session id`. rig qa now
cleans the id (`holderId`, 4566680) and wraps the call.

Suggested repair: either return `{ ok: false, why }` for bad input, as the contract says, or allow
`/` in `by`. `/` is safe there: `by` only goes into the JSON through `printf %s`, and file names
come from the resource, not the holder.

### 3. Host stubs do not record their calls (low, suggestion)

The host's clipboard stubs print `<tool>: the desktop is off in test runs` to the spec's stderr
and exit 1, which is right. But nothing records that a call happened. rig qa can therefore only
name a host spec as needs-a-stub when its failure output carries that line. A spec that swallows
the stub's stderr and then fails on an assertion is counted as a new failure on the host and as
needs-a-stub here.

Suggested repair: have each stub also append `<epoch-ms>\t<tool>\t<args>` to
`.git/rig-no-desktop/calls`, and have the runner print `rig-qa: stub <tool> <ms>` lines from it
before `rig-qa: exit`. That is the same format the local shims log (`src/qa/desktop.js`), so the
same coincidence rule would apply on both machines.

### 4. Lease ttl and long runs (note, no change needed)

The default ttl of 120 min is shorter than an unlimited host run can be. rig qa now asks for 2 ×
its limit + 30 min, renews every 30 min while it runs (the same holder renewing is allowed), and
leaves the lease to expire if it dies mid-run. No change is needed in `lease.js`. This is for the
lead's README paragraph on leases.

## Verdict

Pass with one fix wanted: finding 1, so that a stopped `rig qa` stops its host run. Findings 2 and
3 are small. Nothing here blocks the merge order (r55m first). rig qa already works around 1 and
2, and the workarounds are tested.
