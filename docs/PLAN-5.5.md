# Rig 5.5 — plan (Alexander's go 2026-10-22: build AFTER the five Unio CRM PRs are sent)

Lessons from the Unio CRM round 1 (2026-10-21/22). Six changes:
1. Second-vendor gate: `rig finish` refuses until a second-vendor reviewer (Codex, e.g. Zyro on GPT-6 Astra medium) passes the FINAL sha. Zyro found 9 real defects two Claude reviews passed.
2. Codex crew members report back: tell-lead / lead-inbox / codex-job (built 10-22 in ~/.local/bin) become part of the Rig; any Codex member's last step is tell-lead; the lead's watcher is armed by `rig up`.
3. Refusal -> repair matrix: required PLAN.md section for any UI over rules; every refusal a screen can hit lists its repair (field, or message naming who acts); `rig up` warns when missing; checked before build.
4. Base drift: `rig status`/`rig qa` report how far the main branch moved since the base and which owned files it touched (Outport master moved 30 PRs overnight; 27 conflicting files).
5. Measured timings + stall detector: time each stage (fold, per-commit, full suite, reviews); flag a worker running far past the others (one worker hung 100 min on open_script_spec); estimates come from measurements.
6. Fix commits stay plain until reviews settle; fold/organize history ONCE at the end; every final check reruns on the final organized shas.
Release: version 5.5.0; Rig PDF + site the same night (standing rule).

## Added 2026-10-22 evening (lessons from the rest of round 1)
7. Second test machine: `rig qa --host <ssh-host>` runs the same full suite on a second machine (fetch over SSH from the lead's tree, no push), with one test DB per session there too. Report both tallies side by side. A second OS caught 34 platform-only failures and one 1-in-3 flake the first machine never showed.
8. Platform-neutral snapshots: the snapshot helpers pin the user agent, locale and modifier-key hints, record auto margins as "auto", wait for app-ready (not first paint) and retake when not ready. Baselines record the reference sha they came from (RECORDED_FROM).
9. Peers ask the lead: every brief ends with the tell-lead line; a question left in a peer's pane reaches nobody. Only his-hands items (a permission dialog, a go, a taste call) go to the human.
10. Base drift check at the START of every final round (fetch + merge-tree), not only in status; if the base moved, rebuild before reviews. (Upstream moved three times in one day.)
11. Test-run guards: run the suite with clipboard/display unset (`env -u WAYLAND_DISPLAY -u DISPLAY`) and a no-progress watchdog (stop + name the stuck worker/spec after 5 min).
12. Decision records feed the build: a meeting or huddle decision is checked against the transcript and against the build BEFORE the PR round closes (a "convert with no amount" answer was caught by a reviewer only at the end).
Public repo: every example, note and release text stays generic. No client, company, repo or person names from the work that taught these lessons.
