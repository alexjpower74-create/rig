# Rig 3.0 — the night's lessons built in

One plan file. It is the contract, and it lives at the repo root so every agent reads the same copy.
A plan is a brief first and a slice list second.

## What it's for
Rig runs builds where several Claude Code sessions work one repo at once, and it now has to run the
workflow Alexander adopted on 2026-09-15/16: a registry file per app, a decision log, one GitHub issue per
slice, review before merge, and crews that sweep many repos from one brief. Rig 3.0 makes each of those
the default, so the lead never hand-merges, hand-closes issues, hand-cleans the QA worktree or forgets to
jot, and so a build report cannot call a formatted tree done until its negative controls went red again.

## Who uses it, on what
Alexander's lead sessions (Onyx on Claude Code, Cobalt on Codex) on the PC and the Mac, under herdr, and
the Fable 5.1 peers those leads launch. Public repo: anyone running multi-agent builds with worktrees.

## What done looks like
- `rig up` names the slices, opens one tab per slice in the CURRENT herdr workspace, and, when `gh` and a
  remote exist, opens one GitHub issue per slice ("<id> <title>") and records the numbers. Each brief
  carries its issue number.
- `rig qa <sha>` never refuses: it always grades from a clean detached worktree pinned to exactly that sha,
  per project, that no other run is using, and it reports any tracked file the test run dirtied by name.
- `rig finish` fails while a slice is unreviewed (no `docs/review-<id>.md` on base for a slice that has
  code changes), unmerged, dirty, without a green QA on this sha, or, when the plan or config names a
  negative-control command, without that command recorded green on this same sha. It closes the slice
  issues with the QA line, runs `jot "[<slug>] …"` and `apps touch <slug>`, and prints the `wrap` line.
- `rig init` creates the registry file with `apps new <slug> "<Name>"` when `apps` is on PATH and the
  file is missing, and stores the slug in `.rig/config.json`.
- A first commit in a fresh repo with the guard hook installed succeeds.
- `rig roll <brief.md>` launches N tabs in the current workspace from a brief with per-tab repo lists,
  writes a brief per tab, and `rig roll status` shows per repo: untouched / in progress / committed
  (sha) / pushed / skipped, read from the repos themselves.
- `rig <cmd> --help` prints that command's usage and creates nothing.
- Version 3.0.0, CHANGELOG entry, README updated, the suite green with every new check shown red once,
  `check-no-personal-data` clean.

## What must not happen
- Never type into a running agent's pane; never open a new herdr workspace or a split pane for an agent.
- Never grade the shared tree; every number in a report names its sha.
- Never delete or move a worktree, branch, or file that holds uncommitted work; QA worktrees may only be
  reset when nothing in them is tracked-and-modified by a person (a test's leftovers are named and reset).
- Never close a GitHub issue, jot, or touch the registry unless every finish gate passed. Never run
  `wrap` or `sync` unless `--wrap` was passed. Never push, release, deploy or post.
- Never stop a process by name; only by working directory inside a worktree being removed.
- Keep `harness/**` unchanged; the public harness API is `suite`/`check`/`launch`/input/hittest as is.
- No dependencies. Node 22+. No personal data (no home paths, hostnames, emails) in tracked files.
- Do not edit files outside your Owns list; say so in your report and let the owner change them.

## Where it lives
Existing public repo ~/Projects/Rig (github.com/alexjpower74-create/rig, MIT), installed by `npm link`
and the Homebrew tap. Local build; the release and the tap update are the owner's call after `rig finish`.

## Size and mode
big: four slices, cross-review before the finish gate (each slice reviews the next one round-robin:
rg1→rg2→rg3→rg4→rg1), then the lead merges in order rg2, rg1, rg3, rg4.

## Checks
- `npm test` (rg4 makes it run every `test/*.test.js` through `test/run.js`; existing tests stay).
- Every new check uses `harness/check.js` `s.check` with a `breaks` control, or `node:test` with a paired
  known-bad case, and the build report says which check was seen red and how.
- Negative-control command for this repo: `npm run demo` must still print exactly one VOID and one FAIL
  from `examples/demo.test.js`; that is the repo's own "negatives went red" line for `rig finish`.
- `tools/check-no-personal-data --self-test && tools/check-no-personal-data` clean.
- Screenshots are not needed (CLI); `docs/FINISH.md` carries the console transcript of `rig finish` on
  the final sha instead.
- Dogfood: the lead runs `rig up --dry-run`, `rig qa <sha> --run "npm test"`, and `rig finish` from the
  3.0 tree on its own repo, and the transcript goes in docs/FINISH.md.

## Rules

- You own the files listed under your id and **nothing else**. `rig guard` enforces this. If you need a
  line in another slice's file (for example a new COMMANDS entry in bin/rig.js), write the exact text in
  your report under "For rg4" and carry on.
- Verify, then commit, then report. Never leave a verified step uncommitted. Commit only your own paths:
  `git commit -- <paths>`.
- Your report goes in `docs/build-report-<your id>.md` and is committed with your work.
- Numbers come from a QA worktree pinned to a commit: `rig qa <sha> --run "npm test"`. Until rg1 lands,
  the installed rig 2.0 is what runs; if its shared QA worktree refuses, say so and pin your own detached
  worktree by sha (as c3 did), naming the sha.
- A check that cannot fail measured nothing. Say what would make it red, then make it red once.
- `node:test` files are fine; `harness/check.js` suites are fine; no new dependencies.
- The 2.0 tests are the contract for behaviour you are not changing. If one has to change, say why in
  the report.

## Agents

### rg1 — QA hygiene and the finish gate
Owns:
- src/commands/qa.js
- src/commands/finish.js
- src/qalog.js
- src/worktrees.js
- src/desk.js
- test/qa-finish.test.js

Report: docs/build-report-rg1.md

Task:
**QA worktrees that never refuse.** Tonight `rig qa` refused checkout three ways: a tracked evidence log a
test wrote (`shared/app/gate/negative-control.log`), untracked files from `npm install` and gate
screenshots, and one run was killed mid-way because another slice re-pinned the one shared worktree.
Change `ensureDetachedWorktree` and `qa`:
1. The QA worktree for a run is `<worktreeBase>/qa` when free, else `qa-2`, `qa-3`… A run is "in use"
   when `<path>/.rig/qa.lock` holds a live pid (check with `process.kill(pid, 0)`); a stale lock is
   removed with a note. Write the lock before checkout, remove it after the run, on SIGINT/SIGTERM too.
2. Before pinning, clean: `git reset --hard` then `git clean -fd` (NOT `-x`: keep ignored `node_modules`,
   so a Playwright suite does not reinstall every run). `--fresh` adds `-x`. Print what was reset, by
   path, so a person sees "reset 1 tracked file: gate/negative-control.log (a test wrote it)". Refuse
   only when the worktree is not a QA worktree of this project (path not under worktreeBase or not
   detached) — never reset a slice or main checkout.
3. After the command exits, run `git status --porcelain` in the QA worktree. Record `dirtied: [paths]` in
   the qa-history entry. Print "the tests dirtied N tracked file(s): … — untrack it (git rm --cached) or
   have the test restore it; check-no-personal-data and `rig finish` see a dirty tree". This is the c2
   lesson: the tree must be clean right after `npm test`.
4. `rig qa --negative "<cmd>"` (or `cfg.negativeCommand`) runs a second command in the same pinned
   worktree and records `{kind: 'negative', sha, cmd, exit}`. `--run` entries get `kind: 'test'`.
   `lastQaOn(root, sha, kind = 'test')`; add `lastNegativeOn`.
5. `rig qa` inside a linked worktree still resolves the sha in the MAIN checkout (keep that).
6. `--help`/`-h` anywhere in args prints usage and exits 0 before touching git (rg4 also guards this in
   bin/rig.js; do both so the module is safe on its own).
**The finish gate.** In `finishChecks`, add gates, in this order after "merged":
- `<id> reviewed` — FAIL when the slice's branch changed any file outside `docs/` and
  `docs/review-<id>.md` is not on base, or is on base but older than the slice's last code commit
  (compare `git log -1 --format=%ct base -- docs/review-<id>.md` with the last commit on
  `base` that touched the slice's Owns globs; use plain log with pathspecs built from the globs,
  `:(glob)` magic). `--no-review` downgrades to warn and says so in FINISH.md. This is "review before
  merge by default": every slice tonight had real defects found only by cross-review.
- `negative controls red on <sha>` — when `cfg.negativeCommand` is set or the plan's Checks section
  mentions "negative", FAIL unless `lastNegativeOn(root, sha)` exists with exit 0 on THIS sha. A
  negatives run on the pre-format commit does not count, which is exactly the Biome lesson (four
  anchors silently went NOT RED after formatting; the sha changed, so the record must too). Detail text:
  "formatting moves the strings source-patching controls anchor on; re-run `rig qa <sha> --negative`".
- `QA left the tree clean` — FAIL when the recorded run has `dirtied.length > 0`, naming the files.
**Desk integration (`src/desk.js`).** Small shell-outs, each `null` when the tool is not on PATH:
`jot(text)`, `appsTouch(slug)`, `appsNew(slug, name)`, `ghIssueClose(root, number, comment)`,
`ghAvailable(root)` (gh on PATH, `gh auth status` ok, `git remote get-url origin` exists). Never throw
on absence; return `{ ran: false, why }`. On a passing `rig finish` (and only then):
- close each slice's issue from `.rig/issues.json` (written by rg2's `rig up`; shape
  `{ "<id>": { number, url } }`) with the comment "Finished: `<cmd>` exit 0 on `<short sha>` (rig finish)";
  skip and say so when gh or the file is absent, or the issue is already closed.
- `jot "[<cfg.slug || repo dir name>] <plan.title>: finished at <short>; <cmd> exit 0; <N> slices"`.
- `appsTouch(slug)`.
- print: `next: wrap <slug> "<one line>"` — and run it only with `--wrap "<message>"`. Crews may not run
  wrap (tonight's brief forbade it; the lead does).
Write these actions to FINISH.md under "Desk". `--no-desk` skips all of them. Tests in
`test/qa-finish.test.js` (node:test, temp repos like `test/workflow.test.js`): a tracked file written
by the test command is reset and reported; a second `rig qa` while a lock is live picks `qa-2`; a
negative run on the previous sha does not satisfy the gate, one on this sha does; an unreviewed slice
fails and `--no-review` warns; desk calls are exercised with a fake `PATH` holding stub `jot`/`apps`/
`gh` scripts that record their argv to a file, and shown NOT to run when a gate fails.

### rg2 — Plan, up, guard, init: issues, registry, unborn HEAD, per-project worktrees
Owns:
- src/commands/init.js
- src/commands/up.js
- src/commands/guard.js
- src/config.js
- src/plan.js
- src/brief.js
- src/issues.js
- templates/PLAN.md
- templates/AGENTS.md
- test/up-guard-init.test.js

Report: docs/build-report-rg2.md

Task:
**Per-project worktrees.** `DEFAULTS.worktreeDir` is `../.rig-worktrees`, shared by every repo under
~/Projects: tonight `rig qa` in the Rig collided with nl-apps' QA worktree at the same path. Change the
default to `../.rig-worktrees/<repo dir name>` (computed in `loadConfig` when the config has no
`worktreeDir`; an explicit value is honoured as is). `rig init` writes the resolved value into
`.rig/config.json` and stops gitignoring `.worktrees/` (it ignores `.rig/` only; say in the README note for
rg4 that the old entry is harmless). Tests: two temp repos side by side get different worktree bases.
**The guard on an unborn branch.** `guard` calls `currentBranch()` = `git rev-parse --abbrev-ref HEAD`,
which throws before the first commit, so the hook refuses the first commit of a fresh repo (reproduced
from the code; not in tonight's logs). Add `currentBranchOrNull` in config.js (tryGit; `null` when HEAD
is unborn or detached-without-branch); in guard, with no branch and `--staged`, print "first commit on an
unborn branch: nothing to enforce yet" and exit 0. Also: `--staged` with no slice context (the lead on
`main`) must NOT sweep every worktree — tonight that refused the lead's review-file commit on c3's
untracked node_modules. Rule: `--staged` always means "this checkout's index"; with no slice id it exits 0
with "not a slice branch; guard enforces slices only". The sweep stays for bare `rig guard` with no id.
Tests: a temp repo with the hook and no commits commits; `--staged` on main with dirty worktrees
elsewhere passes.
**Issues per slice.** `src/issues.js`: `openSliceIssues(root, plan, cfg)` — when `gh` is on PATH, `gh auth
status` succeeds and `origin` exists: for each slice without an entry in `.rig/issues.json`, search
`gh issue list --state all --search "<id> in:title" --json number,title,state` for an OPEN issue whose
title starts with `<id> ` (reuse it), else `gh issue create --title "<id> <title>" --body <task + owns>`;
record `{ number, url }`. Print one line per slice. Nothing when gh is absent ("no gh/remote: issues
not opened"). `rig up --no-issues` skips. `rig up` calls it after worktrees are made and before launch;
`briefFor` gets `ctx.issue` and prints "Your issue: #N <url> — the lead closes it at `rig finish`; put
what is waiting on a person there". Add `slug` to `DEFAULTS` (null) and `issues: true`.
**Registry at init.** `rig init` (and `rig init --slug <slug> --name "<Name>"`): slug defaults to the repo
dir name lower-cased and dashed; when `apps` is on PATH and `~/.claude/apps/<slug>.md` is missing, run
`apps new <slug> "<Name>"` and print its path with "fill in What it is / Where it stands / Next"; write
`slug` to config. Never run `apps` when the file exists. `--no-registry` skips. Tests use a stub `apps`
on a fake PATH and a fake `HOME`.
**Plan template and parser.** `templates/PLAN.md`: add under Checks a line `Negative controls: <cmd>` and
parse it into `plan.negativeCommand` (rg1 reads `cfg.negativeCommand || plan.negativeCommand`); add
"Review: each slice is reviewed by another before merge (`rig review <id> --by <other>`)" to Rules; add
`Issue:` as an optional per-slice line (number) that `issues.js` honours instead of creating. Keep every
existing heading regex in `briefFields` working (workflow.test.js is the contract).
**Keep the tabs in the current workspace.** Do not touch `src/herdr.js`; add a test in your file that
`terminal({terminal:'herdr'}).attachHint()` mentions "this workspace" and that `newTab` would pass
`--workspace <HERDR_PANE_ID's workspace>` (stub `herdr` on PATH recording argv, as terminal.test.js does).
**AGENTS.md template**: add "Review before merge: no slice merges without a review file on base" and
"After `npm test`, the tree is clean: a test that writes a tracked file untracks it or restores it".

### rg3 — `rig roll`: a cross-repo crew from one brief
Owns:
- src/commands/roll.js
- src/roll.js
- templates/ROLL.md
- test/roll.test.js

Report: docs/build-report-rg3.md

Task:
Tonight's Biome rollout was three tabs, each owning a list of repos, one brief, one procedure per repo,
one report per tab — and the Rig could not express it because it assumes one repo and file slices. Build
`rig roll`.
**The brief file** (`ROLL.md`, template in `templates/ROLL.md`, same brief-first shape): `## What it's for`,
`## What must not happen`, `## Procedure per repo` (ordered steps), `## Report` (where each tab writes),
`## Lists` with `### <tab id>` headings followed by one line of comma-separated slugs or one slug per
bullet. Repo folder resolution, in order: an explicit `slug = ~/path` line under `## Repos`, then the
registry `~/.claude/apps/<slug>.md` `code:` field, then `~/Projects/<slug>`; a slug that resolves
nowhere is an error before anything is launched. `src/roll.js` exports `parseRoll(text)` and
`resolveRepos(roll, { home, registryDir })`, pure apart from fs reads, and refuses a slug in two lists.
**`rig roll up <brief.md>`** (run from a lead pane): for each tab id writes
`<rollDir>/<tab>/BRIEF.md` where `rollDir` is `~/.rig/rolls/<brief basename>-<date>` (outside every
repo; a roll touches many repos and owns none), containing the purpose, the hard rules, the per-repo
procedure, the tab's list with resolved absolute paths, the commit discipline (one commit per repo, on
main, clean tree first, record the test result before touching anything, `jot "[<slug>] …"` and
`apps touch <slug>` after each push, never `wrap`/`sync`), and the report path. Launches one tab per
list in the CURRENT herdr workspace through `terminal(cfg).newWindow` with cwd = the first repo of the
list and label = the tab id, with the configured launch command + `"Read <BRIEF path> and follow it."`
`--no-launch` and `--dry-run` as in `rig up`. Under tmux, one window per tab. Writes
`<rollDir>/roll.json` ({ brief, tabs: { id: [ {slug, path} ] }, startedAt }).
**`rig roll status [<rollDir>]`** (defaults to the newest roll): per tab, per repo, read from the repo
itself, no memory: `untouched` (no commit since `startedAt` and clean), `in progress` (dirty tree),
`committed <short>` (a commit since start whose subject contains the brief's commit subject line or
whose author date ≥ startedAt), `pushed` (that commit is in `origin/main` after `git fetch --quiet`
when a remote exists; `local only` when none), `skipped` (the tab's report file lists the slug with
SKIPPED). Then the tab's agent state via `terminal(cfg).slicePanes(session, ids)` like `rig status`,
and WAITING ON YOU via `blockedPanes()`. Exit 1 while any repo is `in progress`.
**`rig roll finish`**: each tab's report file exists and names every slug in its list (done or SKIPPED
with a reason); every non-skipped repo is clean and its commit is pushed where a remote exists; prints
the roll-up table (slug, tab, state, sha) and writes `<rollDir>/ROLL-FINISH.md`; `jot "[workflow] roll
<name>: N pushed, M skipped, K local"` through the `jot` binary when present (no import from rg1's
desk.js: the file may not exist in your worktree; shell out yourself with `tryRun`).
**`rig roll down`**: closes only this roll's tabs (by the roll's tab ids, never a pattern — same rule as
slice tabs) after refusing over a dirty repo unless `--force`; touches no worktrees (a roll makes none).
Tests: parse a fixture in the shape of a rollout brief (write your own fixture text; do not copy the
owner's repo list or paths into the public repo), resolution order with a fake registry dir, duplicate
slug refused, status states from temp repos with a fake `origin`, and a launch under a stub `herdr` on
PATH proving one `tab create --workspace <home>` per list and none anywhere else. Show each red once.
For rg4: the `COMMANDS.roll` line is `roll    a cross-repo crew from one brief: rig roll up <brief.md> |
status | finish | down (tabs in this workspace, one list of repos each)`.

### rg4 — 3.0.0: entry point, per-command help, changelog, README, rulebook, test runner
Owns:
- bin/rig.js
- package.json
- package-lock.json
- CHANGELOG.md
- README.md
- AGENTS.md
- test/run.js
- docs/**

Report: docs/build-report-rg4.md

Task:
**bin/rig.js.** Add `roll` to COMMANDS (text from rg3's report; use a placeholder until it lands and
update when merged). Per-command help: when `args` contains `-h` or `--help`, print
`rig <cmd>  — <COMMANDS[cmd]>` plus a `USAGE` map you add here (one or two lines per command, listing
every flag the 2.0 and 3.0 commands accept: up `--no-issues`, qa `--negative`/`--fresh`, finish
`--no-review`/`--no-desk`/`--wrap`, init `--slug`/`--name`/`--no-registry`, roll's four verbs) and exit 0
WITHOUT importing the command module — `rig qa --help` created a worktree tonight. Bump the help
banner to say the 3.0 loop: plan, build, prove, review, show, finish (jot, issues, registry), ship.
**package.json.** `version` 3.0.0; `test` becomes `node test/run.js`; `test/run.js` runs every
`test/*.test.js` in name order as a child process with stdio inherited (harness suites and node:test
files both exit non-zero on failure), stops at the first failure, exits with it, and prints the list up
front; so rg1–rg3's new test files are picked up without editing package.json again. Keep `demo` and
`demo:watch`. `files` unchanged (templates/ROLL.md is under templates).
**CHANGELOG.md.** `## 3.0.0 — the workflow's desk built in`: one paragraph on the night (a four-slice
crew on a family repo, a linter rollout across dozens of repos in three tabs), then "Review before merge",
"QA that never refuses", "Negatives after formatting", "A clean tree after npm test", "Issues opened and
closed by the rig", "Registry and log", "rig roll", "Fixes" (per-project worktree dir, unborn HEAD,
`--staged` on main, `--help` that creates nothing). Every entry says what went wrong and what now refuses
it, in the 2.0 entry's voice; no home paths, no hostnames, no business names.
**README.md.** Command list updated (roll, new flags); new sections in the existing voice: "Review is
a gate, not a command", "The QA worktree is yours alone", "Formatters un-anchor negative controls",
"A test that writes a tracked file", "One issue per slice", "jot and the registry" (describe the
convention generically: a `jot` and an `apps` on PATH; the rig calls them when present), "Roll: one
brief, many repos". Keep "herdr or tmux" and say again that tabs land in the workspace the rig runs in.
Update "Why these rules and not others" with the new bullets.
**AGENTS.md (this repo's rulebook).** Add under Rules learned, dated 2026-09-16: review before merge;
re-run negative controls after any formatter, on the new sha; a test never leaves a tracked file dirty;
QA worktrees are per project and per run. Use `rig rule` for each so the format is the tool's own.
**docs/**: nothing beyond the build reports and FINISH.md; remove nothing.
Tests: `test/run.js` is exercised by running it (it is the runner); your report shows the transcript of
`rig qa --help`, `rig finish --help`, `rig roll --help` on a repo with NO plan and NO worktree, and
`git status` clean after, plus `npm test` stopping on a deliberately failing fixture file (added, run,
removed) as the red.

## Open questions
- Should `rig finish` also require the slice issue to hold at least one comment from the agent (what is
  waiting on a person), or is the report file enough? Default in this plan: report file is enough.
- `rig roll` writes briefs under `~/.rig/rolls/`; should that be `~/.claude/rolls/` so `sync` carries it
  to the Mac? Default: `~/.rig/rolls/`, overridable with `--dir`.
- Homebrew tap and the 3.0 release notes: owner's call after `rig finish`.
