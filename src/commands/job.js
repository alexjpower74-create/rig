// `rig job <pane> "<task>" [--expect <file>] [--deadline <min>] [--lead <name>] [--id <name>]`
//
// Brief an agent in another pane and wait, with a deadline, until it stops: idle, done or blocked.
// A lead runs it as a background job, so its exit is what wakes the lead with the answer. It replaces
// the bash `codex-job`, and it is how a Codex member (which has no inbox hook of its own) is briefed.
//
// The one prompt the rig ever submits goes to an IDLE agent, between turns. A working or blocked
// pane is refused before anything is sent: keystrokes into a running turn interrupt it, and a
// blocked agent is waiting on a person, not on another task.
//
// It watches herdr's state counter (state_change_seq) as well as the state, so a turn shorter than one
// poll still reads as "left idle and came back", not as "never started".
//
// Exit codes, one per outcome:
//   0  finished (idle or done), and the --expect file, when given, exists and is not empty
//      (a relative --expect is read from the pane's own cwd, as herdr reports it)
//   3  refused: no such agent, it is busy or blocked, or herdr would not take the prompt
//   4  the deadline passed while it was still working
//   5  BLOCKED: it is waiting on a prompt or an approval
//   6  finished, but the --expect file is missing or empty
//   7  never started: still idle with no state change a minute after the prompt
//   2  usage
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { mainRoot, loadConfig } from '../config.js'
import { agentBackend, backendName } from '../terminal.js'
import { leadName } from '../inbox.js'
import { tellLine } from '../brief.js'

export const EXIT = { ok: 0, refused: 3, deadline: 4, blocked: 5, missing: 6, neverStarted: 7 }
const MAX_POLL_MS = 5000
const STOPPED = new Set(['idle', 'done', 'blocked'])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default async function job(args) {
  const valued = new Set(['--expect', '--deadline', '--lead', '--id', '--lines'])
  const pos = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]))
  const [pane, ...taskWords] = pos
  const task = taskWords.join(' ').trim()
  if (!pane || !task) {
    console.error('usage: rig job <pane> "<task>" [--expect <file>] [--deadline <min>]')
    process.exit(2)
  }
  let cfg = {}
  try {
    cfg = loadConfig(mainRoot())
  } catch {
    /* outside a repo: flags and the environment say it all */
  }
  const expect = arg(args, '--expect')
  const minutes = Number(arg(args, '--deadline') ?? cfg.jobDeadline ?? 90)
  if (!(minutes > 0)) {
    console.error(`rig job: --deadline wants minutes above 0`)
    process.exit(2)
  }
  const lead = arg(args, '--lead') || leadName(cfg)
  const id = arg(args, '--id') || pane
  const lines = Number(arg(args, '--lines')) || 25
  const pollMs = Math.max(10, Math.min(MAX_POLL_MS, Number(process.env.RIG_JOB_POLL_MS) || 2000))
  const startMs = Number(process.env.RIG_JOB_START_MS) || 60_000
  const say = (s) => console.log(`rig job: ${s}`)
  // In the Herdr app the pane is an hc terminal (t7); under terminal herdr, a herdr pane id.
  const { agentInfo, agentPrompt, agentRead } = agentBackend(cfg)
  const hcApp = backendName(cfg) === 'hc'

  const before = agentInfo(pane)
  if (!before) {
    say(`no agent in pane ${pane} (${hcApp ? 'hc get' : 'herdr agent get'} found nothing). Nothing was sent.`)
    process.exit(EXIT.refused)
  }
  if (before.status !== 'idle' && before.status !== 'done') {
    say(`${pane} is ${before.status}; rig job only briefs an idle agent. Nothing was sent.`)
    if (before.status === 'blocked') say('BLOCKED: it is waiting on a prompt or approval. That one is for the human.')
    process.exit(EXIT.refused)
  }
  if (!lead) say('no lead set ("lead" in .rig/config.json or RIG_LEAD): the tell line names none, so `rig tell` will look it up then.')

  const text = `${task.trim()}\n\n${tellLine(lead, id)}`
  const start = Date.now()
  const sent = agentPrompt(pane, text)
  if (!sent.ok) {
    say(`${hcApp ? 'hc' : 'herdr'} would not take the prompt for ${pane}: ${sent.err || sent.out || 'no reason given'}`)
    process.exit(EXIT.refused)
  }
  say(`briefed ${pane}; waiting up to ${minutes} min for idle, done or blocked (polling every ${pollMs / 1000} s)`)

  const until = start + minutes * 60_000
  const { now, finished, timedOut } = await waitForTurn(before, { read: () => agentInfo(pane), pollMs, start, until, startMs })

  const mins = ((Date.now() - start) / 60_000).toFixed(1)
  let code = EXIT.ok
  if (timedOut) {
    say(`${pane} is ${now.status} after ${mins} min: DEADLINE (${minutes} min) passed`)
    code = EXIT.deadline
  } else if (!finished) {
    say(`${pane} never started: still ${now.status} ${Math.round(startMs / 1000)} s after the prompt`)
    code = EXIT.neverStarted
  } else say(`${pane} is ${now.status} after ${mins} min`)

  if (expect) {
    // The member writes the file in its own worktree: a relative path is read from the pane's cwd
    // (herdr knows it), not from wherever the lead ran rig job.
    const at = isAbsolute(expect) ? expect : resolve(now.dir || before.dir || process.cwd(), expect)
    const ready = existsSync(at) && statSync(at).isFile() && statSync(at).size > 0
    say(ready ? `expected output ready: ${at}` : `expected output MISSING or empty: ${at}`)
    if (!ready && code === EXIT.ok) code = EXIT.missing
  }
  if (now.status === 'blocked') {
    say('BLOCKED: it is waiting on a prompt or approval. A permission dialog is the human’s; anything else, answer it yourself.')
    if (code === EXIT.ok || code === EXIT.missing) code = EXIT.blocked
  }
  console.log(`--- last ${lines} lines of ${pane} ---`)
  console.log(agentRead(pane, lines).split('\n').slice(-lines).join('\n'))
  process.exit(code)
}

function arg(args, name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}

/**
 * Wait for the agent's next turn to finish, the deadline, or the start window to close without a
 * turn. `read` returns the agent (agentInfo); `nap` and `clock` are the sleep and the clock, so the
 * timing rules can be checked on a virtual clock that load cannot move.
 * @returns {Promise<{ now: object, finished: boolean, timedOut: boolean }>}
 */
export async function waitForTurn(before, { read, pollMs, start, until, startMs, nap = sleep, clock = Date.now }) {
  // Never trust a stale status. The pane's last status (often "done" from its previous turn) is still
  // what herdr reports for a moment after the prompt, and herdr may bump its counter once (done → idle)
  // before the new turn starts: on 2026-10-22 a job read that as finished, at 0 min, with the output
  // MISSING while the member was just starting. A turn is finished only when one of these is seen
  // after the prompt:
  //   - completion_seq moved past its value before the prompt, and the pane is stopped;
  //   - a new working (or blocked) was seen, then a stopped state at a later state_change_seq;
  //   - state_change_seq moved by 2 or more and the pane is stopped (a whole turn between two polls).
  let started = false
  let sawWorking = false
  let workingSeq = null
  let now = before
  let finished = false
  let timedOut = false
  for (;;) {
    await nap(pollMs)
    const info = read()
    if (info) now = info
    const moved = now.seq != null && before.seq != null ? now.seq - before.seq : 0
    const completed = now.completion != null && before.completion != null && now.completion !== before.completion
    if (now.status === 'working' && !sawWorking) {
      started = sawWorking = true
      workingSeq = now.seq
    }
    if (now.status === 'blocked') started = true
    if (completed || moved >= 2) started = true
    finished =
      now.status === 'blocked' ||
      (STOPPED.has(now.status) &&
        (completed || moved >= 2 || (sawWorking && (workingSeq == null || now.seq == null || now.seq !== workingSeq))))
    if (finished) break
    if (!started && clock() - start >= startMs) break
    if (clock() >= until) {
      timedOut = true
      break
    }
  }
  return { now, finished, timedOut }
}
