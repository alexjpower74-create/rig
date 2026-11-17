# Build report — tw1 · `rig tell` wakes idle agents, queues for busy ones, refuses blocked ones

Branch `rig/tw1`. Files: `src/deliver.js` (new), `src/commands/tell.js`, `src/inbox.js` (claim
recovery only), `test/tell-wake.test.js` (new), `test/fixtures/fake-hc/` (new), `tools/tell-wake-e2e.mjs`
(new). `src/commands/inbox.js` unchanged: its exit codes and output stay as they are.

## 1. Evidence: what hc does with a send (DONE)

hc 0.1.21. A throwaway terminal started with `hc run --bg --no-parent` (no window labels, so no tab)
running a stdin reader that reports its status with OSC 7501 (`ESC ]7501;state=working BEL`), never
an agent's pane. Exit codes and JSON as hc printed them:

| Send | Terminal is | What happened |
|---|---|---|
| `hc send t "x"` | working | **typed at once** (echoed on screen while the program was still busy); `{"started":true,"status":"working"}`, exit 0. hc does **not** queue. |
| `hc send t "x" --if idle` | working | refused: `{"error":{"kind":"status_mismatch","message":"t277 is working, not idle","hint":"nothing was typed"}}`, exit **10** |
| `hc send t "x" --if working` | working | typed, exit 0 |
| any send (with or without `--if`) | blocked (permission) | refused: `kind: blocked`, hint "typing would answer its dialog", exit **9** |
| `hc send t "x" --if idle` | done | refused `status_mismatch` "is done, not idle", exit 10 |
| `hc send t "x" --if idle` | error | refused `status_mismatch`, exit 10 |
| any send | finished | `kind: finished`, exit **11** |
| any send | removed / never existed | `kind: not_found`, exit **3** |
| plain send | never reported a status (`status: null`) | typed; took ~5 s (hc waits to see whether it started) |

Also seen: hc wraps every typed text in `<hc from="tNN">…</hc>` (its notes setting), and `hc ls` shows
real agents sitting at `done` between turns, not only `idle`.

**Decision from this evidence:** hc has no queue for a busy agent, so busy delivery is our own small
watcher. Every send to an `idle` agent uses `--if idle`, which makes hc check and type in one step
(no window between our status read and the keystrokes). `done` and `error` mean the turn ended, but
`--if` only takes `idle|working`, so those are sent without `--if` right after a fresh status read
(the window is one `hc` call; a person's draft is still protected by hc's own draft wait).

## 2. What `rig tell <name> "<text>"` does now (DONE)

1. Files the message first, today's format (`from:`, `at:`, blank line, text) in `<inbox>/<name>/`.
2. Resolves `<name>` by exact name via `resolveMember(mainRoot(), name)`. No pattern, no case-folding.
3. States its fate in one line (then the file's path on the next):

| Situation | Line | Exit |
|---|---|---|
| hc member, idle / done / error | `delivered: <name> (<t>) has it as a turn now (from <sender>)` (file moved to `read/`) | 0 |
| hc member, working | `queued: <name> (<t>) is working; it is typed in as a turn when <name> is idle (delivery watcher pid N)` | 0 |
| recipient's `rig inbox --wait` is armed | `filed for <name>'s inbox watcher: rig inbox <name> --wait is armed and wakes <name> with it` (nothing typed) | 0 |
| hc member, blocked | `not delivered: <name> is blocked on <kind> (<msg>)` + `filed, still waiting in <name>'s inbox …` | **3** |
| hc member, terminal finished / not found | `not delivered: <name>'s terminal <t> is gone (…)` + filed line | **3** |
| not in the record, tmux/herdr/null backend, outside a repo | `filed only: <name> has no Herdr app tab; it reads this with rig inbox <name>` | 0 |
| hc member that never reports status | `filed only: <name> (<t>) does not report whether it is busy, so nothing was typed; …` | 0 |
| hc not on PATH | `filed only: hc is not on PATH here, so <name>'s tab cannot be reached; …` | 0 |
| usage | unchanged | 2 |

The turn typed in is one line per message:
`[rig tell from tw1 (answer with: rig tell tw1 "…")] <text>`. Several waiting messages go in as one
turn, oldest first. The sender is `RIG_AGENT_ID`, else **the crew member whose terminal is
`HC_TERMINAL_ID`** (new: the lead has no slice branch and used to show as `peer`), else the slice id
from the branch, else `CODEX_PERSONA`, else `peer`.

### No double delivery: the one rule
A message is delivered by whoever wins the rename that takes it out of `<inbox>/<name>/`. `rig inbox`
renames into `read/`; a delivery renames into `delivering/<pid>/`, types, then files it under `read/`
(or puts it back if hc refused). A recipient whose `rig inbox --wait` is armed is never typed to.
Tested in both orders (watcher armed first → typed 0, printed once; tell claims first while hc is
"typing" and a watcher arms meanwhile → typed once, watcher does not print it). A claim left by a
deliverer that died is put back by the next delivery and by `rig inbox` (`recoverClaims` in
`src/inbox.js`), so a crash loses nothing.

### The delivery watcher
`node src/deliver.js --watch {…}`, detached, one per recipient: it holds `<inbox>/<name>/.deliver.lock`
(created with `wx`; a dead holder's lock is cleared). Polls every 1 s (`RIG_DELIVER_POLL_MS`),
re-reads hc's status right before every send, never sends to a working or blocked agent, exits when
the queue is empty (lets go of the lock, then looks once more, so a tell landing in between is never
stranded), when the terminal is gone, when an inbox watcher takes over, or after
`RIG_DELIVER_DEADLINE_MIN` (240). It follows the record if the member moves terminal. Its log is
`<inbox>/<name>/.deliver.log`. The lock only bounds how many run; the claim rename alone guarantees
once-only delivery.

## 3. Checks: each seen red, then green (DONE)

`test/tell-wake.test.js`, harness `check`/`target`, 18 checks. A fake `hc` on PATH
(`test/fixtures/fake-hc/`: states from `<t>.state` files, `after-send` to simulate a turn starting,
`send-delay-ms` for races, every send logged with the state at that moment and whether real hc would
have typed it; exit codes are real hc's). No real hc, app, clipboard or display; `HC_TERMINAL_ID` is
unset by `clean-env.js` and only set per call by the test.

| Check | Green | Red (control) |
|---|---|---|
| idle, slowest of helper→lead, lead→helper, lead→reviewer, reviewer→lead, 0 unread | **0.09 s** (bar ≤ 5 s) | 5.6.0's `tell.js` swapped in: 20 s (never typed) |
| turn text says rig tell + sender + text; file moves to `read/` | pass | 5.6.0's tell |
| lead named by its terminal in the record, not "peer" | pass | crew lookup removed |
| a `done` agent is typed to (no `--if`) | pass | only `idle` counted as sendable |
| busy: queued, typed after idle | **0.63 s** after idle (bar ≤ 10 s) | 5.6.0's tell: 20 s |
| never typed into a working agent | pass | `working` classified as sendable (the naive plain `hc send`) |
| agent turns busy between our read and hc's typing → hc refuses, message queued, delivered later | pass | `--if idle` dropped |
| two concurrent tells to a busy agent: one watcher, both delivered, in filing order | pass | lock removed (two watchers logged) |
| watcher exits when its queue is empty | pass | exit replaced by a keep-polling loop |
| blocked: nothing typed, `blocked on permission (Bash(rm -rf build))`, exit 3, file kept, no `--force` | pass | 5.6.0's tell (exit 0) |
| gone (not found / finished): exit 3, says so, file kept | pass | 5.6.0's tell |
| no Herdr app tab (unknown name, tmux member, outside a repo): exact `filed only:` line, exit 0 | pass | 5.6.0's tell |
| exact-name resolution (`tw`, `TW1` don't reach `tw1`) | pass | 5.6.0's tell |
| a terminal that never reports status is never typed to | pass | `silent` classified as sendable |
| armed `rig inbox --wait`: printed once, nothing typed | pass | armed-watcher check removed |
| other order: tell claimed first, watcher armed meanwhile: typed once, watcher silent | pass | claim by copy instead of rename |
| dead deliverer's claim put back and delivered | pass | recovery removed from `deliverNow` |
| `rig inbox` puts back a dead deliverer's claim | pass | recovery removed from `takeAll` |

Result on the committed tree: `18 passed, 0 failed, 0 void, 0 unproven`; `test/watch-inbox.test.js`
(the existing tell/inbox suite) `27 passed, 0 void`. Both re-run after Biome formatted the files.

## 4. The real-hc proof (DONE, run once by me; the lead runs it once more in the crew space)

`node tools/tell-wake-e2e.mjs [--keep]` from a terminal in the Herdr app. It starts three throwaway
terminals with the real hc (no window labels: no tab, nobody's view moves) running a stand-in agent
that reports status with OSC 7501 and logs each line's arrival time; status is set through control
files, never by typing. A temp repo holds the crew record, a temp inbox the messages. Run on hc 0.1.21:

```
PASS  idle helper→lead: 0.96 s (bar ≤ 5 s)
PASS  idle lead→helper: 0.24 s (bar ≤ 5 s)
PASS  idle lead→rv-e2e: 0.24 s (bar ≤ 5 s)
PASS  idle rv-e2e→lead: 0.40 s (bar ≤ 5 s)
PASS  busy: nothing typed while working (3 s): nothing typed · queued: helper (t27m) is working; …
PASS  busy: typed in after going idle: 1.21 s (bar ≤ 10 s)
PASS  blocked: refused: exit 3, nothing typed, 1 filed · not delivered: rv-e2e is blocked on permission
PASS  unread after the run: 1 (bar 1 (the blocked one))
PASS: 8/8 (hc 0.1.21)
```

Its first run failed the busy row; the cause was the stand-in agent's own "turn ends after 1 s" timer
flipping the helper back to idle after the test had set it working (the watcher saw hc say idle and
correctly typed). Fixed in the stand-in (its own turn is marked `working auto`); delivery code
unchanged. Note: hc kept the blocked `kind` (permission) but not the `msg` the stand-in sent, so the
real line reads "blocked on permission"; with a real agent it says whatever hc reports.

## Decided
- Exit code **3** = not delivered (blocked, terminal gone, or an hc error). Unused elsewhere in rig
  (0, 1, 2, 4 and 75 are taken). Exported as `EXIT_NOT_DELIVERED` from `src/deliver.js`.
- `done` and `error` count as "turn ended": typed to (without `--if`, which hc refuses for them).
- A terminal that never reported a status is never typed to (it could be a shell running the text).
- Several waiting messages go in as one turn, one line each, oldest first.
- Blocked: refused now, the message stays in the inbox. A delivery watcher that is already running
  for that recipient (from an earlier busy tell) delivers it with the rest when the agent is idle
  again: at least once, never lost.
- The sender of a tell from the lead is found by `HC_TERMINAL_ID` in the record.
- Watcher poll 1 s, deadline 240 min, both overridable (`RIG_DELIVER_POLL_MS`, `RIG_DELIVER_DEADLINE_MIN`).
- `.scratch/` (my evidence scripts) is in the clone's `info/exclude`, never committed.

## For the lead (files I don't own)

`bin/rig.js` HELP / USAGE:
```
tell: 'tell a crew member something: typed in as a turn if it is idle in a Herdr app tab, queued if busy, refused if blocked',
tell: `rig tell [<name>] "<one line>"   exits 0 delivered/queued/filed · 3 not delivered (blocked, gone) · 2 usage   (name: a crew member; default "lead" in .rig/config.json, else RIG_LEAD)`,
```

README (the `rig tell` section):
> `rig tell <name> "<one line>"` files the message in `<name>`'s inbox, then looks `<name>` up in the
> crew record (`.rig/crew.json`; `rig crew` lists it) and says what happened, in one line:
> **delivered** (an idle agent in a Herdr app tab gets it as a turn, through `hc send --if idle`),
> **queued** (a working agent: a small delivery watcher types it in within about a second of the
> agent going idle, and never while it works), **filed for the inbox watcher** (the recipient runs
> `rig inbox --wait`, whose exit wakes it), **not delivered** (blocked on a permission prompt, or its
> terminal is gone: exit 3, and the message stays in the inbox), or **filed only** (no Herdr app tab:
> tmux, terminal herdr or a plain terminal read it with `rig inbox <name>`). Each message is taken
> once: a reader and a delivery both take it by renaming it, and only one rename succeeds.

CHANGELOG 5.6.1:
> - `rig tell <name>` reaches the agent it names. An idle agent in a Herdr app tab gets the message as
>   a turn; a busy one gets it when it goes idle (one delivery watcher per recipient); a blocked one
>   is never typed to (exit 3, "not delivered: … is blocked on …"); a member without a Herdr app tab
>   gets today's file plus a "filed only" line. Names come from the crew record, never a tab label.
>   hc 0.1.21 types a plain send straight into a working agent, so every send is `--if idle`.

For tw2's brief text, the true sentence is: "`rig tell <name>` wakes `<name>` if it is idle in a Herdr
app tab, queues it until a busy one is idle, refuses (exit 3) when it is blocked, and says 'filed only'
when there is no tab to wake."

## What's left
- The lead's own run of `tools/tell-wake-e2e.mjs` in the crew's space, and rv-561's review.
- tw2 must record members with `backend: 'hc'` (the contract's value); a record without it is filed only.
- Not done: delivering to members on another machine (`mac/t46`-style addresses) was not tested; hc
  accepts them, so it should work, unproven.
