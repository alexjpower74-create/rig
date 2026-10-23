# Rig 5.5 — the gate, watching, upstream and decisions, tests that hold anywhere — finished report

Commit: `c9bcf08`

## What changed
All seventeen items of docs/PLAN-5.5.md built, each check seen red then green, `npm run check` clean
on both machines, a second-vendor review passed on the final sha, and `rig finish` passing on it.
The lead writes README, CHANGELOG and releases 5.5.0.

## The proof
- `npm test` exited **0** on `c9bcf08` (2026-10-23T08:36:38.105Z)
- ✓ r55g merged
- ✓ r55q merged
- ✓ r55m merged
- ✓ r55u merged
- ✓ r55w merged
- ✓ r55g reviewed — docs/review-r55g.md
- ✓ r55q reviewed — docs/review-r55q.md
- ✓ r55m reviewed — docs/review-r55m.md
- ✓ r55u reviewed — docs/review-r55u.md
- ✓ r55w reviewed — docs/review-r55w.md
- ✓ no uncommitted work
- ✓ the stack merges with the live base — origin/main has not moved
- ✓ QA green on c9bcf08 — npm test
- ✓ QA green on the second machine (macOS) — exit 0, 467 passed, 0 failed beside exit 0, 468 passed, 0 failed here
- ✓ negative controls red on c9bcf08 — npm run demo
- ✓ QA left the tree clean
- ✓ second-vendor pass on c9bcf08 — openai: Reviewed all 18 files in 9b06fec..c9bcf08; desktop-free npm ci and npm run check on Node 26 (35 files green); real Node 22 baseline/repeat suite (21 passed); real Node 22 + Debian dash remote suite (18 passed). Zero new findings. The full report is kept outside the repo.
- ✓ decisions closed — 14 since 14a1ad6 (r55w was cut here), none open
- ✓ r55g report — docs/build-report-r55g.md
- ✓ r55q report — docs/build-report-r55q.md
- ✓ r55m report — docs/build-report-r55m.md
- ✓ r55u report — docs/build-report-r55u.md
- ✓ r55w report — docs/build-report-r55w.md
- ✓ a check was shown to go red
- ✓ the plan’s brief is complete
- ✓ screenshots — 10 in docs/
- ✓ README

## Second-vendor review
- pass from openai on `c9bcf08` (2026-10-23T08:37:46.088Z): Reviewed all 18 files in 9b06fec..c9bcf08; desktop-free npm ci and npm run check on Node 26 (35 files green); real Node 22 baseline/repeat suite (21 passed); real Node 22 + Debian dash remote suite (18 passed). Zero new findings. The full report is kept outside the repo.
- builders: anthropic (vendor "anthropic" in .rig/config.json)

## Decisions
- D1 (built (2026-10-23)): rig status --eta counts local and host QA stages once, at the longer, and leaves repeat stages out of the round — thread
- D2 (built (2026-10-23)): repeat runs record their own stages (qa:repeat, qa:host:repeat) — thread
- D3 (built (2026-10-23)): inboxes default to the XDG state dir; inboxDir keeps an existing layout — thread
- D4 (built (2026-10-23)): rig job never trusts a pane status left from its previous turn — thread
- D5 (built (2026-10-23)): every review brief carries the Ask these list (seven items) — thread
- D6 (built (2026-10-23)): timing checks measure the thing itself, not machine load; flake fixes prove it with --repeat 10 under load — thread
- D7 (scheduled 5.5.1 (2026-10-23)): the taste swipe-tap control under extreme synthetic load (VOID at load ~26) — thread
- D8 (scheduled 5.5.1 (2026-10-23)): baseline lists a green base's unproven check as new when the head is red for another reason — thread
- D9 (scheduled 5.5.1 (2026-10-23)): a watcher flags a peer done with nothing running and no report as needs a nudge — thread
- D10 (scheduled 5.5.1 (2026-10-23)): rebase and fold check migration numbering and load each commit's schema into a blank database — thread
- D11 (scheduled 5.5.1 (2026-10-23)): await stopped host runs before a later host stage starts, not only at the end — thread
- D12 (scheduled 5.5.1 (2026-10-23)): FINISH.md names the second machine by a label, never its ssh host — thread
- D13 (scheduled 5.5.2 (2026-10-23)): a host with dash as sh and neither setsid nor bash: warn that stops cannot reach the group, fall back to killing the pid — thread
- D14 (scheduled 5.5.2 (2026-10-23)): record per machine whether node shuffled a seeded repeat (shuffled true/false), so Node 22 seeds are not read as shuffled — thread

## Drift
- origin/main has not moved

## Desk
- skipped: --no-desk

## The pictures
- `docs/shots/taste-comps-desktop-dark.png`
- `docs/shots/taste-comps-desktop-light.png`
- `docs/shots/taste-comps-phone-dark.png`
- `docs/shots/taste-comps-phone-light.png`
- `docs/shots/taste-round-desktop-dark.png`
- `docs/shots/taste-round-desktop-light.png`
- `docs/shots/taste-round-phone-dark.png`
- `docs/shots/taste-round-phone-light.png`
- `docs/shots/taste-viewer-desktop.png`
- `docs/shots/taste-viewer-phone.png`

## Where it lives
This public repo (MIT), installed by `npm link` and the Homebrew tap.

## Hard rules this build had to keep
- File-slice ownership, the QA worktree pinned to a sha, negative controls, the mindset block, `rig taste`, and herdr tabs in the current workspace.
- No new dependency: node, git, herdr, ssh only. No npm packages.
- No test touches the real clipboard, the real display, a real second machine or a real herdr pane: fakes on PATH (`ssh`, `herdr`, clipboard tools) in temp dirs. Run suites with `env -u WAYLAND_DISPLAY -u DISPLAY`.
- No personal data in tracked files: no home paths, host names, emails, or names of people, companies or client repos. Examples stay generic. Run `check-no-personal-data` before you call it done.
- No AI credit anywhere: no Co-Authored-By trailers, no "generated with" lines.
- Every commit's author and committer is the repo owner's identity from git config. Commit with `env -u GIT_AUTHOR_EMAIL -u GIT_COMMITTER_EMAIL git commit …` (a session's environment may carry another address) and check `git log -1 --format='%an %ae / %cn %ce'` after each commit.
- Never push, tag or release. The lead merges, releases and publishes.
- Never type into another agent's pane. Never open a herdr workspace or split a pane.
- Do not edit files outside your Owns list. `bin/rig.js`, `README.md`, `CHANGELOG.md` and `package.json` are the lead's: put the USAGE text and README paragraph you want in your report.

## Staged for the owner, and still owed
- None for the crew. The lead brings the release.

