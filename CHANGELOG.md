# Changelog

## 5.0.0 — briefs that aim high, bars you can measure, taste you can click

Rig 5.0 builds Steve Clarke's creative prompt into the tool. He shared it with one line, "Take what's
useful," and its argument is short: agents left alone make the average of everything they have seen,
sized to what a human team could ship. Exceptional work needs three things: the best work in the
world as the starting point, a brief packed with what the agent can't guess, and an agent that knows
it can go further than it thinks. Rig 4 briefs carried the files, the task and the hard rules. They
said nothing about the feeling, the references or the bar, and no check measured a number. It is a
major version because every brief now opens differently and the plan template has new sections.

### Every brief opens with the mindset block
- **Now:** slice briefs (`rig up`, `rig brief`), review briefs (`rig review`) and roll briefs
  (`rig roll up`) open with the same paragraph, word for word, once, before the first heading. It
  lives in `src/mindset.js` and nowhere else in `src/`.
- **Checked:** `test/brief-five.test.js`. Each control swaps the Rig 4 function back in.

### The parts of a brief an agent can't guess
- **Now:** the plan learns The feeling (or The one quality), The specialist, The best at this job
  (with Anti-references), The bar, Where we're starting from, Freedom, Tools, Budget and autonomy,
  and What to hand back. "What must not change" joins "What must not happen" as one list. Slice
  briefs carry them in that order, and `templates/PLAN.md` has them.
- `rig up` names a missing feeling, missing references or a missing bar, and says when the bar has no
  number. Warn, never refuse.
- **What went wrong on the way:** the placeholder rule took `answers in < 200 ms and fails > 1 time`
  for a template placeholder and dropped the bar from every brief without a word. That's the one
  line a bar is most likely to look like. A placeholder now hugs its brackets with words (`<the one
  command>`). `rig up` also names any line it strips that still holds a number.
- The review brief asks whether the bar is measured by a target check seen red, and how the work
  looks beside the references.

### A bar is a number, and a number is a check
- **Now:** `Suite#target(name, { measure, atMost, atLeast, unit, breaks, timeout })` prints the
  number beside its bar (`2 taps (≤ 3) · broken: 4 taps`). A broken run that stays inside the bar,
  or gives no number, is VOID. `countInput(page)` counts real taps, keys, gestures and ms through
  the harness's own input. `timeTo(fn)` times a bar like "found in under 10 s".
- **What went wrong on the way:** a measure that forgot `reset()` let the broken run inherit the
  first run's taps, so a break that changed nothing read as PASS. `target()` now resets every live
  counter before each run.
- **Checked:** `test/target.test.js`, with PASS, VOID, FAIL and a non-number each shown. The
  forgetful-counter case goes red with the old `check.js`.

### `rig taste`: recognition, not recall
- **Now:** a local rating board. References come from a folder of screenshots, from `--url`, or from
  the URLs under the plan's "The best at this job", captured headless at desktop and phone size; a
  URL that fails or answers 4xx/5xx is named and skipped. One reference at a time, five big rating
  buttons (or the number keys), an optional note, and no scrolling. A comps round shows the owner's
  own screen done three or four ways: a grid on desktop, and one at a time with A-D chips (tap or
  swipe) on a phone.
- Every answer is saved at once, and every round is kept. Notes flush on pagehide with keepalive,
  and fast taps are queued, never dropped. Every request carries the round's token behind Host,
  Origin and content-type guards. `--lan` is opt-in.
- `docs/TASTE.md` gets a table per round and a `## Principles` section. Slice briefs point at it.
  `rig brief <id>` re-shares it with a crew that is already building. The rig never commits it.
- **The bar, measured:** six references in 7 taps (≤ 7) at 1440×900 and 390×844, with real input
  and hit-tested targets. The broken run (no auto-advance, plus a Next button) took 13.
- **Checked:** `test/taste.test.js`, with every control seen red. The swipe test caught a swipe right
  being taken as the browser's back gesture.

### Smaller
- `goto()` clears its navigation deadline. Every suite that used it sat idle for the full 30 s
  timeout after its last check. `test/goto-timer.test.js` is a target: the process is gone within
  1 s of the browser closing, and Rig 4's race line lingers past it.
- Peers launch with `claude --model opus --effort medium`, as in 4.0.

## 4.0.0 — machine state stays on the machine

Rig 4.0 comes out of the morning after a build finished clean. The crew had merged, the finish gate
had passed on the exact sha, the tabs were closed, and a few hours later the repo's hygiene check went
red. A nightly sync had swept up the rig's own working files, among them a QA record full of
home-folder paths, and committed them. The repo had been set up before `rig init` learned to ignore
`.rig/`, and nothing in the rig ever looked again. It is a major version because the rig now changes
a clone's git settings on its own, and because peers launch on a different model by default.

### Machine state never reaches git
- **What went wrong:** `rig init` put `.rig/` in .gitignore, but a repo set up before it did, or never
  init'ed, had no such line and nothing noticed. A nightly `git add -A` sync then committed a finished
  build's `.rig/qa-history.jsonl`, home-folder paths and all, and the public repo's hygiene check went
  red. The same gap made every slice's `.rig/BRIEF.md` look like uncommitted work, so `rig down`
  refused without `--force`.
- **Now:** every write into `.rig/` (`qa`, `up`, `review`, `finish`, issues, config) makes git ignore
  it first, through the clone's own `info/exclude`: shared by every worktree, nothing to commit. State
  that was already committed is named on each run, with the `git rm --cached` command to untrack it
  (and a warning that `git commit -- <paths>` keeps a file tracked when it is still on disk).
- **Checked:** `test/rig-state.test.js`, four checks, each red with the old bare `mkdir` swapped back
  in; the first is also red with the old call sites restored, and a source scan fails if any command
  creates `.rig/` without going through `rigDir()`.

### Peers launch on Opus at medium effort
- The default launch string is `claude --model opus --effort medium` (it was Fable 5.1 at low effort).
  A project's `.rig/config.json` still overrides it.

### Smaller
- The decision-log lookup skips macOS's own `/usr/bin/jot`, which shadowed the log tool on PATH.
- Biome lint and format, and `npm run check` (lint, the suite, the personal-data scan) as one gate.

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
- **Now:** the QA worktree is per project and per run (`qa`, then `qa-2`, `qa-3`… while a
  the lock beside each, `qa.lock`, `qa-2.lock`…, holds a live pid), detached, reset and cleaned before the pin, and pinned to
  exactly the sha you named. `rig qa <sha>` always grades; it never asks you to clean up first.
  `--fresh` also removes ignored files (`git clean -x`), so `node_modules` reinstalls.

### Negatives after formatting
- **What went wrong:** a build's checks were shown red, then a formatter rewrote the tree, and the
  report called the new sha done on the strength of a red seen on the old one.
- **Now:** when the plan or `.rig/config.json` names a negative-control command, `rig finish` fails
  until that command is recorded green on the same sha it is grading. `rig qa <sha> --run "<tests>"
  --negative "<cmd>"` runs both in the same pinned tree and records each with its kind.

### A clean tree after npm test
- **What went wrong:** a test wrote a tracked fixture and left it modified. The next `rig qa` on the
  same tree graded a sha that no longer matched its commit, and nobody could say which file.
- **Now:** `rig qa` names every tracked file the run dirtied and resets it before the next run;
  `rig finish` fails while the QA tree is dirty.

### Issues opened and closed by the rig
- **What went wrong:** one GitHub issue per slice was the rule, and the lead opened and closed them
  by hand, late, or not at all.
- **Now:** `rig up` opens one issue per slice ("<id> <title>") when `gh`, its login and `origin`
  exist, records the number in `.rig/issues.json`, and puts it in the slice's brief. A plan entry
  that already says `Issue: N` is honoured, and an open issue with that title prefix is reused. `rig finish` closes them with the QA
  line, and only after every gate passed. `--no-issues` opens none.

### Registry and log
- **What went wrong:** the app registry file and the decision log were written by whoever
  remembered, so a finished build could be invisible to the next session.
- **Now:** `rig init` creates the registry file with `apps new <slug> "<Name>"` when `apps` is on
  PATH and stores the slug in `.rig/config.json`. `rig finish`, after a pass, runs
  `jot "[<slug>] …"` and `apps touch <slug>` and prints the `wrap` line; `wrap` runs only with
  `--wrap "<message>"`.
  Both are optional tools: without them on PATH the rig says so and moves on. `--no-desk` skips them.

### rig roll
- **What went wrong:** a change wanted across dozens of repos was three tabs with a pasted brief
  each, and the only way to know which repos were done was to open every one.
- **Now:** `rig roll up <brief.md>` launches one tab per repo list in the current workspace, writes a
  brief per tab, and `rig roll status` reads each repo itself: untouched, in progress, committed
  (sha), pushed, skipped. `rig roll finish` refuses until every repo is accounted for; `rig roll
  down` closes only this roll's tabs.

### Fixes
- **Per-project worktree dir.** Every project's worktrees lived under one `../.rig-worktrees`; now
  each project has `../.rig-worktrees/<repo dir name>`, and each QA run its own slot. A 2.0 config
  holding the old literal reads as unset and becomes per-repo; any other path is honoured as is.
- **Unborn HEAD.** `rig init --hook` in a fresh repo installed a guard that could not survive the
  first commit: it asked git for the current branch, and `git rev-parse --abbrev-ref HEAD` throws
  before a repo has one. Reproduced from the code, not seen on the night. The guard now reads the
  branch as "none" on an unborn or detached HEAD and says "first commit on an unborn branch: nothing
  to enforce yet".
- **`--staged` on main.** The hook refused a commit on the base branch itself, where no slice
  applies, and swept every worktree to do it. On a non-slice branch it now exits 0 without the sweep.
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
