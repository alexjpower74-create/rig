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
