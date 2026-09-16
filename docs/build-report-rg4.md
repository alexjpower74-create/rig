# Build report — rg4 · 3.0.0: entry point, per-command help, changelog, README, rulebook, test runner

Branch `rig/rg4`. Commits: `7ddeccc` (code), `44b8ba5` (docs), plus this report.

## What I built — all DONE
- **bin/rig.js.** `roll` in COMMANDS with the exact line from the plan's rg3 section. A `USAGE` map
  with every flag the 2.0 and 3.0 commands take (up `--no-issues`, qa `--negative`/`--fresh`, finish
  `--no-review`/`--no-desk`/`--wrap`, init `--slug`/`--name`/`--no-registry`, roll's four verbs).
  `rig <cmd> -h|--help` prints `rig <cmd>  — <description>` and the usage, exits 0, and runs before
  the `import()` of the command module, so nothing is created. Banner says the 3.0 loop: plan, build,
  prove, review, show, finish (jot, issues, registry), ship.
- **package.json / package-lock.json.** version 3.0.0; `test` is `node test/run.js`; `demo`,
  `demo:watch`, `files` unchanged.
- **test/run.js.** Lists every `test/*.test.js` up front, runs each in name order as a child process
  with stdio inherited (plain `node <file>`: harness suites and node:test files both exit non-zero on
  failure under plain node), stops at the first failure and exits with its status. rg1–rg3's new
  test files are picked up with no package.json edit.
- **CHANGELOG.md.** `## 3.0.0 — the workflow's desk built in`: the night's paragraph, then Review
  before merge, QA that never refuses, Negatives after formatting, A clean tree after npm test,
  Issues opened and closed by the rig, Registry and log, rig roll, Fixes (per-project worktree dir,
  unborn HEAD, `--staged` on main, `--help` that creates nothing, the runner).
- **README.md.** Command list with roll and the new flags; new sections: The QA worktree is yours
  alone, Formatters un-anchor negative controls, A test that writes a tracked file, Review is a gate
  not a command, One issue per slice, jot and the registry (generic: two commands on PATH, called
  when present), Roll: one brief many repos. "herdr or tmux" kept, tabs still land in the workspace
  the rig runs in. Eight new bullets under "Why these rules and not others".
- **AGENTS.md.** Four rules dated 2026-09-16 added through `addRule` from `src/commands/rule.js`
  (the tool's own function and format). I did not run `rig rule` as a command: from a linked
  worktree it resolves `mainRoot()` and would have written the MAIN checkout's AGENTS.md, outside
  my tree. Same text, same format, right file.

## What I verified, and the red
- **`--help` creates nothing.** On a fresh `git init` repo with no plan, no commit and no worktree:
  ```
  $ rig qa --help
  rig qa  — grade from a clean QA worktree pinned to an exact commit, per project and per run: ...
  USAGE
    rig qa [<sha>] [--run "<cmd>"] [--negative] [--fresh] [--port <n>] [--ref <ref>] [--branch <name>]
  exit=0
  $ rig finish --help        → usage, exit=0
  $ rig roll --help          → usage (four verbs), exit=0
  $ git status --porcelain   → (empty)
  $ git worktree list        → the bare repo only
  ```
  **Red:** the 2.0 `bin/rig.js` on the same bare repo: `rig qa --help` imported qa.js and died in
  `git rev-parse --abbrev-ref HEAD`, exit 1, help never printed. On a repo with a commit it would
  have made the worktree; that is the night's bug.
- **Runner stops on the first failure.** `test/aaa-deliberate-fail.test.js` containing
  `process.exit(3)` was added: `npm test` listed 8 files, printed
  `test/run.js: aaa-deliberate-fail.test.js exited 3 — stopping here`, exit 3, with no later file
  run (18 lines of output). Removed; `git status` clean. Then green: 7 files, exit 0.
- **`rig qa 44b8ba5 --run "npm test"`:** `rig qa: exit 0 at 44b8ba5`, `test/run.js: 7 file(s)
  green`, recorded in `.rig/qa-history.jsonl`. (Ran on the 2.0 qa.js; rg1's per-run tree lands at
  merge.)
- **Negative control for this repo:** `npm run demo` prints exactly one VOID and one FAIL
  (`sticky nav vs the CTA: 1 passed, 1 failed, 1 void, 1 unproven`).
- **`tools/check-no-personal-data --self-test && tools/check-no-personal-data`:** both clean.

## Left undone / for other slices
- **USAGE flags for rg1–rg3 are from the plan, not their code.** If a slice adds or renames a flag
  (roll's `--dir`, qa's `--fresh`), tell me or edit the `USAGE` line in `bin/rig.js` at merge.
- **CHANGELOG "unborn HEAD" and "`--staged` on main" entries** describe rg2's fix from the plan; if
  rg2's mechanism differs, the wording should follow it.
- **The README's `rig roll status` transcript is illustrative** (made-up slugs); replace with rg3's
  real output at merge if it differs in shape.
- `docs/FINISH.md` is the lead's, written by `rig finish` on the final sha.
- Nothing pushed, no release, no tap update: the owner's call after `rig finish`.
