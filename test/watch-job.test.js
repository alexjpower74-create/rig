// Rig 5.5, item 5: `rig job` briefs an agent in another pane and exits when it is idle, done or
// blocked, or on its deadline. Every run here talks to a fake `herdr` on PATH (a node script with a
// scripted pane), never a real pane.
//
// Each check's control runs a copy of the rig's tree with the guard taken out (the old behaviour
// swapped back in), so a check that would pass against the broken code is VOID.

import { suite } from '../harness/check.js'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync, readFileSync, chmodSync, cpSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { tellLine } from '../src/brief.js'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rig-watch-job-')))
const bin = join(tmp, 'bin')
mkdirSync(bin)
const statePath = join(tmp, 'herdr-state.json')
const herdrLog = join(tmp, 'herdr.log')

// ------------------------------------------------------------------------------------------------
// The fake herdr. A pane has a status, a state counter, and a script of [ms after the prompt, status]
// steps. `agent get` reports the step the clock has reached; `agent prompt` starts the clock and is
// rejected for a working or blocked pane, as the real one does.
writeFileSync(
  join(bin, 'herdr'),
  `#!${process.execPath}
const fs = require('node:fs')
const S = ${JSON.stringify(statePath)}
const st = JSON.parse(fs.readFileSync(S, 'utf8'))
const [noun, verb, target, text] = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(herdrLog)}, JSON.stringify({ t: Date.now(), argv: process.argv.slice(2) }) + '\\n')
const p = st.panes[target]
// A step may also write a file (the member's output, written as it finishes). completion_seq counts
// the turns that finished; a pane with noSeq has no state_change_seq, a pane with completion has one.
const now = () => {
  let status = p.status, seq = p.seq, done = p.completion ?? 0, prev = p.status
  if (p.promptedAt)
    for (const [ms, s, file] of p.script)
      if (Date.now() - p.promptedAt >= ms) {
        status = s; seq++
        if ((s === 'idle' || s === 'done') && prev === 'working') done++
        prev = s
        if (file && !fs.existsSync(file)) fs.writeFileSync(file, 'output\\n')
      }
  return { status, seq, done }
}
if (noun !== 'agent') process.exit(1)
if (!p) { console.error('{"error":{"code":"agent_not_found"}}'); process.exit(1) }
if (verb === 'get') {
  const n = now()
  const agent = { pane_id: target, agent: 'fake', agent_status: n.status, cwd: p.cwd, foreground_cwd: p.cwd }
  if (!p.noSeq) agent.state_change_seq = n.seq
  if (p.completion != null) agent.completion_seq = n.done
  console.log(JSON.stringify({ result: { agent } }))
} else if (verb === 'prompt') {
  const n = now()
  if (n.status === 'working' || n.status === 'blocked') { console.error('{"error":{"code":"agent_' + n.status + '"}}'); process.exit(1) }
  p.promptedAt = Date.now(); p.prompt = text
  fs.writeFileSync(S, JSON.stringify(st))
  console.log('{"result":{"type":"prompt_submitted"}}')
} else if (verb === 'read') {
  console.log(Array.from({ length: 30 }, (_, i) => 'pane line ' + (i + 1)).join('\\n'))
}
`,
)
chmodSync(join(bin, 'herdr'), 0o755)

const pane = (status, script, seq = 10, cwd, extra = {}) => ({ status, script, seq, cwd, ...extra })
const setPanes = (panes) => {
  writeFileSync(statePath, JSON.stringify({ panes }))
  writeFileSync(herdrLog, '')
}
const state = () => JSON.parse(readFileSync(statePath, 'utf8'))
// Every herdr call the job made, with the time the fake saw it: { t, argv }. Timing checks measure
// these (the job's own polls), not the wall time of a child process, which load stretches.
const logged = () =>
  readFileSync(herdrLog, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
const calls = () => logged().map((c) => c.argv)
/** Times of the `agent get` polls made after the prompt, and the prompt's own time. */
const pollsAfterPrompt = () => {
  const all = logged()
  const at = all.find((c) => c.argv[1] === 'prompt')?.t
  return { at, polls: all.filter((c) => c.argv[1] === 'get' && at != null && c.t > at).map((c) => c.t) }
}

// A copy of the tree with a patch applied: [file, old, new]. Each `old` must be there, or the control
// would silently run the real code.
function brokenTree(patches) {
  const root = mkdtempSync(join(tmp, 'broken-'))
  for (const d of ['bin', 'src', 'templates']) cpSync(join(repo, d), join(root, d), { recursive: true })
  cpSync(join(repo, 'package.json'), join(root, 'package.json'))
  for (const [file, from, to] of patches) {
    const p = join(root, file)
    const text = readFileSync(p, 'utf8')
    if (!text.includes(from)) throw new Error(`control patch not found in ${file}: ${from}`)
    writeFileSync(p, text.replace(from, to))
  }
  return root
}

let tree = repo
/** The tree's own module, so a control swaps the code in-process too. */
const mod = (rel) => import(pathToFileURL(join(tree, rel)).href + `?t=${tree === repo ? 0 : tree}`)
const broken = (patches) => async () => {
  tree = brokenTree(patches)
  return () => {
    tree = repo
  }
}

const work = join(tmp, 'work')
mkdirSync(work)
/** Run `rig job` from the current tree: { code, out, ms }, killed after `limit` ms (code null). */
function job(args, { env = {}, limit = 30_000, stopWhen } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const c = spawn(process.execPath, [join(tree, 'bin', 'rig.js'), 'job', ...args], {
      cwd: work,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        RIG_JOB_POLL_MS: '100',
        RIG_LEAD: 'lead',
        HERDR_ENV: '',
        ...env,
      },
    })
    let out = ''
    c.stdout.on('data', (d) => (out += d))
    c.stderr.on('data', (d) => (out += d))
    const kill = setTimeout(() => c.kill('SIGKILL'), limit)
    // stopWhen: end the run early once the log shows what the check needs (a control would otherwise
    // run to its limit). A run stopped this way has code null.
    const watch = stopWhen && setInterval(() => stopWhen() && c.kill('SIGKILL'), 100)
    c.on('close', (code) => {
      clearTimeout(kill)
      if (watch) clearInterval(watch)
      resolve({ code, out, ms: Date.now() - t0 })
    })
  })
}
const expectCode = (r, code, also = () => true) => {
  if (r.code !== code) throw new Error(`exit ${r.code}, wanted ${code}\n${r.out}`)
  return also(r)
}

await suite('rig 5.5: rig job watches a pane until it stops', async (s) => {
  await s.check('exits 0 when the pane goes working → idle, and prints the state, the minutes and its last lines', {
    assert: async () => {
      setPanes({
        p1: pane('idle', [
          [200, 'working'],
          [900, 'idle'],
        ]),
      })
      const r = await job(['p1', 'build the thing', '--deadline', '1'])
      return expectCode(
        r,
        0,
        () =>
          /p1 is idle after \d+\.\d min/.test(r.out) &&
          r.out.includes('--- last 25 lines of p1 ---') &&
          r.out.includes('pane line 30') &&
          !r.out.includes('pane line 5\n'),
      )
    },
    breaks: broken([['src/commands/job.js', "new Set(['idle', 'done', 'blocked'])", "new Set(['done', 'blocked'])"]]),
  })

  await s.check('exits 0 on done, and says the expected file is ready', {
    assert: async () => {
      setPanes({
        p1: pane('idle', [
          [200, 'working'],
          [900, 'done'],
        ]),
      })
      const f = join(work, 'out.md')
      writeFileSync(f, 'result\n')
      const r = await job(['p1', 'write it', '--expect', f, '--deadline', '1'])
      return expectCode(r, 0, () => r.out.includes(`expected output ready: ${f}`) && r.out.includes('p1 is done'))
    },
    breaks: broken([['src/commands/job.js', "new Set(['idle', 'done', 'blocked'])", "new Set(['idle', 'blocked'])"]]),
  })

  await s.check('finished with the expected file missing or empty is exit 6, named MISSING', {
    assert: async () => {
      setPanes({
        p1: pane('idle', [
          [200, 'working'],
          [900, 'done'],
        ]),
      })
      const f = join(work, 'empty.md')
      writeFileSync(f, '')
      const r = await job(['p1', 'write it', '--expect', f, '--deadline', '1'])
      return expectCode(r, 6, () => r.out.includes(`expected output MISSING or empty: ${f}`))
    },
    breaks: broken([['src/commands/job.js', 'statSync(at).size > 0', 'true']]),
  })

  await s.check('exits 5 and says BLOCKED when the pane stops on a prompt or approval', {
    assert: async () => {
      setPanes({
        p1: pane('idle', [
          [200, 'working'],
          [900, 'blocked'],
        ]),
      })
      const r = await job(['p1', 'do it', '--deadline', '1'])
      return expectCode(r, 5, () => /BLOCKED/.test(r.out) && r.out.includes('p1 is blocked'))
    },
    breaks: broken([
      ['src/commands/job.js', "new Set(['idle', 'done', 'blocked'])", "new Set(['idle', 'done'])"],
      ['src/commands/job.js', "      now.status === 'blocked' ||\n", ''],
    ]),
  })

  // The deadline, in two parts. The rule ("stop at the first poll at or past the deadline, no
  // sooner, no later") is checked on a virtual clock, where load cannot move it: the first version
  // read it off the fake herdr's log, whose clock starts later than the job's, and went red 4 of 10
  // times under load while the job was right. The CLI run is held only to exit 4, DEADLINE named,
  // no sooner than the deadline and inside the plan's 60 s.
  await s.check('a pane that never finishes hits the deadline: exit 4, DEADLINE named, after 3 s and inside 60 s', {
    assert: async () => {
      setPanes({ p1: pane('idle', [[200, 'working']]) })
      const r = await job(['p1', 'forever', '--deadline', '0.05'], { limit: 60_000 })
      return expectCode(r, 4, () => /DEADLINE \(0\.05 min\) passed/.test(r.out) && r.ms >= 3000 && r.ms < 60_000)
    },
    breaks: broken([['src/commands/job.js', '    if (clock() >= until) {', '    if (false) {']]),
    timeout: 70_000,
  })

  await s.check('on a virtual clock: a turn that never ends stops at the first poll at or past the deadline', {
    assert: async () => {
      const { waitForTurn } = await mod('src/commands/job.js')
      let t = 0
      let reads = 0
      const r = await waitForTurn(
        { status: 'idle', seq: 10 },
        {
          read: () => {
            if (++reads > 100_000) throw new Error('still polling after 100000 reads: no deadline')
            return { status: 'working', seq: 11 }
          },
          nap: (ms) => new Promise((ok) => setImmediate(() => ok((t += ms)))),
          clock: () => t,
          pollMs: 100,
          start: 0,
          until: 3000,
          startMs: 60_000,
        },
      )
      if (!(r.timedOut && !r.finished)) throw new Error(JSON.stringify(r))
      if (t !== 3000 || reads !== 30) throw new Error(`stopped at ${t} ms after ${reads} reads`)
      return true
    },
    breaks: broken([['src/commands/job.js', '    if (clock() >= until) {', '    if (false) {']]),
    timeout: 30_000,
  })

  await s.check('a busy pane is refused before anything is sent (exit 3, no prompt)', {
    assert: async () => {
      setPanes({ p1: pane('working', []) })
      const r = await job(['p1', 'more work', '--deadline', '0.05'])
      return expectCode(r, 3, () => r.out.includes('only briefs an idle agent') && !calls().some((c) => c[1] === 'prompt'))
    },
    breaks: broken(
      [["if (before.status !== 'idle' && before.status !== 'done') {", 'if (false) {']].map((p) => ['src/commands/job.js', ...p]),
    ),
  })

  await s.check('a blocked pane is refused too, and its BLOCKED is said', {
    assert: async () => {
      setPanes({ p1: pane('blocked', []) })
      const r = await job(['p1', 'more work'])
      return expectCode(r, 3, () => /BLOCKED/.test(r.out) && !calls().some((c) => c[1] === 'prompt'))
    },
    breaks: broken([['src/commands/job.js', "if (before.status !== 'idle' && before.status !== 'done') {", 'if (false) {']]),
  })

  await s.check('an unknown pane is refused: exit 3, nothing sent', {
    assert: async () => {
      setPanes({})
      const r = await job(['nope', 'x'])
      return expectCode(r, 3, () => r.out.includes('no agent in pane nope'))
    },
    breaks: broken([['src/commands/job.js', '  if (!before) {', '  if (false) {']]),
  })

  await s.check('a turn shorter than one poll still reads as finished, from the state counter (exit 0, not 7)', {
    assert: async () => {
      setPanes({
        p1: pane('idle', [
          [30, 'working'],
          [60, 'idle'],
        ]),
      })
      const r = await job(['p1', 'quick one', '--deadline', '1'], { env: { RIG_JOB_POLL_MS: '700', RIG_JOB_START_MS: '30000' } })
      return expectCode(r, 0, () => r.out.includes('p1 is idle'))
    },
    breaks: broken([
      ['src/commands/job.js', 'if (completed || moved >= 2) started = true', 'if (completed) started = true'],
      ['src/commands/job.js', '(completed || moved >= 2 || (sawWorking', '(completed || (sawWorking'],
    ]),
  })

  await s.check('a pane that never leaves idle is "never started" (exit 7), not a success', {
    assert: async () => {
      setPanes({ p1: pane('idle', []) })
      const r = await job(['p1', 'ignored', '--deadline', '1'], { env: { RIG_JOB_START_MS: '1500' } })
      return expectCode(r, 7, () => r.out.includes('p1 never started'))
    },
    // Rig 5.0's codex-job: wait for working (which never came), then for idle, which matched at once.
    breaks: broken([['src/commands/job.js', '} else if (!finished) {', '} else if (false) {']]),
  })

  await s.check('the task it sends ends with the tell line, naming the lead and the id', {
    assert: async () => {
      setPanes({
        p1: pane('idle', [
          [100, 'working'],
          [300, 'idle'],
        ]),
      })
      const r = await job(['p1', 'review the diff', '--id', 'rev1', '--deadline', '1'])
      expectCode(r, 0)
      const sent = state().panes.p1.prompt
      return sent.startsWith('review the diff') && sent.trimEnd().split('\n').pop() === tellLine('lead', 'rev1')
    },
    breaks: broken([['src/commands/job.js', '`${task.trim()}\\n\\n${tellLine(lead, id)}`', 'task.trim()']]),
  })

  // The bar: an idle pane is noticed within 60 s. With the default poll (2 s, capped at 5 s) it is
  // seconds; the control lifts the cap and asks for a 10-minute poll, the "check now and then" watcher.
  await s.target('rig job notices a pane going idle (default poll, capped)', {
    measure: async () => {
      setPanes({
        p1: pane('idle', [
          [100, 'working'],
          [600, 'idle'],
        ]),
      })
      const r = await job(['p1', 'x', '--deadline', '5'], { env: { RIG_JOB_POLL_MS: '600000' }, limit: 65_000 })
      return r.code === null ? 65_000 : r.ms - 600
    },
    atMost: 60_000,
    unit: 'ms',
    timeout: 70_000,
    breaks: broken([
      [
        'src/commands/job.js',
        'Math.min(MAX_POLL_MS, Number(process.env.RIG_JOB_POLL_MS) || 2000)',
        'Number(process.env.RIG_JOB_POLL_MS) || 2000',
      ],
    ]),
  })

  // Measured, not grepped: the deadline it says it waits for, and how soon it notices with a huge poll asked for.
  await s.check('with no --deadline it waits up to 90 minutes, and says so', {
    assert: async () => {
      setPanes({
        p1: pane('idle', [
          [100, 'working'],
          [400, 'idle'],
        ]),
      })
      const r = await job(['p1', 'x'])
      return expectCode(r, 0, () => r.out.includes('waiting up to 90 min for idle, done or blocked'))
    },
    breaks: broken([['src/commands/job.js', 'cfg.jobDeadline ?? 90)', 'cfg.jobDeadline ?? 60)']]),
  })

  // The clamp, measured on the poll itself: the job says the interval it uses, and the gaps between its
  // `agent get` calls are that interval (never shorter: no busy loop). An end-to-end wall-time bar on
  // a 5 s poll had ~1 s of headroom and went red under crew load; the end-to-end bar is the target
  // above, at the plan's 60 s.
  await s.check('a 10-minute poll asked for is clamped to 5 s, measured between the job’s own polls', {
    assert: async () => {
      setPanes({ p1: pane('idle', [[100, 'working']]) })
      const r = await job(['p1', 'x', '--deadline', '5'], {
        env: { RIG_JOB_POLL_MS: '600000' },
        limit: 40_000,
        stopWhen: () => pollsAfterPrompt().polls.length >= 3,
      })
      const { at, polls } = pollsAfterPrompt()
      if (!r.out.includes('(polling every 5 s)')) throw new Error(r.out)
      if (polls.length < 3) throw new Error(`only ${polls.length} poll(s) after the prompt in ${r.ms} ms`)
      const gaps = [polls[0] - at, polls[1] - polls[0], polls[2] - polls[1]]
      // A gap is the sleep plus one herdr call; load lengthens it and can never shorten it.
      if (gaps.some((g) => g < 4900)) throw new Error(`gaps ${gaps.join(', ')} ms: shorter than the 5 s poll`)
      return true
    },
    breaks: broken([['src/commands/job.js', 'const MAX_POLL_MS = 5000', 'const MAX_POLL_MS = 60000']]),
    timeout: 45_000,
  })

  await s.check('a relative --expect is read from the pane’s own worktree, not the lead’s cwd', {
    assert: async () => {
      const member = join(tmp, 'member-worktree')
      mkdirSync(join(member, 'docs'), { recursive: true })
      writeFileSync(join(member, 'docs', 'review.md'), 'findings\n')
      rmSync(join(work, 'docs'), { recursive: true, force: true })
      setPanes({
        p1: pane(
          'idle',
          [
            [100, 'working'],
            [400, 'done'],
          ],
          10,
          member,
        ),
      })
      const r = await job(['p1', 'review it', '--expect', 'docs/review.md', '--deadline', '1'])
      return expectCode(r, 0, () => r.out.includes(`expected output ready: ${join(member, 'docs', 'review.md')}`))
    },
    breaks: broken([['src/commands/job.js', 'resolve(now.dir || before.dir || process.cwd(), expect)', 'resolve(process.cwd(), expect)']]),
  })

  // ---------------------------------------------------------------------------------------------
  // A stale status never counts (the lead's bug, 2026-10-22): the pane was "done" from its last turn,
  // the switch to working came late, and the job saw the old "done" and exited at 0 min with the
  // output MISSING while the member was just starting. Here herdr also bumps its counter once right
  // after the prompt (done → idle) before the real turn begins: a bump that is not a new turn.
  const late = (out) =>
    pane(
      'done',
      [
        [50, 'idle'],
        [2500, 'working'],
        [3500, 'done', out],
      ],
      10,
      undefined,
      { completion: 4 },
    )

  await s.check('a pane whose last status was done and whose switch to working is late: waits for the new turn, output found', {
    assert: async () => {
      const out = join(work, 'late-output.md')
      rmSync(out, { force: true })
      setPanes({ p1: late(out) })
      const r = await job(['p1', 'start late', '--expect', out, '--deadline', '0.5'], { env: { RIG_JOB_POLL_MS: '100' } })
      return expectCode(r, 0, () => r.ms >= 3500 && r.out.includes(`expected output ready: ${out}`) && r.out.includes('p1 is done'))
    },
    // 5acc1e1's loop: any counter bump counted as having left idle, so the done → idle bump ended it.
    breaks: broken([
      [
        'src/commands/job.js',
        '    finished =\n',
        "    if (now.seq !== before.seq || now.status === 'working') started = true\n    if (started && STOPPED.has(now.status)) { finished = true; break }\n    finished =\n",
      ],
    ]),
    timeout: 30_000,
  })

  await s.check('stale done with no counter change at all: still waits for the late turn', {
    assert: async () => {
      const out = join(work, 'late-output-2.md')
      rmSync(out, { force: true })
      setPanes({
        p1: pane('done', [
          [2500, 'working'],
          [3500, 'done', out],
        ]),
      })
      const r = await job(['p1', 'start late', '--expect', out, '--deadline', '0.5'])
      return expectCode(r, 0, () => r.ms >= 3500 && r.out.includes('expected output ready'))
    },
    // codex-job's logic: the status as it reads now, trusted at once.
    breaks: broken([
      ['src/commands/job.js', '    finished =\n', '    if (STOPPED.has(now.status)) { finished = true; break }\n    finished =\n'],
    ]),
    timeout: 30_000,
  })

  await s.check('only a stale bump and no turn: "never started" (exit 7), not done', {
    assert: async () => {
      setPanes({ p1: pane('done', [[50, 'idle']], 10, undefined, { completion: 4 }) })
      const r = await job(['p1', 'x', '--deadline', '1'], { env: { RIG_JOB_START_MS: '1500' } })
      return expectCode(r, 7, () => r.out.includes('p1 never started'))
    },
    breaks: broken([
      [
        'src/commands/job.js',
        '    finished =\n',
        '    if (now.seq !== before.seq && STOPPED.has(now.status)) { finished = true; break }\n    finished =\n',
      ],
    ]),
  })

  await s.check('completion_seq advancing is a finished turn, even when the poll saw no working and herdr gives no state counter', {
    assert: async () => {
      setPanes({
        p1: pane(
          'idle',
          [
            [30, 'working'],
            [60, 'idle'],
          ],
          10,
          undefined,
          { completion: 7, noSeq: true },
        ),
      })
      const r = await job(['p1', 'quick', '--deadline', '1'], { env: { RIG_JOB_POLL_MS: '700', RIG_JOB_START_MS: '30000' } })
      return expectCode(r, 0, () => r.out.includes('p1 is idle'))
    },
    breaks: broken([
      [
        'src/commands/job.js',
        'const completed = now.completion != null && before.completion != null && now.completion !== before.completion',
        'const completed = false',
      ],
    ]),
  })
})

if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
