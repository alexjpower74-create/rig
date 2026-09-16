# Build report — rg1 · QA hygiene and the finish gate

Branch `rig/rg1`. Final sha graded: `79bec0d` (this report is committed on top of it; the report
changes no code).

## What I built

**`rig qa` never refuses** (`src/worktrees.js`, `src/commands/qa.js`) — DONE
- Each run takes `<worktreeBase>/qa` when free, else `qa-2`, `qa-3`… A slot is "in use" when
  `<path>/.rig/qa.lock` holds a live pid (`process.kill(pid, 0)`; EPERM counts as alive). A stale
  lock is removed with a note. The lock is written (`wx`, so two runs cannot both take it) before the
  clean and pin, and released on exit, SIGINT, SIGTERM and SIGHUP. Extra slots get `qaPort + n`.
- Before the pin: `git reset --hard`, then `git clean -fd -e .rig/qa.lock` (`--fresh` adds `-x`).
  What was reset is printed by path: `reset 1 tracked file: log.txt (a test wrote it)` and
  `removed 1 untracked path: junk.txt`.
- It refuses to reset anything that is not a detached worktree under this project's worktree base.
  A branch checkout sitting in a QA slot is skipped with a note (`qa is on branch side, not a QA
  worktree: left alone`) and the run takes the next slot, so it still never refuses and never
  touches someone's work.
- After each command, `git status --porcelain` in the QA worktree: `dirtied` (tracked) and
  `untracked` are recorded in the qa-history entry and printed with the c2 message.
- `--negative "<cmd>"` (or `cfg.negativeCommand`, or `plan.negativeCommand` from rg2's parser) runs
  in the same pinned tree and is recorded `{ kind: 'negative' }`; `--run` entries are `kind: 'test'`.
  `lastQaOn(root, sha, kind = 'test')`; entries with no kind count as tests. `lastNegativeOn` added.
- The ref still resolves in the MAIN checkout. `--help`/`-h` prints usage and creates nothing;
  `--run`/`--negative` without a command exits 2 before touching git.

**The finish gate** (`src/commands/finish.js`) — DONE. After "merged", in this order:
- `<id> reviewed`: FAIL when the slice changed anything outside `docs/` (newest commit on base
  touching its Owns globs via `:(glob)` pathspecs with `:(exclude,glob)docs/**`, or any non-docs
  file on an unmerged branch) and `docs/review-<id>.md` is not on base, or its `%ct` is older than
  that code commit. `--no-review` → warn, and FINISH.md carries "Run with `--no-review`".
- `negative controls red on <sha>`: when `cfg.negativeCommand`, `plan.negativeCommand`, or the plan's
  Checks section mentions "negative", FAIL unless a negative run exited 0 on THIS sha. Detail carries
  the Biome lesson text.
- `QA left the tree clean`: FAIL naming the files when the recorded run has `dirtied`.

**Desk** (`src/desk.js`) — DONE. `findOnPath`, `runTool`, `jot`, `appsTouch`, `appsNew`, `wrap`,
`ghAvailable`, `ghIssueClose` (checks `gh issue view --json state` first; an already-closed issue is
skipped and said). Nothing throws on absence; `{ ran: false, why }`. On a passing finish only:
close each slice's issue from `.rig/issues.json` with "Finished: `<cmd>` exit 0 on `<short>` (rig
finish)", `jot "[<slug>] <title>: finished at <short>; <cmd> exit 0; <N> slices"`, `apps touch
<slug>`, print `next: wrap <slug> "…"`; `wrap` runs only with `--wrap "<msg>"`. `--no-desk` skips.
All of it is written to FINISH.md under "Desk", including "skipped: a gate failed".

## What I verified, and the red I saw

`test/qa-finish.test.js`: 13 `node:test` cases in temp repos, `rig qa`/`rig finish` driven as
child processes exactly as the CLI would call the modules. Each case has its paired known-bad
state (no lock → `qa` again; no negatives in plan → no gate; review after code → ok; etc.).

Mutations applied to the fix, one at a time, and the tests that went red (files restored after):

| Mutation | Red |
|---|---|
| reviewed gate always `ok` | unreviewed-slice, stale-review, desk (desk ran on a failing repo) |
| desk runs even when a gate failed | desk |
| `lastQaOn` ignores `kind` | `--negative` kinds, negatives-on-this-sha |
| no `git reset --hard` before the pin | tracked-file reset and reported |
| lock never checked | second run takes qa-2 |

Graded from a pinned QA worktree with the 3.0 `rig qa` itself:

```
QA worktree qa pinned to 79bec0dabeabd21cc149dd66db2eff2b8c3d97c2 @ 79bec0d
rig qa: test exit 0 at 79bec0d       node --test test/qa-finish.test.js   (13 pass, 0 fail)
rig qa: negative exit 0 at 79bec0d   npm run demo … exactly one VOID and one FAIL check line
```
Both entries are in `.rig/qa-history.jsonl` on the main checkout with `dirtied: []`. My first two
attempts at the negative command were wrong (colour codes; the demo's summary line also begins
with "VOID") and were recorded as `negative exit 1` on the same sha; the later green entry is the
one `lastNegativeOn` returns.

`tools/check-no-personal-data --self-test && tools/check-no-personal-data`: clean.

## What is red that I could not fix (not my files)

`npm test` exits 1 on one 2.0 check in `test/workflow.test.js`: "finish passes when merged, clean,
and QA exited 0 on this exact commit". Its c1 slice changed `app/entry.js` and has no
`docs/review-c1.md` on base, so the new reviewed gate fails it. That is the gate doing its job; the
test needs a review commit. Verified fix (12/12 green with it applied, then reverted because I do
not own the file). **For the lead / rg4:**

```diff
@@ -146,6 +146,9 @@ test/workflow.test.js
   git(['merge', '-q', '--ff-only', 'rig/c1'], repo)
+  // 3.0: review before merge is a gate; c1 changed app/, so its review has to be on base.
+  writeFileSync(join(repo, 'docs', 'review-c1.md'), '# Review c1\nno findings\n')
+  git(['add', '-A'], repo); git(['commit', '-qm', 'review c1'], repo)
   const head = git(['rev-parse', 'HEAD'], repo)
```

## For rg4 (bin/rig.js, package.json, README, CHANGELOG)
- `npm test` must run `node --test test/qa-finish.test.js` (or the runner picks up `test/*.test.js`).
- COMMANDS text: `qa: … (--run "<cmd>", --negative "<cmd>", --port, --fresh; qa, qa-2… per run)`,
  `finish: … reviewed, QA + negatives green on this sha, tree clean; closes issues, jots, touches the
  registry on a pass (--no-review, --no-desk, --wrap "<msg>")`. Both modules export `USAGE` and
  handle `--help`/`-h` themselves.
- README/CHANGELOG: the QA worktree is per run (`qa`, `qa-2`…), the lock file, `--fresh`, the three
  new gates, and that `wrap` only runs with `--wrap`.

## For rg2
- I read `cfg.negativeCommand || plan.negativeCommand`, `cfg.slug`, and `.rig/issues.json` as
  `{ "<id>": { number, url } }`. If `plan.negativeCommand` ends up under another name, `qa.js`
  `planNegative()` and `finish.js` `wantsNegative()` are the two places to change.

## Left undone / notes
- `rig review rg1` was not launched from here (the plan's round-robin is the lead's to run).
- I did not run `wrap`, `sync`, `jot`, `apps`, or `gh` for real: the desk tests use stubs on a fake
  PATH, and the real tools were never touched by this slice.
- The QA worktree for this repo is `../.rig-worktrees-rig/qa` from the main checkout's config; the
  per-repo default is rg2's.
