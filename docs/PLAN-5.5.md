# Rig 5.5 — plan

Written 2026-10-22 night. Replaces the earlier six-item draft. Lessons from a two-day build: five stacked PRs on a
fast-moving upstream, a Claude crew, a second-vendor reviewer (Codex), and a second test machine.
**Public repo:** every example, note and release text stays generic. No client, company, repo or person names
from the work that taught these lessons.

## The feeling

The lead never has to be the human's alarm clock. Every wait has a deadline, every peer reports itself, every
number is measured, and nothing called "ready" turns out stale an hour later.

## The bar (numbers, each one a check that is seen red once)

- A stalled test run is caught and named in **5 minutes or less** (it went unnoticed for 20 to 100 minutes).
- A peer finishing, or blocking, reaches the lead in **60 seconds or less**, Claude or Codex alike (a Codex
  reviewer's finish once went unnoticed until the human pointed it out).
- Base drift (upstream moved, which files it touched, whether it still merges) is known **before** a final round
  starts, never after it (upstream moved 30, then 11, then 3 PRs in one day).
- Every estimate the lead gives is computed from **measured** stage times, not guessed.

## What changes, in four parts

### A. The gate: what "finish" means

1. **Second-vendor review is required.** `rig finish` refuses until a reviewer from a different model vendor has
   passed the final sha. It's recorded with `rig review --vendor <name> --pass "<what ran>"`. That vendor review
   found 9 real defects that two same-vendor reviews passed, and later a bypass the code's own tests did not
   cover.
2. **One organized fold, at the end.** Fix commits stay plain while reviews settle. `rig fold` folds them into
   their owning commits once, then:
   - walks every commit (each boots and passes its own specs);
   - checks the folded tip's tree against "old tip + the fix commits" (`git diff` must be empty);
   - stamps the new shas.

   Every final check reruns on the final shas. Message-only rewrites are allowed after that only when every tree
   compares identical.
3. **Two machines.** `rig qa --host <ssh-host>` runs the same full suite on a second machine:
   - it fetches over SSH from the lead's tree (nothing pushed) and gives each session its own test DB there;
   - it reports both tallies side by side;
   - `finish` needs both, when a host is configured.

   A second OS caught 34 platform-only failures and a 1-in-3 flake that the first machine never showed.
3b. **The repo's own local CI is the gate where it has one.** More teams are moving CI off hosted runners to
   local runs, for speed and cost. When the repo defines a local CI command (and any "CI passed" status it posts),
   `rig qa` runs that exact command on both machines and `rig finish` records its result. The Rig's own checks
   come on top of the repo's CI, never instead of it.
4. **The upstream baseline is part of the result.** `rig qa` also runs the base branch with the same command and
   reports only failures that are **new**. Known base failures are listed with where each also fails (here, there,
   both), so "0 new" is a computed fact, not a claim.

### B. Watching: nobody waits blind

5. **Peers report themselves.** `tell-lead`, `lead-inbox` and `codex-job` move into the Rig:
   - `rig up` arms the lead's inbox watcher;
   - every brief, Claude or Codex, ends with the tell-lead line;
   - a Codex member is briefed through `rig job <pane> "<task>" --expect <file> --deadline <min>`, which exits
     when that member is idle, done or blocked.
6. **Peers ask the lead, never the human.** Briefs say so outright: a question left in a peer's pane reaches
   nobody. Only items that need the human's own hands go to the human: a permission dialog, a go, a taste call.
7. **Stall watchdog on every test run.** `rig qa` watches log growth per worker. If a worker makes no progress for
   5 minutes (configurable), it names the worker and the spec, stops the group and reports.
8. **Desktop-free test runs.** `rig qa` runs suites with the clipboard and display unreachable by default
   (`--desktop` opts back in). A spec that shelled out to the real clipboard tool hung whole runs, and wrote over
   the human's clipboard. Specs that fail only because of this are listed as "needs a stub", not new failures.
9. **Measured timings.** `rig qa`, `fold` and `review` record each stage's wall time in `.rig/timings.jsonl`.
   `rig status --eta` estimates from the median of past runs, and says when it has no data.
10. **Shared resources are scheduled.** The second machine and per-session test DBs are leased:
    `rig lease <host|db> --by <id>`, refused while someone else holds it. Two sessions once wiped each other's test
    DB on the second machine.

### C. Upstream and decisions

11. **Drift check at the start of every final round.** `rig status` and the start of `rig fold` and `rig finish`
    run fetch plus `merge-tree` against the live base. They report:
    - commits since the base;
    - which owned files those commits touched;
    - whether the stack still merges.

    If the base moved, the round rebuilds before reviews, not after them.
12. **Rebuild when upstream supersedes a slice.** When upstream deletes or rewrites files a slice changed,
    `rig rebase` stops and asks the slice owner to say what upstream now covers, before resolving. Upstream once
    replaced most of one PR; dropping its superseded commits made that PR smaller and correct.
13. **Decision records feed the build.** `rig decision "<what was decided>" --source <transcript|thread>` adds to
    docs/DECISIONS.md. `rig finish` lists every decision made since the round started and refuses until each is
    marked built, scheduled (with a round) or not-in-scope. A meeting answer once reached the build only through a
    late review.
14. **Refusal to repair matrix.** For any UI over rules, PLAN.md has a section that lists every refusal a screen
    can hit and its repair: the field to fill, or the message naming who acts. `rig up` warns when it's missing.
    Dead ends (a move refused with no way to fix it) were the largest class of defects found.

### D. Tests that hold on any machine

15. **Platform-neutral snapshot helpers** (in the Rig's test kit):
    - pin the user agent, locale and modifier-key hints;
    - record auto margins as "auto";
    - wait for app-ready, not first paint;
    - retake the snapshot when not ready.

    Baselines carry `RECORDED_FROM` (the reference sha). `rig qa` warns when the base moved past that reference.
16. **Flake proof.** `rig qa --repeat N --seeds` reruns one file N times across seeds on both machines. A flake fix
    isn't done until it shows N green, with the failing seed included.

## What must not change

- File-slice ownership, the QA worktree pinned to a sha, negative controls, the mindset block, `rig taste`, and
  herdr tabs in the current workspace.
- No new dependency for the lead's machine beyond what the Rig already uses (node, git, herdr, ssh).

## Checks (each seen red, then green)

- Stall watchdog: a fake suite that stops writing must be stopped and named in 5 minutes or less; a suite that
  keeps writing must not be.
- `rig job` exits on idle, done or blocked, and on its deadline. A fake pane that never finishes hits the deadline.
- Drift: a fixture repo whose base moved, touching an owned file, is flagged; untouched files are listed as safe.
- Fold: a fold that drops a hunk is refused by the tree check.
- Finish: refuses without a second-vendor pass, a second-machine tally (when configured), or open decisions.
- The base-baseline diff ("0 new") is computed from two real runs in a fixture.
- Lease: a second holder is refused.

## Release

- Version 5.5.0. CHANGELOG, tag, GitHub release, and the Homebrew tap.
- The explainer PDF "Rig 5.5.0 - explained - <date>.pdf" goes on both desktops, and the site's Rig card says
  "Rig 5.5.0", the same night (standing rule).
- Rig 6 is a separate plan, after the Codex-led build round shows how a Codex lead works with the Rig.
