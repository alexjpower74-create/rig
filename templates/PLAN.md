# {{PROJECT}} — build contract

One plan file. It is the contract, and it lives at the repo root so every agent reads the same copy.
A plan is a brief first and a slice list second.

## What it's for
<the job it does in the world, in one or two sentences — not the tech>

## The feeling
<the one quality a person should feel in the first five seconds: "calm and sure", "fast as thought">

## The specialist
<who would do this best in the world, by trade: "a type designer", "an airline ops engineer">

## The best at this job
- <the best work anyone has done on this, by name and link: start there, then go past it>

Anti-references:
- <what this must never look or feel like, by name: the average it would drift to if left alone>

## The bar
<a number a check can go red on: "found in under 10 s", "3 taps at 390 px", "60 fps while scrolling">

## Who uses it, on what
<who, and on what device: customers on their phones, staff on a tablet, the owner at a desk>

## What done looks like
<the screen you want to see, the number you want to read, the thing that happens — concrete>

## Refusals
<every refusal a screen can hit, and its repair: the field to fill, or the message that names who acts>
A refusal with no repair is a dead end, and dead ends are the commonest defect a review finds. One row
per refusal. No screen, or no rules behind it? Replace this section with the line `UI: none`.

| Refusal (what is refused, where) | Repair (the field to fill, or who acts) |
|---|---|
| <"Submit" on the claim form: the amount is over the approved limit> | <the message names who acts: "Ask your approver to raise the limit"> |

## Where we're starting from
<what exists today, its commit, and what is wrong with it: the honest before picture>

## What must not happen or change
- <a hard rule every agent obeys, e.g. "Never claim an amount it can't back up.">
- <"Nothing is sent to a customer without the owner.">

## Where it lives
<existing or new project, public or private, local only / staging / live>

## Freedom
<what is theirs to decide (look, wording, structure) and the little that is not>

## Tools
<what they can use: the harness, which browsers, which screenshot tool, which data to seed>

## Size and mode
<small (one agent) · medium (one builder plus a fresh-eyes reviewer) · big (a crew of slices)>

## Checks
<how "done" is proved: the tests each slice's change touches, which must be shown to go red once, which screens get screenshots; plus ONE whole-suite run on the final sha>
Negative controls: <the one command whose run proves the checks can go red, e.g. npm run demo; rig finish wants it green on the final sha>

## Budget and autonomy
<how much usage to spend, and what to decide alone: everything with an established answer>

## What to hand back
<what lands at the end: green commits, a report with the red you saw, screenshots beside the references>

## Rules

- You own the files listed under your id and **nothing else**. If you need a change in someone
  else's file, say so in your report — do not reach in. `rig guard` enforces this.
- Verify, then commit, then report. Never leave a verified step uncommitted: a usage-limit pause
  lands mid-task with no warning and the next session inherits your uncommitted tree.
- Your report goes in `docs/build-report-<your id>.md` and is committed with your work.
- Commit only your own paths: `git commit -- <paths>`.
- Never grade the shared tree. Numbers come from a QA worktree pinned to a commit:
  `rig qa <sha> --run "<tests>"`.
- Test what you touched: run only the tests your change touches while you build. The lead runs the
  whole suite once on the final sha before merge, as the safety net. No repeated seeds or triple runs
  unless this plan asks for them.
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
