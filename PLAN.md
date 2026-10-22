# Rig 5.5 — the gate, watching, upstream and decisions, tests that hold anywhere

One plan file. It is the contract. The seventeen items, the bar and the checks are written out in
`docs/PLAN-5.5.md`: read that file whole before you start. This file adds the brief and the slices.

## The feeling
The lead never has to be the human's alarm clock. Every wait has a deadline, every peer reports
itself, every number is measured, and nothing called "ready" turns out stale an hour later.

## The specialist
- r55g works like a **release engineer who owns a merge queue**: a gate is a list of facts with a sha
  beside each, and "it passed on my machine" is not one of them.
- r55q works like a **CI infrastructure engineer** who has run flaky suites at scale: every run
  has a deadline, a baseline and a name for what hung.
- r55m works like an **SRE writing a runbook for a shared lab**: two machines, leases with an owner
  and an expiry, and a clock on every stage.
- r55u works like a **maintainer of a long-lived fork** of a fast-moving upstream: drift is known
  before the round, and a superseded commit is dropped, not resolved by hand.
- r55w works like an **on-call tooling engineer**: nobody waits blind, and every alert names who acts.

## The best at this job
- Merge gates: GitHub merge queues and required status checks; Bors ("not rocket science": test the
  merged result, not the branch); Gerrit's Verified +1 from a separate system.
- Watching: Buildkite agent timeouts and "no output for N minutes" kills; GitHub Actions
  `timeout-minutes`; PagerDuty escalation (every alert has an owner and a deadline).
- Upstream: `git merge-tree --write-tree`, `git range-diff`, `git rebase --update-refs`, Linux
  stable-queue practice of dropping patches upstream already carries.
- Flakes and baselines: pytest-rerunfailures with seeds, Jest `--seed`/`--randomize`, rspec
  `--seed` and bisect, "known failures" baselines in Chromium's test expectations.

Anti-references:
- A watchdog that only checks whether the process is alive.
- "0 new failures" typed by hand into a PR description.
- A lease that is a comment in a chat channel.
- A gate that can be passed by a review recorded on an older sha.

## The bar
- A stalled test run is caught and named in 5 minutes or less (default); a run that keeps writing is
  never stopped. Proven with a fake suite and a short configured window, and the default is 5 min.
- A peer finishing or blocking reaches the lead in 60 seconds or less: `rig job` notices an idle,
  done or blocked pane within 60 s, and `rig inbox --wait` wakes within 60 s of a `rig tell`.
- Drift is known before a final round: `rig status`, `rig fold` and `rig finish` print it first.
- `rig status --eta` prints only medians of measured stage times, and says "no data" when it has none.
- `npm run check` stays green (Biome, the full suite, the personal-data scan); every existing test
  passes, changed only where a new gate makes an old fixture incomplete (say which, and why).

## Who uses it, on what
A lead session (Claude Code or Codex) driving a crew under herdr on Linux and macOS, with a second
machine reachable by SSH and a reviewer from a second model vendor. Public repo: anyone running
multi-agent builds with worktrees.

## Where we're starting from
Rig 5.0.3 plus two plan commits (main at 93a7a9d), plus the scaffold commit that registers the new
commands in `bin/rig.js` (stubs in `src/commands/{fold,decision,job,tell,inbox,lease,rebase}.js`)
and writes contract stubs: `src/drift.js`, `src/baselines.js`, `src/timings.js`, `src/lease.js`,
`src/remote.js`. Each stub's signature and JSDoc is the contract; its owner writes the body.
Today: `rig qa` runs one command in a pinned worktree with a hard timeout and records
`.rig/qa-history.jsonl`; `rig finish` gates on merge, review file, QA and negatives on the sha.
The lead's helper scripts `tell-lead`, `lead-inbox` and `codex-job` exist outside the Rig (bash);
their behaviour is described in item 5 and in the r55w task.

## What must not happen or change
- File-slice ownership, the QA worktree pinned to a sha, negative controls, the mindset block,
  `rig taste`, and herdr tabs in the current workspace.
- No new dependency: node, git, herdr, ssh only. No npm packages.
- No test touches the real clipboard, the real display, a real second machine or a real herdr pane:
  fakes on PATH (`ssh`, `herdr`, clipboard tools) in temp dirs. Run suites with
  `env -u WAYLAND_DISPLAY -u DISPLAY`.
- No personal data in tracked files: no home paths, host names, emails, or names of people,
  companies or client repos. Examples stay generic. Run `check-no-personal-data` before you call
  it done.
- No AI credit anywhere: no Co-Authored-By trailers, no "generated with" lines.
- Every commit's author and committer is the repo owner's identity: use the commit prefix the lead
  gives you in your first message (the session's environment carries another address) and check
  `git log -1 --format='%an %ae / %cn %ce'` after each commit.
- Never push, tag or release. The lead merges, releases and publishes.
- Never type into another agent's pane. Never open a herdr workspace or split a pane.
- Do not edit files outside your Owns list. `bin/rig.js`, `README.md`, `CHANGELOG.md` and
  `package.json` are the lead's: put the USAGE text and README paragraph you want in your report.

## Freedom
Names of flags beyond those the plan fixes, file formats under `.rig/`, and module layout inside your
slice are yours. Where the plan doesn't settle a choice, decide it, write it under "Decided" in your
report, and carry on.

## Tools
Node 22, `node:test` or the harness (`harness/check.js`: `s.check` with `breaks`), Biome
(`npx biome check --write <your files>`), `npm run check`, `rig qa <sha> --run "npm test"`,
`rig review <id>`. Headless Chrome only through `harness/cdp.js` (RIG_CHROME), debugging port 9355
for r55u; existing tests use 9351 and 9352.

## Checks
- Every check in `docs/PLAN-5.5.md` "Checks" is a test that is seen red once (the old behaviour
  swapped back in, or the guard removed), then green. Your report says how each was made red.
- `npm test` runs every `test/*.test.js`. New test files are yours; existing ones only if listed in
  your Owns.
- Negative controls: `npm run demo`

## Budget and autonomy
Usage is finite: aim to finish your slice in one sitting, and spawn no sub-agents. Decide everything
that has an established answer yourself.

## Asking and reporting
A question left in your pane reaches nobody. Ask the lead, never the human:
`tell-lead rig55 "<id>: <question>"`. When you finish, or block, run
`tell-lead rig55 "<id>: <one line: done|blocked, sha, tests>"` as your last step. Only things that
need the human's own hands (a permission dialog) go to the human, and you still tell the lead.

## What to hand back
Green commits on your branch. `docs/build-report-<id>.md`: what you built, the red you saw for each
check and how, what you decided, the USAGE/README text for the lead, and what's left.

## Size and mode
Big: five slices. Cross-review EARLY, at each slice's first real commit, round-robin: r55g reviews
r55q, r55q reviews r55m, r55m reviews r55u, r55u reviews r55w, r55w reviews r55g. Write findings to
`docs/review-<reviewee>.md` in your own worktree and commit it. The finder verifies the fix. The lead
merges in the order r55m, r55u, r55w, r55q, r55g.

## Contract between slices
- **r55m → everyone:** `src/timings.js` (`recordTiming`, `readTimings`, `estimate`), `src/lease.js`
  (`acquire`, `release`, `holderOf`), `src/remote.js` (`runOnHost`), with the signatures in the
  stubs. Leases on a host must hold across machines and sessions, not just in one repo's `.rig/`.
- **r55u → r55g, r55q:** `src/drift.js` `drift(root, opts)` and `src/baselines.js`
  `staleBaselines(root, opts)`, with the shapes in the stubs.
- **r55q → r55g:** records in `.rig/qa-history.jsonl` keep today's fields and add: `host`
  (`'local'` or the ssh host), `kind: 'ci'` for the repo's own local CI command (3b), `baseline`
  (`{ base, baseSha, newFailures: [name], known: [{ name, where: 'here'|'there'|'both' }] }`),
  `stalled` (`{ worker, spec, quietMs }` when the watchdog stopped it), `needsStub` ([spec]), and
  `repeat` (`{ n, seeds, failedSeeds }`). The config keys are `qaHost` (ssh host or null) and
  `ciCommand` (or detected, r55q decides how and documents it).
- **r55g reads those:** finish needs a local test pass on the sha, the same on `qaHost` when it is
  set, the CI command's pass (both machines when a host is set) when the repo has one, a
  second-vendor review pass on the sha, no open decisions, and it prints drift first.
- **r55w → r55g:** nothing in code. `rig up` and every brief end with the `rig tell` line.

## Agents

### r55g — The gate: second vendor, one fold, decisions, finish
Owns:
- src/commands/finish.js
- src/commands/review.js
- src/commands/fold.js
- src/commands/decision.js
- src/fold.js
- src/decisions.js
- src/vendor.js
- test/qa-finish.test.js
- test/workflow.test.js
- test/gate-*.test.js
- docs/DECISIONS.md
- docs/review-r55q.md
- docs/build-report-r55g.md

Task:
Items 1, 2 and 13 of docs/PLAN-5.5.md, and the finish side of 3, 3b, 4 and 11.

1. `rig review --vendor <name> --pass "<what ran>"` records a second-vendor pass on the current
   sha of the base (`--sha` to name another) in `.rig/`, with the time it took when given
   (`--ms`, else since the review brief was written) via `recordTiming(stage 'review')`. The
   builder's vendor comes from `vendor` in the config, else from the launch command (claude →
   anthropic, codex → openai). A pass from the same vendor is refused with a message saying why.
   `--fail "<what it found>"` records a failing verdict; the newest verdict on the sha wins.
2. `rig fold [--base <ref>]`: fix commits (subject starting `fixup!`/`squash!`, or listed with
   `--fix <sha>`) fold into their owning commits with an autosquash rebase run non-interactively.
   Then: every commit walked (each checked out in a scratch worktree and the configured test or
   `--each "<cmd>"` command run, exit recorded), the folded tip's tree compared to the old tip's tree
   (which already contains the fixes) and refused unless `git diff` is empty, and the new shas
   stamped in `.rig/fold.json` (old → new). A fold that drops a hunk is refused and the branch is
   put back. Drift (`drift()`) is printed first. Timing recorded as stage 'fold'.
3. `rig decision "<what>" --source <transcript|thread>` appends to `docs/DECISIONS.md` (id, date,
   what, source, status open). `rig decision <id> --built|--scheduled <round>|--not-in-scope`.
   `rig finish` lists every decision since the round started (the oldest slice branch point, or
   `--since <ref>`) and fails while any is open.
4. `rig finish` gains gates: second-vendor pass on this sha (`--no-vendor` downgrades to a warning
   and FINISH.md says so); host tally on `qaHost` when set; the CI command's result (r55q's `ci`
   records) on both machines when it ran; open decisions; baseline "0 new" shown when recorded.
   Drift is printed before the gates.
Checks (each red once): finish refuses without a vendor pass, without the host tally when
configured, with an open decision; a same-vendor pass is refused; a fold that drops a hunk is
refused by the tree check. Existing finish fixtures that now lack a vendor pass get one added:
list each in your report.

### r55q — QA that cannot hang, lie, or touch the desktop
Owns:
- src/commands/qa.js
- src/qalog.js
- src/qa/**
- test/qa-*.test.js
- docs/review-r55m.md
- docs/build-report-r55q.md

Task:
Items 3b, 4, 7, 8, 16, and the `rig qa` side of 3, 9 and 15.

1. **Stall watchdog (7).** While a command runs, watch output growth per worker: the command's own
   output, plus per-worker logs when `qaWorkerLogs` (a glob) is configured. No growth for
   `qaStallMinutes` (default 5) names the worker and the last spec it mentioned, stops the whole
   process group (reuse `groups.stop`), records `stalled`, and exits non-zero with a message that
   names both. Output must still reach the terminal live.
2. **Desktop-free (8).** By default the command runs with DISPLAY and WAYLAND_DISPLAY unset and a
   shim dir first on PATH holding `xclip`, `xsel`, `wl-copy`, `wl-paste`, `pbcopy`, `pbpaste` that
   fail fast and log the call. Specs whose failure coincides with a shim call are listed as
   "needs a stub" (`needsStub`), not new failures. `--desktop` opts back in.
3. **Baseline (4).** `rig qa <sha> --baseline [<base>]` also runs the same command on the merge base
   (or `<base>`) in a second pinned worktree, parses failure names (node:test, TAP `not ok`, the
   harness's `FAIL  <name>`, rspec `rspec ./path:line`, Playwright; add a `qaFailurePattern` regex
   option), and reports only new failures, with known ones listed by where they also fail (here,
   there, both, when a host ran too). "0 new" is computed from both runs.
4. **Local CI (3b).** When the repo defines a local CI command (`ciCommand` in config, else a
   detection rule you choose and document, e.g. `scripts.ci` in package.json or an executable
   `bin/ci`), `rig qa` runs exactly that command and records kind `ci`, on both machines when a
   host is set. Record a "CI passed" status the command posts when it can be read (decide; say).
5. **Second machine (3).** `rig qa <sha> --host <ssh-host>` (or `qaHost` in config) runs the same
   command there through r55m's `runOnHost`, under a lease (`acquire(root, 'host:<h>', session)`),
   and prints both tallies side by side. A held lease is refused with the holder's name.
6. **Repeat (16).** `rig qa <sha> --repeat N --seeds [<list>] --run "<one file>"`: N runs with a
   seed each (exported as `RIG_SEED`, plus `--seed` passing for known runners: say which), on both
   machines when a host is set; reports N green or names the failing seeds. Listed seeds always run.
7. **Timings (9) and baselines (15).** Every stage's wall time goes to `recordTiming` (stages
   `qa:test`, `qa:negative`, `qa:ci`, `qa:host`, `qa:baseline`). `rig qa` warns when
   `staleBaselines()` returns anything.
Checks (each red once): a fake suite that stops writing is stopped and named within the window; one
that keeps writing is not; "0 new" from two real runs in a fixture (and a new failure shown as new);
a spec calling a clipboard tool is listed "needs a stub" and the real tool is never reached.

### r55m — Two machines, leases, measured time
Owns:
- src/remote.js
- src/lease.js
- src/timings.js
- src/commands/lease.js
- test/machines-*.test.js
- test/fixtures/fake-ssh/**
- docs/review-r55u.md
- docs/build-report-r55m.md

Task:
Items 3 (the runner), 9 (the record and the estimate) and 10.

1. `runOnHost` (see stub): sends the commit with `git bundle` over `ssh <host>` (nothing pushed),
   into a checkout per session under a configurable remote dir (`qaHostDir`, default
   `~/.rig-qa/<repo>`), checks out exactly the sha, installs deps when the lockfile changed, runs
   the command with `RIG_TEST_DB=<repo>_<session>` (the per-session test DB name) and the same
   desktop-free env as local, streams output, honours `limitMs`, and returns the exit. An ssh
   failure is exit 255 with the reason, never a hang (ConnectTimeout, BatchMode).
2. Leases (10): `acquire/release/holderOf` for `host:<h>` and `db:<name>`. A host lease lives on the
   host (an atomic `mkdir` lock plus a JSON holder file over ssh), so two sessions on two machines
   see the same lease; a local db lease lives under the user's state dir, not a repo. Leases expire
   (`ttlMin`). `rig lease <resource> --by <id> [--release] [--ttl <min>]` prints the holder on refusal
   and exits 1.
3. Timings (9): `.rig/timings.jsonl` via `rigDir`; `estimate()` takes the median per stage, says
   "no data" for a stage with none and returns totalMs null then.
Checks (each red once): a second holder is refused (two sessions, a fake ssh host); a lease past its
ttl is taken over; `runOnHost` on a fake ssh (a script on PATH that runs the remote command in a temp
"host" dir) checks out exactly the sha and returns its exit, and an unreachable host returns 255
quickly; `estimate` medians are exact on fixture data and say no data on none.

### r55u — Upstream: drift, rebase, baselines that know their sha
Owns:
- src/drift.js
- src/baselines.js
- src/commands/rebase.js
- src/commands/status.js
- harness/snapshot.js
- harness/index.js
- test/upstream-*.test.js
- test/snapshot.test.js
- examples/snapshot-fixture.html
- docs/review-r55w.md
- docs/build-report-r55u.md

Task:
Items 11, 12, 15, and `rig status --eta` (9's display).

1. `drift()` (see stub): fetch, then commits on the live base since the merge base, the files they
   touched mapped to owning slices (via the plan's Owns), owned files untouched listed as safe, and
   `git merge-tree --write-tree` for whether the head still merges, with conflicting files.
2. `rig status` prints drift first (`--no-fetch` to skip fetching) and gains `--eta`, which prints
   r55m's `estimate()` for the stages of a final round and says when there is no data.
3. `rig rebase <id> [--base <ref>]`: rebase a slice's branch onto the live base. Before resolving
   anything, when upstream deleted or rewrote (a configurable share of lines, decide) a file the
   slice changed, stop, write `.rig/rebase-<id>.md` asking the owner what upstream now covers, print
   it, and exit 3. `--covered "<what upstream covers>"` records the answer and lets the rebase go on,
   with `--drop <sha>` to drop superseded commits.
4. `harness/snapshot.js`: platform-neutral snapshot helpers on top of `harness/cdp.js`: pin the user
   agent, locale and modifier-key hints (Meta vs Control); record auto margins as "auto"; wait for
   an app-ready signal (a selector, a global or a function) instead of first paint; retake when not
   ready, with a bounded number of tries. Baselines carry `RECORDED_FROM: <sha>`.
   `staleBaselines()` finds them (a `snapshotDirs` config or a sensible default) and reports how far
   the base moved past each. Export the helpers from `harness/index.js` (additions only).
Checks (each red once): a fixture repo whose base moved, touching an owned file, is flagged and the
untouched files listed as safe; a non-merging stack is reported; rebase stops on an upstream-deleted
file; the snapshot helper records "auto", and a not-ready page is retaken.

### r55w — Watching: peers report themselves, briefs say who acts
Owns:
- src/commands/job.js
- src/commands/tell.js
- src/commands/inbox.js
- src/inbox.js
- src/herdr.js
- src/brief.js
- src/plan.js
- src/roll.js
- src/commands/up.js
- src/commands/brief.js
- templates/**
- test/watch-*.test.js
- test/brief-five.test.js
- test/up-guard-init.test.js
- test/crew.test.js
- docs/review-r55g.md
- docs/build-report-r55w.md

Task:
Items 5, 6 and 14.

1. `rig tell <lead> "<msg>"` writes one message file atomically into the lead's inbox (a state dir:
   `RIG_INBOX_DIR`, else `$XDG_STATE_HOME/rig/inbox`, else `~/.local/state/rig/inbox`, decide and
   document; honour an existing `~/.claude/inbox` layout only if you can do it without naming a
   vendor in the default). The sender comes from `RIG_AGENT_ID`, the slice id, or `CODEX_PERSONA`.
2. `rig inbox [<lead>] [--wait] [--deadline <min>]` prints new messages and files them under
   `read/`; `--wait` blocks until one lands or the deadline, polling at most every 5 s (the 60 s bar).
3. `rig job <pane> "<task>" [--expect <file>] [--deadline <min>]`: brief a pane through
   `herdr agent prompt`, wait for it to leave idle, then until idle, done or blocked, or the deadline;
   print the state, the minutes, whether the expected file exists and is non-empty, BLOCKED when it
   is, and the pane's last lines. The task it sends ends with the tell line. Exit codes per outcome
   (decide; document). Refuse to prompt a busy pane.
4. `rig up` prints, and when it can, starts, the lead's inbox watcher (the exact background command
   `rig inbox <lead> --wait --deadline <min>`), with the lead name from `lead` in config or
   `RIG_LEAD`. Every brief ends with the tell line: `briefFor` and `tabBrief` are yours; export a
   `tellLine(lead, id)` helper from `src/brief.js` and r55g calls it at the end of `reviewBrief`.
   Briefs state item 6 outright: ask the lead, never the human; only permission dialogs, a go,
   or a taste call go to the human.
5. Item 14: plans gain a `## Refusals` (refusal → repair) section in `templates/PLAN.md`; `rig up`
   warns when a plan whose work has a UI over rules lacks it (decide the trigger; an explicit
   `UI: none` line silences it).
Checks (each red once): `rig job` exits on idle, done and blocked, and on its deadline against a fake
`herdr` on PATH whose pane never finishes; `rig inbox --wait` wakes within 60 s of `rig tell`; the
brief's last line is the tell line; `rig up` warns on a missing refusal matrix.

## Open questions
- None for the crew. The lead brings the release.
