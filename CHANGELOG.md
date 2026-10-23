# Changelog

## 5.5.0 — nobody waits blind

Lessons from a two-day build: stacked branches on a fast-moving upstream, a crew of agents, a
reviewer from a second model vendor, and a second test machine. The lead should never be the
human's alarm clock: every wait has a deadline, every peer reports itself, every number is measured,
and nothing called "ready" turns out stale an hour later. Built by a five-slice crew under the Rig
itself, every slice cross-reviewed early, every check seen red once and then green.

**The gate**
- `rig review --vendor <name> --pass "<what ran>"` records a second-vendor verdict on a sha;
  `rig finish` refuses without one on the final sha. A pass from the builders' own vendor (from
  `vendor` in the config, else the launch command) or from an unknown name is refused.
  `--no-vendor` turns it into a warning that FINISH.md repeats.
- Every review brief ends with "Ask these": what changes between a check and its use or delivery;
  time edges (DST, zones, exactly at the boundary); a state that flips off and back on; every
  feature flag off on every surface (UI, API, CLI, tool servers, jobs) with the old behaviour exact;
  a saved user preference overridden; and a negative test that would still pass if the thing
  happened twice.
- `rig fold` folds fix commits into their owning commits once, at the end. The folded tree must
  equal the old tip's, or the branch is put back. Every commit is walked on its own, and old → new
  shas are stamped in `.rig/fold.json`; after that, `rig finish` allows only message-only rewrites.
- `rig decision "<what>" --source <thread>` keeps `docs/DECISIONS.md`; `rig finish` lists every
  decision of the round and refuses while one is open.
- `rig finish` prints drift first, then gates on the second machine's tally (`qaHost`), the repo's
  own CI command (configured or detected) and the baseline's "0 new".

**Watching**
- `rig tell <lead> "<line>"` and `rig inbox <lead> --wait`: peers report themselves, and the lead
  wakes within seconds (60 s bar, measured). Every brief ends with the tell line and says outright:
  ask the lead, never the human. `rig up` prints the watcher; `rig up --watch` becomes it.
- `rig job <pane> "<task>" --expect <file> --deadline <min>` briefs an agent with no inbox hook and
  exits on idle, done, blocked or the deadline. It records the pane's state counters before the
  prompt, so a "done" left over from the last turn never ends the wait early (seen with the bash
  script this replaces: it exited after 0 minutes while the member was just starting).
- `rig qa` watches every run's output: no output for 5 minutes (`--stall`) names the worker and
  the last spec and stops the group. A run that keeps writing is never stopped.
- Runs are desktop-free by default: no display, and the clipboard tools fail at once. A spec that
  reached for one is listed "needs a stub", not as a new failure (`--desktop` opts back in).
- Every stage's wall time goes to `.rig/timings.jsonl`; `rig status --eta` prints medians of
  measured stages, or "no data".
- `rig up` warns when a plan with a UI over rules has no `## Refusals` matrix.

**Two machines and the baseline**
- `rig qa --host <ssh-host>` runs the same sha on a second machine: the commit travels as a git
  bundle over ssh (nothing pushed), into a checkout and a test DB name per session, and both tallies
  print side by side. Its first real run caught a macOS-only failure (a Homebrew tool shadowing the
  host's own) that the Linux machine never showed.
- `rig lease host:<h>|db:<name> --by <id>`: refused while someone else holds it, named holder and
  expiry; a host lease lives on the host, so sessions on two machines see one lease.
- `rig qa --baseline` runs the base with the same command and reports only new failures, listing
  known ones by where they fail. `--ci` runs the repo's own local CI command (`ciCommand`,
  `scripts.ci`, `bin/ci`, `script/cibuild`, `make ci`).
- `rig qa --repeat N --seeds <list>` reruns one file across seeds on both machines.

**Upstream**
- `rig status`, `rig fold` and `rig finish` start with drift: commits on the live base since the
  slice was cut, which owned files they touched, which are safe, and whether it still merges.
- `rig rebase <id>` stops before resolving when upstream deleted, moved or largely rewrote a file the
  slice changed, and asks the owner what upstream now covers (`--covered`, `--drop <sha>`).

**Tests that hold anywhere**
- Snapshot helpers in the test kit (`pin`, `snapshot`, `matchBaseline`, …): pinned user agent,
  locale, zone and modifier key, auto margins recorded as "auto", app-ready waits, retakes, and
  `RECORDED_FROM` baselines that `rig qa` flags when the base moves past them.

**Flake proof, used on itself**
- The rating board's suite went red only on a loaded machine: two of its checks held a 10 s
  budget, and under five parallel suites a passing board took 8.2 to 9.95 s. The budgets measured
  the machine, not the code. The checks now wait on the board's own state (counted steps, the
  frame the board moved on) instead of a wall clock. Proof with `rig qa --repeat 10`: 10 of 10 green
  under the crew's normal load, where the old suite ran within 50 ms of red, and the old suite red
  2 of 2 under a synthetic burn. The same was done for a watcher check that held a 6 s bar over a 5 s
  poll: it now measures the poll itself, and only the plan's 60 s bar stays end to end.

**Found by the real second machine and a real run**
- Host runs put the package manager's bin first on the host PATH, shadowing the host's own tools
  (macOS only). Fixed, with a check that runs on Linux too.
- The side-by-side tally counted FAIL lines printed by a control inside a passing check, and an
  unproven check as a failure. Only a FAIL is a failure now; unproven and void are named as such, and
  a count that disagrees with the exit is shown as unknown, never as a number.

**Notes for the next round**
- `rig fold` walks every folded commit with the whole test command, not each commit's own specs: a
  spec from an earlier commit that a later commit's behaviour makes stale only shows up that way.
- A peer whose background run ended can sit "done" without reading the result. A watcher that
  flags "done, nothing running in its worktree, no report since its last turn" after N minutes as
  "needs a nudge" is planned.
- A shared fixture that one example mutates leaks into later examples at some seeds only; review
  briefs now ask for a changed spec file to run at 3 seeds (`rig qa --repeat 3 --seeds`).
- After a rebase onto a moved base, every migration in the stack must be numbered above the base's
  newest, or a fresh schema load marks it applied without creating its tables and a regenerated
  schema file silently drops it. The walk should load each commit's schema into a blank database,
  as CI does, never migrate a long-lived dev database. `rig rebase` and `rig fold` will check both.

## 5.0.3 — every picture on the taste board opens full screen

- **What went wrong:** the owner rated four comps side by side on a 2560×1440 screen and could not
  see them: "the pictures are too small for me to see. need a way to zoom all the options up." A
  comp could only be selected, never enlarged, and a reference was only as big as the board left it.
- **Now:** one click opens any picture full screen. A reference's shot is a button with an Enlarge
  sign on it. Each comp has an **Enlarge** button under it, and clicking the comp already selected
  opens it too (on a phone, the comp shown is tapped). The viewer is a modal dialog on a dark
  neutral ground: the picture as large as the window allows (92% of 1440×900, 94% of the height at
  2560×1440, sized to its own shape so there is no letterbox), its letter or name in large type,
  big Back and Next buttons, ← → and a swipe to step through the comps or the references, a
  Desktop/Phone switch when a card has both (desktop first), the 1-5 buttons and the star. A rating
  there saves at once and moves on, as the board does: to the next reference, or the next comp
  still unrated. The number keys still rate, S stars, F opens the viewer from the board, and Esc,
  Close or the phone's back gesture returns to the board on the picture last shown. On a big
  monitor the controls grow with it. Nothing changed on the server.
- **Found on the way, fixed:** on a phone, a swipe to the next comp was also the browser's fling,
  and a tap within half a second of it only stopped the fling. Swiping to comp B and tapping 4 at
  once saved nothing (5.0.0 to 5.0.2). The board and the viewer now keep a one-finger swipe to
  themselves (not while pinched in), so the next tap always counts.
- **Checked:** `test/taste.test.js`, four new checks (36 in all), each with a control that must turn it red.
  At 1440×900 a real click on comp A's Enlarge opens it and the picture spans 90% of the window by
  elementFromPoint alone; → shows comp B, the 4 key saves 4 for B in ratings.json, the viewer moves
  on to C, and Esc gives the board back with "4 / 5" under B. Its control swallows Enlarge's click.
  On a phone a tap on a reference's shot opens it, the Phone switch, Next, a tap on 5 (saved), a
  swipe back and Close all work by touch; its control swallows the shot's tap. On a phone every
  viewer control is 44 px and in reach; its control keeps the controls on one row, which runs Next
  off the edge. Swiping to comp B and tapping 4 at once saves 4; its control leaves the swipe to the
  browser too, and nothing is saved. The existing reach and 44 px checks now include the Enlarge
  button. The same walk passes in WebKit, on an iPhone 14 profile with touch and at 1440×900.
  `docs/shots/` is regenerated, with `taste-viewer-desktop.png` and `taste-viewer-phone.png` added.
## 5.0.2 — a refused launch always says why, on every machine

- **What went wrong:** GitHub's runner went red on 5.0.1's port checks, though the second suite was
  refused every time. (1) When a launch is refused, `launch()` removes the profile it made. Chrome's
  helpers were still writing into it, so the removal threw "ENOTEMPTY … rig-chrome-…", and that
  error replaced the reason ("Port N is already in use"). A printout added to the check showed it.
  (2) The "told plainly" check required the [::1] wording, and that machine refused with the other.
  Hardening besides: if Chrome ever exits before its last stderr line is read, `launch()` would
  have blamed the install ("Chrome exited … Is it installed?") for a taken port. Real Chrome 155
  keeps running in that case, so this is guarded rather than seen.
- **Now:** a failed cleanup never replaces the reason a launch was refused. The profile removal is
  retried, and the profile always goes to the same detached cleaner the reaper uses, since a helper
  can write it back. After 'exit', `launch()` lets the stderr already on its way arrive (the
  stream's end, or 300 ms) before it blames the install. The check accepts either plain refusal; its
  control takes both guards out, so it is red with IPv6 loopback and without it.
  An unexpected refusal message is printed.
- **Checked:** `test/launch-port.test.js`, seven checks, two of them new, each run against a
  stand-in Chrome. One leaves a read-only folder in its profile and says the port is taken: it is
  refused for the port, and with the old cleanup put back it is red ("EACCES, Permission denied").
  The other exits at once and prints "Cannot start http server for devtools" 100 ms later from a
  child: it is refused for the port, and with the old exit handler put back it is red ("Chrome
  exited (1)"). The read-only check is skipped by name when run as root, where it could not go red.
  A fresh-eyes review: PASS, no defects; its five suggestions were taken except one (a 1.5 s retry on
  a failure path is fine).

## 5.0.1 — the rating board fits a phone, whatever the reference is called

- **What went wrong:** on the Mac, the night 5.0.0 shipped, `rig taste` at 390×844 laid out 409 px
  wide: the 5 and Done went off the right edge. `#app` is a grid with no column template, so its one
  `auto` column took the reference's whole file name as its minimum width before the name's ellipsis
  could apply. Apple's serif is wider than Linux's, so the Mac crossed 390 and Linux did not; a name
  long enough does it anywhere, an iPhone included.
- **Now:** `#app` has `grid-template-columns: minmax(0, 1fr)`. A long name ends in "…", and the board
  is exactly as wide as the screen on the Mac, on Linux, and in WebKit at iPhone 13 size.
  A long `--ask` question had the same bug (985 px on 5.0.0) and is fixed by the same line.
- **Checked:** `test/taste.test.js` opens a board whose reference has an 85-character name, then a
  comps round with a long question, at 390×844. Each must fit with nothing off screen, the header
  must end within the screen, and the name must actually be cut. The control puts the `auto` column
  back and goes red. Every fit check in the suite now also catches sideways overflow: before, the
  body's `overflow: hidden` clipped a too-wide board, so the page still measured 390. A fresh-eyes
  review measured every other view, at 390, 1440, 1800 and 2560 wide, and found them unchanged.

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
  and fast taps are queued, never dropped. An answer leaves the queue only when the board has it,
  and "Saved" shows only on an empty queue. Answers are ordered per tab by a counter, never by
  clocks, so a late older answer can't overwrite a newer one, and a phone with a slow clock still
  wins its re-rate. Every request carries the round's token behind Host, Origin and content-type
  guards. `--lan` is opt-in.
- **What went wrong on the way:** four rounds of review found a re-run wiping earlier ratings, a
  note lost when the tab closed, a hidden tab dropping a queued answer, and (from the first fix for
  ordering) a phone whose clock ran slow losing its re-rate under "Saved". Each one is now a test
  that goes red on the code that had it.
- `docs/TASTE.md` gets a table per round and a `## Principles` section. Slice briefs point at it.
  `rig brief <id>` re-shares it with a crew that is already building. The rig never commits it.
- **The bar, measured:** six references in 7 taps (≤ 7) at 1440×900 and 390×844, with real input
  and hit-tested targets. The broken run (no auto-advance, plus a Next button) took 13.
- **Checked:** `test/taste.test.js`, with every control seen red. The swipe test caught a swipe right
  being taken as the browser's back gesture.

### Two runs at once, each with a browser of its own
- **What went wrong:** the final QA of this release ran while a slice ran the same suite, and both
  asked the harness for debugging port 9352. The second Chrome found 127.0.0.1:9352 taken and took
  [::1]:9352 instead. `launch()` only checked that something answered on 127.0.0.1, so it drove the
  other run's browser. When the other run finished and closed it, eleven checks failed with "fetch
  failed". Boards those checks had opened stayed listening, so the suite never exited, and `rig qa`
  sat silent for three hours.
- **Now:** `launch()` defaults to port 0, so Chrome picks a free one. It reads the address Chrome
  says it listens on, and it refuses a fixed port that is taken (`Port N is already in use…`)
  instead of borrowing whatever answers there. That includes a runner without IPv6, where the
  refusal comes at once instead of after a 10 s wait blamed on the Chrome install. No suite pins a
  port any more. The taste suite stops every board it started, even after a failed check. `npm
  test` stops any file still running after 20 minutes (`RIG_TEST_TIMEOUT_MS`) and names it. `rig
  qa` stops a command still running after 60 minutes (`--timeout <min>`, `qaTimeoutMinutes`; a value
  that is not a number of minutes is refused, never read as "no limit") and records exit 124. It
  waits for the command's whole process group first, so nothing is still running in the worktree
  when the lock comes off. Zombies count as gone, so `rig qa` running as PID 1 in a container
  without an init stops in seconds, and the wait has a ceiling of 10 s that names anything still
  listed. Limits above 35791 minutes, which setTimeout cannot hold, are refused.
- **The harness, for callers:** a browser that a suite never closes no longer keeps the suite alive.
  The reaper kills it at exit and removes its profile. A page left open still holds the suite, as in
  Rig 4. `launch({ keepAlive: true })` keeps Rig 4's behaviour, for a script that leaves a window
  up for a person to look at.
- **What review caught in the fix:** fv2 found that a command behind a pipe that ignores SIGTERM
  (`node x | cat`) outlived the first version of the limit: bash died, the run answered 124, and the
  command kept running in a worktree the lock called free. fv2 also found `--timeout 10m` quietly
  meant no limit, and that neither new port guard had been shown to fail on its own. Its check of
  those fixes found the PID 1 hang, the setTimeout overflow (`--timeout 99999` stopped every run at
  once), and the profiles the reaper left behind. The lead's own deadline watch caught one more: a
  test of the fix whose cleanup threw, which left a browser holding the suite open.
- **Checked:** `test/launch-port.test.js`, five checks, each with its own control. Two suites
  launch together, the second opens a page, and the first closes: with the old `launch()` the
  second suite's page dies with the other run's browser. The address guard and the id guard are
  each taken out alone. A port held on every address must be refused by name within 5 s. A suite
  that never closes its browser must end, with that Chrome and its profile gone.
  `test/crew.test.js` runs the stubborn piped command against the limit, red with the first
  version's stop, and as PID 1 in an unprivileged PID namespace, where the kill-based wait lasts
  until the ceiling. `test/qa-finish.test.js` checks exit 124, the freed lock, nothing left running,
  six bad `--timeout` values refused, and 35791 accepted.

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
