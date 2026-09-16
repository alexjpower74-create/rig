# Changelog

## 3.0.0 — the workflow's desk built in

Rig 3.0 comes out of the night the workflow got a desk: a registry file per app, a decision log, one
GitHub issue per slice, and a review before every merge. The same night a four-slice crew built a
family repo through the rig while three tabs rolled a linter out across dozens of repos from one
brief, and the lead spent the hours between hand-merging, hand-closing issues, hand-cleaning a QA
worktree another build had left behind, and forgetting to write the log line. Each of those chores
is now the tool's, and each way the night's numbers lied is now refused.

### Review before merge
- **What went wrong:** slices were merged on their author's word. Every real defect crossed a
  boundary between two agents' work, and the author's tests share the author's blind spots.
- **Now:** `rig finish` fails while a slice with code changes has no `docs/review-<id>.md` on base.
  `rig review <id> --by <slice>` writes the brief; the reviewer writes the findings; the gate reads
  them. `--no-review` turns the gate off for a run and says so in `docs/FINISH.md`.

### QA that never refuses
- **What went wrong:** `rig qa` used one worktree directory for every project on the machine, so a
  second build found it pinned to another build's sha, refused, and its numbers came off the shared
  tree instead.
- **Now:** the QA worktree is per project and per run, detached, and pinned to exactly the sha you
  named. `rig qa <sha>` always grades; it never asks you to clean up first. `--fresh` throws the
  old tree away before pinning.

### Negatives after formatting
- **What went wrong:** a build's checks were shown red, then a formatter rewrote the tree, and the
  report called the new sha done on the strength of a red seen on the old one.
- **Now:** when the plan or `.rig/config.json` names a negative-control command, `rig finish` fails
  until that command is recorded green on the same sha it is grading. `rig qa <sha> --negative
  --run "<cmd>"` records it.

### A clean tree after npm test
- **What went wrong:** a test wrote a tracked fixture and left it modified. The next `rig qa` on the
  same tree graded a sha that no longer matched its commit, and nobody could say which file.
- **Now:** `rig qa` names every tracked file the run dirtied and resets it before the next run;
  `rig finish` fails while the QA tree is dirty.

### Issues opened and closed by the rig
- **What went wrong:** one GitHub issue per slice was the rule, and the lead opened and closed them
  by hand, late, or not at all.
- **Now:** `rig up` opens one issue per slice ("<id> <title>") when `gh` and a remote exist, records
  the number in the plan, and puts it in the slice's brief. `rig finish` closes them with the QA
  line, and only after every gate passed. `--no-issues` opens none.

### Registry and log
- **What went wrong:** the app registry file and the decision log were written by whoever
  remembered, so a finished build could be invisible to the next session.
- **Now:** `rig init` creates the registry file with `apps new <slug> "<Name>"` when `apps` is on
  PATH and stores the slug in `.rig/config.json`. `rig finish`, after a pass, runs
  `jot "[<slug>] …"` and `apps touch <slug>` and prints the `wrap` line; `--wrap` runs it.
  Both are optional tools: without them on PATH the rig says so and moves on. `--no-desk` skips them.

### rig roll
- **What went wrong:** a change wanted across dozens of repos was three tabs with a pasted brief
  each, and the only way to know which repos were done was to open every one.
- **Now:** `rig roll up <brief.md>` launches one tab per repo list in the current workspace, writes a
  brief per tab, and `rig roll status` reads each repo itself: untouched, in progress, committed
  (sha), pushed, skipped. `rig roll finish` refuses until every repo is accounted for; `rig roll
  down` closes only this roll's tabs.

### Fixes
- **Per-project worktree dir.** Every project's QA tree lived in one directory; now each project has
  its own, and each run its own.
- **Unborn HEAD.** `rig init --hook` in a fresh repo installed a guard that failed the first commit,
  because there was no base to diff against. The guard now treats an unborn HEAD as empty and lets
  the first commit through.
- **`--staged` on main.** The hook refused a commit on the base branch itself, where no slice
  applies. It now checks only slice branches.
- **`--help` that creates nothing.** `rig qa --help` created a worktree, because the flag was read
  inside the command module after it had started work. Help is answered in the entry point before
  any command module is imported, for every command.
- **`npm test` runs every `test/*.test.js`** through `test/run.js`, in name order, stopping at the
  first failure. A new test file is picked up without editing `package.json`.

## 2.0.0 — the workflow built in

Rig 2.0 comes out of a night of fifteen builds run through it at once, and the written workflow
it was supposed to serve. Everything that went wrong that night is now either fixed in the tool or
refused by it.

### The workflow, built in
- **The plan is a brief first.** `rig init` writes a PLAN.md with the five parts of a good brief —
  what it's for, who uses it (on what), what done looks like, what must not happen, where it lives —
  plus size and mode, and the checks. `rig up` names any part still empty before it creates anything.
- **The hard rules reach every agent.** Each slice's brief now carries the plan's "What must not
  happen" rules word for word, above its task, along with the purpose and what done looks like.
- **The loop in every brief:** plan, build, prove (ask for the red), review, show, commit.
- **`rig review <id>`** writes a read-only, fresh-eyes review brief pointed at exactly that slice's
  diff and the plan's rules. `--by <slice>` for a cross-review, `--launch` for a new reviewer tab.
- **`rig finish`** is the done gate. It fails while a slice is unmerged, a tree is dirty, or the
  tests have not run green on the exact commit being called done, and it warns when a report shows no
  check made to go red, there are no screenshots, or the brief is incomplete. It writes
  `docs/FINISH.md`: what changed, the proof, the pictures, where it lives, the hard rules, what's owed.
- **`rig rule "<rule>"`** adds a learned rule to the project rulebook, once.
- **One rulebook.** `rig init` writes `AGENTS.md` and links `CLAUDE.md` to it.

### Fixes
- **Slice tabs are the plan's ids.** herdr tabs were matched by the pattern "one letter, then digits",
  so two-letter slice ids (`jr1`, `tw1`) were invisible to `rig status` and `rig down`, and a crew using
  `c1` could have closed another project's `c1`. Tabs are now matched against the plan's own ids, and
  the tab the rig runs in is never one of them.
- **`rig qa <sha>` pins that sha.** A bare ref was ignored and the worktree was pinned to the current
  branch. `--ref` still works and wins.
- **A red QA run can no longer exit 0.** The command runs under bash with `pipefail`, so
  `npm test | tail` fails when the tests fail, and a run killed by a signal exits 128 + the signal
  instead of 0. Every run is recorded in `.rig/qa-history.jsonl` with its sha and exit status.
- **Leftover branches start at base.** A `rig/<id>` branch left by an earlier build, with nothing
  unmerged on it, is moved up to base before its worktree is made. A branch holding unmerged commits
  is never moved; `rig up` reports it. `--keep-branches` turns the move off.
- **`rig down` stops what the build left running**, and only that: processes whose working directory
  is inside a worktree being removed. A dev server outliving its worktree used to keep its port.
- **`rig up --launch "<cmd>"`** chooses the agent command for one run without editing the config.
- **`rig up` flags a symlinked `node_modules`** in a worktree: an `npm install` inside it rewrites the
  checkout every slice shares. Run `npm ci` in the worktree instead.
- **`rig status` shows each agent's state** (working, idle, done, blocked) under herdr.

## 0.1.0

First release: plan-as-contract, file-owned slices, the guard, pinned QA worktrees, herdr and tmux,
and the negative-control harness.
