# Build report tw2: crew record, tab order, messaging text

## Built (all DONE)
1. **Crew record written by the code that starts agents.** `rig up` (under hc) records the lead
   (`HC_TERMINAL_ID`, its tab and space, role `lead`) and every slice or `rv-*` tab open at that moment,
   opened by this run or found, as `{terminal, tab, space, role, backend:'hc'}` (`recordCrew` in
   `src/commands/up.js`, using `hc.crewTabs`). `rig review --launch` records its `rv-<id>` tab
   (`recordReviewer`). `rig down` forgets exactly the tabs it closed. With no lead name, `rig up` says
   the lead is not recorded rather than guessing.
2. **`rig crew`**: list (sorted lead, reviewers, slices; live hc state per member, `gone` if hc no longer
   knows the terminal), `add`, `rm`. `add` defaults the role to `reviewer` for `rv-*` names, else `slice`;
   the backend is `hc` when the terminal looks like `t<number>`, else unset (`--backend` overrides).
3. **Tab order** (`hc.arrangeTabs`): after the tabs exist, `herdr-app do tab.move {id, index}` lays our tabs
   out lead, reviewer(s), helpers in plan order, in the slots from the earliest of them onward; the person's
   other tabs keep their order. `rig review --launch` puts `rv-*` right after the lead. Only `tab.rename` and
   `tab.move` reach the window; `tab.new`, `space.new` and focus are never called.
4. **Messaging text**: `askTheLead` now says `rig tell <name>` wakes an agent in a Herdr app tab, queues
   for a busy one, says when it only filed, exits non-zero if blocked, and that the lead keeps
   `rig inbox --wait`. `rig up`'s hint and `rig review --by`'s hand-over text say the same. `templates/`
   has no messaging text, so it is unchanged.

## Red seen (each check's control is a copy of the tree with the fix removed; the harness fails a check as VOID if the control passes)
- Record holds lead, slices, reviewer: `recordMember(root, m.name, ...)` in `recordCrew` replaced by `void (...)`.
- Lead is this terminal: the `if (lead && hc.homeTerminal())` guard replaced by `if (false)`.
- Reviewer recorded: `recordMember(root, label, ...)` in `review.js` voided.
- Exact-name resolve: `resolveMember` swapped for a prefix matcher (in the copied tree only; `src/crew.js` is the lead's and untouched).
- Tab order, with and without an existing reviewer tab: the `hc.arrangeTabs({` call voided; and slices arranged in reverse.
- No view-moving command: `tab.move` swapped for `tab.focus`; the check lists every `herdr-app do` verb and every hc argument.
- `rv-*` right after the lead: arrange call voided in `review.js`.
- `rig down` forgets: the forget loop voided. `rig crew`: `--role` ignored. Brief: "wakes" text swapped.
- Premise check: the fake window puts new labelled tabs in front, reversed (`s3,s2,s1,lead`); with an appending window the premise check goes red.
Runs: `test/crew-record.test.js` 7 passed, `test/up-tab-order.test.js` 5 passed, 0 void; `hc`, `brief-five`,
`gate-review-brief` pass. `watch-inbox` 27 passed. `watch-job` is slow: it timed out in my 110 s window with every check so far passing; the lead's full run covers it.

## Decided
- **Why the tabs land reversed and in front is not proven from the real window.** I did not open tabs in the
  real app (hard rule). What the code shows: `hc run --label herdr.space=... --label herdr.tab=...` tells the
  window nothing about position, so the window picks it. The fix does not depend on the cause: arrange after
  the fact. The fake window reproduces "in front, reversed" as a stated assumption. Worth one look in the
  real-hc proof: `herdr-app ls` right after `rig up`.
- `herdr-app commands` lists `tab.new` with `focus:false` ("adds it last, keeps the shown space"), which
  contradicts the comment in `src/hc.js`. I did not switch to it (the brief forbids `tab.new`); the lead may want to revisit.
- **`tellLine` is unchanged.** `test/gate-review-brief.test.js` (not mine) pins its exact text, and `watch-job`
  needs it as the last line. The wake sentence sits in `askTheLead` directly above it. Changing the line itself
  needs those tests edited by the lead.
- Only the hc backend is recorded; tmux and terminal herdr have no terminal address `rig tell` can wake.

## Text for the lead
USAGE (bin/rig.js already carries it): `rig crew | rig crew add <name> <terminal> [--role lead|slice|reviewer] [--backend hc|herdr|tmux] | rig crew rm <name>`
(add `[--backend ...]` to the USAGE line in `bin/rig.js`). README/CHANGELOG: "`rig up` and `rig review --launch`
record who runs where in `.rig/crew.json` (`rig crew` to see it, `add`/`rm` to edit); under the Herdr app the
space reads lead, reviewer(s), helpers in plan order; briefs say `rig tell <name>` wakes the agent it names."

## Left
- Real-window confirmation of the tab-order fix (`tools/` proof by the lead). `rig crew` does not yet show a member's current tab name.
- Merge note: `test/watch-inbox.test.js` and `test/brief-five.test.js` pass `askTheLead` content checks; re-run after tw1 merges.
