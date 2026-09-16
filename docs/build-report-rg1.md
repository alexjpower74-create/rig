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

## Review findings acted on (docs/review-rg1.md, eight findings)

Each fix has a test in `test/qa-finish.test.js` named "(review N)" or extended in place, and each
was shown red once by reverting only that fix (files restored after).

1. **Squash-merged slice never reviewed** — FIXED. `branchApplied()` is now a shared helper; the
   merged gate records unmerged slices and `reviewState` only treats the branch diff as "newer
   code" when the branch holds work not on base. Red: reverting to `if (branchExists)`.
2. **Signals released the lock under a running command** — FIXED. `runShell` keeps the child;
   the handler forwards the same signal, waits for the child's exit (SIGKILL after 5 s), then
   releases and exits 128+n. Red: handler with no child → the orphan's marker file appeared.
3. **Two simultaneous runs on a fresh repo** — FIXED. The lock moved beside the worktree,
   `<worktreeDir>/<id>.lock`, taken with `wx` before any git; a `worktree add` that loses the race
   is read as "taken while we looked" and the run moves on. Red: creating the tree before the lock
   → both runs pinned `qa`. (Deviation from the brief's `<path>/.rig/qa.lock`, for the reason in the
   review; nothing a clean does can reach the lock now, so the `-e` exclude went.)
4. **Negative run's leftovers not gated** — FIXED. "QA left the tree clean" unions the test and
   negative entries' `dirtied`, naming the run. Red: test entry only.
5. **Every passing finish jots again** — FIXED. `.rig/finish.json` remembers `{ sha: { jotted,
   slug } }`; a repeat says "already jotted on <sha>" and skips jot and apps touch; issue closing
   was already idempotent. Red: jotting unconditionally → two jot lines.
6. **`--wrap` swallowed** — FIXED. `--wrap` with no message and `--wrap` with `--no-desk` both
   exit 2 with a sentence before anything runs. Red: removing the two checks.
7. **Slug fallback** — FIXED. `slugFor` copied verbatim from rg2's `init.js` (`cfg.slug ||
   slugFor(dirname)`); a repo directory "Depot Draw" jots under `[depot-draw]`. Red: raw dir name.
8. **USAGE wrong about the exit** — FIXED: "rig qa exits with the first non-zero of the test run,
   then the negative". Red: old wording.

Also, from the lead's notes: `qaSlots(root, cfg)` exported from `src/worktrees.js`, returning
`[{ id, path, lock: { live, pid } }]` for every `qa`/`qa-N` under the worktree base, for `down`.
The `Negative controls: <cmd>` PLAN.md line and the `workflow.test.js` patch remain the lead's.

## Second-pass review findings acted on

1. **A forwarded signal reached only the bash wrapper** — FIXED. `runShell` spawns the command
   as its own process group (`detached: true`) and the handler signals the group
   (`process.kill(-pid, sig)`, SIGKILL to the group after 5 s). The test's command is now
   `sh -c 'sleep 2; touch marker'; true`, a program the command started followed by another
   command, and it goes red when only bash is signalled: the orphan writes the marker.
2. **Two runs seeing the same stale lock both took the slot** — FIXED. `takeOverStaleLock`
   claims an exclusive takeover file named by the dead pid (`<id>.lock.takeover-<pid>`, `wx`),
   re-reads the lock to confirm the same dead pid is still there, and only then removes it; the
   loser reads "taken while we looked" and moves to the next slot. A takeover file left by a
   crashed winner is itself taken over when its pid is dead. Test: a dead-pid lock in place, two
   runs at once → `qa` and `qa-2`, exactly one "removed a stale lock", the winner's lock released.
   Red by reverting to read-then-remove: 1 of 3 runs (the window is milliseconds); the fixed code
   was green 3 of 3.

Notes for the lead: the pid-reuse case after a reboot is in my `readQaLock`; `qaSlots` already
returns the lock path, so `down` can print it. Writing `pid starttime` is a small follow-up if
wanted. The `%ct` cross-machine clock note and the untracked `docs/FINISH.md` are not rg1's files.
