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
import { fileURLToPath } from 'node:url'
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
fs.appendFileSync(${JSON.stringify(herdrLog)}, JSON.stringify(process.argv.slice(2)) + '\\n')
const p = st.panes[target]
const now = () => {
  let status = p.status, seq = p.seq
  if (p.promptedAt) for (const [ms, s] of p.script) if (Date.now() - p.promptedAt >= ms) { status = s; seq++ }
  return { status, seq }
}
if (noun !== 'agent') process.exit(1)
if (!p) { console.error('{"error":{"code":"agent_not_found"}}'); process.exit(1) }
if (verb === 'get') {
  const n = now()
  console.log(JSON.stringify({ result: { agent: { pane_id: target, agent: 'fake', agent_status: n.status, state_change_seq: n.seq } } }))
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

const pane = (status, script, seq = 10) => ({ status, script, seq })
const setPanes = (panes) => {
  writeFileSync(statePath, JSON.stringify({ panes }))
  writeFileSync(herdrLog, '')
}
const state = () => JSON.parse(readFileSync(statePath, 'utf8'))
const calls = () =>
  readFileSync(herdrLog, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))

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
const broken = (patches) => async () => {
  tree = brokenTree(patches)
  return () => {
    tree = repo
  }
}

const work = join(tmp, 'work')
mkdirSync(work)
/** Run `rig job` from the current tree: { code, out, ms }, killed after `limit` ms (code null). */
function job(args, { env = {}, limit = 20_000 } = {}) {
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
    c.on('close', (code) => {
      clearTimeout(kill)
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
      const r = await job(['p1', 'build the thing', '--deadline', '0.1'])
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
      const r = await job(['p1', 'write it', '--expect', f, '--deadline', '0.1'])
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
    breaks: broken([['src/commands/job.js', 'statSync(expect).size > 0', 'true']]),
  })

  await s.check('exits 5 and says BLOCKED when the pane stops on a prompt or approval', {
    assert: async () => {
      setPanes({
        p1: pane('idle', [
          [200, 'working'],
          [900, 'blocked'],
        ]),
      })
      const r = await job(['p1', 'do it', '--deadline', '0.1'])
      return expectCode(r, 5, () => /BLOCKED/.test(r.out) && r.out.includes('p1 is blocked'))
    },
    breaks: broken([['src/commands/job.js', "new Set(['idle', 'done', 'blocked'])", "new Set(['idle', 'done'])"]]),
  })

  await s.check('a pane that never finishes hits the deadline: exit 4, DEADLINE named, within a poll of it', {
    assert: async () => {
      setPanes({ p1: pane('idle', [[200, 'working']]) })
      const r = await job(['p1', 'forever', '--deadline', '0.05'], { limit: 10_000 })
      return expectCode(r, 4, () => /DEADLINE \(0\.05 min\) passed/.test(r.out) && r.ms >= 3000 && r.ms < 6000)
    },
    breaks: broken([['src/commands/job.js', 'if (Date.now() >= until) {', 'if (false) {']]),
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
      const r = await job(['p1', 'quick one', '--deadline', '1'], { env: { RIG_JOB_POLL_MS: '700', RIG_JOB_START_MS: '3000' } })
      return expectCode(r, 0, () => r.out.includes('p1 is idle'))
    },
    breaks: broken([
      ['src/commands/job.js', " || now.status === 'blocked' || changed) left = true", " || now.status === 'blocked') left = true"],
    ]),
  })

  await s.check('a pane that never leaves idle is "never started" (exit 7), not a success', {
    assert: async () => {
      setPanes({ p1: pane('idle', []) })
      const r = await job(['p1', 'ignored', '--deadline', '1'], { env: { RIG_JOB_START_MS: '1500' } })
      return expectCode(r, 7, () => r.out.includes('p1 never started'))
    },
    // Rig 5.0's codex-job: wait for working (which never came), then for idle, which matched at once.
    breaks: broken([['src/commands/job.js', '} else if (!left) {', '} else if (false) {']]),
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

  await s.check('the default deadline is 90 minutes and the poll is capped at 5 s', {
    assert: async () => {
      const src = readFileSync(join(tree, 'src', 'commands', 'job.js'), 'utf8')
      return /cfg\.jobDeadline \?\? 90\)/.test(src) && /const MAX_POLL_MS = 5000/.test(src)
    },
    breaks: broken([['src/commands/job.js', 'const MAX_POLL_MS = 5000', 'const MAX_POLL_MS = 60000']]),
  })
})

if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
