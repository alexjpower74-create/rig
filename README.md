# rig

Orchestration for builds where several Claude Code sessions work the same repo at once.

Three sessions in one checkout will quietly overwrite each other, review their own blind spots, and
hand you a green test suite for a broken page. `rig` is the set of rules that stops each of those,
made executable. Every one of them came from a build where the absence of it cost real time.

```
rig init     scaffold PLAN.md + .rig/config.json  (--hook installs the pre-commit guard)
rig up       a worktree + branch per slice, an agent launched in each
rig status   commits ahead, uncommitted work, and anything edited outside its slice
rig guard    refuse work that reaches outside its slice
rig qa       pin a QA worktree to an exact commit, on its own port
rig brief    print an agent's briefing so you can hand it over deliberately
rig down     tear down; refuses over uncommitted work
```

## The plan file is the contract

One `PLAN.md` at the repo root. Humans read it, agents read it, and the parser reads it — if those
three ever disagree, the format is wrong.

```markdown
### c1 — Collector
Owns:
- src/collect/**

Task:
Visit a site and fill in a Measurement, exactly as src/contract.js defines it.
```

`Owns:` is not documentation. It is enforced.

## Ownership is enforced, not requested

```console
$ rig guard --base main
REFUSED  c1 reached outside its slice (vs main):
  src/content/b.md

  c1 owns: src/hero/**
  If the task genuinely needs this file, say so in your report and let its owner make the change.
```

Install it as a pre-commit hook with `rig init --hook` and the cross-slice edit never reaches
history. This is the single highest-value rule in the tool: an agent that quietly fixes something
in another agent's file produces a defect nobody owns and nobody can find.

## Grade from a QA worktree, never the shared tree

```console
$ rig qa --ref main --port 5199
QA worktree pinned to main @ 40c0d72
  Scoring: 25 rules in two voices, with penalties that decay instead of summing
  port 5199

Every number you report from here belongs to 40c0d72. Say the sha when you report it.
```

Agents are mid-edit in their own trees by definition. A number taken there measured a half-finished
checkout, and you will not find out until someone tries to reproduce it.

## `rig qa` is also your scratch tree

Its name says grading, which undersells it. It makes a detached worktree pinned to an exact commit
— a tree whose state you are free to wreck and whose wreckage belongs to nobody.

```console
rig qa --ref main      # break things in here
```

Use it for anything destructive: testing that `guard` refuses what it should, checking what a
half-deleted repo does, trying a migration. The alternative is what I actually did — running a
destructive test inside another agent's worktree, staging a deletion of their build report without
noticing, and leaving them to find an unexplained deletion in their own tree. The tool refused
correctly. The mistake was needing it to.

## When a number comes through a wrapper, check which layer produced it

Three times in one build, a measurement answered a question adjacent to the one asked — and every
time it was an extra verification step nobody had required, which is why it felt like diligence:

- `guard | tail` reporting exit 0, because that is `tail`'s exit code. A refusal read as a pass.
- Counting Chrome processes two seconds after a suite exited — inside Chrome's own shutdown
  sequence. A clean run looked like a leak.
- Counting processes matching `--remote-debugging-port`, which Chrome's renderer helpers inherit
  from their parent. One browser looked like nine.

The common shape is a wrapper around the thing you care about. **The wrapper always answers, and it
always answers about itself.** "Be careful with numbers" is advice nobody can act on. "When a number
comes through a wrapper, check which layer produced it" is something you can catch yourself doing.

## A check that cannot fail measured nothing

This is the part worth stealing even if you never run the CLI.

`harness/check.js` runs every assertion twice: once against the real thing, and once against
something you have deliberately broken. If it passes both, it is not green — it is **VOID**, and
the run fails.

```js
await t.check('CTA is clickable after a fast scroll', {
  assert: () => isHittable(page, '#cta'),
  breaks: async () => {           // break it on purpose; return a restore function
    await page.eval('...')
    return () => page.eval('...')
  }
})
```

Four states, and only one of them is good news:

| | |
|---|---|
| **PASS** | held against the page, and failed when the page was broken |
| **FAIL** | did not hold |
| **VOID** | held even against the broken page — it is not evidence of anything |
| **UNPROVEN** | no negative control supplied; has never been shown to fail |

`examples/` ships a fixture with a real bug: a sticky nav whose "ignore anchor-link jumps" guard
also swallows every delta a fast wheel produces, so at speed it never hides and it covers the
call-to-action. Run it:

```console
$ node examples/demo.test.js

sticky nav vs the CTA
  UNPRV the page is actually rendering
        no negative control — this check has never been shown to fail
  PASS  [hit-test] CTA is clickable after a SLOW scroll
  VOID  [rect] CTA has a real box after a FAST scroll
        passed even with the thing under test broken — this assertion measures nothing
  FAIL  [hit-test] CTA is clickable after a FAST scroll

sticky nav vs the CTA: 1 passed, 1 failed, 1 void, 1 unproven

after a fast scroll the nav is still covering the page; a tap at the CTA's centre lands on: header#nav
```

The rect-based check is the one most suites are made of, and it is void. The slow scroll passes.
Only real input at real speed, hit-tested, finds the bug.

On its first use against this project's own scoring tests, 6 of 14 checks came back VOID. They had
been written by me, they looked reasonable, and they were watching nothing.

## An agent stuck waiting on a person

The failure this was blindest to. An agent sitting on a permission prompt looks exactly like an
agent thinking hard — no commits, a few dirty files, quiet. The foreman reads `status`, sees
nothing alarming, and everybody waits; one of them for as long as the desk is empty.

```console
$ rig status
WAITING ON YOU — 1 session stopped for a person:

  impress-steve-clarke:3 (claude 2)
     Allow reads outside the working directories?
       ❯ 1. Yes, keep allowing reads outside the working directories
         2. No, block reads outside the working directories from now on
     answer it in that pane — do not send keys from here, it kills the turn
```

Only the tail of the scrollback counts, because a prompt answered ten minutes ago is still sitting
further up and would otherwise read as a live block forever.

Briefs also tell agents to keep scratch files inside their own worktree. A debug screenshot written
to `/tmp` is what caused the block this was built to catch.

## goto() will not call an error page a load

Chrome fires the load event on its **own** error page, and that page's `document.title` is the
hostname. A failed navigation is therefore indistinguishable, to any naive check, from a successful
one that rendered a short page.

Found the hard way. A live site answered `curl` with a 200 and gave Chrome `ERR_EMPTY_RESPONSE`.
`goto()` returned cleanly, `document.title` read back the domain, and twenty minutes went into
believing a working collector was broken. `goto()` now checks where the page actually landed and
throws with the underlying `ERR_` code.

It is worth saying plainly that this was a check that could not fail, living inside the harness
built to catch checks that cannot fail.

## Real input, not synthetic events

`harness/input.js` drives through `Input.dispatchMouseEvent` and `Input.dispatchTouchEvent` — the
same door a physical wheel or finger goes through. It does not set `scrollTop` and it does not
dispatch a synthetic `Event`.

Programmatic scrolling eases. Easing is exactly what input-speed bugs outrun. Four green suites
once missed a site that was visibly broken to anyone who scrolled it with a hand.

## Hit-test, don't measure rectangles

`getBoundingClientRect` reports where a box *would* be if nothing were in the way. It will happily
tell you a 44×44 button is fine while it sits under a sticky header, inside a clipping parent, or
beneath a full-screen overlay.

`harness/hittest.js` asks the only question that matters — if a finger lands here, what does it
hit? — via `document.elementFromPoint`. `whatIsAt(x, y)` names the thief.

`isRendering(page)` is there because a backgrounded or occluded tab renders nothing, and a
screenshot of one is a picture of a lie.

## Briefing agents

`rig up` writes `.rig/BRIEF.md` into each worktree with the agent's slice, its task, who else is on
the build, and the standing rules. `rig brief <id>` prints it so you can hand it over yourself.

The rig never types into an agent's pane. Keystrokes sent to a running session land as an interrupt
and kill the turn it is in the middle of. Panes are read-only from outside: `herdr pane read <id>` or
`tmux capture-pane -p`.

## herdr or tmux

`rig up` launches agents in whichever multiplexer it is running inside. Under [herdr](https://herdr.dev)
(`HERDR_ENV=1`) it **stays in the workspace it was run from** and splits off one pane per slice,
labelled with the slice id — main and every helper on one screen, never a new workspace. Under
tmux it makes a session with one window per slice. Force one with `"terminal": "herdr"` or
`"tmux"` in `.rig/config.json`. `rig down` closes only the slice panes; the workspace is yours.

If the helper panes already exist (someone made them by hand), label them with the slice ids
(`herdr pane rename <id> c1`) and use `rig up --no-launch`: the worktrees and briefs get made,
`rig status` finds the panes by label, and you brief them yourself.

Under herdr, `rig status` trusts herdr's own agent state: a slice herdr reports as `blocked` is
listed under WAITING ON YOU whether or not the prompt text is still on screen, and one it reports as
`working` is never mistaken for blocked by a stale prompt in scrollback. The text scan is the fallback
for `unknown`.

## Install

```console
git clone <this repo> && cd rig && npm link
```

Node 22+. No dependencies. macOS/Linux; the harness expects Chrome at the usual macOS path, or set
`RIG_CHROME`.

## Why these rules and not others

Each one replaced a specific bad afternoon:

- **File-ownership slices** — three sessions in one checkout overwrote each other's work.
- **QA worktree pinned to a sha** — numbers were being read off a tree someone was still editing.
- **Commit every verified step** — a usage-limit pause landed mid-task and left an uncommitted tree
  nobody could interpret.
- **Cross-review early** — every real defect crossed a session boundary. Self-review found none.
- **Negative controls** — a suite went green against a page that was visibly broken.
- **Real input** — the bug only appeared above a speed no programmatic scroll reaches.
- **Hit-testing** — the button measured 44×44 and could not be tapped.
- **Notes files are not queues** — a killed agent's notes outlived its reasoning and the next agent
  worked from stale instructions.
