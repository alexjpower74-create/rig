# Review — rg1 · QA hygiene and the finish gate

Reviewed `git diff main...rig/rg1` at `c9790d1` against PLAN.md. Read only; nothing was edited on
the branch. Every finding below was reproduced in a temp repo against a clone of `rig/rg1` unless it
says "by reading".

## Findings

### 1. A squash- or rebase-merged slice can never pass `reviewed` while its branch exists
`src/commands/finish.js:219-223` (`reviewState`). When `refs/heads/rig/<id>` exists, any non-docs
file in `git diff --name-only base...ref` sets `codeAt = Infinity`. After a squash merge (which the
`merged` gate explicitly accepts via `merge-tree`, lines 116-125) the branch's commits are not on
base, so the three-dot diff still lists every file the slice changed, and the review file on base is
always "older".
Reproduced: c1 squash-merged, then `docs/review-c1.md` committed on top →
`c1 merged = ok`, `c1 reviewed = fail — docs/review-c1.md is older than the last code commit (rig/c1)`.
The only way through is `--no-review` or deleting the branch, and `rig down` keeps branches by design.
Check: only take the Infinity path when the `merged` gate found real unmerged work (reuse its
`applied` answer), or compare the branch's changed files against base's tree instead of the diff.

### 2. SIGTERM/SIGINT/SIGHUP release the lock while the test command is still running in the worktree
`src/commands/qa.js:118-123` (`holdLock`) and `runShell` at 165-176. The signal handler removes the
lock and exits the parent, but the child shell spawned by `runShell` is not killed. The lock then
says "free" while `npm test` is still writing into that worktree, so the next `rig qa` resets and
re-pins it under the running suite. That is the exact "run killed mid-way by a re-pin" the lock was
built to stop.
Reproduced: `rig qa HEAD --run "sleep 3; touch marker"`, SIGTERM the parent → lock gone, a second
`rig qa` took `qa` immediately, and the marker still appeared 3 s later from the orphaned child.
The test at `test/qa-finish.test.js:139-141` asserts only that the lock is gone; it would pass with
the orphan and does. Check: keep the child handle, send it the same signal in the handler (it is our
own child, in the worktree we hold, so the "only by working directory" rule is satisfied), wait for
it, then release.

### 3. Two runs started in the same instant on a repo with no `qa` worktree yet
`src/worktrees.js:193` creates the worktree with `ensureDetachedWorktree(root, cfg, id, ref, opts)`
BEFORE the `wx` lock at line 195, and that first call has no `keep: [QA_LOCK_KEEP]`, so its
`git clean -fd` can delete a lock another run wrote a moment earlier. Three rounds of two
simultaneous `rig qa HEAD` on a fresh repo gave: round 1 both runs "QA worktree qa pinned" (two
suites in one tree), rounds 2-3 one run crashed with
`Error: Command failed: git worktree add --detach …/.worktrees/qa` instead of moving to `qa-2`.
A crew where two slices type `rig qa` at once is the normal case, not the corner.
Check: make the slot directory and write the lock first (`mkdir -p <path>/.rig` works before
`git worktree add` if the add is given an existing empty-but-for-.rig dir via `--force`, or lock in
`<worktreeBase>/.qa-<n>.lock` beside the worktree instead of inside it), and catch the `worktree add`
failure as "taken while we looked" → next slot.

### 4. A negative-control run that dirties a tracked file is not gated
`src/commands/finish.js:171-173` reads `dirtied` from the `test` entry only (`qa = lastQaOn(root, sha)`
at line 154); `src/commands/qa.js:79-82` also subtracts the test run's paths from the negative run's
record via `seen`. Source-patching negative controls are precisely the runs most likely to leave a
patched file behind (the Biome lesson in the plan).
Reproduced: `rig qa HEAD --run true --negative "echo patched >> log.txt"` → negative entry has
`dirtied: ["log.txt"]`, printed correctly, but `QA left the tree clean = ok` and the finish gate passes.
Check: gate on the union of the test entry's and `lastNegativeOn`'s `dirtied`, naming which run.

### 5. Every passing `rig finish` jots and touches the registry again
`src/commands/finish.js:96-99`. Issue closing is idempotent (`ghIssueClose` checks state) but `jot`
and `apps touch` are not. The natural sequence is `rig finish` (look), then `rig finish --wrap "…"`
(the plan's own dogfood step), which the desk test itself performs at
`test/qa-finish.test.js:310-327`: the decision log gets two identical
`[<slug>] <title>: finished at <sha>…` lines. The test asserts `lines.includes(...)`, never a count,
so the duplicate is invisible to it.
Check: record the desk actions in the qa-history (or a `.rig/finish.json` keyed by sha) and skip
`jot`/`apps touch` when the same sha was already jotted, saying "already jotted on <sha>".

### 6. `--wrap` is swallowed silently in two cases
`src/commands/finish.js:42-44`. `rig finish --wrap` with no message: `argOf` returns `undefined`,
nothing runs, exit 0, no message. `rig finish --wrap "msg" --no-desk`: `--no-desk` wins and wrap is
skipped without a word. Both reproduced (exit 0, desk log shows no `wrap`). The lead who typed
`--wrap` will believe the session was wrapped. Check: exit 2 with "`--wrap` needs a message" like
`qa.js:38-43` does for `--run`, and either refuse the combination or say "wrap skipped (--no-desk)".

### 7. Slug fallback disagrees with rg2's `slugFor`
`src/commands/finish.js:77` uses `cfg.slug || root.split('/').pop()`. rg2's `init.js:67 slugFor`
lower-cases and dashes the directory name, and it writes that into `cfg.slug`. For a repo `rig init`
2.0 set up (no `slug` in config) with a directory named e.g. `Rig` or `Depot Draw`, finish jots under
`[Rig]` / `[Depot Draw]` and runs `apps touch Rig`, which is not the registry's slug. By reading;
the desk test only uses a config with `slug` set. Check: apply the same normalisation (copy the
three-line function; you cannot import rg2's file yet) so both slices name the app the same way.

### 8. `USAGE` says the test exit is `rig qa`'s exit; the code says otherwise
`src/commands/qa.js:23-24` vs line 86 (`if (exit === 0) exit = code`). With a configured
`negativeCommand` every `rig qa` now also runs the negatives, and a red negative makes `rig qa` exit
non-zero even when the tests are green. The behaviour is fine and tested (`test/qa-finish.test.js:189`);
the usage text is wrong. Check: say "the first non-zero of test then negative".

## Notes for the lead (not rg1's files)

- `src/commands/down.js:19` tears down `[...sliceIds, 'qa']` only: `qa-2`, `qa-3`… are never removed,
  and `qa` is removed even while `.rig/qa.lock` holds a live pid (its process is stopped by cwd, which
  is allowed, but the running `rig qa` then records a dead exit as a real result). rg1 could export a
  `qaSlots(root, cfg)` from `worktrees.js` for `down` to use. `down.js` has no owner in the 3.0 plan.
- `PLAN.md:61` says "Negative-control command for this repo: `npm run demo` …". rg2's parser
  (`plan.js negativeCommand`) matches only `Negative controls?: <cmd>`, so on this repo
  `plan.negativeCommand` is `null`: `rig qa` will not run the negatives by itself, while
  `wantsNegative` (finish.js:201-203) is true because the word appears. The dogfood `rig finish` will
  fail until the lead passes `--negative` or the plan line is rewritten as `Negative controls: <cmd>`.
- `test/workflow.test.js` goes red on the new `reviewed` gate, as the build report says; its patch in
  `docs/build-report-rg1.md` is correct and is the lead's to apply.
- `desk.js:46` runs `gh auth status` once in `deskActions` and again per issue in `ghIssueClose`;
  each is a network round-trip with no `timeout` on `spawnSync`. Offline it reports "not logged in",
  which is misleading but harmless. Low.

## What I could not fault
Reset-by-path reporting, `--fresh` keeping the lock (verified: `.rig/qa.lock` survives `-fdx`), stale
lock removal, the branch-checkout-in-a-slot skip, `lastQaOn` kinds, the review-timestamp comparison
on fast-forward merges, and the desk being untouched on a failing gate all behave as the plan asks.
