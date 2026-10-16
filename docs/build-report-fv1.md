# Build report — fv1 · Briefs that aim high

Branch `rig/fv1`. Commits: 97feaaf (the slice), 7aa59af (the reset rule, from reviewing fv2),
9162c27 (docs/review-fv2.md, at the lead's request). QA numbers are at the end, each with its sha.

## What I built

- DONE `src/mindset.js` exports `MINDSET`: Steve's paragraph, byte-exact and on one line, taken
  programmatically from the plan's task text, not retyped. It is the only copy in `src/` (checked).
- DONE `briefFor`, `reviewBrief` and `tabBrief` open with the block: title line, blank line, block,
  then everything else. Exactly once, before the first `## `.
  - Plans quote the block at the top of every task, so a slice brief would have carried it twice.
    `taskText()` takes it out of the task (the brief already opens with it, so "the paragraph above"
    still points at it). Found by rendering the real plan's three briefs, not by guessing.
- DONE `briefFields` learns the new headings with their aliases: The feeling / The one quality,
  The specialist, The best at this job / References (bullets, plus `antiReferences` from an
  `Anti-references:` block or a `## Anti-references` section), The bar, Where we're starting from,
  Freedom, Tools, Budget and autonomy, What to hand back. `What must not happen`, `What must not
  change` and `What must not happen or change` are one list; two of them are combined.
- DONE The slice brief carries each filled section in the contract's order: What it's for first,
  then feeling, specialist, best at this job (anti-references under "not this"), bar, who it's for,
  what done looks like, where we're starting from, must not, freedom, tools, checks, budget, what to
  hand back.
- DONE `<placeholder>` text never reaches a brief: `withoutPlaceholders()` drops whole-placeholder
  lines and prose lines carrying one (`Negative controls: <the one command ...>`), and the brief also
  drops a template `<slice title>` or `<task>`. Backticked text (`rig qa <sha>`) and short names
  (`<id>`) are real text and stay.
- DONE `missingBrief(plan, { aim: true })` also names The feeling, The best at this job and The bar.
  `barHasNoNumber(plan)` is true for a filled bar with no digit. `rig up` prints one yellow line for
  it, and warns without refusing.
- DONE Two new loop steps: **Hard numbers are checks** (step 4, naming
  `s.target(name, { measure, atMost, atLeast, unit, breaks, timeout })` and `countInput(page)` exactly
  as the contract does, plus "call `reset()` at the start of `measure`") and **The bar is a floor**
  (step 8, references side by side). The loop is now 9 steps.
- DONE TASTE.md: when the main checkout has `docs/TASTE.md`, `rig up` copies it to each worktree's
  `.rig/TASTE.md` and the brief says to read it before designing, that the ratings outrank the agent's
  own taste, and that it names the principles in its report.
- DONE `reviewBrief` item 5: is the bar a target check seen red, and how does the work look beside
  the references. It quotes the plan's bar when there is one.
- DONE `templates/PLAN.md` has the new sections in order, each with a one-line placeholder, and keeps
  every existing section. `templates/ROLL.md` has an optional `## The bar`, which `parseRoll` reads
  (new `bar` field) and `tabBrief` carries.

## Decided

- **`missingBrief` names the three new gaps only with `{ aim: true }`.** The task says
  "`missingBrief` also names" them, but `test/workflow.test.js` (not mine) asserts that the template
  has exactly 5 gaps, and the hard rule says every existing test passes unchanged. The hard rule
  outranks the task, so the default stays Rig 4's five and `rig up` asks for all eight. If the lead
  would rather change the default, that's a one-word change in `src/plan.js` plus a change to
  `test/workflow.test.js:141`, which is the lead's call.
- **TASTE.md is copied into `.rig/`, not read from the main checkout.** Reading outside the worktree
  triggers a permission prompt that stops an agent dead. `.rig/` is machine state, already
  git-ignored. The copy is taken at `rig up`, so a round rated after that needs another `rig up`
  (it reuses the worktrees and rewrites the briefs).
- **Specialist per slice.** When a specialist bullet starts with a slice id (`- fv1 writes like…`),
  each slice's brief keeps only its own bullet plus the bullets that name no slice.
- **`barHasNoNumber` is false when there is no bar.** `missingBrief` names an empty bar, so one gap
  doesn't get two warnings.
- **What it's for comes first**, before the feeling. The contract's order doesn't list it, and it is
  the single-minded proposition a creative brief opens with. The relative order of everything listed
  is exactly the contract's.

## Proof: what was seen red

`test/brief-five.test.js`, 17 checks, all `s.check` with `breaks`. Every control swaps Rig 4 back in:
the functions are copied verbatim from 7d40d97 into the test (renamed `rig4*`). The two CLI checks run
Rig 4's whole tree, unpacked with `git archive 7d40d97` into a temp folder. All 17 PASS, which means
each control went red; a control that stayed green would have been VOID.

| check | control |
|---|---|
| MINDSET byte-exact (sha256 + length), one line, only copy in src/ | Rig 4: no block, no module |
| slice / review / roll brief opens with the block once, before `##` | `rig4BriefFor`, `rig4ReviewBrief`, `rig4TabBrief` |
| briefFields: new headings, aliases, both anti-ref forms, combined must-nots | `rig4BriefFields` |
| sections in contract order | `rig4BriefFor` |
| specialist: own slice's line only | `rig4BriefFor` |
| no placeholder in a brief from a half-filled template | `rig4BriefFor` (leaks a two-line placeholder) |
| loop names s.target / countInput / reset() exactly | `rig4BriefFor` |
| TASTE.md pointer and wording | `rig4BriefFor` |
| review item 5 | `rig4ReviewBrief` |
| roll `## The bar` reaches tab briefs | `rig4TabBrief` |
| missingBrief aim names the three, default stays 5 | `rig4MissingBrief` |
| barHasNoNumber | Rig 4's behaviour, `() => false` |
| `rig up --dry-run` names a missing feeling, one bar line | Rig 4's `bin/rig.js` |
| `rig up` copies TASTE.md into each worktree, brief points at it | Rig 4's `bin/rig.js` |
| templates in order, one-line placeholders, ROLL bar | Rig 4's templates |

Red seen during the build, before the fix: the placeholder check failed for real on the template's
`<slice title>`, first in the title line and then in "Also on this build". Both are fixed.

Seen working with the real CLI: `rig up --dry-run` on this repo's own plan prints no warnings
(everything is filled). On a thin plan in a throwaway repo it prints the missing list (with The
feeling and The best at this job) and the one yellow bar line.

## QA

- 97feaaf: `rig qa 97feaaf --run "npm ci --silent && npm run check"` → `rig qa: test exit 0 at 97feaaf`,
  `rig qa: negative exit 0 at 97feaaf`. Biome, all 12 test files and the personal-data scan.
  (A first run without `npm ci` exited 127: the QA worktree has no node_modules, so `biome` was not
  found. That's an environment gap, not a test result.)
- Final sha: see the line below, added after this report is committed.

## Fixes from fv3's review (docs/review-fv1.md on rig/fv3 at 71216a2)

- DONE **A bar written with `<` and `>` as comparisons vanished from every brief.** The rule read
  `< 200 ms and fails >` as a placeholder, so the bar's line was dropped from slice, review and roll
  briefs, and since the raw text was not a placeholder, neither `missingBrief` nor `barHasNoNumber`
  warned. Now a placeholder has to hug its brackets: no space after `<` and none before `>`
  (`<the one command>` is a placeholder, `< 200 ms … >` is not). Two checks were seen red against the
  slice as reviewed (be201ba, unpacked whole): the comparison bar reaches all three briefs (old: absent
  from the brief, with no warning), and `barHasNoNumber` is true for a comparison bar with no digit
  (old: false, because the line had been stripped).
- DONE **`rig brief <id>` dropped the taste pointer.** `src/commands/brief.js` is now fv1's (plan at
  e89c887). `shareTaste(root, worktree)` in `src/brief.js` does the copy for both `rig up` and
  `rig brief`, so re-running `rig brief <id>` after a taste round hands a crew that is already
  building the new ratings. Check: write a later TASTE.md, run `rig brief s1`, and the output points at
  `.rig/TASTE.md` and the worktree copy is the new file. Red with be201ba's `bin/rig.js`.
- DONE **Heading:** "The owner's taste, in ratings" (it's a public tool).

## Left / needs others

- Cross-review: fv3 has `.rig/REVIEW-fv1.md` (per the lead). I reviewed fv2 (docs/review-fv2.md). The
  lead is having fv2 make `target()` reset counters itself, and I'll verify that fix when its sha
  arrives.
- README and CHANGELOG are the lead's, per the plan. Worth saying there: `missingBrief(plan, { aim })`
  and `barHasNoNumber` are new exports, `parseRoll` returns `bar`, and the loop is 9 steps.
- Nothing outside my Owns list was edited.
