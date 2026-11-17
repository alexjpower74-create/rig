// Rig 5.6.1, item 7: under the Herdr app the space reads lead, reviewer(s), then helpers in plan
// order. A terminal `hc run` starts with a herdr.space label lands in the window wherever the window
// puts it (the fake here puts it in FRONT, which is how a build came out reversed and ahead of its
// reviewer), so `rig up` arranges the tabs afterwards with `herdr-app do tab.move`, and never with
// a command that moves the person's view. Every call goes to fakes on PATH; the real window is never
// touched. Each check's control runs a copy of the tree with the fix taken out.

import './clean-env.js'
import { suite } from '../harness/check.js'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rig-up-tab-order-')))
const bin = join(tmp, 'bin')
mkdirSync(bin)
const statePath = join(tmp, 'state.json')
const logPath = join(tmp, 'calls.log')

const fakeHc = `#!${process.execPath}
const fs = require('node:fs')
const S = ${JSON.stringify(statePath)}
const st = JSON.parse(fs.readFileSync(S, 'utf8'))
const save = () => fs.writeFileSync(S, JSON.stringify(st))
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ tool: 'hc', argv: args }) + '\\n')
const [cmd, target] = args
const where = (id) => { for (const sp of st.spaces) for (const tb of sp.tabs) if (tb.terminals.includes(id)) return { sp, tb }; return {} }
if (cmd === '--version') { console.log('hc 0.0-fake'); process.exit(0) }
if (cmd === 'run') {
  // A labelled terminal shows up as a new unnamed tab of that space. st.insert says where the window puts it.
  const at = args.indexOf('--'), opts = args.slice(1, at)
  const label = (k) => { const i = opts.findIndex((o, j) => opts[j - 1] === '--label' && o.startsWith(k + '=')); return i < 0 ? null : opts[i].slice(k.length + 1) }
  const sp = st.spaces.find((x) => x.id === label('herdr.space'))
  const n = (st.next = (st.next ?? 50) + 1), id = 't' + n
  st.terminals[id] = { app: 'claude-code', status: 'idle' }
  const tab = { id: label('herdr.tab'), name: null, terminals: [id] }
  if (st.insert === 'front') sp.tabs.unshift(tab); else sp.tabs.push(tab)
  save(); console.log(JSON.stringify({ address: id, state: 'live' })); process.exit(0)
}
const t = st.terminals[target]
if (!t) { console.error('{"error":{"kind":"not_found"}}'); process.exit(3) }
if (cmd === 'get') {
  const w = where(target)
  console.log(JSON.stringify({ address: target, labels: w.sp ? { 'herdr.space': w.sp.id, 'herdr.tab': w.tb.id } : {}, state: t.finished ? 'finished' : 'live', status: t.app ? { app: t.app, state: t.status } : null }))
} else if (cmd === 'read') console.log('ready')
else console.log('{}')
`
const fakeApp = `#!${process.execPath}
const fs = require('node:fs')
const S = ${JSON.stringify(statePath)}
const st = JSON.parse(fs.readFileSync(S, 'utf8'))
const save = () => fs.writeFileSync(S, JSON.stringify(st))
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ tool: 'herdr-app', argv: args }) + '\\n')
const [cmd, verb, json] = args
if (cmd === '--version') { console.log('herdr-app 0.0-fake'); process.exit(0) }
if (cmd === 'ls') {
  console.log(JSON.stringify({ spaces: st.spaces.map((sp) => ({ ...sp, tabs: sp.tabs.map((tb) => ({ ...tb, terminals: tb.terminals.map((id) => ({ terminal: id, status: st.terminals[id].status, app: st.terminals[id].app })) })) })) }))
  process.exit(0)
}
const a = JSON.parse(json)
const fail = (m) => { console.log(JSON.stringify({ error: m })); process.exit(1) }
const sp = st.spaces.find((x) => x.tabs.some((tb) => tb.id === a.id))
if (verb === 'tab.rename') { if (!sp) fail('no tab'); sp.tabs.find((tb) => tb.id === a.id).name = a.name }
else if (verb === 'tab.close') { if (!sp) fail('no tab'); sp.tabs = sp.tabs.filter((tb) => tb.id !== a.id) }
else if (verb === 'tab.move') { if (!sp) fail('no tab'); const i = sp.tabs.findIndex((tb) => tb.id === a.id); const [tb] = sp.tabs.splice(i, 1); sp.tabs.splice(a.index - 1, 0, tb) }
else fail('unknown command ' + verb)
save(); console.log('{}')
`
writeFileSync(join(bin, 'hc'), fakeHc)
writeFileSync(join(bin, 'herdr-app'), fakeApp)
chmodSync(join(bin, 'hc'), 0o755)
chmodSync(join(bin, 'herdr-app'), 0o755)

/** One space: the lead's tab (t1), a stray tab of the person's, and optionally an existing reviewer tab. */
const setWorld = (extra = {}, reviewer = false) => {
  const w = {
    spaces: [
      {
        id: 'spA',
        name: 'Build',
        tabs: [
          { id: 'tbLead', name: 'lead', terminals: ['t1'] },
          { id: 'tbN', name: 'notes', terminals: ['t4'] },
        ],
      },
    ],
    terminals: { t1: { app: 'claude-code', status: 'working' }, t4: { app: null, status: null } },
    ...extra,
  }
  if (reviewer) {
    w.spaces[0].tabs.splice(1, 0, { id: 'tbRv', name: 'rv-s1', terminals: ['t7'] })
    w.terminals.t7 = { app: 'claude-code', status: 'idle' }
  }
  writeFileSync(statePath, JSON.stringify(w))
  writeFileSync(logPath, '')
}
const state = () => JSON.parse(readFileSync(statePath, 'utf8'))
const order = () => state().spaces[0].tabs.map((t) => t.name)
const calls = () =>
  readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))

const saved = { PATH: process.env.PATH, HOME: process.env.HOME, SHELL: process.env.SHELL }
process.env.PATH = `${bin}:${saved.PATH}`
process.env.HOME = join(tmp, 'home')
mkdirSync(process.env.HOME)
process.env.SHELL = '/bin/sh'
process.env.HC_TERMINAL_ID = 't1'
delete process.env.HERDR_ENV
delete process.env.HERDR_PANE_ID

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
const mod = (rel) => import(pathToFileURL(join(tree, rel)).href + `?t=${tree === repo ? 0 : tree}`)

const root = join(tmp, 'proj')
mkdirSync(root)
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root })

/** What `rig up` does for a build under hc: open slice tabs in plan order, then record and arrange. */
async function up(ids, { reviewer = false } = {}) {
  setWorld({ insert: 'front' }, reviewer)
  const hc = await mod('src/hc.js')
  for (const id of ids) hc.newWindow('s', id, tmp, 'true')
  const { recordCrew } = await mod('src/commands/up.js')
  const out = []
  const log = console.log
  console.log = (...a) => out.push(a.join(' '))
  try {
    recordCrew(root, 'boss', ids)
  } finally {
    console.log = log
  }
  return out
}
let where = 'front'
const VIEW_MOVERS = ['tab.new', 'space.new', 'tab.focus', 'tab.select', 'space.focus', 'space.select', 'focus']

await suite('rig up tab order (lead, reviewer(s), helpers in plan order)', async (s) => {
  await s.check('the fake window really does put new tabs in front, reversed (the bug exists before the fix)', {
    assert: async () => {
      setWorld({ insert: where })
      const hc = await import('../src/hc.js')
      for (const id of ['s1', 's2', 's3']) hc.newWindow('s', id, tmp, 'true')
      return order().join(',') === 's3,s2,s1,lead,notes'
    },
    // A window that appends: the same three opens come out in plan order, so the premise is gone.
    breaks: async () => {
      where = 'back'
      return () => {
        where = 'front'
      }
    },
    timeout: 60_000,
  })

  await s.check('after rig up with an existing reviewer tab: lead, reviewer, s1, s2, s3 in plan order, then the person’s own tab', {
    assert: async () => {
      await up(['s1', 's2', 's3'], { reviewer: true })
      return order().join(',') === 'lead,rv-s1,s1,s2,s3,notes'
    },
    breaks: broken([['src/commands/up.js', 'hc.arrangeTabs({', 'void ({']]),
    timeout: 60_000,
  })

  await s.check('without a reviewer: lead, then helpers in plan order', {
    assert: async () => {
      await up(['s1', 's2', 's3'])
      return order().join(',') === 'lead,s1,s2,s3,notes'
    },
    // Arranged in reverse plan order.
    breaks: broken([['src/commands/up.js', 'slices: sliceIds }', 'slices: [...sliceIds].reverse() }']]),
    timeout: 60_000,
  })

  await s.check('nothing that moves the person’s view is called: only tab.rename and tab.move reach the window', {
    assert: async () => {
      await up(['s1', 's2'], { reviewer: true })
      const verbs = calls()
        .filter((c) => c.tool === 'herdr-app' && c.argv[0] === 'do')
        .map((c) => c.argv[1])
      const hcArgs = calls()
        .filter((c) => c.tool === 'hc')
        .flatMap((c) => c.argv)
      return (
        verbs.includes('tab.move') &&
        verbs.every((v) => v === 'tab.rename' || v === 'tab.move') &&
        !hcArgs.some((a) => VIEW_MOVERS.includes(a))
      )
    },
    breaks: broken([['src/hc.js', "appDo('tab.move',", "appDo('tab.focus',"]]),
    timeout: 60_000,
  })

  await s.check('rig review --launch puts rv-* right after the lead, ahead of the helpers', {
    assert: async () => {
      setWorld({ insert: 'front' })
      const hc = await mod('src/hc.js')
      for (const id of ['s1', 's2']) hc.newWindow('s', id, tmp, 'true')
      const term = hc.newWindow('s', 'rv-s1', tmp, 'true')
      const { recordReviewer } = await mod('src/commands/review.js')
      const log = console.log
      console.log = () => {}
      try {
        recordReviewer(root, { lead: 'boss' }, 'rv-s1', term)
      } finally {
        console.log = log
      }
      return order().join(',') === 'lead,rv-s1,s2,s1,notes'
    },
    breaks: broken([['src/commands/review.js', 'hc.arrangeTabs({', 'void ({']]),
    timeout: 60_000,
  })
})

process.env.PATH = saved.PATH
rmSync(tmp, { recursive: true, force: true })
