# Build report — rg2: plan, up, guard, init (issues, registry, unborn HEAD, per-project worktrees)

Branch `rig/rg2`. Commits `44e9cc2` (code), `41acb13` (tests + one fix), plus this report.
Graded with the installed rig 2.0: `rig qa 41acb13 --run "npm test && node test/up-guard-init.test.js"`
→ `rig qa: exit 0 at 41acb13`. `tools/check-no-personal-data --self-test && tools/check-no-personal-data`: clean.

## What I built

- **Per-project worktrees** DONE. `loadConfig` resolves `worktreeDir` to `../.rig-worktrees/<repo dir name>`
  when the config has none (`defaultWorktreeDir` in `src/config.js`); an explicit value is honoured as is.
  `DEFAULTS.worktreeDir` stays `../.rig-worktrees` as the base. `rig init` writes the resolved value to
  `.rig/config.json`, prints it, and gitignores `.rig/` only.
- **Guard on an unborn HEAD, and `--staged` off a slice** DONE. `currentBranchOrNull` (config.js): `null`
  when HEAD is unborn or detached. In `guard`, `--staged` with no branch prints "first commit on an unborn
  branch: nothing to enforce yet" and exits 0; `--staged` with no slice id prints "not a slice branch
  (main); guard enforces slices only" and exits 0. Both happen before the plan is loaded, so a hook in a
  repo with no plan yet still lets the first commit through. Bare `rig guard` (no `--staged`, no id) still
  sweeps every worktree.
- **Issues per slice** DONE. `src/issues.js`: `openSliceIssues(root, plan, cfg)` → `{ ran, why, issues, lines }`.
  Order per slice: already in `.rig/issues.json` → the plan's `Issue:` line (url looked up with
  `gh issue view` when gh is here, else `null`) → an OPEN issue whose title starts with `<id> ` (reused) →
  `gh issue create --title "<id> <title>" --body <task + owns>`. Record shape `{ "<id>": { number, url } }`
  (what rg1's desk.js reads). Absent gh / auth / origin: one line "no gh/remote: issues not opened (why)".
  `rig up` calls it after the worktrees exist and before the briefs are written (they were reordered into a
  second pass so each brief can carry its issue); `--no-issues` and `cfg.issues: false` skip. `briefFor`
  prints "Your issue: #N <url> — the lead closes it at `rig finish`; put what is waiting on a person there".
  `DEFAULTS` gained `slug: null`, `issues: true`.
- **Registry at init** DONE. `rig init [--slug <slug>] [--name "<Name>"] [--no-registry]`. Slug defaults to
  the repo dir name lower-cased and dashed (`slugFor`), and is written to config. `ensureRegistry` runs
  `apps new <slug> "<Name>"` only when `apps` is on PATH (found by scanning PATH: `apps` has no `--version`)
  and `~/.claude/apps/<slug>.md` is missing, then prints the path with "fill in What it is / Where it stands
  / Next". An existing file is never touched and `apps` is never run for it.
- **Plan template and parser** DONE. `Negative controls: <cmd>` under Checks → `plan.negativeCommand`
  (backticks stripped; a `<placeholder>` reads as `null`). Per-slice `Issue: 42` / `Issue: #42` →
  `agent.issue`, kept out of the task text like `Report:`. Template gained the review rule under Rules and
  an optional `Issue:` line on c1. `briefFields` untouched; workflow.test.js still green.
- **AGENTS.md template** DONE: "Review before merge" and "After `npm test`, the tree is clean" bullets.
- **Tabs in the current workspace** DONE (test only; `src/herdr.js` untouched).

## What I verified, and the red I saw

`test/up-guard-init.test.js`: 18 harness checks, **0 void, 0 unproven** — the harness marks a check VOID
when its negative control also passes, so every one of these was seen red once in the same run. Stubs for
`gh`, `apps`, `herdr` and `rig` (the hook's `exec rig guard --staged`) sit on a PATH the test owns and log
their argv; HOME is a temp dir. Nothing reached GitHub, the registry or a terminal.

| Check | Made red by |
|---|---|
| two side-by-side repos get different worktree bases | writing the 2.0 default `../.rig-worktrees` into both configs |
| `rig init` writes resolved worktreeDir + slug, ignores `.rig/` only | a pre-written config naming another dir (proves explicit wins) |
| fresh repo + hook: first commit succeeds, hook says "unborn" | a `rig` on PATH whose `guard` exits 1 (proves the commit went through the hook) |
| `--staged` on main with c1's worktree dirty (untracked node_modules, README edited) passes | dropping `--staged`: the sweep sees c1's stray file → exit 1 |
| `--staged` in a slice worktree still refuses README.md | staging `app/x.js` instead |
| create / reuse-open / honour `Issue:`; exactly one `gh issue create`, CLOSED issue not reused | removing `origin` |
| second run creates nothing | deleting `.rig/issues.json` between runs |
| no origin → "no gh/remote: issues not opened" | adding an origin |
| no `gh` binary → why "no gh on PATH", gh never called | putting the stub back on PATH |
| `--no-issues` asks nothing | `issues: true` |
| brief carries "Your issue: #11 <url> — the lead closes it…" | `ctx.issue = null` |
| `rig up --no-launch` end to end: worktrees at `../.rig-worktrees/iss/<id>`, briefs carry #11 / #3 | `--no-issues` with no record |
| `rig init --slug --name` runs `apps new` once; second `init` never runs it | an `apps` stub that logs twice |
| `--no-registry` skips apps; bare init slug from dir name | dropping the flag with the file absent → `apps new` runs |
| `Negative controls:` and `Issue:` parsed, out of the task text | removing the line |
| template has review rule / Negative controls / Issue:, placeholders parse as empty | removing the line |
| AGENTS.md template bullets | removing the bullet |
| herdr: `attachHint` says "this workspace"; `newWindow` → `tab create --workspace w7 --label c1 --no-focus`, never `workspace create` or `pane split` | `HERDR_PANE_ID=w8:p0` |

Debugging note: the harness records a FAIL's thrown message but does not print it. The test wraps
`s.check` so `RIG_TEST_DEBUG=1` echoes it (harness untouched).

Bugs found by the tests while writing them: a slice pinned by the plan's `Issue:` line was printed twice
by `openSliceIssues` (fixed in `41acb13`).

## Left undone / decisions

- `rig <cmd> --help` is rg4's (bin/rig.js prints usage without importing the module); my commands add no
  help of their own. The flags rg4's USAGE map needs from me: `up --no-issues`;
  `init --slug <slug> --name "<Name>" --no-registry` (plus existing `--hook`).
- I did not run `rig review rg2`: `review.js` writes `docs/review-<id>.md` at the main root, outside my
  paths. The diff is ready for a reviewer (`git diff main...rig/rg2`).
- `openSliceIssues` records a plan-declared `Issue:` number even without gh (url `null`); that is a fact
  from the contract, not a GitHub action.

## For rg4 (README / CHANGELOG text)

- Worktrees now default to `../.rig-worktrees/<repo dir name>` (per project, written into `.rig/config.json`
  by `rig init`). An old `.worktrees/` entry in `.gitignore` is harmless; `rig init` no longer adds it.
- `rig init` creates the app registry file with `apps new <slug> "<Name>"` when `apps` is on PATH and the
  file is missing; `--slug`, `--name`, `--no-registry`.
- `rig up` opens one GitHub issue per slice (`<id> <title>`) when `gh`, its login and `origin` exist,
  reusing an open one with that title prefix, honouring a plan `Issue:` line, recording `.rig/issues.json`;
  `--no-issues`. Each brief carries its issue.
- The guard: the first commit on an unborn branch passes; `--staged` on a non-slice branch exits 0 without
  sweeping other worktrees.
- Plan: `Negative controls: <cmd>` under Checks → `plan.negativeCommand`; per-slice `Issue: N`.

## For rg1

`plan.negativeCommand` is `null` or the command string (backticks stripped). `.rig/issues.json` shape is
`{ "<id>": { number, url } }`, `url` may be `null`. Config has `slug` (string or `null`).

## Review findings acted on

Review: `docs/review-rg2.md` (the lead, 2026-09-16). All six fixed in `f52c760`; one check each in
`test/up-guard-init.test.js`, all shown red once (23 checks, 0 void). Graded:
`rig qa f52c760 --run "npm test && node test/up-guard-init.test.js"` → `rig qa: exit 0 at f52c760`.

1. **Per-project default never reached a 2.0-initialised repo** — DONE. The literal `../.rig-worktrees`
   in a config now reads as unset in `loadConfig` (any other explicit value is honoured); `rig init`
   writes the resolved path back. Red by: a config holding a different explicit value. For rg4's README:
   "a `.rig/config.json` written by rig 2.0 holds `../.rig-worktrees`; 3.0 reads that as the per-repo
   default and `rig init` rewrites it. Set any other path to keep a shared directory on purpose."
2. **Root PLAN.md's line did not parse; trailing prose broke the command** — DONE. `negativeCommand`
   accepts `Negative controls:` and `Negative-control command …:` wording, and takes the backticked span
   when there is one. The check reads this repo's own PLAN.md Checks section and gets `npm run demo`.
   Red by: removing the backticks from the prose form. The template placeholder lost its backticked
   example so it still parses as empty. No PLAN.md change needed.
3. **Detached HEAD reported as unborn; `--agent` ignored** — DONE. `headState` in config.js
   (`git rev-parse --verify -q HEAD` fails only when unborn). On a detached HEAD, `--staged --agent c1`
   enforces; without `--agent` it says "detached HEAD, no slice named" and exits 0. Red by: staging an
   in-slice file instead.
4. **Issue reuse paged out** — DONE. `gh issue list --state open --limit 200`. The stub now models gh
   (newest first, `--state` honoured, default 30) and the test first confirms the stub pages: 31 closed
   `c1 …` issues hide the open one under `--state all`. With the fix the open issue is reused and no
   `c1` created. Red by: the open issue's title no longer starting with `c1 `.
5. **`Issue:` inside Task truncated the task** — DONE. Inside a Task block the line is taken out of the
   text and the block continues. Red by: dropping the line (issue must read null).
6. **Registry control broke the stub** — DONE. The control now removes the registry file between the
   two `rig init` runs, so `apps new` legitimately runs twice and the "never when it exists" half goes
   red on its own terms. Stub untouched; the `void original` leftover is gone.

### Second round (docs/review-rg2.md "Second-round findings", plus rg4's bullets finding)

Fixed in `60291fd` on `rig/rg2` (main merged in first). Four new checks, all red once (27 checks, 0 void).
Graded with the installed rig 3.0: `rig qa 60291fd --run "npm test"` → `test exit 0 at 60291fd` and
`negative exit 0 at 60291fd` (the one VOID in that transcript is the demo suite's own, by design).

- **A. Prose bullet became the command** — DONE. `negativeCommand` matches only `Negative controls:` and
  `Negative-control command [for this repo]:` at line start. The CLAUDE.md rule "Negative controls are
  re-run after any formatter, on the new sha: …" placed above the real line now yields `npm run demo`.
  Red by: removing the real line (null).
- **B. Backticked span inside a placeholder** — DONE. `^<.*>$` is tested on the raw value before the span is
  taken; `Negative controls: <e.g. \`npm run demo\`>` is `null`. Red by: dropping the angle brackets.
- **C. Detached HEAD inside a slice worktree passed the hook** — DONE. `sliceFromCwd(root, cfg, cwd)` in
  guard.js: the slice whose `worktreePath` contains cwd (realpath, boundary-safe) is used before the branch
  and before the "no slice" exits, so bare `rig guard --staged` on a detached HEAD in `<worktreeDir>/c1`
  REFUSES a stray README.md. Red by: staging `app/x.js` instead. The plan is loaded lazily there; no plan
  means no inference, and the unborn path still never reads it.
- **D. `bullets()` cut wrapped rules at the line break** (rg4's review) — DONE. An indented line under a
  bullet is joined to it with a space, so `mustNotRules` and every brief carry "Never run wrap or sync
  unless --wrap was passed." whole. Red by: un-indenting the continuation (then it is a paragraph, not the
  rule). `test/workflow.test.js` still 12/12.
