# Review — rg2 · Plan, up, guard, init: issues, registry, unborn HEAD, per-project worktrees

Reviewed `git diff main...rig/rg2` (5bff511) against PLAN.md and rig/rg1 as it stands today. Read only;
nothing edited. The slice's own suite is green in a detached scratch worktree at 5bff511 (18 passed).
Every probe below was run against that worktree, not the shared tree.

## Findings

### 1. The per-project worktree default never reaches a repo that 2.0 initialised (src/config.js:75-77)
2.0's `rig init` saved the whole of `DEFAULTS` into `.rig/config.json`, so every repo initialised
before 3.0 carries an explicit `"worktreeDir": "../.rig-worktrees"`. `withWorktreeDir` only fills the
per-repo value when the key is absent, so those repos keep sharing one directory. Verified: a repo whose
config holds `{"worktreeDir":"../.rig-worktrees"}` loads `../.rig-worktrees`, not
`../.rig-worktrees/<repo>`. Those are exactly the repos that collided on 2026-09-15 (this repo had to be
hand-edited to `../.rig-worktrees-rig`). Check: treat the literal 2.0 default as unset (or have
`rig init` rewrite it, saying so), add a test whose config holds the 2.0 value, and put the migration
note in the README text handed to rg4.

### 2. The root PLAN.md's own negative-control line does not parse (src/plan.js:112-121)
This repo's Checks section says "Negative-control command for this repo: `npm run demo` must still
print…". `negativeCommand` wants `Negative controls: <cmd>` at line start, so `plan.negativeCommand` is
`null` for the plan the dogfood runs on. rg1's `wantsNegative` still turns the gate on because the
section mentions "negative", so `rig finish` on this repo will fail with no command to run unless the
lead passes `--negative` by hand or sets `cfg.negativeCommand`. PLAN.md is in nobody's Owns list, so
this is the lead's line to change (or the parser's to widen). Also, a trailing note after a backticked
command breaks it: `Negative controls: \`npm run demo\` (one VOID and one FAIL)` yields
``npm run demo` (one VOID and one FAIL)`` (verified), which a shell will not run. Check: when the value
holds a backticked span, take the span; add the two cases as red checks.

### 3. A detached HEAD is reported as an unborn branch, and `--agent` is ignored there (src/commands/guard.js:26-30)
`currentBranchOrNull` returns `null` for both an unborn HEAD and a detached one. Under `--staged` the
guard then prints "first commit on an unborn branch: nothing to enforce yet" and exits 0 in any detached
checkout, including `rig guard --staged --agent c1`, which names a slice and should still be enforced.
Verified on a detached checkout with a staged file. Check: tell the two apart (`git rev-parse --verify
HEAD` fails only when unborn); on detached HEAD with `--agent`, enforce; without, say "detached HEAD".

### 4. Issue reuse pages out on a busy repo (src/issues.js:41-44)
`gh issue list` returns 30 results by default, newest first, and the call asks for `--state all`. Slice
ids repeat across builds (c1, c2 … on every plan), so on a repo with more than 30 closed `c1 …` issues
the one open one falls off the page and `rig up` opens a duplicate. Only OPEN issues are ever used, so
`--state open` (plus a `--limit`) removes the case. Check: stub list with 31 closed matches and one open.

### 5. An `Issue:` line inside the Task block silently truncates the task (src/plan.js:88-89)
`Issue:` resets `mode` to `null`, so any task text after it is dropped from `agent.task`. Verified:
`Task:\nDo it.\nIssue: 5\nMore.` gives task `Do it.`. `Report:` behaves the same in 2.0, but the
template now invites the line, and a lead who puts it at the end of a slice loses whatever follows.
Check: keep `mode` when the line appears inside Task, or only honour `Issue:` before `Task:`.

### 6. The registry "once" control breaks the stub, not the behaviour (test/up-guard-init.test.js:376-382)
The `breaks` for "creates the registry file with `apps new` once, and never when it exists" makes the
stub log twice per call, so the assertion goes red on the first `rig init`. Nothing about the
second-run path ("never when it exists") is shown to be able to fail: a version of `ensureRegistry`
that ignored `existsSync` and ran `apps new` again would fail against the stub's own "exists" exit and
be reported, but that is the stub refusing, not the code. `void original` on line 381 is a leftover.
Check: a control that removes the registry file between the two runs (so `apps` legitimately runs
twice) or pre-creates it and expects zero calls.

## For the lead
- Finding 1 wants one line in the README (rg4 owns it) and the rewrite-or-alias decision.
- Finding 2 wants a line in PLAN.md, which no slice owns.
