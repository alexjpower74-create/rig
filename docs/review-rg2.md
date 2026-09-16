# Review — rg2, second round

Reviewed the fix commits on main, `f52c760` (code and tests) and `6724471` (report), against the six
findings of the first-round review and the "Review findings acted on" section of
`docs/build-report-rg2.md`. Read only. The suite was run in a detached scratch worktree at main:
`test/up-guard-init.test.js` → 23 passed, 0 failed, 0 void, 0 unproven, so every `breaks` control was
seen red by the harness in that run.

## The six findings

1. **2.0 literal `../.rig-worktrees` reads as unset** — fixed (`src/config.js:80`). `rig init` re-saves the
   resolved path (`src/commands/init.js:16-18`). Test `review 1` goes red when the config holds any other
   explicit value, and would go red without the fix (the literal would be honoured). Confirmed.
2. **PLAN.md wording and trailing prose** — fixed (`src/plan.js:117-122`); this repo's PLAN.md now also
   uses the plain `Negative controls: npm run demo` form. Test `review 2` reads the live PLAN.md and goes
   red when the backticked span is removed from the prose form. Confirmed, with two new edges below.
3. **Detached HEAD vs unborn** — fixed (`headState`, `src/config.js:108-114`; `src/commands/guard.js:19-39`).
   Test `review 3` stages a file outside c1 on a detached checkout and expects REFUSED; red when the file
   is inside c1, and red without the fix (exit 0 "unborn"). Confirmed, with one gap below.
4. **Issue reuse paging** — fixed (`src/issues.js:46`: open only, limit 200). The stub now pages like gh
   and the test proves the stub pages before using it. Red when the open title stops matching; red
   without the fix (open issue falls off the page of 30, c1 created twice). Confirmed.
5. **`Issue:` inside Task** — fixed (`src/plan.js:91`). Red when the line is dropped (`issue` null); red
   without the fix (task truncated). Confirmed. `Report:` inside Task still truncates, as in 2.0; not
   in this finding, noted only.
6. **Registry "once" control** — fixed. The control deletes the file between runs so `apps new`
   legitimately runs twice; the stub is untouched and logs every call before deciding, so an
   `ensureRegistry` that ignored `existsSync` would also be counted. Confirmed.

## Second-round findings

### A. The widened wording match turns a prose bullet into a command (src/plan.js:117)
`/^negative[- ]controls?[^:`]*:\s*(.+?)\s*$/` now matches any Checks line that starts "Negative
control(s) … :" and takes the tail after the first colon; the first match wins. Verified:
`- Negative controls are re-run after any formatter, on the new sha: a reformat un-anchors the check`
placed above the real line yields `a reformat un-anchors the check`, and `rig finish` would run that
as the shell command. That sentence is the CLAUDE.md rule leads copy into plans. Check: accept only the
two wordings named in the comment (`controls?:` and `-control command( for this repo)?:`), or when the
value has no backticked span require it to look like a command (no sentence punctuation); add the
prose bullet as a red case.

### B. A backticked span inside a placeholder wins over the placeholder test (src/plan.js:120-122)
The span is taken before `<...>` is checked, so `Negative controls: <e.g. \`npm run demo\`>` yields
`npm run demo` (verified). The shipped template lost its backticks for exactly this reason, but a lead
who writes their own placeholder, or an older plan made from the 2.0 template that still carries the
backticked example, gets a command they never chose. Check: test `^<.*>$` on the raw value first, then
take the span; add the backticked placeholder as a red case (expects `null`).

### C. Detached HEAD inside a slice worktree still passes the hook unenforced (src/commands/guard.js:33-39)
The slice is inferred from the branch only. A `git commit --amend` while resolving a rebase conflict,
or an agent that checked out a sha in its worktree, runs the pre-commit hook on a detached HEAD in a
directory that already names the slice (`<worktreeDir>/<id>`), and the guard prints "detached HEAD, no
slice named" and exits 0. The first-round fix made `--agent` work there, but the hook never passes
`--agent`. Check: infer the id from `process.cwd()` under `worktreePath(root, cfg, id)` before falling
back to the branch; test by detaching inside a slice worktree, staging a stray file and running
`rig guard --staged` with no `--agent`, expecting REFUSED (red when the file is inside the slice).

## For the lead
- A and B are parser edges in rg2's own file; C touches guard.js, also rg2's. No other slice's files
  are involved.
