# Rig 3.0 — the night's lessons built in — finished report

Commit: `ce28029`

## What changed
- `rig up` names the slices, opens one tab per slice in the CURRENT herdr workspace, and, when `gh` and a
  remote exist, opens one GitHub issue per slice ("<id> <title>") and records the numbers. Each brief
  carries its issue number.
- `rig qa <sha>` never refuses: it always grades from a clean detached worktree pinned to exactly that sha,
  per project, that no other run is using, and it reports any tracked file the test run dirtied by name.
- `rig finish` fails while a slice is unreviewed (no `docs/review-<id>.md` on base for a slice that has
  code changes), unmerged, dirty, without a green QA on this sha, or, when the plan or config names a
  negative-control command, without that command recorded green on this same sha. It closes the slice
  issues with the QA line, runs `jot "[<slug>] …"` and `apps touch <slug>`, and prints the `wrap` line.
- `rig init` creates the registry file with `apps new <slug> "<Name>"` when `apps` is on PATH and the
  file is missing, and stores the slug in `.rig/config.json`.
- A first commit in a fresh repo with the guard hook installed succeeds.
- `rig roll <brief.md>` launches N tabs in the current workspace from a brief with per-tab repo lists,
  writes a brief per tab, and `rig roll status` shows per repo: untouched / in progress / committed
  (sha) / pushed / skipped, read from the repos themselves.
- `rig <cmd> --help` prints that command's usage and creates nothing.
- Version 3.0.0, CHANGELOG entry, README updated, the suite green with every new check shown red once,
  `check-no-personal-data` clean.

## The proof
- `npm test` exited **0** on `ce28029` (2026-09-16T05:35:42.155Z)
- ✓ rg1 merged
- ✓ rg2 merged
- ✓ rg3 merged
- ✓ rg4 merged
- ✓ rg1 reviewed — docs/review-rg1.md
- ✓ rg2 reviewed — docs/review-rg2.md
- ✓ rg3 reviewed — docs/review-rg3.md
- ✓ rg4 reviewed — docs/review-rg4.md
- ✓ no uncommitted work
- ✓ QA green on ce28029 — npm test
- ✓ negative controls red on ce28029 — npm run demo
- ✓ QA left the tree clean
- ✓ rg1 report — docs/build-report-rg1.md
- ✓ rg2 report — docs/build-report-rg2.md
- ✓ rg3 report — docs/build-report-rg3.md
- ✓ rg4 report — docs/build-report-rg4.md
- ✓ a check was shown to go red
- ✓ the plan’s brief is complete
- ! screenshots — none under docs/ — show it before calling it done
- ✓ README

## Desk
- – close slice issues — no .rig/issues.json (rig up opens them when gh and a remote exist)
- ✓ jot "[rig] Rig 3.0 — the night's lessons built in: finished at ce28029; npm test exit 0; 4 slices"
- ✓ apps touch rig
- next: `wrap rig "Rig 3.0 — the night's lessons built in: finished at ce28029; npm test exit 0; 4 slices"`

## The pictures
- none yet

## Where it lives
Existing public repo ~/Projects/Rig (github.com/alexjpower74-create/rig, MIT), installed by `npm link`
and the Homebrew tap. Local build; the release and the tap update are the owner's call after `rig finish`.

## Hard rules this build had to keep
- Never type into a running agent's pane; never open a new herdr workspace or a split pane for an agent.
- Never grade the shared tree; every number in a report names its sha.
- Never delete or move a worktree, branch, or file that holds uncommitted work; QA worktrees may only be reset when nothing in them is tracked-and-modified by a person (a test's leftovers are named and reset).
- Never close a GitHub issue, jot, or touch the registry unless every finish gate passed. Never run `wrap` or `sync` unless `--wrap` was passed. Never push, release, deploy or post.
- Never stop a process by name; only by working directory inside a worktree being removed.
- Keep `harness/**` unchanged; the public harness API is `suite`/`check`/`launch`/input/hittest as is.
- No dependencies. Node 22+. No personal data (no home paths, hostnames, emails) in tracked files.
- Do not edit files outside your Owns list; say so in your report and let the owner change them.

## Staged for the owner, and still owed
- Should `rig finish` also require the slice issue to hold at least one comment from the agent (what is
  waiting on a person), or is the report file enough? Default in this plan: report file is enough.
- `rig roll` writes briefs under `~/.rig/rolls/`; should that be `~/.claude/rolls/` so `sync` carries it
  to the Mac? Default: `~/.rig/rolls/`, overridable with `--dir`.
- Homebrew tap and the 3.0 release notes: owner's call after `rig finish`.

- screenshots: none under docs/ — show it before calling it done
