# Rig 5.6.1: `rig tell` wakes the agent it names

One plan file. It is the contract.

## What it's for
`rig tell <name> "..."` only drops a file in `<inbox>/<name>/`. The recipient sees it only if it keeps
`rig inbox --wait` running, and leads do, but helpers and reviewers don't. In a practice run a lead used
`rig tell` to message its helpers and reviewer; nothing woke them, and the crew sat idle for 30 minutes
until the lead typed to them by hand. 5.6.1 makes a tell reach the agent it names, as a turn, without
ever typing into an agent that is busy or waiting on a permission prompt. Three smaller faults from the
same run are fixed alongside: the finish gate's negative-command exit semantics, `rig qa` grading a dev
server as a test, and `rig up` opening helper tabs in reverse and in front of the reviewer.

## Who uses it, on what
A lead session (Claude Code or Codex) driving a crew in the Herdr desktop app (hc + herdr-app) on Linux
and macOS; the same commands still run under terminal herdr, tmux, or a plain terminal. Public repo:
anyone running multi-agent builds with worktrees.

## What done looks like
Every bar below proved by a test that fails on 5.6.0's code (shown red by swapping the old behaviour
back in), the real-hc end-to-end proof run once in the crew's Herdr space with idle, busy and blocked
agents, an independent review passed on the final sha, one full `npm test` and `npm run check` green on
it, README/CHANGELOG/briefs saying the new truth, version 5.6.1 committed locally (not pushed).

## The bar
- A `rig tell` to an IDLE agent in a Herdr app tab is delivered into that agent as a turn within 5 s,
  any direction (helper→lead, lead→helper, lead→reviewer, reviewer→lead). 0 messages left unread.
- To a BUSY agent: queued, then delivered within 10 s of it going idle (a small delivery watcher, or
  hc's own queue if it has one: decide from evidence and write the evidence down), never typed
  mid-turn.
- To an agent BLOCKED on a permission prompt: nothing typed; `rig tell` prints that it is blocked and on
  what, exits non-zero with a code that means "not delivered", and the file is still written.
- A recipient with no Herdr app tab (plain terminal, tmux, terminal herdr): today's behaviour, plus one
  line saying it was only filed. Exit 0.
- A lead whose `rig inbox --wait` watcher is armed is never delivered twice: one rule, tested.
- Names resolve through the crew's own record (`.rig/crew.json`, `src/crew.js`): slice ids, the lead
  name and `rv-*` reviewer ids. Never a tab-label pattern.
- `rig finish` cannot be fooled by, or wrongly fail on, a negative command that exits 1 when the break
  is caught; `rig qa` never grades a long-running server as a test; `rig up` tab order is lead,
  reviewer(s), then helpers in plan order.

## What must not happen or change
- Nothing is ever typed into an agent that is working or blocked. Keystrokes into a busy pane mangle
  the input. `hc send --force` is never used.
- No test touches the real Herdr app, real hc, the real clipboard or display: fakes on PATH (`hc`,
  `herdr-app`, `herdr`, `tmux`) in temp dirs; run suites with `env -u WAYLAND_DISPLAY -u DISPLAY` and
  with `HC_TERMINAL_ID` unset unless the test sets it. The real-hc proof is a separate script
  (`tools/`), run by hand, not part of `npm test`.
- No new dependency: node, git, hc/herdr/tmux only.
- File-slice ownership, the QA worktree pinned to a sha, negative controls, the inbox file format
  (`from:`, `at:`, blank line, text) and `rig inbox --wait` exit codes stay as they are.
- Public repo: no home paths, host names, emails, names of people or companies, no AI tool names or
  credits in new tracked text where avoidable. `check-no-personal-data` clean.
- Every commit's author and committer is the repo owner's git identity: commit with
  `env -u GIT_AUTHOR_EMAIL -u GIT_COMMITTER_EMAIL git commit …`. No Co-Authored-By, no "generated with".
- Never push, tag or release. Never type into another agent's pane, never open a new Herdr space or
  tab by hand except through the code under test.
- Do not edit files outside your Owns list. `bin/rig.js`, `README.md`, `CHANGELOG.md`, `package.json`,
  `AGENTS.md`, `PLAN.md` and `src/crew.js` are the lead's: put the text you want there in your report.

## Where it lives
This public repo (MIT), installed with `npm link`.

## Where we're starting from
Rig 5.6.0 (bf44de6) plus the scaffold commit: `src/crew.js` (the crew record: `readCrew`,
`recordMember`, `forgetMember`, `resolveMember`; its JSDoc is the contract) and a `rig crew` command
registered in `bin/rig.js` with a stub at `src/commands/crew.js`.
Today: `src/commands/tell.js` writes a file via `src/inbox.js` `tellMessage` and nothing else.
`src/hc.js` opens slice tabs with `hc run --bg` labelled with the space and a fresh tab id.
`hc send <t> <text>` pastes and presses Enter, refuses a blocked program unless `--force`, takes
`--if idle|working`, and "waits for a person's unfinished draft"; `hc wait <t>` waits until it stops
working; `hc get <t> --json` has `status.state` (`idle`, `working`, `blocked` …) and `turn`.

## The feeling
A message sent is a message read. The lead never has to be a crew's alarm clock, and no agent ever
has its half-typed turn trampled by a delivery.

## The specialist
- tw1 works like a **messaging-systems engineer** (at-least-once delivery, idempotent consumers,
  dead-letter queues): a message is filed first, delivered once, and its fate is always stated.
- tw2 works like a **terminal-multiplexer maintainer**: tabs land where the user expects, and the
  record of who runs where is written by the code that started them.
- tw3 works like a **CI gate maintainer**: an exit code means exactly one thing, and a gate that a
  server can pass measured nothing.

## The best at this job
- Delivery: SMTP's queue-and-retry with a bounce that names the reason; Maildir's tmp→new→cur rename
  (claim by rename, so two readers never both take one message); systemd's `Type=notify` readiness.
- Busy/idle: tmux's `wait-for`, `hc wait`, editors that hold a paste until the user stops typing.
- Gates: GitHub Actions `continue-on-error` vs a step's exit code; `! cmd` and `expect-fail` in test
  runners; Bazel's distinction between a test target and a run target.
Anti-references:
- A delivery that types into whatever pane matches a label regex.
- "Sent" printed when the message is only sitting in a folder.
- A gate whose meaning flips depending on how a script was written.

## Freedom
Flag names beyond those fixed here, file formats under `.rig/`, module layout inside your slice.
Where the plan doesn't settle a choice, decide it, write it under "Decided" in your report, carry on.

## Tools
Node 22, `node:test` or the harness (`harness/check.js`). Biome: `npx biome check --write <your files>`.
Run only the tests your change touches (your files, their direct tests); the lead runs the whole suite
once on the final sha.

## Checks
- Every bar above is a test that is seen red once (5.6.0's behaviour swapped back in, or the guard
  removed), then green. Your report says how each was made red.
- `npm test` runs every `test/*.test.js`. New test files are yours; existing ones only if in your Owns.
- Negative controls: `npm run demo`

## Budget and autonomy
Aim to finish your slice in one sitting; spawn no sub-agents. Decide everything that has an
established answer yourself.

## Asking and reporting
This crew's own messages go through the lead's terminal (the bug being fixed is that `rig tell`
does not wake anyone yet): report with `hc send t26z "<id>: <one line>"` when the lead's status is idle,
or keep it short and send anyway (hc waits for a draft). Questions the same way. When you finish or
block, that line is your last step: `<id>: done|blocked, <sha>, <tests>`.

## What to hand back
Green commits on your branch. `docs/build-report-<id>.md`: what you built, the red you saw for each
check and how, what you decided, the USAGE/README text for the lead, and what's left.

## Size and mode
Medium: three slices and one reviewer (rv-561, an Opus reviewer from the start; no second-vendor
reviewer this round). The reviewer reads each slice at its first real commit and again at the end;
findings go to `docs/review-<id>.md` on the reviewer's side, and the finder verifies the fix. The lead
merges tw3, tw2, then tw1.

## Contract between slices
- **lead → everyone:** `src/crew.js`. Entry: `{ terminal, tab, space, role: 'lead'|'slice'|'reviewer',
  backend: 'hc'|'herdr'|'tmux'|null, at }`, keyed by exact name.
- **tw2 writes the record:** `rig up` records the lead (its `lead` name → the terminal `rig up` runs in,
  `HC_TERMINAL_ID` under hc) and every slice tab it opens or finds; `rig review --launch` records its
  `rv-<id>` tab; `rig crew add <name> <terminal> [--role r]` records one by hand (a reviewer spawned
  outside rig), `rig crew` lists, `rig crew rm <name>` forgets. `rig down` forgets the slices it closes.
- **tw1 reads it:** `rig tell <name>` resolves the terminal with `resolveMember(mainRoot(), name)`,
  delivers or queues, and states the outcome. tw1 owns the delivery code and the exit codes.
- **tw2 → tw1:** the brief/hint text says "rig tell <name> wakes it" only after tw1's behaviour lands;
  tw2 writes the text to the plan's bar, the lead checks it against tw1's final behaviour at merge.

## Agents

### tw1 — Delivery: `rig tell` wakes idle agents, queues for busy ones, refuses blocked ones
Model: opus (hard: concurrency and live agent state)
Owns:
- src/commands/tell.js
- src/commands/inbox.js
- src/inbox.js
- src/deliver.js
- test/tell-wake.test.js
- test/fixtures/fake-hc/**
- tools/tell-wake-e2e.*
- docs/build-report-tw1.md

Task:
1. Find out from evidence what hc does with `hc send` to a working agent (does it queue until idle,
   type immediately, or refuse?) and with `--if idle`. Use a throwaway terminal running a plain
   program that reads stdin (never another agent's pane), and write what you saw in the report. That
   evidence decides whether busy delivery leans on hc or on a small delivery watcher of our own.
2. `rig tell <name> "<text>"`: always file the message first (today's format). Then resolve `<name>`
   through `src/crew.js`. If it is an hc terminal: idle → `hc send` the message as a turn (one line
   that says who it is from and that it is a rig tell, plus the text), and on success move the file
   to `read/`; working → queue it and make sure a delivery watcher exists that sends within 10 s of
   the agent going idle (one watcher per recipient, never two; it exits when the queue is empty;
   it re-checks the status right before each send and never sends to a working or blocked agent);
   blocked → print `not delivered: <name> is blocked on <what hc says>`, exit with a distinct code.
   No hc terminal, no record, or another backend → print one line `filed only: <name> has no Herdr
   app tab; it reads this with rig inbox <name>`, exit 0.
3. No double delivery: pick one rule (e.g. the file is claimed by an atomic rename into `read/` or a
   `delivering/` dir; whoever wins the rename delivers; a recipient with an armed `rig inbox --wait`
   watcher gets the file through its watcher, not typed) and test both orders.
4. Exit codes: 0 delivered or queued or filed-only; one documented non-zero code for "not delivered"
   (blocked, or the terminal is gone). Usage errors stay 2.
5. A fake `hc` on PATH for the tests (states idle/working/blocked scripted from a file, every `send`
   logged), and `tools/tell-wake-e2e.*`: the real-hc proof the lead runs once (idle helper→lead,
   lead→helper, lead→reviewer, reviewer→lead within 5 s; busy delivered within 10 s of idle; blocked
   refused), printing the measured times.
Checks (each red once on 5.6.0's tell): idle delivered as a turn within 5 s; busy never typed while
working and delivered within 10 s of idle; blocked not typed, exit code, file present; no-tab prints
filed-only and exits 0; a watcher-armed lead gets each message exactly once; two concurrent tells to
one busy agent spawn one watcher and deliver both, in order.

### tw2 — Crew record, tab order, and the briefs' messaging text
Model: sonnet
Owns:
- src/commands/up.js
- src/commands/review.js
- src/commands/down.js
- src/commands/crew.js
- src/hc.js
- src/brief.js
- templates/**
- test/crew-record.test.js
- test/up-tab-order.test.js
- docs/build-report-tw2.md

Task:
1. `rig up` and `rig review --launch` record members in `.rig/crew.json` through `src/crew.js` (see
   Contract). Under hc, the lead's terminal is `HC_TERMINAL_ID`; slice tabs opened by `rig up` or found
   already open (named with the slice id) are recorded with their terminal, tab and space; `rig down`
   forgets the ones it closes.
2. `rig crew` (list, with each member's live hc status when hc is available), `rig crew add <name>
   <terminal> [--role lead|slice|reviewer]`, `rig crew rm <name>`. Put the USAGE line in your report.
3. Item 7: under hc, `rig up` opens tabs so the space reads lead, reviewer(s), then helpers in PLAN
   order. Find out why they land reversed and in front (where the window inserts a tab labelled into
   a space) using a fake `herdr-app` for the test and the evidence from the code; fix it with
   `herdr-app do tab.move` (or the right label/ordering), never with anything that moves the person's
   view (`tab.new`, `space.new`, focus). `rig review --launch` puts `rv-*` right after the lead.
4. Briefs and hints: `tellLine`/`askTheLead` in `src/brief.js`, `rig up`'s inbox hint, `rig review`'s
   hand-over text and anything in `templates/` that tells agents how to message: say the new truth
   (`rig tell <name>` wakes an agent in a Herdr app tab, queues for a busy one, and says when it only
   filed the message). Keep `rig inbox --wait` as the lead's listener where it still applies.
Checks (each red once): the record holds the lead, every slice and the reviewer after `rig up` +
`rig review --launch` with a fake hc/herdr-app; resolve is exact-name (a label that merely matches a
pattern resolves to nothing); tab order after `rig up` with an existing reviewer tab is lead, reviewer,
slices in plan order, and no command that moves the view was called; the brief's tell line says it
wakes the named agent.

### tw3 — Gate semantics: negative command exit, qa never grades a server
Model: sonnet
Owns:
- src/commands/finish.js
- src/commands/qa.js
- src/plan.js
- src/config.js
- test/finish-negative.test.js
- test/qa-not-a-server.test.js
- docs/build-report-tw3.md

Task:
1. Item 4: today `rig finish` wants the negative command to exit 0, and a plan's `npm run negative`
   that exits 1 when the break is caught is read as red. Make the meaning explicit and hard to get
   wrong: decide the rule (for example a `negativeExpect: "fail"|"pass"` setting, or the plan line
   saying "exits non-zero when the break is caught", or Rig inverting it itself when the command is
   a known-red demo), make `rig qa --negative` record what the run's exit MEANS (caught / not caught),
   and make `rig finish` gate on that meaning. The printed line names the command, its exit, and what
   that exit was taken to mean. Existing configs (`negativeCommand: "npm run demo"` where the script
   ends `|| true`) keep working.
2. Item 5: `rig qa` without `--run` used `devCommand` (`npm start`) as the test and counted a server
   that ran 5 minutes as green. A QA test run must be a test: decide the rule (e.g. a separate
   `testCommand`, with `devCommand` never used as the test; or refuse a command that is still running
   and listening on a port when the stall or deadline ends, and never record a killed run as green)
   and enforce it. A run killed by the deadline or a signal is never green.
Checks (each red once): a negative command that exits 1 when the break is caught passes the gate when
configured as such and fails it otherwise, with the meaning printed; a negative command that exits 0
because nothing broke is not counted as caught; `rig qa` with only `devCommand: "npm start"`-style
config refuses to grade it as the test (or never records it green); a deadline-killed run is never
recorded green.
