# Review: tw2, crew record, tab order, briefs

## Early review at e3dcccc (2026-11-17)

Read: `git diff main...rig/tw2` (src/commands/{crew,up,review,down}.js, src/hc.js, src/brief.js, the
two new tests, the build report). Checked against the real window's own command list
(`herdr-app commands`, read-only) and the live address format (`hc ls --json`, read-only).

What holds up:
- `tab.move`'s index is 1-based in the real app ("1 = first"), which matches `index: to + 1` and the
  fake's `splice(a.index - 1, …)`.
- Only `tab.rename` and `tab.move` reach the window. The check lists every verb and was shown red by
  swapping in `tab.focus`.
- `arrangeTabs` filters out a null id. That matters because `tab.move` with no id moves the person's
  *active* tab ("the active one if no id"). Keep that filter.
- Resolve stays exact (`src/crew.js` untouched); `crewTabs` matches tab names with a `Set`, not a pattern.
- `rig down` forgets only the names `killSession` reports closed.

### 1. HIGH: `rig crew add` records a real hc terminal as "no backend", so `rig tell` can never wake it
`src/commands/crew.js` (`add`): `const backend = flag('--backend') || (/^t\d+$/.test(terminal) ? 'hc' : null)`.
Real hc addresses are not all `t` + digits. The live list right now has `t1yz`, `t26z` (this crew's
lead), `t271` … `t279` and `mac/t46`. So `rig crew add rv-561 t26z` records `backend: null`.
`src/crew.js` says "only an hc terminal can be woken". If tw1 keys on `backend === 'hc'`, as the
contract invites, the hand-added reviewer gets "filed only" for ever. A hand-added reviewer is
exactly the case `rig crew add` exists for (a reviewer spawned outside the rig).

The test cannot see it: it adds `t7` (`test/crew-record.test.js:290`), the one shape the regex
accepts, so the fake hides what real hc does.

Fix: decide the backend by asking hc, not by the address's shape. `hc get <terminal> --json`
succeeds means 'hc', and `hc` absent or `get` failing means as given or null. Failing that, use a
pattern that matches hc's real form (`^([a-z0-9-]+/)?t[0-9a-z]+$`). Add a test that adds `t26z` (and
`mac/t46` if remote terminals are in scope) and is red on today's regex.

### 2. MEDIUM: `rig up` never finds or orders a reviewer whose id is not `rv-<slice-id>`
`src/commands/up.js` `recordCrew`: `names = [...sliceIds, ...sliceIds.map((i) => 'rv-' + i)]`. Only
`rv-<slice>` tabs (what `rig review <slice> --launch` makes) are recorded and arranged. This crew's
own reviewer is `rv-561`, a build-level reviewer added by hand, the shape the plan names ("`rv-*`
reviewer ids"). If `rig up` runs with that tab already open, it is neither recorded nor moved: the
space reads lead, helpers, and the reviewer wherever the window put it. That misses the bar ("tab
order after `rig up` with an existing reviewer tab is lead, reviewer, slices").

Fix: the reviewers to arrange are the union of the `rv-<slice>` tabs found and every member already
in `.rig/crew.json` with `role: 'reviewer'` (found by its recorded tab id, not by label). Test: record
`rv-561` with `rig crew add`, put its tab at the end, run `rig up`, and expect lead, rv-561, slices.

### 3. LOW: `rig up` run from another tab silently rebinds the lead
`recordCrew` records `lead` as `HC_TERMINAL_ID` every time `rig up` runs. A helper or a second
terminal re-running `rig up` (to reopen a closed slice tab, say) overwrites the lead's terminal with
its own, and from then on tells to the lead go to that terminal. Suggest: if a lead is already
recorded on a different, live terminal, keep it and print one line saying so (`rig crew add <lead>
<t>` is the explicit rebind).

### 4. LOW: `rig crew` usage errors exit 1, not 2
`add` with a missing argument, an unknown subcommand and a bad role all `throw`, and `bin/rig.js`
turns those into exit 1. Elsewhere the rig uses 2 for usage (`rig tell`, `rig inbox`, `rig qa`).
`rig crew rm <unknown>` exits 0 with "was not in the crew record", which is fine. Minor, but tw1's
exit-code table should stay consistent with this.

### 5. NOTE for the lead (tw2 → tw1 contract)
The brief text in `askTheLead` promises "exits non-zero if the agent is blocked on a prompt", "queues
the message for one that is busy" and "says so when it could only file it". Hold it against tw1's
final behaviour at merge. Also: `recordCrew` writes `backend: 'hc'` for every member it finds. If tw1
decides wake-ability by `backend`, finding 1 is the only path that writes a null backend for a real
hc terminal.

Severity summary: 1 high, 1 medium, 2 low.
