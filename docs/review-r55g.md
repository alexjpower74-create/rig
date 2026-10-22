# Review of r55g (by r55w)

Diff read: `git diff main...rig/r55g` at `5b748a6` (src/vendor.js, src/commands/review.js in full;
the tell-line seam with r55w's `src/brief.js`). Read only; nothing in r55g's files was changed.
I did not review finish.js, fold.js or decisions.js line by line: those findings would be thin.

## Findings

1. **Any made-up vendor name passes the second-vendor gate.** `src/vendor.js` `vendorOf()`: a name
   the table does not know "is its own vendor". So with Claude builders,
   `rig review --vendor me --pass "lgtm"` (or `--vendor reviewer`, or a persona name such as a
   Codex persona's) records vendor `me` ≠ `anthropic`, and `vendorGate()` returns `ok`. The builders
   can pass their own round by typing a word the table lacks. That is the anti-reference "a gate
   that can be passed by" a claim. Check: refuse `--pass` from a vendor not in `ALIASES` unless the
   config lists it (e.g. `vendors: ["acme"]`), or at least print it in the finish detail as
   "unknown vendor".

2. **Mixed crews are not modelled.** `builderVendor(cfg)` returns one vendor, from `vendor` or the
   launch command. Item 5 of this plan briefs Codex members through `rig job`, so one round can be
   built by both anthropic and openai. Then an openai "second-vendor" pass reviews code openai wrote.
   Check: allow `vendor` to be a list (or per-slice `Vendor:` in the plan) and refuse a pass from
   any of them.

3. **The hand-over line doubles the tell line with a different id.** `vendorReview` prints
   `rig job <pane> "Read .rig/REVIEW-final.md and follow it."`. The brief already ends with
   `tellLine(lead, 'rv-<vendor>')`, and `rig job` appends its own tell line with id = the pane
   (`--id` defaults to the pane). The reviewer gets two instructions naming two different ids, and
   the lead's inbox shows `w46:p3: done` instead of `rv-openai: done`. Check: print
   `rig job <pane> "Read .rig/REVIEW-final.md and follow it." --id rv-<vendor>` instead.

## The seam with r55w

- `tellLine(lead, id)` is called with the signature r55w exports, and its output is the last line of
  both `reviewBrief` and `vendorBrief`. The `typeof briefs.tellLine === 'function'` fallback can now
  go: r55w's commit `ef60454` exports it.
- Lead resolution matches r55w (`cfg.lead || RIG_LEAD`).
