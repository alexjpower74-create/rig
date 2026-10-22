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
//   3  refused: no such agent, it is busy or blocked, or herdr would not take the prompt
//   4  the deadline passed while it was still working
//   5  BLOCKED: it is waiting on a prompt or an approval
//   6  finished, but the --expect file is missing or empty
//   7  never started: still idle with no state change a minute after the prompt
//   2  usage
import { existsSync, statSync } from 'node:fs'
import { mainRoot, loadConfig } from '../config.js'
import { agentInfo, agentPrompt, agentRead } from '../herdr.js'
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

  const before = agentInfo(pane)
  if (!before) {
    say(`no agent in pane ${pane} (herdr agent get found nothing). Nothing was sent.`)
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
    say(`herdr would not take the prompt for ${pane}: ${sent.err || sent.out || 'no reason given'}`)
    process.exit(EXIT.refused)
  }
  say(`briefed ${pane}; waiting up to ${minutes} min for idle, done or blocked`)

  const until = start + minutes * 60_000
  let left = false
  let now = before
  let timedOut = false
  for (;;) {
    await sleep(pollMs)
    const info = agentInfo(pane)
    if (info) now = info
    const changed = now.seq != null && before.seq != null && now.seq !== before.seq
    if (now.status === 'working' || now.status === 'blocked' || changed) left = true
    if (left && STOPPED.has(now.status)) break
    if (!left && Date.now() - start >= startMs) break
    if (Date.now() >= until) {
      timedOut = true
      break
    }
  }

  const mins = ((Date.now() - start) / 60_000).toFixed(1)
  let code = EXIT.ok
  if (timedOut) {
    say(`${pane} is ${now.status} after ${mins} min: DEADLINE (${minutes} min) passed`)
    code = EXIT.deadline
  } else if (!left) {
    say(`${pane} never started: still ${now.status} ${Math.round(startMs / 1000)} s after the prompt`)
    code = EXIT.neverStarted
  } else say(`${pane} is ${now.status} after ${mins} min`)

  if (expect) {
    const ready = existsSync(expect) && statSync(expect).isFile() && statSync(expect).size > 0
    say(ready ? `expected output ready: ${expect}` : `expected output MISSING or empty: ${expect}`)
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
