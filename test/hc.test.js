// The Herdr desktop app backend (src/hc.js). Since 2026-10-31 every agent runs in the Herdr app:
// the window is `herdr-app`, the terminals and their agents are herdr-core's `hc`. Every call here
// goes to a fake `hc` and a fake `herdr-app` on PATH (node scripts sharing one state file), never to
// the person's real window: the suite would otherwise open tabs on his screen.
//
// Each check has a negative control that breaks the one thing it watches.

import './clean-env.js'
import { suite } from '../harness/check.js'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rig-hc-')))
const bin = join(tmp, 'bin')
const home = join(tmp, 'home')
mkdirSync(bin)
mkdirSync(home)
const statePath = join(tmp, 'hc-state.json')
const logPath = join(tmp, 'hc.log')

// ------------------------------------------------------------------------------------------------
// The fakes. State: spaces > tabs > terminal ids, and terminals by id. A terminal may carry a script
// of [ms after the last send, status] steps (turn goes up each time the status leaves working, as
// hc's does), and a `screen` that `hc read` prints.
const common = `#!${process.execPath}
const fs = require('node:fs')
const S = ${JSON.stringify(statePath)}
const st = JSON.parse(fs.readFileSync(S, 'utf8'))
const save = () => fs.writeFileSync(S, JSON.stringify(st))
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ tool: TOOL, argv: args }) + '\\n')
const now = (t) => {
  let status = t.status, turn = t.turn ?? 0, prev = t.status
  if (t.sentAt)
    for (const [ms, s] of t.script ?? [])
      if (Date.now() - t.sentAt >= ms) {
        if (prev === 'working' && s !== 'working') turn++
        status = s; prev = s
      }
  return { status, turn }
}
const where = (id) => {
  for (const sp of st.spaces) for (const tb of sp.tabs) if (tb.terminals.includes(id)) return { sp, tb }
  return {}
}
`
const fakeHc = `${common.replace('TOOL', "'hc'")}
const [cmd, target] = args
const t = st.terminals[target]
if (cmd === '--version') { console.log('hc 0.0-fake'); process.exit(0) }
if (cmd === 'ls') {
  const terminals = Object.entries(st.terminals).map(([address, x]) => {
    const w = where(address)
    return { address, agent: x.app, cwd: x.cwd, state: 'live', status: now(x).status, turn: now(x).turn, where: w.sp ? w.sp.name + ' / ' + w.tb.name : null }
  })
  console.log(JSON.stringify({ terminals })); process.exit(0)
}
if (!t) { console.error(JSON.stringify({ error: { kind: 'not_found', message: 'no terminal ' + target } })); process.exit(3) }
if (cmd === 'get') {
  const w = where(target), n = now(t)
  const labels = t.unlabelled || !w.sp ? {} : { 'herdr.space': w.sp.id, 'herdr.tab': w.tb.id }
  console.log(JSON.stringify({ address: target, cwd: t.cwd, foreground: { cwd: t.cwd }, labels, state: t.finished ? 'finished' : 'live',
    status: t.app ? { app: t.app, state: n.status } : null, turn: n.turn }))
} else if (cmd === 'read') {
  console.log(t.screen ?? Array.from({ length: 30 }, (_, i) => 'screen line ' + (i + 1)).join('\\n'))
} else if (cmd === 'send') {
  const n = now(t)
  if (n.status === 'blocked') { console.error('{"error":{"kind":"blocked"}}'); process.exit(9) }
  t.status = n.status; t.turn = n.turn; t.sentAt = Date.now(); t.sent = args[2]; save()
  console.log('{}')
} else if (cmd === 'keys' || cmd === 'wait') {
  console.log('{}')
} else process.exit(2)
`
const fakeApp = `${common.replace('TOOL', "'herdr-app'")}
const [cmd, verb, json] = args
if (cmd === '--version') { console.log('herdr-app 0.0-fake'); process.exit(0) }
if (cmd === 'ls') {
  console.log(JSON.stringify({ spaces: st.spaces.map((sp) => ({ ...sp, tabs: sp.tabs.map((tb) => ({ ...tb,
    terminals: tb.terminals.map((id) => ({ terminal: id, status: now(st.terminals[id]).status, app: st.terminals[id].app })) })) })) }))
  process.exit(0)
}
if (cmd !== 'do') process.exit(2)
const a = JSON.parse(json)
const fail = (m) => { console.log(JSON.stringify({ error: m })); process.exit(1) }
if (verb === 'tab.new') {
  const sp = st.spaces.find((x) => x.id === a.space)
  if (!sp) fail('no space ' + a.space)
  const n = (st.next = (st.next ?? 50) + 1)
  const id = 't' + n, tab = 'tb' + n
  st.terminals[id] = { app: 'claude-code', status: 'idle', cwd: a.folder, argv: a.argv, screen: st.newScreen ?? 'ready' }
  sp.tabs.push({ id: tab, name: st.retitle ?? a.name ?? null, terminals: [id] })
  save(); console.log(JSON.stringify({ space: sp.id, tab, terminal: id }))
} else if (verb === 'tab.rename' || verb === 'tab.close') {
  const sp = st.spaces.find((x) => x.tabs.some((tb) => tb.id === a.id))
  if (!sp) fail('no tab ' + a.id)
  if (verb === 'tab.rename') sp.tabs.find((tb) => tb.id === a.id).name = a.name
  else sp.tabs = sp.tabs.filter((tb) => tb.id !== a.id)
  save(); console.log('{}')
} else fail('unknown command ' + verb)
`
writeFileSync(join(bin, 'hc'), fakeHc)
writeFileSync(join(bin, 'herdr-app'), fakeApp)
chmodSync(join(bin, 'hc'), 0o755)
chmodSync(join(bin, 'herdr-app'), 0o755)

/** Space A (ours: the lead t1 in tab "lead", slice tabs s1 and s2, a stray "notes"), space B (another crew's s1). */
const world = (extra = {}) => ({
  spaces: [
    {
      id: 'spA',
      name: 'Rig build',
      tabs: [
        { id: 'tbLead', name: 'lead', terminals: ['t1'] },
        { id: 'tbS1', name: 's1', terminals: ['t2'] },
        { id: 'tbS2', name: 's2', terminals: ['t3'] },
        { id: 'tbN', name: 'notes', terminals: ['t4'] },
      ],
    },
    { id: 'spB', name: 'Other', tabs: [{ id: 'tbB1', name: 's1', terminals: ['t9'] }] },
  ],
  terminals: {
    t1: { app: 'claude-code', status: 'working', cwd: '/w/lead' },
    t2: { app: 'claude-code', status: 'idle', cwd: '/w/s1' },
    t3: { app: 'codex', status: 'blocked', cwd: '/w/s2', screen: 'Do you want to run npm test?\n❯ 1. Yes\n  2. No' },
    t4: { app: null, status: null, cwd: '/w' },
    t9: { app: 'claude-code', status: 'working', cwd: '/x/s1' },
  },
  ...extra,
})
/** A negative control's change to every world the next assert builds (null: none). */
let tweak = null
const tweaked = (fn) => async () => {
  tweak = fn
  return () => {
    tweak = null
  }
}
const setWorld = (w = world()) => {
  if (tweak) tweak(w)
  writeFileSync(statePath, JSON.stringify(w))
  writeFileSync(logPath, '')
}
const state = () => JSON.parse(readFileSync(statePath, 'utf8'))
const calls = (tool) =>
  readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((c) => !tool || c.tool === tool)
const appDos = (verb) => calls('herdr-app').filter((c) => c.argv[0] === 'do' && c.argv[1] === verb)

const onlyHc = join(tmp, 'only-hc')
mkdirSync(onlyHc)
writeFileSync(join(onlyHc, 'hc'), fakeHc)
chmodSync(join(onlyHc, 'hc'), 0o755)

const saved = { PATH: process.env.PATH, HOME: process.env.HOME, SHELL: process.env.SHELL }
process.env.PATH = `${bin}:${saved.PATH}`
process.env.HOME = home
process.env.SHELL = '/bin/zsh'
delete process.env.HERDR_ENV
delete process.env.HERDR_PANE_ID
const inApp = (id = 't1') => {
  process.env.HC_TERMINAL_ID = id
}
/** A negative control that flips one environment variable, and puts it back. */
const flipEnv = (k, v) => async () => {
  const old = process.env[k]
  if (v == null) delete process.env[k]
  else process.env[k] = v
  return () => {
    if (old == null) delete process.env[k]
    else process.env[k] = old
  }
}

await suite('Herdr app backend (hc + herdr-app)', async (s) => {
  const { terminal } = await import('../src/terminal.js')
  const hc = await import('../src/hc.js')
  const blocked = await import('../src/blocked.js')
  setWorld()
  inApp()

  // -- selection --------------------------------------------------------------------------------
  await s.check('in a Herdr app terminal (HC_TERMINAL_ID), auto picks the hc driver', {
    assert: async () => terminal({ terminal: 'auto' }).name === 'hc',
    breaks: flipEnv('HC_TERMINAL_ID', null),
  })
  await s.check('HC_TERMINAL_ID wins over a leftover HERDR_ENV, so a stale terminal-herdr variable never picks the old driver', {
    assert: async () => {
      process.env.HERDR_ENV = '1'
      process.env.HERDR_PANE_ID = 'w1:p1'
      try {
        return terminal({}).name === 'hc'
      } finally {
        delete process.env.HERDR_ENV
        delete process.env.HERDR_PANE_ID
      }
    },
    breaks: flipEnv('HC_TERMINAL_ID', null),
  })
  const cfg = { terminal: 'herdr-app' }
  await s.check('"terminal": "herdr-app" (or "hc") in config forces it, and is available here', {
    assert: async () => {
      delete process.env.HC_TERMINAL_ID
      try {
        return terminal(cfg).name === 'hc' && terminal({ terminal: 'hc' }).name === 'hc'
      } finally {
        inApp()
      }
    },
    breaks: async () => {
      cfg.terminal = 'tmux'
      return () => {
        cfg.terminal = 'herdr-app'
      }
    },
  })
  await s.check('available() needs both hc and herdr-app on PATH', {
    assert: async () => terminal({}).available() === true,
    // Only hc on PATH: the window's CLI is missing, so the backend is not available.
    breaks: flipEnv('PATH', onlyHc),
  })

  // -- finding this build's slice tabs ------------------------------------------------------------
  await s.check("slice tabs are this space's tabs named with a plan id: not the lead's, not another space's s1", {
    assert: async () => {
      setWorld()
      const term = terminal({})
      const names = term.listWindows('rig-x', ['s1', 's2', 'lead'])
      const panes = term.slicePanes('rig-x', ['s1', 's2'])
      return (
        names.join(',') === 's1,s2' && panes.map((p) => `${p.name}=${p.pane}:${p.agentStatus}`).join(' ') === 's1=t2:idle s2=t3:blocked'
      )
    },
    // Run from another crew's space, the same ids name its tabs instead.
    breaks: flipEnv('HC_TERMINAL_ID', 't9'),
  })
  await s.check('the space is found from `ls` when our terminal carries no herdr.space label', {
    assert: async () => {
      const w = world()
      w.terminals.t1.unlabelled = true
      setWorld(w)
      return terminal({}).listWindows('rig-x', ['s1', 's2']).join(',') === 's1,s2'
    },
    // `ls` no longer shows our terminal anywhere: the space cannot be found.
    breaks: tweaked((w) => {
      w.spaces[0].tabs[0].terminals = []
    }),
  })

  // -- launching ---------------------------------------------------------------------------------
  let claudeJson = JSON.stringify({ projects: {} })
  const launch = (label = 'c1', cmd = 'claude --model opus "Read .rig/BRIEF.md and follow it."') => {
    writeFileSync(join(home, '.claude.json'), claudeJson)
    return terminal({}).newWindow('rig-x', label, join(tmp, 'wt-' + label), cmd)
  }
  await s.check('rig up opens a TAB in OUR space, named with the slice id, in the worktree, running the launch line in a shell', {
    assert: async () => {
      setWorld()
      const t = launch()
      const [call] = appDos('tab.new')
      if (!call) throw new Error('no tab.new: ' + JSON.stringify(calls()))
      const a = JSON.parse(call.argv[2])
      const ok =
        a.space === 'spA' &&
        a.name === 'c1' &&
        a.folder === join(tmp, 'wt-c1') &&
        a.argv[0] === '/bin/zsh' &&
        a.argv[1] === '-ic' &&
        a.argv[2].startsWith('claude --model opus "Read .rig/BRIEF.md and follow it."; exec /bin/zsh -i')
      if (!ok) throw new Error(JSON.stringify(a))
      if (calls('herdr-app').some((c) => c.argv[1] === 'space.new')) throw new Error('opened a new space')
      return t === 't51' && state().spaces[0].tabs.some((tb) => tb.name === 'c1' && tb.terminals[0] === 't51')
    },
    breaks: flipEnv('HC_TERMINAL_ID', 't9'),
  })
  await s.check('the worktree is pre-trusted in ~/.claude.json before the agent starts', {
    assert: async () => {
      setWorld()
      launch()
      return JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')).projects[join(tmp, 'wt-c1')]?.hasTrustDialogAccepted === true
    },
    // An unreadable config is left alone, so nothing gets trusted.
    breaks: async () => {
      claudeJson = 'not json'
      return () => {
        claudeJson = JSON.stringify({ projects: {} })
      }
    },
  })
  let trustScreen = 'Do you trust this folder?\n❯ 1. No\n  2. Yes, I trust this folder'
  await s.check('a trust prompt still on screen is answered once (down, enter); none on screen, no key is pressed', {
    assert: async () => {
      setWorld(world({ newScreen: trustScreen }))
      launch()
      const keys = calls('hc').filter((c) => c.argv[0] === 'keys')
      if (keys.length !== 1 || keys[0].argv.join(' ') !== 'keys t51 down enter') throw new Error(JSON.stringify(keys))
      setWorld()
      launch()
      return calls('hc').filter((c) => c.argv[0] === 'keys').length === 0
    },
    breaks: async () => {
      const old = trustScreen
      trustScreen = 'ready'
      return () => {
        trustScreen = old
      }
    },
  })
  await s.check('a tab the agent retitled is renamed back to the slice id', {
    assert: async () => {
      setWorld(world({ retitle: 'Claude Code' }))
      launch('c2')
      const r = appDos('tab.rename')
      return r.length === 1 && JSON.parse(r[0].argv[2]).name === 'c2' && state().spaces[0].tabs.some((tb) => tb.name === 'c2')
    },
    breaks: async () => {
      const fake = readFileSync(join(bin, 'herdr-app'), 'utf8')
      writeFileSync(join(bin, 'herdr-app'), fake.replace('sp.tabs.find((tb) => tb.id === a.id).name = a.name', 'void 0'))
      return () => writeFileSync(join(bin, 'herdr-app'), fake)
    },
  })
  let codexCmd = 'codex --model gpt-6 "Read .rig/BRIEF.md"'
  await s.check('a Codex launch line gets --no-daemon (its commands would run outside hc), once', {
    assert: async () => {
      const a = hc.launchArgv(codexCmd, '/bin/sh')[2]
      const again = hc.launchArgv('codex --no-daemon -m x', '/bin/sh')[2]
      return (
        a.startsWith('codex --no-daemon --model gpt-6') &&
        again.startsWith('codex --no-daemon -m x;') &&
        !/--no-daemon/.test(hc.launchArgv('claude', '/bin/sh')[2])
      )
    },
    breaks: async () => {
      codexCmd = 'claude "Read .rig/BRIEF.md"'
      return () => {
        codexCmd = 'codex --model gpt-6 "Read .rig/BRIEF.md"'
      }
    },
  })

  // -- closing ------------------------------------------------------------------------------------
  await s.check('rig down closes only this build’s slice tabs (confirmed), never the lead’s, a stray one or another space’s', {
    assert: async () => {
      setWorld()
      const closed = terminal({}).killSession('rig-x', ['s1', 's2', 'rv-s1'])
      const ids = appDos('tab.close').map((c) => JSON.parse(c.argv[2]))
      const left = state()
        .spaces.flatMap((sp) => sp.tabs.map((tb) => `${sp.id}/${tb.name}`))
        .join(' ')
      return (
        closed.join(',') === 's1,s2' &&
        ids.every((a) => a.confirmed === true) &&
        ids.map((a) => a.id).join(',') === 'tbS1,tbS2' &&
        left === 'spA/lead spA/notes spB/s1'
      )
    },
    breaks: flipEnv('HC_TERMINAL_ID', 't9'),
  })

  // -- hints, blocked scan ---------------------------------------------------------------------------
  await s.check('the read hint names hc and each slice’s terminal; the attach hint names our space', {
    assert: async () => {
      setWorld()
      const term = terminal({})
      return (
        /^hc read <terminal> --lines 40 {3}\(s1=t2 s2=t3\)$/.test(term.readHint('rig-x', ['s1', 's2'])) &&
        term.attachHint('x').includes('Rig build')
      )
    },
    breaks: flipEnv('HC_TERMINAL_ID', 't9'),
  })
  await s.check('the blocked scan reads hc: the blocked Codex agent is found, with its question', {
    assert: async () => {
      setWorld()
      const b = blocked.blockedPanes()
      return b.length === 1 && b[0].pane === 't3' && b[0].question === 'Do you want to run npm test?' && b[0].options.length === 2
    },
    breaks: tweaked((w) => {
      w.terminals.t3.status = 'idle'
      w.terminals.t3.screen = 'all done'
    }),
  })

  // -- agentInfo ----------------------------------------------------------------------------------------
  await s.check('agentInfo maps hc: status from status.state, completion from turn, no state counter, dir from cwd', {
    assert: async () => {
      const w = world()
      w.terminals.t2.turn = 4
      setWorld(w)
      const a = hc.agentInfo('t2')
      return (
        a.status === 'idle' &&
        a.completion === 4 &&
        a.seq === null &&
        a.dir === '/w/s1' &&
        hc.agentInfo('t4') === null &&
        hc.agentInfo('t77') === null
      )
    },
    breaks: tweaked((w) => {
      w.terminals.t2.status = 'working'
    }),
  })
})

// ------------------------------------------------------------------------------------------------
// `rig job` end to end, in a child process with the fakes on PATH.
function job(args, env = {}, limit = 20_000) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [join(repo, 'bin', 'rig.js'), 'job', ...args], {
      cwd: tmp,
      env: { ...process.env, RIG_JOB_POLL_MS: '100', RIG_JOB_START_MS: '1500', RIG_LEAD: 'lead', HC_TERMINAL_ID: 't1', ...env },
    })
    let out = ''
    c.stdout.on('data', (d) => (out += d))
    c.stderr.on('data', (d) => (out += d))
    const kill = setTimeout(() => c.kill('SIGKILL'), limit)
    c.on('close', (code) => {
      clearTimeout(kill)
      resolve({ code, out })
    })
  })
}

await suite('Herdr app backend: rig job', async (s) => {
  let script = [
    [200, 'working'],
    [700, 'idle'],
  ]
  await s.check('rig job sends through hc send and exits 0 when the turn ends (turn goes up)', {
    assert: async () => {
      const w = world()
      w.terminals.t2.script = script
      setWorld(w)
      const r = await job(['t2', 'build the thing', '--deadline', '1'])
      const sent = state().terminals.t2.sent ?? ''
      if (r.code !== 0) throw new Error(`exit ${r.code}\n${r.out}`)
      return sent.startsWith('build the thing') && /t2 is idle after/.test(r.out) && r.out.includes('screen line 30')
    },
    // No turn ever happens: the agent never starts, exit 7.
    breaks: async () => {
      const old = script
      script = []
      return () => {
        script = old
      }
    },
  })
  await s.check('rig job refuses a blocked hc agent (exit 3) and sends nothing', {
    assert: async () => {
      setWorld()
      const r = await job(['t3', 'more work'])
      return r.code === 3 && /t3 is blocked/.test(r.out) && !state().terminals.t3.sent
    },
    breaks: tweaked((w) => {
      w.terminals.t3.status = 'idle'
    }),
  })
  await s.check('rig job names hc when there is no such terminal', {
    assert: async () => {
      setWorld()
      const r = await job(['t77', 'x'])
      return r.code === 3 && r.out.includes('hc get found nothing')
    },
    breaks: tweaked((w) => {
      w.terminals.t77 = { app: 'claude-code', status: 'blocked', cwd: '/' }
    }),
  })
})

for (const [k, v] of Object.entries(saved)) {
  if (v == null) delete process.env[k]
  else process.env[k] = v
}
delete process.env.HC_TERMINAL_ID
if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
