# Review — rg4 · 3.0.0: entry point, per-command help, changelog, README, rulebook, test runner

## Second pass (2026-09-16, main 28828ac)

`git diff main...rig/rg4` is empty: rg4 is merged. This pass reads rg4's commits since the first
review (b2b7f69, 8fd8432) as they stand on main, against the merged qa.js, finish.js and roll.js
rather than against the plan. Read only; nothing edited.

What held up on 28828ac: `npm test` through `test/run.js` is green (10 files); a copy of the tree
with `test/aaa-red.test.js` (a node:test file asserting 1 == 2) exits 1 and the runner stops there.
`rig init|up|status|guard|qa|brief|review|finish|rule|roll|down --help` on a fresh `git init` with
no commit each exit 0, `git status --porcelain` is empty after, and no `.rig-worktrees` appears
beside the repo. `rig bogus --help` exits 2, `rig --version` prints 3.0.0. USAGE in bin/rig.js
matches each module's own flag parsing (qa `--run/--negative/--port/--fresh`, finish
`--no-review/--no-desk/--no-write/--wrap`, roll `--dir/--no-launch/--dry-run/--launch/--no-fetch/
--force`). `check-no-personal-data --self-test` and the check are clean. `npm run demo` prints one
VOID and one FAIL. All seven findings from the first pass are resolved in b2b7f69 and 8fd8432.

### Findings

#### 1. README and CHANGELOG place the QA lock at `.rig/qa.lock`; rg1 put it beside the worktree (README.md line 118, CHANGELOG.md line 24)
`src/worktrees.js` lines 156-162: the lock is `<worktreeBase>/<id>.lock`, next to the worktree and
not inside it, on purpose (a lock inside the tree could only be written after checkout). qa.js's
own USAGE says so. A person hunting a stale lock after a crash, or a `rig down` that reports "qa-2
is in use by pid N", will look inside the worktree's `.rig/` and find nothing. Say
`<worktreeDir>/qa.lock`, `qa-2.lock`… in both places.

#### 2. Wrapped "What must not happen" bullets reach every agent cut at the line break (owner rg2, `src/plan.js` line 146; noted here because rg4 owns docs/** where it shows)
`bullets()` keeps only a bullet's first physical line. PLAN.md wraps three of its hard rules, so the
review brief that produced this file, every `.rig/BRIEF.md`, and `docs/FINISH.md` "Hard rules this
build had to keep" all carry "QA worktrees may only be" and "Never run" with nothing after them. The
rule that got lost is "Never run `wrap` or `sync` unless `--wrap` was passed. Never push, release,
deploy or post", which is the one a crew most needs. rg4 cannot fix it: the lead should have rg2 join
continuation lines (a line that does not start a bullet and is indented belongs to the bullet above)
and re-run workflow.test.js, or unwrap the bullets in PLAN.md before the next `rig up`.

#### 3. `docs/FINISH.md` is untracked and records a failing gate (docs/FINISH.md, `git status`)
It says "Commit: 28828ac (gates failing — not finished)" with the four "reviewed" gates red because
each review file predates the slice's post-review commit. The plan asks for the transcript of
`rig finish` on the final sha in that file. Once the four second-pass reviews are on base, the lead
should re-run `rig finish`, check the file reads as passed, and commit it; a FINISH.md that says
"not finished" must not ship in the 3.0 tree.

### Minor, no action needed unless cheap
- `rig finish` warns "screenshots — none under docs/" although the plan says none are needed for a CLI.
  A warn, not a fail; rg1's gate could read a "Screenshots are not needed" line in Checks.
- `bin/rig.js` line 67: `rig rule "-h"` prints help instead of writing that rule (unchanged from pass one).

---

## First pass (rig/rg4 at ef61904) — all seven resolved in b2b7f69 and 8fd8432

Reviewed `git diff main...rig/rg4` (ef61904) against PLAN.md and the other three slice branches as
they stand today (rig/rg1 971b1ed, rig/rg2 44e9cc2, rig/rg3 28a3c1f). Read only; nothing edited.

What held up: `npm test` through `test/run.js` is green on rg4 (7 files). I made the runner red
three ways in a scratch copy: a node:test file with a failing assertion run under plain `node`
exits 1 and stops the run; a file killed by SIGKILL exits 129 with the signal named; an unhandled
rejection in a node:test file exits 1. `rig qa|finish|roll|init|up --help` on a fresh `git init`
with no plan and no commit each exit 0 and leave the tree empty; `rig bogus --help` still says
unknown command. `check-no-personal-data --self-test` and the check are clean on the rg4 tree.

## Findings

### 1. `--negative` is documented as a bare flag; rg1 makes it take a command (bin/rig.js USAGE.qa, README.md "Formatters un-anchor negative controls", CHANGELOG.md "Negatives after formatting")
rg1's `qa.js` line 38 exits 2 with "`--negative` needs a command" when the flag has no value, and
its `argOf` (line 184) takes the next argv entry as the value. The README and CHANGELOG example

    rig qa 40c0d72 --negative --run "npm run demo"

therefore parses on rg1 as negative command `--run` and test command `npm run demo`: it runs the
literal string `--run` as the negative control and records that. The help line says "--negative
records the run as the negative-control command", which describes a different design from the one
being merged. Check against rg1: the shape is `rig qa <sha> --run "<tests>" --negative "<cmd>"`
(two commands, one run), and the README command list line "--negative records the negative-control
run" needs the same change.

### 2. finish's `--wrap` is shown bare; the plan gives it a value (bin/rig.js USAGE.finish; README "jot and the registry"; CHANGELOG "Registry and log")
PLAN.md rg1: "run it only with `--wrap "<message>"`". USAGE prints `[--wrap]` and says "runs
`wrap` after a pass" with no message. Also note: rig/rg1 as of 971b1ed has none of `--no-review`,
`--no-desk`, `--wrap`, the reviewed gate, the negatives gate or desk.js yet (its finish.js is the
2.0 file). rg4's help, README and CHANGELOG all promise them. Fine if rg1 lands them before merge;
the lead should diff USAGE.finish against rg1's final `finish.js` flag list, not against the plan.

### 3. USAGE.roll is missing flags and names the argument wrong (bin/rig.js USAGE.roll)
rg3's `roll.js` accepts `up ... [--dir] [--dry-run] [--no-launch] [--launch "<cmd>"]`, and
`status|finish` take `[--no-fetch]`. USAGE lists only `--dir` and `--dry-run` for `up`, so
`rig roll up --help` never mentions the one flag (`--no-launch`) that keeps it from opening tabs.
rg3's own usage calls the positional `[<rollDir>]`; rg4 says `[<name>]`. Same text should appear in
both places or the entry-point help will drift from the module's.

### 4. `--fresh` is described as "discards the QA worktree"; rg1 makes it `git clean -x` (bin/rig.js USAGE.qa; README "The QA worktree is yours alone"; CHANGELOG)
rg1 `worktrees.js` line 98: `fresh` adds `-x`, so ignored files go and `node_modules` is
reinstalled; the worktree itself is kept. "Throws the old tree away before pinning" is close
enough in effect, but the help should say the cost: "also removes ignored files (node_modules
reinstalls)". That is the line a person reads before deciding to pass it on a Playwright suite.

### 5. "records the number in the plan" is wrong; rg2 writes `.rig/issues.json` (README "One issue per slice"; CHANGELOG "Issues opened and closed by the rig")
rg2 `issues.js` line 13 writes `.rig/issues.json`; the plan's `Issue:` line is read, never
written. Someone looking for the number in PLAN.md after `rig up` will not find it. Say
`.rig/issues.json` (and that a plan-declared `Issue: N` is honoured instead of creating one).

### 6. README roll transcript does not match rg3's layout (README "Roll: one brief, many repos")
The author flags it as illustrative, but the paths shown are `~/.rig/rolls/linter-2026/BRIEF-1.md`;
rg3 writes `<rollsDir>/<brief basename>-<date>/<tab id>/BRIEF.md` (roll.js lines 74, 89). A reader
will look for `BRIEF-1.md`. Replace with rg3's real `rig roll up --dry-run` output at merge, as the
report already suggests.

### 7. CHANGELOG "Unborn HEAD" states a cause the plan says is different (CHANGELOG "Fixes")
It says the guard "failed the first commit, because there was no base to diff against". PLAN.md
(rg2) says the cause is `currentBranch()` = `git rev-parse --abbrev-ref HEAD` throwing before the
first commit, and that it was reproduced from the code, not seen on the night. Two sentences to
match rg2's fix, which is what the entry claims to describe.

## Minor, no action needed unless cheap
- `test/run.js` line 19: when `spawnSync` itself fails (`r.error` set, status and signal both null)
  the exit is reported as "exited 128" with no error text. Print `r.error.message` when present.
- `rig rule "--help"` prints help instead of writing that rule; no realistic input, noted only
  because the check is `args.includes` on every command.

For rg1: nothing rg4 can fix in items 1, 2 and 4 until the flag shapes are final; the lead should
take USAGE from each module's own `USAGE` string at merge (qa.js and roll.js both carry one).
