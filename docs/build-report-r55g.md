# Build report — r55g · The gate: second vendor, one fold, decisions, finish

Branch `rig/r55g`. Items 1, 2 and 13 of `docs/PLAN-5.5.md`, and the finish side of 3, 3b, 4 and 11.
Every check below was seen red once, then green. `npm run check` was green on this branch from a
pinned QA worktree (`rig qa 5b748a6 --run "env -u WAYLAND_DISPLAY -u DISPLAY npm run check"` →
`rig qa: test exit 0 at 5b748a6`, 20 files; negatives `exit 0`), and the full suite was green on all
five slices merged in the lead's order (m, u, w, q, g) in a throwaway worktree: `test/run.js: 32 file(s)
green`, exit 0, with the real `drift()`, `recordTiming()` and `tellLine()`.

## What I built

| Item | State | Where |
| --- | --- | --- |
| 1. `rig review --vendor` | DONE | `src/vendor.js`, `src/commands/review.js` |
| 2. `rig fold` | DONE | `src/fold.js`, `src/commands/fold.js` |
| 13. `rig decision` + the finish gate | DONE | `src/decisions.js`, `src/commands/decision.js`, `docs/DECISIONS.md` |
| 3 / 3b / 4 / 11, finish side | DONE | `src/commands/finish.js` |
| Cross-review of r55q | DONE | `docs/review-r55q.md` (5 findings) |
| r55w's review of r55g | DONE, all 3 fixed | commit `1f0a290` |

**1. Second-vendor review.** `rig review --vendor <name> --pass "<what ran>"` records
`{ sha, vendor, verdict, what, builder, ms }` in `.rig/reviews.jsonl` on the base's tip (`--sha` for
another commit). `--fail "<what it found>"` records a failing verdict; the newest verdict on a sha wins.
Names resolve to the vendor that trained the model (`codex`, `gpt-5.1` → openai; `claude`, `opus` →
anthropic; `gemini-3-pro` → google). The builders' vendors come from `vendor` in the config (a name, or
a list for a mixed crew), else the launch command's program, read past `env X=1`, `npx -y`, a path
and a version. A pass from any builder vendor is refused before anything is written, with why:

```
$ rig review --vendor claude --pass "read it, looks fine"
rig review: refused: claude is anthropic, the same vendor that built this round (the launch command
(claude)). Same-vendor reviews share the builders' blind spots; a second-vendor pass has to come from
a model trained by someone else. Nothing was recorded.          (exit 1)

$ rig review --vendor codex --pass "npm test on a clean checkout; read the whole diff" --ms 840000
pass from openai on 422a731: npm test on a clean checkout; read the whole diff
  took 14 min (--ms); timing recorded as stage review
```

Without `--pass`/`--fail` it writes `.rig/REVIEW-final.md`: the second-vendor brief for the round's
whole diff, pinned to the sha, ending with the two exact record commands and r55w's tell line, and
prints the hand-over: `rig job <pane> "Read .rig/REVIEW-final.md and follow it." --id rv-openai`.
The time is `--ms`, else the age of that brief (a brief over 12 h old is not used: it is another
review's clock). Timing goes through r55m's `recordTiming(stage 'review')`.

**2. One fold.** `rig fold [--base <ref>]` folds `fixup!`/`squash!`/`amend!` commits, and any
`--fix <sha>[=<owner>]`, into their owners. It writes the rebase todo itself and runs a real
`git rebase -i` with `GIT_SEQUENCE_EDITOR=cp <todo>`, onto the stack's own merge base (a fold never
pulls the base in), with the author/committer env stripped so commits carry the git-config identity.
Then: the folded tip's tree must equal the old tip's tree, or the branch is reset to the old tip and
the fold refused with the diffstat; every new commit is checked out in a scratch worktree
(`fold-walk`, removed after) and `--each` (or `testCommand`, else `devCommand`) run, exit recorded;
old → new shas are stamped in `.rig/fold.json`; timing as stage 'fold'. Drift is printed first.

**13. Decisions.** `rig decision "<what>" --source <where>` appends a row (D1, D2…, date, what,
source, open) to the table in `docs/DECISIONS.md`, atomically; `rig decision <id> --built |
--scheduled <round> | --not-in-scope | --open` rewrites that row; `--list` prints them. A pipe in the
text survives; a status word the rig does not know reads as open (a typo never closes a decision).

**Finish.** Drift against the live base is printed before anything else, and is a gate: a stack that
no longer merges fails, a moved base warns. New gates, each a fact on this sha:

```
drift vs origin/main: moved 1 commit(s); does NOT merge (app/entry.js)
  touched: app/entry.js (c1)
  safe: 4 owned file(s) untouched
  the base moved: rebuild the round before reviews (rig rebase <id>), not after them

Depot draw — finish gate on main @ f9716a4
  ok   c1 merged
  ok   c1 reviewed  — docs/review-c1.md
 FAIL  the stack merges with the live base  — origin/main moved 1 commit(s) and the stack no longer merges: app/entry.js
  ok   QA green on f9716a4  — npm test
 FAIL  second-vendor pass on f9716a4  — no second-vendor verdict on f9716a4: `rig review --vendor <name> --pass "<what ran>" --sha f9716a4`
 FAIL  decisions closed  — 1 open since 15dec28 (c1 was cut here): D1 — rig decision <id> --built | --scheduled <round> | --not-in-scope
 …
Decisions since 15dec28 (c1 was cut here):
  OPEN  D1  entries close at midnight local time  — open
```

- **Second-vendor pass** on exactly this sha, newest verdict wins; a pass recorded by a builder vendor
  (the config can change after it was written) or under a name the rig does not know does not count.
  `--no-vendor` downgrades it to a warning and FINISH.md says, in bold, that no second-vendor pass was
  required. FINISH.md gains "Second-vendor review", "Decisions" and "Drift" sections.
- **qaHost tally**: when `qaHost` is set, a test run recorded with `host: <qaHost>` on this sha, shown
  beside the local tally (`exit 1, 409 passed, 3 failed beside exit 0, 412 passed here`). A host run
  never answers for the local one, and vice versa.
- **CI (3b)**: when `ciCommand` is set it must have run; when a `kind: 'ci'` run exists on any machine
  it must exist, and pass, on every machine. A CI that exits 0 but posts `failure` is not green.
- **Baseline (4)**: "0 new against <base>" is shown when a comparison was recorded (r55q's
  `kind: 'baseline'` record, or a `baseline` field on the run), fails on any new failure, and is a
  warning reading "not computed: …" when `complete` is false. A run whose only failures are known on
  the base is green (Chromium's expectations rule), but only from a complete comparison recorded after
  the run; a stalled run, or one killed at its limit (124/137/143), never is.
- **Decisions (13)**: every decision added since the round started is listed; any open one fails.
  Open decisions from earlier rounds warn.
- Stale snapshot baselines (r55u's `staleBaselines`) show as a warning.

## The checks, and the red I saw for each

The plan's checks are harness checks with `breaks`; the harness marks a check VOID if it still passes
broken. On my first draft it caught six of my own controls as VOID (I reset state inside `assert`,
which undid each break) and three placeholder controls that broke nothing; all were rewritten until
every check shows red under its control.

| Check | Test | How it went red |
| --- | --- | --- |
| finish refuses without a second-vendor pass | gate-finish: "finish refuses without a second-vendor pass on this sha" | the guard off (`noVendor`): the finish passes |
| … on the command line, naming the record command | gate-finish CLI: "rig finish exits 1 without a vendor pass…" | a gemini pass recorded: exit 0 |
| `--no-vendor` is said in FINISH.md | gate-finish CLI | the pre-5.5 `finish.js` (from `3ef17d0`) swapped back in: no such line |
| finish refuses without the host tally when configured | gate-finish: "finish refuses without the qaHost tally…" | a host run recorded: the gate passes |
| finish refuses with an open decision | gate-finish: "finish refuses with a decision of this round still open, and lists it" | D2 marked built and committed: passes |
| a same-vendor pass is refused | gate-vendor: "a pass from the builders' own vendor is refused, says why, and records nothing" | config `vendor: openai`: the same `--vendor claude` pass is recorded |
| … and cannot be written around | gate-finish: "a same-vendor pass written straight into .rig/reviews.jsonl still does not pass" | builders set to codex: the same record passes |
| a fold that drops a hunk is refused by the tree check | gate-fold: "a fold that drops a hunk is refused by the tree check, and the branch is put back" | `treeCheck: false` on a todo with one fixup dropped: the fold reports `folded` and `app/entry.js`'s fix is gone |
| drift is printed before the gates | gate-finish CLI | the pre-5.5 `finish.js` swapped back in: no drift line |
| a moved base that no longer merges fails | gate-finish: "a live base the stack no longer merges with fails…" | a drift check that only asks "moved?" (the anti-reference) |
| older-sha pass, newest-wins, made-up vendor, mixed crew, CI posted failure, CI on both machines, new baseline failures, "0 new" shown, known-only/stalled/killed, uncomputed baseline | gate-finish, gate-vendor | each by the state change that makes the other answer right (listed in the test next to it) |
| fold: owners, orphan fixup!, walk, CLI stamp, walk failure, edges | gate-fold | `--fix` removed; a matching subject; a failing walk command; `--no-each`; `true` as the walk; a clean tree |
| fold keeps the git-config identity | gate-fold (no in-suite control) | by hand: env stripping removed in `src/fold.js` → `1 failed`; restored, diff empty |
| decisions CLI | gate-decision | no `--source`; `--scheduled` without a round; a real status word; a well-formed call; D2 built |

Totals: gate-finish 20 + 3, gate-vendor 10, gate-fold 7 (+1 unproven in-suite, proven by hand), gate-decision 5.

## Lead's follow-up: what every review brief asks

Both review briefs (`reviewBrief` for a slice, `vendorBrief` for the second vendor) now carry an
"Ask these" list, `ASK_THESE` in `src/commands/review.js`: (1) what changes between the check and its
use or delivery, and is it checked again; (2) time edges: daylight saving, time zones, a clock that
moves, exactly at the boundary; (3) a state that flips off and back on; (4) with every feature flag
off, is each new endpoint, action, prop and job unreachable on every surface (UI, API, CLI, tool servers,
background jobs), and does the old behaviour hold exactly; (5) does the change override a saved user
preference (theme, locale, notifications); (6) a negative test counted exactly: "not exactly once"
passes when it happened twice, so assert absence as "never happened" and ask whether each negative
control goes red when the thing happens more than once. `test/gate-review-brief.test.js` checks both
briefs ask all six; red by swapping `72d5b01`'s `review.js` (the first five only) back in.

**The tell line**: since main was merged in (`45449c7`, with r55w), `review.js` imports `tellLine`
from `src/brief.js` directly, and both briefs end with it: id = `--by`, else `rv-<id>`; `rv-<vendor>`
for the vendor brief. `test/gate-review-brief.test.js` asserts it is the last line of both, red with
the scaffold's `brief.js` (`3ef17d0`), which has no `tellLine`.

## Lead's follow-up: after the fold, and the detected CI command

**(a) Item 2's last line.** `rig fold` now stamps each folded commit's tree in `.rig/fold.json`. `rig
finish` reads the newest fold per branch (the base, and any slice branch still there) and adds
`fold on <branch> holds`. If the stamped tip is on the branch, it passes. If the commits were rewritten,
each commit at the stamped position (counted on first parent from the fold's merge base) must have
exactly the stamped tree. A message-only rewrite passes ("every tree identical to the stamp"). Anything
else fails and names the commit: `<sha> "<subject>" stands where the fold stamped <sha> and its tree
differs: it was changed after the fold, or the stack was rebased onto a moved base`. The same applies
when commits were dropped, the base itself was swapped out, or a stamped commit can no longer be read.
Checks in `test/gate-final.test.js`:
- a content rewrite fails and names the commit; red with `a25b59f`'s `finish.js`, which has no such gate;
- a message-only rewrite passes; red when the same rewrite also changes content;
- unchanged shas pass; red after a rebase onto a moved base;
- that rebase fails and names its first commit out of place; red when the rebase is undone.

**(b) Item 3b, detected CI.** `ciCommandAt(root, sha, cfg)` in `finish.js` returns, in order:
- the configured `ciCommand` (`null` or `""` means none, as in r55q's rule);
- otherwise r55q's `detectCi` run on the commit's own `package.json`, `bin/ci`, `script/ci`,
  `script/cibuild` and `Makefile`, copied out of the sha with their committed modes.

`detectCi` is exported as is (`src/qa/ci.js`, `detectCi(dir, cfg)`); nothing needs changing on r55q's
side. Finish loads it with a guarded dynamic import, so this branch also runs before the merge (then
only `ciCommand` counts). With a CI command and no `ci` record on the sha, the gate fails naming the
command and where it came from: `"npm run ci" (scripts.ci in package.json) has no run recorded on this
commit: rig qa <sha>`. Checks:
- detected with no run fails; red with `a25b59f`'s `finish.js`;
- a `ci` run satisfies it; red when the run is removed;
- an executable `bin/ci` is found by its committed mode; red after `chmod -x`;
- `ciCommand: null` turns detection off; red with detection on and no run.

All of them load r55q's `ci.js` from `5d001c2`. I also merged with `rig/r55q` in a scratch tree, where
finish imports the real module: gate-final, gate-finish, qa-finish and qa-baseline pass.

## Existing fixtures that now record a vendor pass

A passing finish needs a second-vendor pass on the sha, so each fixture that expected a pass now
records one (`vendor: 'openai'`; the builders are the default launch command's anthropic):

- `test/qa-finish.test.js` — "an unreviewed slice fails the gate; --no-review warns…" (the final
  `failed === false`); "negative controls must be green on THIS sha…" (its `failed === false`);
  "a passing finish closes the slice issue, jots…" (on `head`, and on `h2` for the second jot);
  "without cfg.slug the desk uses rg2's slug rule…"; "desk tools that are not on PATH are skipped…".
- `test/workflow.test.js` — "finish passes when merged, clean, and QA exited 0 on this exact commit".

No other assertion in an existing test was changed.

## Decided

- **Unknown vendor names are refused**, not treated as their own vendor (r55w's finding 1): otherwise
  `--vendor me` passes the builders' own round. A new vendor goes under `vendors` in the config.
- **`vendor` may be a list** for a mixed crew; a pass from any of them is same-vendor (finding 2).
- **A same-vendor `--fail` is recorded**: a defect found is a defect, whoever found it. Only passes are refused.
- **Round start** = where the oldest slice branch was cut, from its reflog; else its merge base with
  the base (later than the cut after a merge, so fewer decisions count, never more); `--since` overrides;
  with no slice branch left, every decision counts and the gate says so.
- **Decisions are read from the sha being finished**, not the working file; an edit not committed is
  caught by "no uncommitted work".
- **Drift as a gate**: no longer merges → fail; moved but merges → warn; could not check → warn.
  The live base is `liveBase` in the config, else the base's upstream, else `origin/<base>`.
- **Fold**: own todo over `git rebase -i`, not `--autosquash`, so `--fix` commits and nested `fixup!`
  fold the same way; onto the merge base only; merge commits refused; a failing walk exits 1 but keeps
  the fold (its tree is identical, nothing is lost). Default base: `base` in the config; on the trunk
  itself, its upstream; else main, else master.
- **Known-only failures are green** with a complete comparison recorded after the run (see Finish).
- `.rig/reviews.jsonl` (one verdict per line) and `.rig/fold.json` (`{ folds: [...] }`) are the formats.

## For the lead: USAGE and README text (bin/rig.js and README.md are yours)

```js
// COMMANDS
review: 'a fresh-eyes review brief for a slice: rig review <id>; the second-vendor gate: rig review --vendor <name> --pass "<what ran>" | --fail "<found>" (--sha, --ms); --vendor alone writes the final brief',
finish: 'the done gate: drift first; reviewed, merged, QA (+ qaHost, + CI) and negatives green on this sha, 0 new on the baseline, a second-vendor pass, no open decision; closes issues, jots, touches the registry on a pass (--no-review, --no-vendor, --since, --no-fetch, --no-desk, --wrap "<msg>"); writes docs/FINISH.md',
decision: 'record a decision: rig decision "<what>" --source <transcript|thread>; close it: rig decision <id> --built | --scheduled <round> | --not-in-scope; finish refuses while one of this round is open',

// USAGE
review: `rig review <id> [--by <slice>] [--base <ref>] [--launch] [--launch-cmd "<cmd>"]
rig review --vendor <name> [--base <ref>] [--sha <sha>] [--since <ref>]      writes .rig/REVIEW-final.md
rig review --vendor <name> --pass "<what ran>" | --fail "<what it found>" [--sha <sha>] [--ms <n>]
  a pass from the builders' own vendor (vendor in .rig/config.json, else the launch command) is refused`,
finish: `rig finish [--base <ref>] [--since <ref>] [--no-review] [--no-vendor] [--no-fetch] [--no-desk] [--no-write] [--wrap "<message>"]
  drift is printed first; --no-vendor turns the second-vendor gate into a warning (FINISH.md says so);
  --since names where the round started, for decisions (default: where the oldest slice was cut)`,
fold: `rig fold [--base <ref>] [--fix <sha>[=<owner>]]... [--each "<cmd>"] [--no-each] [--timeout <min>] [--no-fetch]
  the folded tree must equal the old tip's or the branch is put back; every commit walked; shas stamped in .rig/fold.json`,
decision: `rig decision "<what was decided>" --source <transcript|thread>
rig decision <id> --built | --scheduled <round> | --not-in-scope | --open
rig decision --list`,
```

README paragraph:

> **The gate.** `rig finish` prints drift against the live base first, then checks facts with a sha
> beside each: every slice merged and reviewed, QA green on this sha here and on `qaHost` when one is
> set, the repo's own CI command green on every machine it ran on, "0 new" against the base's own run
> when it was compared, negative controls red again on this sha, a pass from a reviewer of a second
> model vendor on this very sha (`rig review --vendor openai --pass "<what ran>"`; a pass from the
> builders' vendor is refused), and no decision of this round left open (`rig decision`, in
> `docs/DECISIONS.md`). Before the final round, `rig fold` folds the fix commits into their owners once,
> refuses unless the folded tree is byte-identical to the old tip's, walks every commit on its own, and
> stamps old → new shas, so every final check reruns on the shas that ship. Config: `vendor` (a name or
> a list), `vendors` (more known vendors), `liveBase`, `qaHost`, `ciCommand`, `testCommand`.

## Second-vendor review of 949e12b: findings 2, 3 and 4

The review failed 949e12b with four reproduced findings; 2, 3 and 4 are r55g's. Each fix has a check
in `test/gate-final.test.js` ("the second-vendor findings on 949e12b") whose control is the file as
it was at 949e12b, and the reviewer's own repro scripts give the wrong answer on 949e12b and the right
one on the fix.

- **#2, a baseline waives only the runs it compared.** `rig finish` used to apply the newest baseline
  on the sha to both machines. Now a failing run is waived only when the comparison read that exact
  run, and every failure it names is known on the base on its own side (`here`, `there` or `both`).
  r55q's record needs one field for the host side: `baseline.compared: [{ host, cmd, at }]`, one entry
  per run fed to `compareBaseline`, where `at` is the `at` of that run's own test or ci record (set
  explicitly in `recordQa` and returned on the stage result). Until it exists, a baseline covers only
  the local run with its own command, recorded before it, so a host failure is never waived by it.
- **#3, the fold walk runs under rig qa's runner.** `walkCommits` (and so `fold`) is async now and
  uses `runWatched`: bash `-o pipefail`, the per-commit limit as exit 124, and the whole process group
  stopped with it. `false | cat` is red; a subshell started by a timed-out walk no longer lives on.
- **#4, a CI record counts only for today's command.** Each host's ci record must have the `cmd` of
  the CI command finish requires now (configured or detected); otherwise the gate fails as stale and
  names both commands.

## What's left, and what I need

- **r55w**: done. `tellLine` is a plain import since main was merged in.
- **r55q**: all five findings in `docs/review-r55q.md` verified fixed or settled at `45449c7` (see its
  "Verified" section); one non-blocking nit is left there (the `ci exit 0` summary line).
- **Not built**: `git rebase --update-refs` for stacked branches is off (it would move other slices'
  branches). The fold check and detected CI are now built (section above).
- **For the owner**: nothing to send or press. The lead merges (order m, u, w, q, g), releases 5.5.0.
