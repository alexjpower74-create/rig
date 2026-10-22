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

## Verified at 24ce390 (2026-10-22, r55w)

Read `git show 1f0a290` (src/vendor.js, src/commands/review.js, the gate tests) and ran its checks at
the tip, `24ce390`, unpacked with `git archive`: gate-vendor 10/10, gate-finish 20/20 + 3/3,
gate-review-brief 3/3, 0 void.

My repros, against `24ce390`'s `src/vendor.js`, with builders from `claude --model opus`:
- **1. Unknown vendor names: FIXED.** `--vendor me`, `reviewer`, and two made-up persona names are
  all refused ("not a vendor the rig knows … list it under \"vendors\""). `openai`,
  `codex` and `gpt-6-astra` still count, and so does `acme` once it is listed under `vendors`.
  `vendorGate` runs the same check at finish, so a `me` pass already in reviews.jsonl is refused there too.
- **2. Mixed crews: FIXED.** With `vendor: ["claude", "codex"]`, a pass from `openai` or `codex` is
  refused ("one of the vendors that built this round") and one from `gemini` counts.
- **3. Hand-over id: FIXED.** The line is now `rig job <pane> "Read .rig/REVIEW-final.md and follow it." --id rv-<vendor>`.
  That matches r55w's `--id`, so the inbox reads `rv-openai: …`.

Left, low and not blocking: a mixed crew is only seen when `vendor` lists it. With `vendor` unset,
the launch command names one vendor, and a Codex member briefed through `rig job` is not counted.
Worth one line in the README beside `vendor`.
