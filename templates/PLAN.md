# {{PROJECT}} — build contract

One plan file. It is the contract, and it lives at the repo root so every agent reads the same copy.

## Rules

- You own the files listed under your id and **nothing else**. If you need a change in someone
  else's file, say so in your report — do not reach in. `rig guard` enforces this.
- Verify, then commit, then report. Never leave a verified step uncommitted: a usage-limit pause
  lands mid-task with no warning and the next session inherits your uncommitted tree.
- Commit only your own paths: `git commit -- <paths>`.
- Never grade the shared tree. Numbers come from a QA worktree pinned to HEAD (`rig qa`).
- A check that cannot fail measured nothing. Before you call something green, say what would
  make it red — and prove it by making it red once.

## Agents

### c1 — <slice title>
Owns:
- src/<area>/**

Task:
<what this agent is building, in enough detail that it does not have to guess>

### c2 — <slice title>
Owns:
- src/<other-area>/**

Task:
<...>

## Open questions
<things nobody should decide alone>
