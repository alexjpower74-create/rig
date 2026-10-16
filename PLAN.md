# Rig 5.0 — briefs that aim high, bars you can measure, taste you can click

One plan file. It is the contract, and it lives at the repo root so every agent reads the same copy.
A plan is a brief first and a slice list second.

## The feeling
A Rig brief should read like it came from the best creative director the agent has ever worked
for: the aim is high, every target is a number, and nothing is left for the agent to guess. The taste
board should feel like flipping through a well-printed portfolio: calm and fast, where one tap brings
up the next page.

## The specialist
- fv1 writes like an **agency creative director** writing a one-page creative brief (single-minded
  proposition, audience, mandatories, the bar), checked by a **technical writer** for plainness.
- fv2 works like a **test-tooling engineer** who has shipped performance budgets: a number, a bar,
  a red build when the number crosses it, and the number printed either way.
- fv3 works like a **UX researcher running a preference test**: one stimulus at a time, a 1-to-5
  scale, no leading questions, every answer saved the moment it is given.

## The best at this job
- Briefs: Steve Clarke's creative prompt (its checklist is quoted in fv1's task); the agency
  one-page creative brief; GitHub issue forms (named fields, nothing to guess).
- Hard-number checks: Lighthouse CI budgets (`maxNumericValue` assertions), size-limit (prints the
  size against the limit and fails CI over it), k6 thresholds (`p(95)<200` printed per run).
- Rating board: Lyssna (UsabilityHub) preference tests, Typeform's one-question-at-a-time flow with
  number-key shortcuts, Mobbin's big single-screen view, Apple Photos' one-key rating.

Anti-references:
- A Google Form grid of radio buttons; a long page you scroll to hunt for Submit.
- A ticket that says "make it faster"; a timing test that passes against code that is slow.
- A brief that lists files and no people.

## The bar
- Every brief the rig writes (`rig up`, `rig review`, `rig roll up`) opens with the mindset block:
  3 of 3, byte-exact, once each, before the first `## ` heading.
- `rig up` on a plan whose bar has no number prints one warning line that says so.
- A target check prints the measured number beside its bar (`2 taps (≤ 3)`), and one whose broken run
  stays inside the bar is VOID. Both are shown in tests.
- Alexander rates 6 references in at most 7 taps (one per reference plus Done), with no typing and no
  scrolling, at 1440×900 and at 390×844. This is measured by an `s.target` walk with `countInput`.
- `npm run check` stays green (Biome, the full suite, the personal-data scan), and every existing
  test passes unchanged.

## What it's for
Agents left alone make the average of everything they have seen, sized to what a human team could
ship. Rig 5 builds Steve Clarke's creative prompt into the tool, so every agent the rig briefs gets:
the mindset block; the parts of a brief it cannot guess (feeling, specialist, references, a bar with
a number); a harness that measures that number and goes red when it is missed; and a taste round
Alexander answers by tapping ratings, not by describing what he wants.

## Who uses it, on what
Alexander's lead sessions (Onyx on Claude Code) on the PC and the Mac, under herdr, and the Opus
peers those leads launch. Alexander himself uses only `rig taste`, in a browser on a desktop or phone.
Public repo: anyone running multi-agent builds with worktrees.

## Where it lives
The existing public repo (MIT), installed by `npm link` and the Homebrew tap. This is a local build:
the release, the tag and the tap update are the lead's to do, on Alexander's word, after `rig finish`.

## Where we're starting from
Rig 4.0.0 plus the untagged ignore-probe fix (main at 7d40d97). `briefFor` (src/brief.js),
`reviewBrief` (src/commands/review.js) and `tabBrief` (src/roll.js) write the three kinds of brief.
`missingBrief` warns on five empty sections. The harness has `check()` with PASS / FAIL / VOID /
UNPROVEN and real input through `Input.dispatch*`. Nothing measures a number against a bar, and
there is no taste tooling.

## What done looks like
- `rig up` writes slice briefs that open with the mindset block and carry the new sections, in this
  order: feeling, specialist, best at this job (with anti-references), bar, who it's for, where
  we're starting from, what must not happen or change, freedom, tools, checks, budget and autonomy,
  what to hand back. `rig review` and `rig roll up` briefs open with the block too.
- `rig up` names any missing feeling, references or bar, and says when the bar has no number.
- `s.target(...)` and `countInput(page)` exist in the harness, and are documented in their source.
- `rig taste` opens a rating board, saves every tap, and writes `docs/TASTE.md`. Slice briefs point to
  that file when it exists.
- The version is 5.0.0. The lead writes the README and the CHANGELOG from the build reports.

## What must not happen
- The mindset block is Steve's text, byte-exact. Never paraphrase, trim or reflow it.
- Never open a browser window on Alexander's screen from a test. Tests run headless, and every
  `rig taste` test passes `--no-open`.
- Existing harness API and behaviour stay as they are. Changes are additions only, and every existing
  test passes unchanged.
- No dependencies. Node 22+. No personal data in tracked files: no home paths, hostnames or emails.
- Never type into a running agent's pane. Never open a new herdr workspace or a split pane.
- Never grade the shared tree. Every number in a report names its sha.
- Never push, tag, release, deploy or post. The release is Alexander's word, carried out by the lead.
- No AI credit anywhere: commits, docs, comments.
- Do not edit files outside your Owns list. Say so in your report and let the owner change them.

## Freedom
Wording, structure and names are yours, except for the contract below and the byte-exact block.
fv3 owns the board's whole look, within the bar. Where the plan doesn't settle a choice, decide it,
write it under "Decided" in your report, and carry on.

## Tools
Node 22, the harness (`harness/cdp.js` headless Chrome, `RIG_CHROME` to point at a binary), Biome
(`npx biome check --write <your files>`), `npm run check`, `rig qa <sha> --run "<cmd>"`, and
`rig review <id>`. For screenshots, use headless Chrome through the harness or `pwshot`, never a
visible window.

## Budget and autonomy
His plan's usage is finite (Max 5x): aim to finish your slice in one sitting, and spawn no
sub-agents. Decide everything that has an established answer yourself. Only a business decision goes
in your report as a question.

## What to hand back
Green commits on your branch. `docs/build-report-<id>.md` lists what you built, the red you saw for
each check, what you decided, and what's left. fv3 also adds screenshots of the board at desktop and
phone size, light and dark, to `docs/shots/` (fixture images only).

## Size and mode
Big: three slices. Cross-review happens EARLY, at each slice's first real commit, round-robin:
fv1 reviews fv2, fv2 reviews fv3, fv3 reviews fv1. Each slice is reviewed again before merge.
The lead merges in the order fv2, fv1, fv3.

## Checks
- `npm test` runs every `test/*.test.js`, and the existing tests stay as they are.
- Every new check uses `harness/check.js` (`s.check` with `breaks`, or the new `s.target` with
  `breaks`) or `node:test` with a paired known-bad case. The report says which check was seen red and
  how: the old implementation swapped back in, not just a changed input.
- `npm run check` is clean, and so is `tools/check-no-personal-data --self-test`.
- Negative controls: `npm run demo`
  (`examples/demo.test.js` must still print exactly one VOID and one FAIL.)

## Contract between slices
- **fv2 → fv1:** the harness exports `Suite#target(name, { measure, atMost, atLeast, unit, breaks,
  timeout })` and `countInput(page)`, from `harness/index.js`. fv1's brief text names them exactly
  so.
- **fv3 → fv1:** `rig taste` writes `docs/TASTE.md` at the repo root, with the headings
  `## Ratings`, `## Comps` (when a comps round ran) and `## Principles`. When that file exists in the
  main checkout, fv1's slice brief tells the agent to read it before designing: the ratings outrank
  the agent's own taste.
- **fv3 reads the plan** with the existing `parseSections` and `bullets` exports from `src/plan.js`.
  It does not change plan.js, which fv1 owns.

## Agents

### fv1 — Briefs that aim high
Owns:
- src/brief.js
- src/plan.js
- src/mindset.js
- src/commands/review.js
- src/commands/up.js
- src/roll.js
- templates/**
- test/brief-five.test.js

Report: docs/build-report-fv1.md

Task:
You are a frontier model working at agent speed, capable of more than you know. Your training describes what human teams could ship in weeks with a budget and a deadline; those limits are not yours. Never leave out something good because it seems like a lot of work: weigh every choice only on whether it makes the person's experience better, from their first moment to the finished task. Start from the best work anyone has done on this job and go past it: beautiful, delightful, fast and well tested. Ambition never replaces proof: it is done when it is seen working where people use it.

Build the creative prompt into every brief the rig writes.

1. `src/mindset.js` exports `MINDSET`, the paragraph above, byte-exact and on one line. It is the only
   copy in `src/`.
2. `briefFor`, `reviewBrief` and `tabBrief` open with `MINDSET` straight after the title line, before
   the first `## `, exactly once.
3. `briefFields` learns these anchored headings, with the aliases in brackets:
   `The feeling` (`The one quality`) → feeling. `The specialist` → specialist.
   `The best at this job` (`References`) → references, as bullets, plus `antiReferences` from an
   `Anti-references:` block inside that section or from a `## Anti-references` section.
   `The bar` → bar. `Where we're starting from` → start. `Freedom` → freedom. `Tools` → tools.
   `Budget and autonomy` → budget. `What to hand back` → handBack.
   `What must not happen` also accepts `What must not change` and `What must not happen or change`;
   when two of those sections exist, their rules are combined.
4. The slice brief carries each filled section, in the order given under "What done looks like".
   `<placeholder>` text never reaches a brief.
5. `missingBrief` also names The feeling, The best at this job and The bar. A new
   `barHasNoNumber(plan)` is true when the bar has no digit, and `rig up` prints one yellow line for
   it. Warn, never refuse.
6. Two new steps join the brief's loop. **The bar is a floor:** put the work beside the references,
   screenshots side by side for anything visible, and say where it holds up. **Hard numbers are
   checks:** write the bar as `s.target` with `countInput`, seen to fail once.
7. When `docs/TASTE.md` exists in the main checkout, the brief says: read it before you design; the
   ratings outrank your own taste; name the principles behind them in your report.
8. `reviewBrief` gains a fifth thing to look for: whether the bar is measured by a target check that
   was seen red, and how the work looks beside the references.
9. `templates/PLAN.md` gets the new sections in that order, each with a one-line `<placeholder>` in
   Steve's spirit. The existing sections stay. `templates/ROLL.md` gets an optional `## The bar`.

Test it in `test/brief-five.test.js` with `s.check` + `breaks`. For every check, the control swaps
the old Rig 4 function back in (copy it into the test), so the check goes red against Rig 4's real
behaviour.

### fv2 — Hard numbers you can run
Owns:
- harness/check.js
- harness/target.js
- harness/index.js
- test/target.test.js
- examples/target-fixture.html

Report: docs/build-report-fv2.md

Task:
You are a frontier model working at agent speed, capable of more than you know. Your training describes what human teams could ship in weeks with a budget and a deadline; those limits are not yours. Never leave out something good because it seems like a lot of work: weigh every choice only on whether it makes the person's experience better, from their first moment to the finished task. Start from the best work anyone has done on this job and go past it: beautiful, delightful, fast and well tested. Ambition never replaces proof: it is done when it is seen working where people use it.

Turn "a bar with a hard number" into a check that can go red.

1. `Suite#target(name, { measure, atMost, atLeast, unit = '', breaks, timeout })`:
   - `measure()` returns a finite number. Anything else is a FAIL that names what came back.
   - The check passes inside the bounds. With neither bound set, it throws a usage error.
   - With `breaks`, it measures again with the thing broken. If that number is still inside the bar,
     the check is VOID: "the number stayed inside the bar with the thing broken". If not, it is a
     PASS. Without `breaks` it is UNPROVEN, exactly as `check` is.
   - Every line prints the number and the bar, e.g. `PASS  accept a Sunday — 2 taps (≤ 3)`, plus the
     broken run's number. The result record keeps `value`, `brokenValue`, `bound` and `unit`.
     `report()` counts targets in the same four states.
2. `countInput(page)`: wraps the harness's own `tap`, `click`, `type`, `wheel` and `swipe` from
   `harness/input.js`, so all input stays real `Input.dispatch*`. It counts `taps` (a tap or a
   click is one), `keys` (characters typed), `gestures` (a wheel or a swipe) and `ms` since it was
   created or last `reset()`. `counts()` returns `{ taps, keys, gestures, ms }`.
3. `timeTo(fn)` returns the milliseconds an async fn took, for bars like "found in under 10 s".
4. Export all three from `harness/index.js`. The existing exports and behaviour don't change.
5. `examples/target-fixture.html` is a small page where accepting a shift takes 2 taps. The test's
   `breaks` adds a confirm step that makes it 4. Write `test/target.test.js` with headless Chrome on
   debugging port 9351. Show four things: a PASS whose break crossed the bar; a VOID whose break
   didn't move the number; a FAIL over the bar; a non-number from `measure`, reported as a FAIL.
   Then show that the old `Suite` (no `target`) makes the suite red.

### fv3 — Taste rounds he can click
Owns:
- src/commands/taste.js
- src/taste/**
- bin/rig.js
- test/taste.test.js
- docs/shots/**

Report: docs/build-report-fv3.md

Task:
You are a frontier model working at agent speed, capable of more than you know. Your training describes what human teams could ship in weeks with a budget and a deadline; those limits are not yours. Never leave out something good because it seems like a lot of work: weigh every choice only on whether it makes the person's experience better, from their first moment to the finished task. Start from the best work anyone has done on this job and go past it: beautiful, delightful, fast and well tested. Ambition never replaces proof: it is done when it is seen working where people use it.

Recognition, not recall: people know great when they see it but can't describe it in advance. Build
`rig taste`, so Alexander rates real examples by tapping, and agents get his ratings in writing.

1. `rig taste [--from <dir>] [--url <u>]... [--comps <dir> --ask "<question>"] [--port N]
   [--no-open] [--done]`. Register it in `bin/rig.js`, COMMANDS + USAGE.
2. References come from three places: image files in `--from`; URLs from `--url`; URLs in the
   bullets of the plan's `## The best at this job` section, read through `parseSections` and
   `bullets`. Each URL is captured headless through `harness/cdp.js` at 1440×900 and at 390×844,
   and the shots go under `.rig/taste/shots/`. Every `.rig` write goes through `rigDir()`. A URL that
   fails to load is named in the console and skipped, never shown as a blank card.
3. A zero-dependency local server on 127.0.0.1 (port `--port`, else `cfg.tastePort`, else 5391)
   serves one self-contained page, with inline CSS and JS. Unless `--no-open` is passed, it opens
   the page in the default browser (`xdg-open`, or `open` on macOS) and prints the URL.
4. The page shows one reference at a time, as large as the screen allows (phone shot beside desktop
   shot where both exist). Below it:
   - five big rating buttons, 1 to 5, that also answer to the number keys, and advance by themselves;
   - a note field nobody has to fill;
   - "3 of 6" progress, and a way back.

   The comps round shows the one question at the top and 3 or 4 comps side by side: tap to rate each
   one, star the favourite. It works at 390 px wide with no horizontal scroll, every target at least
   44 px (`meetsTouchTarget`), in light and dark mode. A Done button finishes the round.
5. Every answer POSTs to the server, which writes `.rig/taste/ratings.json` at once, so a closed tab
   loses nothing. Done, or `rig taste --done`, writes `docs/TASTE.md` with a date line,
   `## Ratings` (a table: reference, rating, note), `## Comps — "<question>"` (comp, rating, picked,
   note) when a comps round ran, and `## Principles` holding the line "<name the principles behind
   these ratings before any design starts>". The server then exits and prints the path.
6. `test/taste.test.js`: headless Chrome on debugging port 9352, server on 5391, `--no-open`, and
   fixture images generated by the test, never personal ones. Drive the page with real input through
   the harness (`click`/`tap` at points checked with `whatIsAt`). Assert the positive path:
   ratings.json and TASTE.md hold exactly what was tapped. Controls: break the POST handler, then the
   rating button, and each assertion must go red.

   The bar (6 references in at most 7 taps, no typing, no scrolling, at 1440×900 and 390×844) is a
   `s.target` with `countInput`. fv2 is building those. Until fv2 merges, write the walk with your
   own counter around harness input, and swap it once fv2's API is on main.
7. Screenshots in `docs/shots/`: desktop and phone, light and dark, of a round in progress and of
   the comps view.

## Open questions
- None for the crew. The lead brings Alexander the release: version bump, tag, Homebrew tap.
