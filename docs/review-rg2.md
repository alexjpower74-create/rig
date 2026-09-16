# Review — rg2 · Plan, up, guard, init (final)

Confirmation pass on `60291fd` (merged into main at `31e42ce`), which acted on the second-round
findings. Read only. Verified in a detached scratch worktree at main, never the shared tree:

- `test/up-guard-init.test.js`: 27 passed, 0 failed, 0 void, 0 unproven (every `breaks` control seen red).
- `npm test`: 10 files green.
- With the `src/plan.js` and `src/commands/guard.js` hunks of `60291fd` reverted in that worktree, the
  same suite reports review A, B, C and D FAIL and the other 23 pass. Each new check fails without its
  fix, not only under its own control.

## Second-round findings

### A. Prose bullet taken as the command — CONFIRMED FIXED
`negativeCommand` (`src/plan.js:120`) now matches only `Negative controls:` and
`Negative-control command [for this repo]:`. Probed: the CLAUDE.md sentence placed above the real line
yields `npm run demo`; alone it yields `null`; this repo's live PLAN.md yields `npm run demo`. Test
`review A` goes red when the real line is removed, and red with the fix reverted.

### B. Backticked span inside a placeholder — CONFIRMED FIXED
The raw value is tested for `<...>` before the span is taken (`src/plan.js:122`). Probed:
`Negative controls: <e.g. \`npm run demo\`>` yields `null`. Test `review B` goes red when the angle
brackets are dropped, and red with the fix reverted.

### C. Detached HEAD inside a slice worktree unenforced — CONFIRMED FIXED
`sliceFromCwd` (`src/commands/guard.js:92-102`) names the slice from the directory under
`<worktreeDir>/<id>` before the branch is consulted; the plan is loaded in a try so a repo with no plan
still gets the unborn and main early exits. Test `review C` detaches inside c1's worktree, stages a
stray file and runs `rig guard --staged` with no `--agent`, expecting REFUSED; red when the staged
file is inside c1, and red with the fix reverted.

### D. Wrapped rules reach the brief whole (rg4's finding, fixed in the same commit) — CONFIRMED FIXED
`bullets` joins indented continuation lines. Test `review D` goes red when the continuation is not
indented, and red with the fix reverted. Noted here because the commit carried it; it is rg4's line
to close.

No findings remain open for rg2.

## History

**Round one** (on `5bff511`, fixed in `f52c760`): six findings, all confirmed fixed in round two.
1. The 2.0 literal `../.rig-worktrees` in a config kept repos sharing one worktree directory; it now
   reads as unset and `rig init` re-saves the per-repo path.
2. This repo's own negative-control wording did not parse, and trailing prose after a backticked
   command broke it; both wordings parse and the span is taken.
3. A detached HEAD was reported as unborn and `--agent` ignored there; `headState` tells them apart.
4. Issue reuse asked gh for all states and paged out past 30 closed matches; open only, limit 200.
5. An `Issue:` line inside a Task block truncated the task; the block now continues.
6. The registry "once" control altered the stub; it now removes the file between runs.

**Round two** (on `f52c760`, fixed in `60291fd`): three findings, confirmed above.
A. The widened parser regex turned a prose "Negative controls …:" bullet into the shell command.
B. A backticked span inside a `<placeholder>` won over the placeholder test.
C. The hook on a detached HEAD inside a slice worktree exited 0 because the slice was inferred from
   the branch only.
