# Changelog

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
