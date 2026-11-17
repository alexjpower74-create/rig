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

## Fix round verified at 72b8486 (2026-11-17)

Ran `test/crew-record.test.js` + `test/up-tab-order.test.js` at 72b8486: 8 + 6 checks passed, 0 void
(every check's control went red).

1. **FIXED.** `rig crew add` asks hc (`isHcTerminal` = `hc get` answers). The test now adds `t26z`
   and `mac/t46` and expects backend hc, with live status shown.
2. **FIXED, but the fix opened a new hole: see 6.** `rig up` and `rig review --launch` now arrange
   every reviewer in the record by its terminal's tab (`reviewerTabIds`). There is a test for a
   hand-added `rv-561`.
3. **FIXED.** A live recorded lead on another terminal is kept, with a line naming the explicit
   rebind.
4. **FIXED.** Usage errors and a bad role exit 2, and a test pins it.

### 6. NEW, MEDIUM: a recorded reviewer in ANOTHER space breaks the order and moves a tab in that space
`src/hc.js` `arrangeTabs` + `reviewerTabIds`. `reviewerTabIds` returns the tab of every recorded
reviewer, wherever it is. `arrangeTabs` puts them in `first`, so each one takes up a slot (`to =
start + k`) even though `findIndex` in this space is -1. It also calls `tab.move {id, index}` on it,
which in the real app moves that tab "to a position in its space": the other space's tabs get
rearranged, the opposite of "only our tabs move".

`.rig/crew.json` outlives a build: a hand-added reviewer is never forgotten, and `rig down` only
forgets what it closed. So this happens on the next build in a new crew space, with the last build's
reviewer still alive somewhere else. I simulated the exact algorithm with space A = `[lead, s1, s2,
X]` (X is the person's tab) and a reviewer recorded in space B. Result: A = `[lead, s1, X, s2]`, with
the person's tab between the helpers, and a `tab.move` sent for B's tab.

Fix: in `arrangeTabs`, keep only ids present in `tabs(space)` before computing slots, or have
`reviewerTabIds` filter by `whereIs(...).space === home().space`. Test: a reviewer recorded with a
terminal whose tab is in a second space. Expect the order lead, slices, person's tab, unchanged,
and no `tab.move` for the foreign id. It is red today.

Verdict: 1–4 PASS; 6 is open (MEDIUM). Final review on main's sha still to come.

## #6 verified at 33152ef (2026-11-17)

**FIXED.** `arrangeTabs` keeps only ids present in this space's tabs (lead included). A new check
records a reviewer whose tab is in a second space and expects `lead,s1,s2,notes` with no `tab.move`
for that tab. Its control removes the filter and must go red. `test/up-tab-order.test.js` at
33152ef: 7 passed, 0 void. All tw2 early findings PASS. Final review on main's sha still to come.
