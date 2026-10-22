# Build report — r55w · Watching: peers report themselves, briefs say who acts

Items 5, 6 and 14 of docs/PLAN-5.5.md. Commits on `rig/r55w`: `ef60454` (the build and its tests),
`d150277` (review of r55g), and this report.

## What I built

- **Item 5: `rig tell`.** DONE. `rig tell <lead> "<one line>"` (or `rig tell "<line>"`, with the lead
  taken from config or RIG_LEAD) writes one file, `<inbox>/<lead>/<stamp>-<pid>-<rand>.md`. It writes
  to a dot-tmp name in the same directory and renames it into place, so no reader sees half a
  message. The format (`from:`, `at:`, a blank line, the text) matches the old bash `tell-lead`.
  The sender is RIG_AGENT_ID, else the slice id (the branch under `branchPrefix`), else
  CODEX_PERSONA, else `peer`. A lead name that looks like a path (`../x`) is refused.
- **Item 5: `rig inbox [<lead>] [--wait] [--deadline <min>]`.** DONE. It prints every new message,
  oldest first, and files each one under `read/`. With `--wait` it blocks until a message lands,
  using `fs.watch` plus a poll every 2 s (`RIG_INBOX_POLL_MS`, capped at 5 s). The poll covers
  filesystems that drop watch events, and `RIG_INBOX_WATCH=0` runs on the poll alone. While waiting,
  the watcher writes `<inbox>/<lead>/.watcher.json` (pid and deadline), so `rig up` can tell whether
  the lead is listening. Exits 0 on messages and 4 at the deadline (default 240 min, or
  `inboxDeadline`). On exit it prints the re-arm command.
- **Item 5: `rig job <pane> "<task>" [--expect <file>] [--deadline <min>] [--lead <n>] [--id <n>]`.**
  DONE. It replaces `codex-job`. It refuses a pane that is working, blocked or unknown before
  sending anything. It submits through `herdr agent prompt`, with the tell line appended to the
  task. Then it polls `herdr agent get` (every 2 s, capped at 5 s) until the pane has left idle and
  then reached idle, done or blocked, or until the deadline (default 90 min, or `jobDeadline`). It
  prints the state, the minutes, whether the `--expect` file is there and non-empty, BLOCKED when it
  is, and the pane's last 25 lines. It also watches herdr's `state_change_seq`, so a turn shorter
  than one poll still reads as "ran and finished" rather than "never started".
- **Item 6 and the tell line.** DONE. `src/brief.js` exports `tellLine(lead, id)` and
  `askTheLead(lead, id)`. Every slice brief (`briefFor`) and every roll tab brief (`tabBrief`) ends
  with a section headed "## Ask the lead, never the human". It says that a question left in your own
  pane reaches nobody, and that only a permission dialog, a go or a taste call go to the human. Its
  last line is the tell line. `rig up` and `rig brief` pass the lead into briefs. The house rule
  "put it in your report" now also says to ask the lead.
- **Item 5: `rig up` and the watcher.** DONE. `rig up` (dry run included) prints `lead inbox:
  <lead> (<dir>)`. Then it prints either "watcher armed: pid N, until HH:MM", or the exact background
  command `rig inbox <lead> --wait --deadline 240`. When no lead is named it warns. "When it can,
  starts": `rig up --watch` sets up the crew and then *becomes* the watcher. The lead runs it as a
  background job, and its exit on the first tell wakes the lead.
- **Item 14: refusals.** DONE. `templates/PLAN.md` gains `## Refusals`, a refusal → repair table
  with one example row and the `UI: none` way out. `rig up` warns when a plan's work has a UI over
  rules and the matrix has no filled rows. A filled matrix also goes into the briefs.

## The red I saw, check by check

Every control runs a **copy of the tree with the guard taken out** (the old behaviour swapped back
in). `brokenTree()` in each test file throws if the patch text is missing, so a control can never
quietly run the real code. All controls went red. One went VOID on the first run and I fixed it
(below).

`test/watch-job.test.js`: 13 passed, 0 void. Fake `herdr` on PATH, a node script with a scripted pane:
| Check | Made red by |
|---|---|
| exits 0 on working → idle, prints state, minutes, last lines | `idle` dropped from the stop states |
| exits 0 on done, expected file ready | `done` dropped |
| exit 6 when the expected file is empty | the size check replaced by `true` |
| exit 5 and BLOCKED when it stops blocked | `blocked` dropped (it then ran to the deadline) |
| **a pane that never finishes hits its deadline: exit 4, DEADLINE, 3–6 s for a 3 s deadline** | the deadline test replaced by `false` (it hung until killed) |
| a busy pane is refused, no prompt sent | the status guard removed (it prompted) |
| a blocked pane is refused | the same |
| an unknown pane is refused | the null guard removed |
| a turn shorter than one poll reads as finished | the `state_change_seq` test removed (exit 7) |
| a pane that never leaves idle is "never started", exit 7 | **first control was VOID**: I had broken the wrong line. The second control restores codex-job's behaviour (wait for working, then match idle at once, exit 0) and goes red |
| the task it sends ends with the tell line | the tell line no longer appended |
| **target: notices a pane going idle — 4566 ms (≤ 60000) · broken: 65000 ms** | the 5 s poll cap lifted, with a 10-minute poll asked for |
| default deadline 90 min, poll cap 5 s | the cap changed to 60 s |

`test/watch-inbox.test.js`: 21 passed, 0 void (2 targets):
| Check | Made red by |
|---|---|
| tell writes one file, from RIG_AGENT_ID, exact format | RIG_AGENT_ID ignored |
| sender order | the branch fallback returns null |
| inbox location order | the XDG step removed |
| a path as a lead is refused | the name guard removed |
| inbox prints oldest first, files under read/, skips dot-tmp writes in flight | the filter lets `.tmp` through |
| no lead → exit 2; RIG_LEAD is read | RIG_LEAD ignored |
| **target: `--wait` wakes after `rig tell` on the poll alone — 4694 ms (≤ 60000) · broken: 62000 ms** | the 5 s cap lifted with a 2-minute poll asked for |
| **target: with fs.watch on — 40 ms (≤ 1500) · broken: 4705 ms** | the watch turned off |
| `--wait` exits 4 at its deadline and removes its mark | the deadline test removed |
| a slice brief's last line is the tell line | `askTheLead` removed from `briefFor` |
| no lead → the line leaves the name out | `null` printed into it |
| a roll tab brief ends with the tell line | `askTheLead` removed from `tabBrief` |
| briefs state item 6 outright | the sentence replaced |
| `rig up` prints the exact watcher command | the dry-run print removed |
| RIG_LEAD names the lead; with neither, a warning | RIG_LEAD ignored |
| `rig up` says when a watcher is already armed | `watcherState` always null |
| `rig up --watch` waits and exits on the first tell | the `--watch` branch removed |
| **`rig up` warns on a missing refusal matrix, naming why** | the warning call replaced with null |
| a filled matrix or `UI: none` silences it; the template's own row does not | the template-row skip removed (the placeholder row then counted as filled) |
| no UI, or a UI with no rules, gets no warning | the rules requirement removed |
| a filled matrix reaches the brief, the placeholder row does not | the brief section removed |

`npm test` before I started: 16 files green. After: see the QA line below.

## QA

`rig qa ef60454 --run "npm ci --silent && npm run check"` (Biome, all 18 test files, the personal-data scan):
`rig qa: test exit 0 at ef60454`; the negative control (`npm run demo`): `rig qa: negative exit 0 at ef60454`.
(The first try, `--run "npm run check"`, exited 127 because the QA worktree has no node_modules
until `npm ci`.)

## Decided

- **Inbox location**: RIG_INBOX_DIR, then `inboxDir` in .rig/config.json (`~/` expanded), then
  `$XDG_STATE_HOME/rig/inbox`, then `~/.local/state/rig/inbox`. To keep the existing
  `~/.claude/inbox` layout, set `"inboxDir": "~/.claude/inbox"`; the default names no vendor. The file
  format is the old bash one, so both tools read each other's messages.
- **Lead name**: `lead` in config, else RIG_LEAD. Lead names are plain words (no `/`, no `..`).
- **`rig inbox` exits**: 0 for messages (or nothing new, without `--wait`), 4 for deadline, 2 for usage.
- **`rig job` exits**: 0 finished (idle/done, and the expected file is fine); 3 refused (unknown,
  busy, blocked, or the prompt was not taken); 4 deadline; 5 BLOCKED; 6 finished but the expected
  file is missing or empty; 7 never started (still idle with no state change 60 s after the prompt;
  `RIG_JOB_START_MS` changes it); 2 usage. BLOCKED outranks MISSING.
- **Polls**: 2 s by default for both, capped at 5 s in code (`RIG_INBOX_POLL_MS`, `RIG_JOB_POLL_MS`
  set them lower for tests; a higher value is clamped).
- **"When it can, starts"**: `rig up --watch`. A detached watcher would wake nobody: the lead is woken
  by the exit of a background job it started itself, so `rig up` either prints that job or becomes it.
- **The tell line**: `When you finish, get blocked or have a question, tell the lead, never the
  human: \`rig tell <lead> "<id>: done|blocked|question — <one line>"\``. With no lead it says
  `rig tell "<id>: …"`, and the lookup happens when the peer runs it.
- **Item 14 trigger**: (a) a UI, meaning a slice owns UI files (html/css/jsx/tsx/vue/svelte/…,
  `ui/ web/ pages/ screens/ components/ …`, not under test/ examples/ fixtures/), or the brief or a
  task says screen/page/form/button/dialog/modal/tap/click/UI, or there is a `UI:` line that is not
  `none`; and (b) rules, meaning the brief or a task says rule/refuse/reject/validate/permission/
  approve/allowed/forbid/blocked/limit/quota/eligible/disabled. A `UI: <anything>` line counts as
  both. `UI: none` (or `no`) silences it. The agents' own hard rules (What must not happen, Rules)
  do not count as rules the product enforces. A matrix counts once it has a table row or a
  `refusal → repair` bullet that is not all `<placeholder>`.

## For the lead

**Rig's own PLAN.md trips the item 14 warning** ("page" and "blocked" in the tasks). Rig has no UI
over rules, so add the line `UI: none` to PLAN.md. That file is yours.

**`src/commands/roll.js` (not mine)**: `tabBrief` takes a `lead` option and falls back to RIG_LEAD.
To use `lead` from config, pass `lead: cfg.lead` where roll.js calls `tabBrief` (line 121).

**USAGE for `bin/rig.js`:**
```
job:   rig job <pane> "<task>" [--expect <file>] [--deadline <min>] [--lead <name>] [--id <name>]
         exits 0 finished · 3 refused (busy, blocked, unknown) · 4 deadline · 5 BLOCKED
               6 expected file missing/empty · 7 never started
tell:  rig tell [<lead>] "<one line>"      (lead: "lead" in .rig/config.json, else RIG_LEAD)
inbox: rig inbox [<lead>] [--wait] [--deadline <min>]   exits 0 messages · 4 deadline
up:    … [--watch]   after setup, wait as the lead's inbox watcher (run it as a background job)
```

**README paragraph:**
> **Peers report themselves.** A peer that finishes, blocks or has a question runs
> `rig tell <lead> "<id>: done — <one line>"`, which is the last line of every brief. The lead keeps
> `rig inbox <lead> --wait` running as a background job (`rig up` prints the exact command, or
> `rig up --watch` becomes it). It wakes within seconds of a tell and files the message under
> `read/`. Inboxes live in `$XDG_STATE_HOME/rig/inbox/<lead>/` (`inboxDir` or RIG_INBOX_DIR to move
> them). To brief an agent that has no inbox hook, such as a Codex member, use
> `rig job <pane> "<task>" --expect <file> --deadline <min>`: it prompts only an idle pane and exits
> on idle, done, blocked or the deadline, with a different exit code for each. Briefs say it
> outright: ask the lead, never the human. Only a permission dialog, a go or a taste call go to the
> human. Plans with a UI over rules carry a `## Refusals` matrix (refusal → repair), and `rig up`
> warns when one is missing (`UI: none` silences it).

**Config keys added** (all optional): `lead`, `inboxDir`, `inboxDeadline` (min, default 240),
`jobDeadline` (min, default 90).

## Review

- My review of r55g is in `docs/review-r55g.md`. The main finding, confirmed by running it: any
  vendor name the table does not know counts as a second vendor, so `--vendor me --pass` passes the
  gate. r55g calls `tellLine(lead, id)` correctly at the end of both of its briefs.
- My diff is for r55u to review (`docs/review-r55w.md`).

## Shown

`rig up --dry-run` on a fixture plan with a claim form that "refuses claims over the limit":
```
the plan has a UI over rules and no ## Refusals matrix (it talks about "form" and "refuses").
  List every refusal a screen can hit and its repair: the field to fill, or the message naming who acts.
  A refusal with no repair is a dead end. No UI here? Add the line `UI: none` to the plan.

  e1  would branch rig/e1 from main, owning 1 pattern(s)

dry run — nothing created

lead inbox: lead  (<repo>/ib/lead)
  no watcher armed. Run this as a background job; it exits when a peer tells you something. Re-arm after each:
    rig inbox lead --wait --deadline 240
```
`rig tell` / `rig inbox --wait`, real run:
```
told boss (from r55w): …/boss/20261022T184132-355268-a1a2fe.md
=== r55w · 2026-10-22 18:41 · 20261022T184132-355268-a1a2fe.md ===
late

re-arm: rig inbox boss --wait --deadline 0.2
```

## Against the references

- Buildkite / Actions `timeout-minutes`: every wait (job, inbox) has a deadline and a distinct
  exit code for it. Beyond them, a pane that never starts is its own outcome (7), not a silent
  success.
- PagerDuty: every alert names who acts. BLOCKED says the permission dialog is the human's and
  anything else is the lead's, and the tell line names the lead.
- Anti-reference "a watchdog that only checks whether the process is alive": `rig job` reads the
  agent's state and its change counter, not whether the pane exists.
- Not yet as far as the references go: there is no escalation. A deadline exits and says so, but
  nothing re-pages if the lead ignores it.

## Left undone

- No real-herdr end-to-end run, by rule (no test touches a real pane). `herdr agent get` and
  `herdr agent prompt` were checked by hand against this machine's herdr for their JSON shape
  (`result.agent.agent_status`, `state_change_seq`), read only.
- `npm run check` on the second machine: the lead's step.
