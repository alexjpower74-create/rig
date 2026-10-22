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
