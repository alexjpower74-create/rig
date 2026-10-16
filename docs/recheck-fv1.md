# Re-check of fv1's fix (ac1c2da)

## Re-check by fv2

The finding (fv3, `docs/review-fv1.md` on rig/fv3 at 71216a2, "The bar disappears from the brief
when it compares with < and >"). Fixed at **ac1c2da** on rig/fv1. Checked read-only. I unpacked
be201ba and ac1c2da whole into an ignored scratch folder, and ran the same probe against each one's
own `src/plan.js` and `bin/rig.js`. The `rig brief` case ran in a temp git repo with a real linked
worktree.

### The repro: red at be201ba, fixed at ac1c2da

| Input | be201ba | ac1c2da |
|---|---|---|
| `withoutPlaceholders('- Search answers in < 200 ms and fails > 1 time in 1000 runs\n- Under 3 taps')` | `"- Under 3 taps"`: the bar line is gone | both lines kept |
| `barHasNoNumber({ bar: '- p95 < 200 ms on a phone older than > 3 years' })` | `false` (the line was stripped, so nothing to judge) | `false` (it has a number: correct) |
| `barHasNoNumber({ bar: '- feels < instant and > snappy' })` | `false`: no warning for a bar with no number | `true`: `rig up` warns |

The third row shows the second half of the bug. At be201ba, a numberless bar that used `<` and `>`
was stripped to nothing, so `barHasNoNumber` stayed silent. At ac1c2da it warns.

### Real placeholders still go, and real text still stays (same at both shas)

- Dropped at ac1c2da: `<the one quality a person should feel>`, `- <a number with a bound>`,
  `Negative controls: <the one command that must still fail>`, `<placeholder>`. Every one returns `""`.
- Kept at ac1c2da: `` Run `rig qa <sha> --run "<cmd>"` first ``, `Branch rig/<id>`, `- p95 ≤ 200 ms and ≥ 55 fps`.
- `barHasNoNumber({ bar: '- <a bar with a hard number>' })` is `false` at both. A bar that is only a
  placeholder counts as missing, so `missingBrief` names it, rather than as a bar without a number.

### `rig brief <id>` after a later docs/TASTE.md

Setup: a repo with one slice whose worktree already exists. `docs/TASTE.md` is written *after*
that, and then `rig brief zz1` runs.

- be201ba: exit 0, and the worktree has no `.rig/TASTE.md`. The brief does not mention it.
- ac1c2da: exit 0, and the worktree's `.rig/TASTE.md` has the same bytes as the main checkout's
  `docs/TASTE.md`. The brief points at `.rig/TASTE.md`.

fv1's own test (`test/brief-five.test.js` at ac1c2da) covers both fixes. Its control swaps the
be201ba code back in, not just a changed input.

### Still open (residual, not a regression)

The new rule treats `<…>` as a placeholder when the brackets hug their text. Comparisons written
**without spaces** still look like that, so they are still dropped at ac1c2da (and at be201ba):

| Input | ac1c2da |
|---|---|
| `- latency<200 ms and jank>1 frame` | `""`: dropped |
| `- x<3 and y>2` | `""`: dropped |
| `- loads in <2 s and scores >90` | kept |

That is narrower than the original bug, but it fails the same silent way. It drops a bar line and
nothing warns. Suggestion for fv1: don't count it as a placeholder when the character after `<` is a
digit, or the character before `>` is one (`<200`, `y>2`). Alternatively, `rig up` could warn
whenever stripping removed a line that holds a digit. Add `- x<3 and y>2` as a known-bad case.

**Verdict:** the reported bug is fixed at ac1c2da, and `rig brief` now copies a later TASTE.md. One
residual case remains, described above.
