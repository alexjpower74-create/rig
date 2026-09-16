# Rig

## Standing rules (every project, read by Claude Code and Codex alike)

CLAUDE.md is a symlink to this file, so Onyx (Claude Code) and Cobalt (Codex) read the same text. Edit AGENTS.md only.

- **Read PLAN.md first where it exists; it is the contract.** Own only your slice's files.
- **What "done" means:** verified, committed (only your own paths, with a message that says what and why), pushed, and shown: a screenshot via `pwshot` for anything visible. Never hand back an empty screen; seed demo data if the UI needs it. Never leave a green step uncommitted.
- **Nothing leaves without Alexander.** Emails, forms, applications, posts, marketplace submissions and pull requests to other people's repos are staged to one click; he presses send.
- **Tests that cannot lie.** A bug that reached a person gets a test that fails without the fix, proved by reverting the fix. Every guard (grep, lint, check) is shown to fail on a known-bad input in the same run: a check that cannot fail measured nothing. Real dependencies over mocks where practical. Hit-test with elementFromPoint, never rects.
- **Public-repo hygiene.** No secrets, no machine names, no home-folder paths, no invented businesses. Real businesses appear only where Alexander chose to show them. Run `check-no-personal-data` before pushing a public repo.
- **Browser work.** Playwright is the default; WebKit check before calling a WKWebView page done; the Chrome extension only for pages that need his real login.
- **Keep this file short:** commands, gotchas with a why, hard rules. Architecture belongs in the code and README.

## Rules learned
- Slice tabs are found by the plan's own ids, never a label pattern: give every project its own slice-id prefix. (2026-09-15)
- Never read a test run's exit code through a pipe; rig qa runs under pipefail and records the exit. (2026-09-15)
- Stop only processes whose working directory is inside your worktree; never pkill by name. (2026-09-15)
- Review before merge: a slice with code changes needs docs/review-<id>.md on base before rig finish will pass it. (2026-09-16)
- Re-run the negative controls after any formatter, on the new sha: a reformat un-anchors the check that was shown red on the old one. (2026-09-16)
- A test never leaves a tracked file dirty: rig qa names any file the run modified, and rig finish fails on it. (2026-09-16)
- QA worktrees are per project and per run: one shared directory meant one build graded another build's sha. (2026-09-16)
