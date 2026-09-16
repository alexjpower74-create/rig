# Build report — rg3 · `rig roll`: a cross-repo crew from one brief

Branch `rig/rg3`. Owns `src/roll.js`, `src/commands/roll.js`, `templates/ROLL.md`, `test/roll.test.js`.

## What was built — DONE

**`templates/ROLL.md`** — the brief-first shape for a roll: What it's for, What must not happen,
Procedure per repo (ordered), Commit subject (one line; how `status` recognises roll commits),
Report (`{tab}` placeholder), Repos (optional `slug = ~/path` overrides), Lists (`### <tab id>` then
one comma-separated line or bullets).

**`src/roll.js`** — pure apart from fs reads:
- `parseRoll(text)`: sections by heading; a slug in two lists, or twice in one, throws before anything
  resolves. An empty or missing `## Lists` throws.
- `resolveRepos(roll, { home, registryDir, projectsDir })`: `## Repos` override → registry
  `code:` field (`~/.claude/apps/<slug>.md`, frontmatter or bare) → `~/Projects/<slug>`. Every slug must
  be an existing directory; otherwise one error names every miss with the path it tried and how.
- `tabBrief(...)`: purpose, hard rules, resolved repos in order, the procedure, the commit discipline
  (clean tree first, tests recorded before touching anything, one commit per repo on the default branch
  with the brief's subject, push where a remote exists, `jot "[<slug>] …"` + `apps touch <slug>` after
  each push, never `wrap`/`sync`), the report path and format (one line per repo: done sha or SKIPPED).
- `rollStatus(rollDir)` / `repoState`: read from the repo, no memory. `missing` → `in progress` (dirty)
  → a roll commit (author date ≥ `startedAt` OR subject contains the brief's commit subject) →
  `pushed` if it is an ancestor of `origin/<default>` after `git fetch --quiet origin`, else
  `committed`; `local only` when there is no origin → `skipped` (report line `- <slug>: SKIPPED …`)
  → `untouched`.

**`src/commands/roll.js`** — `rig roll up|status|finish|down`, plus `--help`/`-h` anywhere prints usage
and returns before touching anything (rg4 also guards this in bin/rig.js).
- `up <brief.md>`: parse + resolve first (a bad slug stops the roll before a folder is made), then
  `<rollsDir>/<brief basename>-<date>/` (default `~/.rig/rolls`, `--dir` or `RIG_ROLLS_DIR` override;
  a second roll the same day gets `-2`), a copy of the brief as `ROLL.md`, `<tab>/BRIEF.md` per list,
  `roll.json` `{ brief, name, title, startedAt, commitSubject, tabs: { id: [{slug, path}] }, reports }`.
  Launch: one `terminal(cfg).newWindow` per list in the CURRENT workspace (cwd = first repo, label = tab
  id, command = `cfg.launch` + `"Read <rollDir>/<tab>/BRIEF.md and follow it."`); under tmux the first
  list opens session `rig-roll-<name>` and the rest are windows in it. `--no-launch`, `--dry-run`,
  `--launch "<cmd>"` as in `rig up`. Config comes from the enclosing repo when there is one, else
  DEFAULTS, so it runs from any lead pane.
- `status [<rollDir>]`: newest roll by `startedAt` when none given; per tab: live tab (●/○), agent
  state via `slicePanes`, report presence, then each repo's state and sha; WAITING ON YOU via
  `blockedPanes()`; exit 1 while any repo is `in progress`. `--no-fetch` skips the remote refresh.
- `finish [<rollDir>]`: `finishChecks` (exported, pure) → per tab: report exists, report names every
  slug; per repo: `pushed` / `local only` / `skipped` pass, anything else fails with the reason
  (`committed` names the remote branch it is missing from). Prints the roll-up table (slug, tab, state,
  sha), and only when every check passes writes `ROLL-FINISH.md` and shells out to `jot` with
  `[workflow] roll <name>: N pushed, M skipped, K local` via `tryRun` (absence recorded, never
  thrown). Prints the `wrap --none` line for the lead; never runs wrap.
- `down [<rollDir>]`: refuses over any `in progress` repo unless `--force`; closes only the roll's tab
  ids through `killSession(session, ids)` (herdr: exact labels, never a pattern); no worktrees to touch.

## What was verified, and the red I saw

`test/roll.test.js`, 21 checks under `harness/check.js`, every one with a `breaks` control. The
harness marks a check VOID when its control still passes, so a green run is itself the proof each
control went red. Two controls DID come back VOID on the first run and were fixed, which is the
point of the rule:
- "a slug in two lists is refused": my control edited the wrong `- kiln` line (the Repos override,
  not the list), so the duplicate remained and the check passed broken. Now the control adds a unique
  slug instead of the duplicate.
- "a commit dated before the roll is found by its subject": `git commit --amend` keeps the author date,
  so my re-dated commit was still found by date. Now `--reset-author` under a 2020 date, and the
  control strips the subject.

Per check, what made it red: parser → `## Lists` heading renamed; duplicate → unique slug instead;
Repos override → override line removed (falls to `~/Projects/kiln`, which does not exist); registry →
registry file removed; last resort → `projectsDir` pointed at an empty dir; unresolvable slug → the
folder created; untouched → an untracked file added; in progress → the file removed; committed → the
commit pushed; pushed → origin's `main` moved back one commit behind the rig's back (a stale tracking
ref would still say pushed; the fetch is what makes it red); subject-only → subject removed; local only
→ a remote added; skipped → SKIPPED line rewritten; finish-fails → everything made to pass; finish-passes
→ one slug dropped from a report (jot log then absent); no-jot-on-fail → a stale jot log planted;
launch → `HERDR_PANE_ID` moved to workspace `w9`, so zero `tab create --workspace w7` lines; brief
content → brief rewritten without procedure/repos; dry-run/help → a real launch run first; down by id →
roll.json cut to one tab (only one close); refuse-dirty → `--force` passed.

The launch check runs `rig roll up` as a child process with a stub `herdr` on PATH that logs every argv:
exactly two `tab create` lines, both `--workspace w7`, with `--cwd <first repo>` and `--label <tab>`,
no `workspace create` anywhere, and the `pane run` command reads `Read <rollDir>/t1/BRIEF.md and follow it.`
`HOME` is a temp dir so `preTrust` finds no `~/.claude.json` and writes nothing real.

Graded from the QA worktree, not this tree:

```
rig qa 28a3c1f --run "npm test && node test/roll.test.js"
rig roll: 21 passed, 0 failed, 0 void, 0 unproven
rig qa: exit 0 at 28a3c1f  — recorded in .rig/qa-history.jsonl
```

The 2.0 suite (38 checks + 10 node:test) is unchanged and green in the same run.
`tools/check-no-personal-data --self-test && tools/check-no-personal-data`: clean. No dependencies.

## For rg4 (bin/rig.js, README, CHANGELOG)

`COMMANDS.roll` line, verbatim:

```
roll    a cross-repo crew from one brief: rig roll up <brief.md> | status | finish | down (tabs in this workspace, one list of repos each)
```

USAGE for `rig roll --help` (also exported as `USAGE` from `src/commands/roll.js`; the module prints it
itself on `-h`/`--help` and creates nothing):

```
rig roll up <brief.md>   [--dir <rollsDir>] [--no-launch] [--dry-run] [--launch "<cmd>"]
rig roll status [<rollDir>]   (newest roll by default; exit 1 while any repo is in progress)
rig roll finish [<rollDir>]   every repo reported, clean and pushed; writes ROLL-FINISH.md; jots
rig roll down   [<rollDir>]   [--force]  closes only this roll's tabs; makes and removes no worktrees
```

`npm test` does not yet run `test/roll.test.js`; rg4's `test/run.js` picks up every `test/*.test.js`.
README "Roll: one brief, many repos": rolls live under `~/.rig/rolls/<brief>-<date>/` (override with
`--dir`, per the plan's open question), the brief template is `templates/ROLL.md`, and `status` reads
the repos, never a memory of what an agent said.

## Left undone / decisions taken

- `## Commit subject` is an addition to the brief shape the plan listed. Without it `status` can only
  go by author date, which an agent's back-dated or cherry-picked commit defeats. `up` warns when it
  is missing rather than refusing.
- The default branch on the remote is read from `refs/remotes/origin/HEAD`, else `origin/main`, else
  `origin/master`. The plan says `origin/main`; a `master` fleet would otherwise read every commit as
  unpushed.
- `status` under tmux shows window presence only (no agent state), same as `rig status`.
- Nothing outside my Owns list was touched. No review was requested yet (`rig review rg3` opens a tab;
  the plan's round-robin has rg4 reviewing rg3, which the lead schedules).
