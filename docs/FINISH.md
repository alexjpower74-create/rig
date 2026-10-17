# Rig 5.0 — briefs that aim high, bars you can measure, taste you can click — finished report

Commit: `51038d5`

## What changed
- `rig up` writes slice briefs that open with the mindset block and carry the new sections, in this
  order: feeling, specialist, best at this job (with anti-references), bar, who it's for, where
  we're starting from, what must not happen or change, freedom, tools, checks, budget and autonomy,
  what to hand back. `rig review` and `rig roll up` briefs open with the block too.
- `rig up` names any missing feeling, references or bar, and says when the bar has no number.
- `s.target(...)` and `countInput(page)` exist in the harness, and are documented in their source.
- `rig taste` opens a rating board, saves every tap, and writes `docs/TASTE.md`. Slice briefs point to
  that file when it exists.
- The version is 5.0.0. The lead writes the README and the CHANGELOG from the build reports.

## The proof
- `npm ci --silent && npm run check` exited **0** on `51038d5` (2026-10-17T01:11:38.128Z)
- ✓ fv1 merged
- ✓ fv2 merged
- ✓ fv3 merged
- ✓ fv1 reviewed — docs/review-fv1.md
- ✓ fv2 reviewed — docs/review-fv2.md
- ✓ fv3 reviewed — docs/review-fv3.md
- ✓ no uncommitted work
- ✓ QA green on 51038d5 — npm ci --silent && npm run check
- ✓ negative controls red on 51038d5 — npm run demo
- ✓ QA left the tree clean
- ✓ fv1 report — docs/build-report-fv1.md
- ✓ fv2 report — docs/build-report-fv2.md
- ✓ fv3 report — docs/build-report-fv3.md
- ✓ a check was shown to go red
- ✓ the plan’s brief is complete
- ✓ screenshots — 8 in docs/
- ✓ README

## Desk
- ✓ close fv1 issue #8
- ✓ close fv2 issue #9
- ✓ close fv3 issue #10
- ✓ jot "[rig] Rig 5.0 — briefs that aim high, bars you can measure, taste you can click: finished at 51038d5; npm ci --silent && npm run check exit 0; 3 slices"
- ✓ apps touch rig
- next: `wrap rig "Rig 5.0 — briefs that aim high, bars you can measure, taste you can click: finished at 51038d5; npm ci --silent && npm run check exit 0; 3 slices"`

## The pictures
- `docs/shots/taste-comps-desktop-dark.png`
- `docs/shots/taste-comps-desktop-light.png`
- `docs/shots/taste-comps-phone-dark.png`
- `docs/shots/taste-comps-phone-light.png`
- `docs/shots/taste-round-desktop-dark.png`
- `docs/shots/taste-round-desktop-light.png`
- `docs/shots/taste-round-phone-dark.png`
- `docs/shots/taste-round-phone-light.png`

## Where it lives
The existing public repo (MIT), installed by `npm link` and the Homebrew tap. This is a local build:
the release, the tag and the tap update are the lead's to do, on Alexander's word, after `rig finish`.

## Hard rules this build had to keep
- The mindset block is Steve's text, byte-exact. Never paraphrase, trim or reflow it.
- Never open a browser window on Alexander's screen from a test. Tests run headless, and every `rig taste` test passes `--no-open`.
- Existing harness API and behaviour stay as they are. Changes are additions only, and every existing test passes unchanged.
- No dependencies. Node 22+. No personal data in tracked files: no home paths, hostnames or emails.
- Never type into a running agent's pane. Never open a new herdr workspace or a split pane.
- Never grade the shared tree. Every number in a report names its sha.
- Never push, tag, release, deploy or post. The release is Alexander's word, carried out by the lead.
- No AI credit anywhere: commits, docs, comments.
- Do not edit files outside your Owns list. Say so in your report and let the owner change them.

## Staged for the owner, and still owed
- None for the crew. The lead brings Alexander the release: version bump, tag, Homebrew tap.

