# Review: tw1, delivery (`rig tell` wakes, queues, refuses)

## Early review at a2dd65a (2026-11-17)

Read: `git diff main...rig/tw1` (src/deliver.js, src/commands/tell.js, the fake hc,
test/tell-wake.test.js, tools/tell-wake-e2e.mjs). Checked real `hc send --help` (read-only). Ran
`test/tell-wake.test.js` at a2dd65a with `WAYLAND_DISPLAY`, `DISPLAY` and `HC_TERMINAL_ID` unset: 17
passed, 0 void. Afterwards no `deliver.js --watch` process was left. I also reproduced one race with
tw1's own fake hc in a scratch repo (below).

What holds up:
- Claim by rename into `delivering/<pid>/` before sending; `takeAll` reads then renames, so whichever
  rename wins takes the message, and the loser skips it. No double delivery between a deliverer and
  `rig inbox`. A deliverer that died is recovered by pid (at-least-once: a crash between send and
  settle re-sends, which is the right side to err on).
- The watcher lock is `wx`-exclusive with a dead-pid takeover. The empty-queue exit releases first and
  then looks again, so a tell that files in between either starts a new watcher or is seen. Order is
  filename order.
- The idle path uses `hc send --if idle`, so hc checks and types in one step. Blocked → exit 3 with
  hc's kind/msg; the file stays. Never `--force`. A terminal that reports no status gets "filed only"
  (it could be a shell). That's a good call.
- Names come only through `resolveMember`; outside a repo it falls back to filed-only.
- The fake hc has real hc's exit codes and refusals, and logs the state at send time, so "typed into a
  working agent" is visible in its log.
- The real-hc proof uses throwaway `hc run --bg --no-parent` terminals with no window labels, sets
  status through a control file (never typing), and kills and removes them in `finally`.

### 1. HIGH: two tells to an agent that hc reports as `done` type into it while it is WORKING
`src/deliver.js` `deliverNow`: `hcSend(terminal, …, { ifIdle: status.state === 'idle' })`. For `done`
and `error` the send has no `--if`, and "the status read just above is the check". Real hc's `--if`
only takes `idle|working`, and a plain send to a working terminal types at once (tw1's own evidence).
`done` is not rare: it is what hc reports for an agent whose turn ended (`hc send` to this crew's
helpers answered `"status":"done"`), so most deliveries take this unguarded path.

Reproduced with tw1's fake (`t1.state = done`, `t1.after-send = working`, `send-delay-ms = 600`), two
`rig tell boss …` 250 ms apart, the way two helpers report at once. Both printed `delivered:`.
`sends.log` has:

    {"text":"[rig tell from tw2 …] from A","if":null,"state":"done","typed":true}
    {"text":"[rig tell from tw3 …] from B","if":null,"state":"working","typed":true}

Tell B read `done`, tell A's send started a turn, and then B typed into the working agent. That breaks
the plan's first must-not ("Nothing is ever typed into an agent that is working"). The suite's
check at test line 258 ("every send the fake saw was to an idle or done one") passes only because no
test sends two tells concurrently to a `done` agent.

Fix direction: serialize every rig send to one recipient, and re-read the status inside that.
Take an exclusive per-recipient send lock (`<inbox>/<name>/.send.lock`, `wx`, dead-pid takeover,
held only across read-status → claim → send → settle), so a second rig tell sees the `working`
that the first one's send caused. The residual window is then only an outside actor (a person
starting a turn in the same milliseconds; hc already waits for a person's draft). Say that in the
header comment. Test: the exact scenario above. It is red today (sends.log has a `typed: true` with
`state: working`) and green with the lock.

### 2. MEDIUM: the real-hc proof never exercises `done`, the state real agents sit in
`tools/tell-wake-e2e.mjs`: the stand-in agent reports `idle`, `working` or `blocked …`, and after a
turn it "goes idle". Real agents go to `done`. So the proof the lead runs once covers only the
guarded `--if idle` path and says nothing about the path in finding 1. Fix: make the stand-in end a
turn in `done` (and keep one `idle` case), and add a concurrent-tells-to-a-done-agent case that
asserts nothing arrived while the stand-in's control file said `working`.

### 3. LOW: a tell refused as `blocked` is stranded until something else reads the inbox
After exit 3 nothing watches that recipient, so when the agent unblocks and goes idle the message
just sits there. The next `rig tell` to it, a `rig inbox`, or a delivery watcher started for another
message picks it up. The plan only asks for refuse+file, so this isn't a bar miss, but the printed
line could say how it gets read ("it is delivered with the next tell, or read with `rig inbox
<name>`"). Optional: on `blocked`, start the delivery watcher too, since it already never sends to a
blocked agent and would deliver it once the agent is idle. That would turn a dead letter into a queue.

### 4. LOW: "filed for the inbox watcher" can strand a message for one re-arm
`deliverNow` returns `watcher` when `watcherState` sees an armed `rig inbox --wait`. The armed watcher
may have just taken an earlier message and be in `finish()` (its `takeAll` already ran, and the mark is
removed a moment later). The new message then waits for the lead's re-arm, whose first `look()` takes
it at once. The lead re-arms after each message (the briefs say so), so this costs a delay, not a
loss. Note it in the comment; no change needed.

### 5. NOTE: `hc send` has no bound in the foreground
`hc send` "waits for a person's unfinished draft", and `tryRun` has no timeout. A sender whose
recipient is the person's own pane, with a half-typed draft, blocks inside `rig tell` for as long as
the draft sits there. Consider a timeout on the foreground send that falls back to "queued" and
starts the watcher.

Exit codes: 0 delivered, queued, watcher or filed-only; 3 not delivered (blocked, gone, hc error); 2
usage. That matches the plan and `rig job`'s meaning of 3, and doesn't collide with `rig inbox`'s 4.

Severity summary: 1 high, 1 medium, 2 low, 1 note.
