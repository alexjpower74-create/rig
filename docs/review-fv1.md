# Review — fv1 · Briefs that aim high (by fv3)

Read-only review of `git diff main...rig/fv1` at be201ba. Findings only; nothing was edited.

## The fv3 → fv1 contract (docs/TASTE.md)

Holds for `rig up`. `src/commands/up.js:79-91` copies the main checkout's `docs/TASTE.md` to each
worktree's `.rig/TASTE.md` and passes `ctx.taste`. `src/brief.js:98-106` then tells the agent to
read it before designing, says the ratings outrank its own taste, and asks it to name the
principles. fv3 writes `## Ratings`, `## Comps — "<question>"` and `## Principles` at
`docs/TASTE.md`, so the file and the pointer line up. Three gaps:

1. **`rig brief <id>` drops the taste pointer.** `src/commands/brief.js:26` calls `briefFor` with
   no `taste` in ctx. A lead who re-prints a brief to hand it over (that command's whole purpose)
   gets one with no `## His taste, in ratings` section, even when `docs/TASTE.md` exists. The file
   is outside every slice's Owns list, so it's the lead's call. The fix is the same `existsSync` and
   copy, or pointing at `docs/TASTE.md` in the main checkout.
2. **A taste round run after `rig up` never reaches the agents.** The copy is taken once, at
   `rig up`. The plan's order ("When that file exists in the main checkout…") lets him run
   `rig taste` while the crew is already building, and then no brief mentions it and no worktree
   has the copy. It's worth one line in the brief or the lead's checklist, e.g. "if docs/TASTE.md
   appears later, `rig brief` again." It needs finding 1 fixed first.
3. **Heading wording, `src/brief.js:100`: "His taste, in ratings".** This is a public tool, and the
   rest of the text says "the owner". "The owner's taste, in ratings" says the same without
   assuming who the owner is. Low.

## The bar disappears from the brief when it compares with < and >

`src/plan.js` `withoutPlaceholders`. The prose-placeholder test, `/<[^<>`]*\s[^<>`]*\s[^<>`]*>/`,
matches any line holding a `<` and a later `>` with two spaces between them. Bars are where those
characters are most likely, written outside backticks. I ran it against fv1's own plan.js:

```
withoutPlaceholders('- Search answers in < 200 ms and fails > 1 time in 1000 runs\n- Under 3 taps')
→ "- Under 3 taps"
barHasNoNumber({ bar: '- p95 < 200 ms on a phone older than > 3 years' })
→ false
```

So the line with the numbers is silently removed from `## The bar` in the slice brief (`briefFor`),
the review brief (`reviewBrief`, `src/commands/review.js:79`) and the roll brief (`parseRoll`). When
it is the bar's only line, three things go wrong together: the bar vanishes, `missingBrief` does not
name it (the raw text is not a placeholder), and `barHasNoNumber` returns false (it tests the
stripped text). Nothing warns.

What to check: only treat `<…>` as a placeholder when the text right after `<` and right before
`>` is not a space (`<the one command>` vs `< 200 ms … >`). Add a known-bad case with `<` and `>`
used as comparisons, so the check goes red against the current regex.

## Everything else

The mindset block in `src/mindset.js` matches the plan's text exactly (compared against PLAN.md). I
found nothing else that crosses a slice boundary.
