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

## Delta at 2615858 (2026-10-23, r55w)

Read `git show 2615858` (finish.js's waiver and CI check, fold.js's walk, the tests). Read only.
Its checks at `2615858`, unpacked with `git archive`: gate-final 4/4, 4/4 and 6/6 (the new
second-vendor suite), gate-finish 20/20 + 3/3, gate-fold 7 passed + 1 unproven. All with 0 void. The
unproven one, "the folded commits keep the identity from git config", came before this commit.

**#2, a baseline waives only the runs it compared: holds for the host, with one gap on the local
side.**
- With `baseline.compared`, the match by host, command and exact `at` is tight.
- The legacy path, used until r55q writes `compared`, takes any local run of the same command
  recorded before the baseline. It does not check that the baseline compared that run.
- A `rig qa <sha> --run "npm test"` from another tab can finish during tab 1's `--baseline` base run.
  That run is the newest test record, and it was never compared.
- The waiver then checks only that run's `failures`. My repro, with records written by
  `recordQa` and `finishChecks` from `2615858`:
  - a later run with only the known failure, plus a **new VOID check**: `ok — every failure is
    known on the base`;
  - a later run with **`failed: 4` but one failure parsed**: `ok`, the same;
  - a later run with a new failure named: `fail — not known on the base: new break` (correct).
- Fix:
  - in the legacy path, refuse a run whose `void` or `unproven` is non-empty, or whose `failed` is
    more than `failures.length`, and say why;
  - better, cover a legacy run only when no other test record of that command sits between it and
    the baseline. Either rule is a three-record check.
- Medium. It needs a concurrent run, but nothing in the waiver's detail would show it.
- Also: until r55q ships `compared`, a host failure is never waived, even one the baseline did
  compare (its `known` says `there`). That fails safe and is documented in r55g's report. It is the
  one thing left before the host-waiver path can be used.

**#3, the fold walk under rig qa's runner: FIXED.** My repros against `2615858`'s `walkCommits`:
- `false | cat` exits 1;
- `exit 3` keeps 3 with its output in the tail;
- a subshell that ignores TERM is stopped by the 5 s KILL, and the walk waits for it.
- `fold` is async now. Its only callers are `commands/fold.js` and the tests, and every one awaits
  it. `finish.js` imports only `foldHolds` and `latestFolds`.
- Not a finding: a `setsid` child leaves the process group and outlives the limit. That is the same
  as `rig qa`.

**#4, a CI record counts only for today's command: FIXED.** `run.cmd !== ci.cmd` is checked before
the exit and the posted status, per host. `ciCommand: null` still turns the gate off. When the test
and CI commands are one run, both records carry the same `cmd`, so that path still passes. I found
no way past it.
