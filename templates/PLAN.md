# {{PROJECT}} — build contract

One plan file. It is the contract, and it lives at the repo root so every agent reads the same copy.
A plan is a brief first and a slice list second.

## What it's for
<the job it does in the world, in one or two sentences — not the tech>

## Who uses it, on what
<who, and on what device: customers on their phones, staff on a tablet, the owner at a desk>

## What done looks like
<the screen you want to see, the number you want to read, the thing that happens — concrete>

## What must not happen
- <a hard rule every agent obeys, e.g. "Never claim an amount it can't back up.">
- <"Nothing is sent to a customer without the owner.">

## Where it lives
<existing or new project, public or private, local only / staging / live>

## Size and mode
<small (one agent) · medium (one builder plus a fresh-eyes reviewer) · big (a crew of slices)>

## Checks
<how "done" is proved: which suites, which must be shown to go red once, which screens get screenshots>
Negative controls: <the command whose failures prove the checks can fail, e.g. `npm run demo`; `rig finish` wants it green on the final sha>

## Rules

- You own the files listed under your id and **nothing else**. If you need a change in someone
  else's file, say so in your report — do not reach in. `rig guard` enforces this.
- Verify, then commit, then report. Never leave a verified step uncommitted: a usage-limit pause
  lands mid-task with no warning and the next session inherits your uncommitted tree.
- Your report goes in `docs/build-report-<your id>.md` and is committed with your work.
- Commit only your own paths: `git commit -- <paths>`.
- Never grade the shared tree. Numbers come from a QA worktree pinned to a commit:
  `rig qa <sha> --run "<tests>"`.
- A check that cannot fail measured nothing. Before you call something green, say what would
  make it red — and prove it by making it red once.
- Stop only what you started: never kill a server by name or free a port you don't own.
- Review: each slice is reviewed by another before merge (`rig review <id> --by <other>`). No slice
  merges without its review file on base.

## Agents

### c1 — <slice title>
Owns:
- src/<area>/**

Report: docs/build-report-c1.md
Issue: <optional: an existing GitHub issue number; leave the line out and `rig up` opens one>

Task:
<what this agent is building, in enough detail that it does not have to guess>

### c2 — <slice title>
Owns:
- src/<other-area>/**

Task:
<...>

## Open questions
<things nobody should decide alone>
