# Review of r55w at ef60454 (by r55u)

Read-only, findings only. Scope: `git diff main...ef60454` (src/inbox.js, src/commands/{tell,inbox,job,up,brief}.js,
src/herdr.js, src/brief.js, src/plan.js, src/roll.js, templates/PLAN.md, test/watch-*.test.js). I ran each
finding below against the code at ef60454 (unpacked with `git archive`), not just read it.

## 1. `rig up` warns "no ## Refusals matrix" on this plan, a CLI with no screens (medium)
`refusalsGap(parsePlan(PLAN.md))` at ef60454 returns `it talks about "page" and "blocked"`. The "page" is
in r55u's task ("a not-ready page is retaken"); "blocked" is everywhere in a plan about watching
peers. So the very next `rig up` of Rig 5.5 tells the lead its CLI plan lacks a refusal matrix. A
warning that fires on the plan it shipped in teaches the lead to skip warnings, and that includes the real one.

Repro: `node -e "import('./src/plan.js').then(({parsePlan,refusalsGap})=>console.log(refusalsGap(parsePlan(require('fs').readFileSync('PLAN.md','utf8')))))"`

The trigger takes any UI word and any rule word anywhere in the prose and tasks. Both lists hold
words that are common in plans with no screen (page, blocked, limits, allowed, rules, approve).
Possible repairs, your call: count a UI only from owned UI paths or an explicit `UI:` line, and use
words only as a second signal; or require the UI word and the rule word in the same sentence; and add
this PLAN.md (or a copy of it) as a no-warning fixture in `test/watch-inbox.test.js`. That fixture
would have caught it.

## 2. `rig inbox` is not oldest first within the same second (medium)
`tellMessage` names files `<YYYYMMDDTHHMMSS>-<pid>-<6 hex random>.md` and `pending()` sorts by name.
Two tells in the same second from the same process (or from two peers) sort by the random suffix.
Measured: 103 of 200 same-second pairs ("first", then "second") came back reversed through `takeAll`.
"done", then "correction: blocked" a moment later is exactly the pair a lead must read in order,
and the doc comment and the check name both promise oldest first.

The check `rig inbox prints every new message oldest first` passes because its messages are written
seconds apart (or happen to sort right). Repair: add milliseconds plus a per-process counter to the
stamp (e.g. `…T184759.123-<pid>-<seq>`), or sort by an `at` with milliseconds. Make the check write
two messages back to back in one process and assert the order, run enough times that a random
suffix would fail it.

## 3. Mixed old and new tell paths lose messages silently during the switch (low, a note)
The bash `tell-lead` this build is using writes to the old inbox layout; `rig tell` defaults to
`$XDG_STATE_HOME/rig/inbox` or `~/.local/state/rig/inbox`. A lead whose watcher is `rig inbox` while a
peer still runs `tell-lead` (or the other way round) never sees the message, and nothing says so. `rig
up` does print the inbox directory, which helps. Consider: when `inboxDir` is unset and the default dir
does not exist, say once that a pre-existing layout can be kept with `"inboxDir"`, without naming one.
This needs no vendor name in the default. If you leave it as is, a line in the release notes covers it.

## 4. Smaller things
- `rig tell` drops every argument that starts with `--` (`words = args.filter(a => !a.startsWith('--'))`),
  so `rig tell lead "--no-vendor was needed"` sends `""` or the wrong text. Only known flags should be
  filtered, as `rig inbox` already does with its `valued` set.
- `rig job --expect <file>` resolves a relative path against the lead's cwd, but the member writes it
  in its own worktree. Either say "absolute path" in the usage, or resolve it against the pane's
  worktree when known.
- `rig up --watch` is new behaviour, but `bin/rig.js` USAGE for `up` does not list it. That file is the
  lead's, so put the line in your report.
- The check `the default deadline is 90 minutes and the poll is capped at 5 s` greps the source
  (`/cfg\.jobDeadline \?\? 90\)/`). A reformat can turn it red, and a wrong default reached another way would leave it green.
  Measuring the poll (as the deadline check already does with `r.ms`) would be a check that cannot lie.

## What holds up
- Atomic write (dot-tmp, then rename) and take-by-rename: two readers never double a message. I read the
  code; I did not stress-test it.
- `rig job` refuses a working or blocked pane before sending, and reads `state_change_seq` so a short
  turn is not "never started". Its exit codes are distinct and documented, and the deadline check measures the time.
- Every brief, and the roll tab brief, ends with the tell line, and the "ask the lead, never the human" block
  names the three things that go to the human.

## Verify
I'll verify the fixes for 1 and 2 when they land: the plan fixture gives no warning, and the same-second order holds over many runs.

## Verified at 44d006c (2026-10-22, by r55u)
Read `git diff ef60454 44d006c -- src/`, covering 5acc1e1, 9a1c4f2 and 44d006c. Ran `test/watch-inbox.test.js` (27 passed,
0 void) and `test/watch-job.test.js` (19 passed, 0 void) at 44d006c in a detached worktree, plus my
own repros against the same code.

| finding | verdict | how I checked |
|---|---|---|
| 1. refusal warning on this CLI plan | **fixed** | `refusalsGap` on PLAN.md at 14a1ad6 and at main: `null` (was `it talks about "page" and "blocked"`). A UI over rules still warns: a slice owning `web/**` that "approves or rejects" does; so does "a claim form that refuses claims over the limit" in one sentence, and a `UI: web` line. A CLI that "rejects" messages does not. r55w's check reads PLAN.md from git at 14a1ad6. |
| 2. same-second order | **fixed** | My repro (two tells in one process, 200 pairs): 0 reversed at 44d006c, 119 of 200 at ef60454. Two separate `rig tell` processes back to back, 20 runs: 0 reversed. Names carry milliseconds and a per-process counter. The new control (44d006c) names messages newest-first from the clock, so it no longer passes on a machine whose pids run past 1,000,000. |
| 3. old and new tell paths | **addressed** | A fresh default inbox prints one note that `inboxDir` can keep an existing folder; it names no other tool's folder. It shows in `rig tell`, `rig inbox` and `rig up`. |
| 4a. `rig tell` dropped `--` text | **fixed** | `rig tell lead "--no-vendor was needed"` is read back as exactly that. |
| 4b. relative `--expect` | **fixed** | Resolved against the pane's cwd as herdr reports it (`foreground_cwd`, else `cwd`). The check passes. |
| 4c. `--watch` missing from USAGE | **handed to the lead** | It is listed in r55w's build report, since `bin/rig.js` belongs to the lead. |
| 4d. source-grep check | **fixed** | Replaced with measured checks: the default deadline as printed, and a 10-minute poll clamped and noticed within 6 s. |
| 9a1c4f2 (stale-status `rig job`, not mine) | **looks right** | A job now finishes only when `completion_seq` moves, when a new working is followed by a stop at a later seq, or when the seq moves by 2 or more and the pane is stopped. Its four new checks pass: late working after a stale done, no counter change at all, a stale bump with no turn (exit 7), and completion_seq without a working being seen. |

Left open, all low; none needs to block the merge:
- The one-sentence rule trades the false positive for a false negative. "Staff use a phone screen to log
  shifts. Shifts over 12 hours are rejected." gives no warning, because the screen and the rule are
  in separate sentences and no slice owns UI files. A plan like that usually owns UI paths, which the
  path rule catches. A `UI:` line covers the rest.
- Stamps are local time, so during the hour repeated when clocks go back, messages can sort out of order.
  A UTC stamp would close that.
- Two processes writing in the same millisecond sort by counter and then by pid, not by time. Two separate
  CLI runs can't land within one millisecond, so I'm only noting it.
