# Review — rg3 · `rig roll`: a cross-repo crew from one brief

Reviewed `git diff main...rig/rg3` (d5e4290) against PLAN.md. Read only; nothing edited.

What held up: `test/roll.test.js` is green in a detached worktree of rig/rg3 (21 passed, 0 void),
every check has a control, and the two VOIDs the report describes are the right kind of fix. Parse,
resolution order, duplicate slugs, dry-run/help, and closing by tab id all do what the plan says.
The findings below are all on paths the fixture never walks: a repo the tab was told to SKIP, a
commit the tab did not make, a second roll in the same workspace, and the launch itself. Each was
reproduced in a scratch copy with the branch's own code; the state named is what the code returned.

## Findings

- **`src/roll.js` line 251 vs. the brief it writes (line 162–164): a repo SKIPPED for a dirty tree
  can never pass the gate.** The tab brief says "A dirty tree or another branch: SKIPPED with the
  reason. Never stash, reset or checkout over someone's work." `repoState` checks `isDirty` before
  it looks at the report, so a repo with someone else's WIP that the tab correctly SKIPs comes back
  `in progress`. Reproduced: untracked `wip.txt` plus `- a: SKIPPED — dirty tree` in the report →
  `in progress`. Consequences: `rig roll status` exits 1 for the rest of the roll, `rig roll finish`
  fails that repo with "uncommitted changes" and never jots, and `rig roll down` refuses without
  `--force`. The one rule the brief puts above the procedure is the one the gate cannot accept.
  Check: when the report marks a slug SKIPPED, return `skipped` before the dirty check (a SKIPPED
  repo was never edited by the roll, so its dirt is not the roll's); and add a fixture repo that is
  dirty-and-SKIPPED so the gate is shown to pass it. Note also that `-uall` counts untracked files,
  so any repo with an unignored scratch file or build output reads `in progress` from the start.

- **`src/roll.js` line 216–226: any commit since `startedAt` is taken as the roll's commit, so
  `status` and `finish` report work the tab never did.** `rollCommit` returns the newest commit
  whose author date is ≥ `startedAt` *or* whose subject carries the brief's line. Reproduced three
  ways: (a) the owner commits and pushes an unrelated change during the roll, no report line →
  `pushed 357055e` with subject `owner: unrelated change`, and finish passes it; (b) the same brief
  re-run next week: last week's `chore: adopt the shared formatter` commit, dated before this roll's
  `startedAt`, → `pushed`, so a second sweep passes every repo without touching one; (c) the tab's
  real commit followed by an owner commit → the sha in the table is the owner's, not the roll's.
  The plan's wording ("subject contains the brief's commit subject line **or** author date ≥
  startedAt") is what was built, so this is a plan gap as much as a code one; the finish gate is
  where it bites. Check: require the subject when the brief has one (date alone only when it does
  not), and stop at the first commit older than `startedAt` when scanning by subject; report the
  matching commit, not HEAD. The test that would have caught (b) is the fixture's `initial` commit
  given the roll subject.

- **`src/commands/roll.js` line 109–124: a second `rig roll up` in the same workspace makes a
  second set of tabs with the same labels, and `down` on either roll closes both.** `rig up` skips
  ids that already have a tab (`have.has(id)`); `roll up` never asks. Reproduced with the stub
  herdr: a tab labelled `t1` already open (w7:t5, from another crew or from roll #1) → `up` creates
  another `t1`; `rig roll down` on roll #1 then closes w7:t5. Same day, same brief, the roll dir
  gets `-2` but the labels do not, so `status` on either roll shows the other's tab as live and
  `down` on the finished roll closes the running one. This is the label-pattern bug of 2026-09-15
  in a new coat: the ids are exact, but nothing makes them the roll's own. Check: before launching,
  refuse (or skip, as `rig up` does) when `term.listWindows(session, ids)` is non-empty, naming the
  tabs; and the template should say tab ids must be unique across the workspace (`t1`/`t2` is what
  every future brief will copy, and `c1`-style plan ids are already in use next door).

- **`src/roll.js` line 239–241 and `src/commands/roll.js` line 205–206: "report names every repo"
  is satisfied by the slug appearing anywhere, and hyphenated slugs match inside longer ones.**
  `namedIn` allows `-` before the slug, so `- home-care-visits: done` names `visits` and
  `care-visits` too (reproduced). Any mention counts: a report that says `- beacon: not started
  yet` passes this check, and a heading like `# t2 — beacon and lantern pending` passes it for
  both. The gate then rests entirely on `repoState`, which finding 2 shows can be fooled. Check:
  drop `-` from the leading class; better, parse report lines the way the brief specifies them
  (`- <slug>: done <sha>` or `- <slug>: SKIPPED — <reason>`) and fail a slug that has neither.

- **`src/roll.js` line 229–236: `skippedIn` marks a done repo SKIPPED when the word appears later
  on its line, and reads prose as a slug.** `- orchard: done abc1234 — SKIPPED the lint step, tests
  were red` → orchard skipped; `- Note: nothing was SKIPPED` → slug `Note`. The second regex
  (`\bSKIPPED\b` anywhere + leading word) is the cause. Harmless while `repoState` finds a commit
  first, but it is what finding 1's fix would lean on, so tighten it to `<slug>: SKIPPED` only.

- **`src/commands/roll.js` line 117–122 and the brief at `src/roll.js` line 187–188: the agent is
  started in the first repo only, and only that repo is pre-trusted.** `preTrust(cwd)` runs on
  `tabs[id][0].path`; the other repos in the list are never trusted, and Claude Code is launched
  with the first repo as its project root. The brief then tells the tab "Reading or writing anywhere
  else triggers a permission prompt", which is exactly what editing repo 2 will do: every write
  outside the project root asks. Not reproduced (no live Claude Code in the review), so treat as a
  check: pre-trust every repo in the list, and launch with `--add-dir <repo>` for each repo after
  the first (or run from the repos' common parent) so the tab can work its whole list unattended.
  On the Biome night the tabs were driven by hand; this is the difference between that and a roll.

- **`src/roll.js` line 201–207: a remote not named `origin` reads as no remote, so an unpushed
  commit passes the gate as `local only`.** Reproduced with the remote named `github`: commit not
  pushed → `local only` → finish PASS. Check `git remote` (any name) before deciding a repo has no
  remote, or say in the plan that `origin` is the only remote a roll knows.

- **`src/roll.js` line 122–125: the roll name carries the UTC date.** A roll started at 23:30
  Pacific on the 15th is `<brief>-2026-09-16`. Cosmetic, but the dir is what the lead types into
  `status` and `finish`; use the local date as `rig qa`'s history does.

- **For rg4, not a defect here:** `status` and `finish` accept `--no-fetch` (`src/commands/roll.js`
  line 158, 220) but neither the module's `USAGE` (line 26–33) nor the report's text for
  `bin/rig.js` mentions it.

## Hard rules

Nothing in the diff sends, deploys, spends or deletes. `down` closes only by the roll's ids (subject
to finding 3), `finish` jots only after every check passes and never touches the registry or an
issue, no worktrees are made or removed, `harness/**` is untouched, no dependencies were added, and
the fixture names are invented. No personal data in the tracked files.
