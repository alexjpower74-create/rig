# Review — rg1 · QA hygiene and the finish gate (final)

Confirmation pass on `e9719c8`, merged into `main` at `31e42ce`. Each second-round finding was checked
three ways: the fix read in `git show e9719c8`, its test run green on `main`
(`node --test test/qa-finish.test.js`: 19 pass, 0 fail), and the fix reverted in a scratch detached
worktree at `31e42ce` to see the same test go red. Read only; nothing was edited.

## Verdicts

### 1. Forwarded signal stopped only the bash wrapper — CONFIRMED FIXED
`src/commands/qa.js`: `runShell` now spawns the command with `detached: true` (its own process
group) and `holdLock` signals the group with `process.kill(-child.pid, sig)`, falling back to the
pid; the SIGKILL backstop after 5 s does the same.
- Test reshaped as asked: `--run "sh -c 'sleep 2; touch marker'; true"`, a program the command
  started followed by another command, so bash's exec-optimisation cannot hide the orphan.
- Green on `main`. With the group signal reverted to `child.kill(sig)` the test fails on
  "the orphaned command must not keep writing into a tree the lock says is free".
- My original reproduction (`sh -c 'sleep 4; touch marker'; echo tail`, SIGTERM, second run) now
  leaves no orphan and no marker.

### 2. Two runs could both remove the same stale lock — CONFIRMED FIXED
`src/worktrees.js` `takeOverStaleLock`: the right to remove a dead-pid lock is claimed through an
exclusive takeover file (`<id>.lock.takeover-<pid>`, `wx`); the winner re-reads the lock, removes it
only if it still names the same dead pid, and deletes the claim; the loser is told the slot "was
taken while we looked" and moves on. A takeover file left by a crashed winner is itself taken over
when its pid is dead.
- New test starts two runs against a dead-pid lock and asserts `qa` and `qa-2`, exactly one
  "removed a stale lock", and the winner's lock released afterwards.
- Green on `main` five runs in a row. With the takeover reverted to a bare `rmSync`, it failed
  three of five runs. It is a timing guard rather than a deterministic one, which is inherent to
  the defect; the suite as a whole still cannot go green with the bug present on a normal run, and
  the odds are good enough to catch a regression across the crew's runs. Acceptable.

## Notes for the lead (unchanged, below the bar)
- `rig down` now names the lock file and says a rebooted machine can leave a reused pid in it; good.
- Committer-time skew across two machines can make a genuinely newer review read as "older"; the
  gate follows the plan's `%ct` rule, so this is a thing to know, not a defect.
- `docs/FINISH.md` at the root is still untracked and exempt from "no uncommitted work" by design.

## History

**Round one** (at `c9790d1`): eight findings — a squash-merged slice could never pass `reviewed`
while its branch existed; SIGTERM released the lock while the test command still ran; two first
runs on a fresh repo shared one slot or one crashed on `worktree add`; a negative run's leftovers
were not gated; every passing `rig finish` jotted and touched the registry again; `--wrap` was
swallowed with no message or with `--no-desk`; the slug fallback disagreed with rg2's `slugFor`;
usage misstated `rig qa`'s exit. All eight acted on in `9d3ebca`, each with a paired known-bad
test.

**Round two** (at `28828ac`): the SIGTERM fix signalled bash alone, so a real command's children
kept writing into a worktree whose lock had been freed (reproduced); and two runs that read the
same dead-pid lock could both remove it, the second deleting the first's fresh lock. Both acted on
in `e9719c8` and confirmed above.
