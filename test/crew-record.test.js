// Rig 5.6.1: the crew record (.rig/crew.json) is written by the code that starts the agents. `rig up`
// records the lead and every slice tab, `rig review --launch` its rv-* tab, `rig down` forgets what it
// closes, `rig crew` lists/adds/removes, and names resolve exactly (never by a label pattern). The
// briefs say the new truth about `rig tell`. Fakes for hc and herdr-app are on PATH; nothing touches
// the real window. Each check's control runs a copy of the tree with the fix taken out.

import './clean-env.js'
import { suite } from '../harness/check.js'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rig-crew-record-')))
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
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
git(['init', '-q', '-b', 'main'])
git(['config', 'user.email', 'test@example.invalid'])
git(['config', 'user.name', 'Rig Test'])
writeFileSync(
  join(root, 'PLAN.md'),
  '# Demo\n\n## The bar\nunder 3 s\n\n## Agents\n\n### s1 — One\nOwns:\n- a.txt\n\nTask:\n1. do it\n\n### s2 — Two\nOwns:\n- b.txt\n\nTask:\n1. do it\n',
)
writeFileSync(join(root, 'a.txt'), 'x\n')
git(['add', '-A'])
git(['commit', '-qm', 'init'])
mkdirSync(join(root, '.rig'), { recursive: true })
writeFileSync(join(root, '.rig', 'config.json'), JSON.stringify({ lead: 'boss', terminal: 'hc' }))

const quiet = async (fn) => {
  const log = console.log
  console.log = () => {}
  try {
    return await fn()
  } finally {
    console.log = log
  }
}
const rig = (args) =>
  spawnSync(process.execPath, [join(tree, 'bin', 'rig.js'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, HC_TERMINAL_ID: 't1' },
  })
const record = () => {
  try {
    return JSON.parse(readFileSync(join(root, '.rig', 'crew.json'), 'utf8')).members
  } catch {
    return {}
  }
}
const resetRecord = () => rmSync(join(root, '.rig', 'crew.json'), { force: true })

await suite('the crew record (.rig/crew.json)', async (s) => {
  await s.check(
    'after rig up and rig review --launch the record holds the lead, every slice and the reviewer, with terminal, tab, space and role',
    {
      assert: async () => {
        resetRecord()
        setWorld({ insert: 'front' })
        const hc = await mod('src/hc.js')
        for (const id of ['s1', 's2']) hc.newWindow('x', id, tmp, 'true')
        const { recordCrew } = await mod('src/commands/up.js')
        await quiet(() => recordCrew(root, 'boss', ['s1', 's2']))
        const rvTerm = hc.newWindow('x', 'rv-s1', tmp, 'true')
        const { recordReviewer } = await mod('src/commands/review.js')
        await quiet(() => recordReviewer(root, { lead: 'boss' }, 'rv-s1', rvTerm))
        const m = record()
        const tabOf = (n) => state().spaces[0].tabs.find((t) => t.name === n)
        const ok = (name, role) => {
          const tb = tabOf(name)
          return (
            m[name]?.role === role &&
            m[name].backend === 'hc' &&
            m[name].space === 'spA' &&
            m[name].tab === tb.id &&
            m[name].terminal === tb.terminals[0]
          )
        }
        return (
          m.boss?.terminal === 't1' &&
          m.boss.role === 'lead' &&
          m.boss.tab === 'tbLead' &&
          ok('s1', 'slice') &&
          ok('s2', 'slice') &&
          ok('rv-s1', 'reviewer')
        )
      },
      // `rig up` that records nobody.
      breaks: broken([['src/commands/up.js', 'recordMember(root, m.name,', 'void (root, m.name,']]),
      timeout: 60_000,
    },
  )

  await s.check('the lead is recorded as this very terminal (HC_TERMINAL_ID)', {
    assert: async () => {
      resetRecord()
      setWorld()
      const { recordCrew } = await mod('src/commands/up.js')
      await quiet(() => recordCrew(root, 'boss', ['s1']))
      return record().boss?.terminal === 't1' && record().boss?.role === 'lead'
    },
    breaks: broken([['src/commands/up.js', 'if (lead && hc.homeTerminal())', 'if (false)']]),
    timeout: 60_000,
  })

  await s.check('rig review --launch records its rv-* tab as a reviewer', {
    assert: async () => {
      resetRecord()
      setWorld()
      const hc = await mod('src/hc.js')
      const t = hc.newWindow('x', 'rv-s1', tmp, 'true')
      const { recordReviewer } = await mod('src/commands/review.js')
      await quiet(() => recordReviewer(root, { lead: 'boss' }, 'rv-s1', t))
      return record()['rv-s1']?.role === 'reviewer' && record()['rv-s1'].terminal === t
    },
    breaks: broken([['src/commands/review.js', 'recordMember(root, label,', 'void (root, label,']]),
    timeout: 60_000,
  })

  await s.check('names resolve exactly: a label that merely matches a pattern resolves to nothing', {
    assert: async () => {
      resetRecord()
      const { recordMember, resolveMember } = await mod('src/crew.js')
      recordMember(root, 'c1', { terminal: 't9', role: 'slice', backend: 'hc' })
      recordMember(root, 'rv-c1', { terminal: 't10', role: 'reviewer', backend: 'hc' })
      return (
        resolveMember(root, 'c1')?.terminal === 't9' &&
        resolveMember(root, 'rv-c1')?.terminal === 't10' &&
        resolveMember(root, 'c') === null &&
        resolveMember(root, 'c1-extra') === null &&
        resolveMember(root, 'C1') === null &&
        resolveMember(root, 'rv-') === null &&
        resolveMember(root, '.*') === null
      )
    },
    // A resolver that matches by prefix.
    breaks: broken([
      [
        'src/crew.js',
        'return readCrew(root).members[name] ?? null',
        'const m = readCrew(root).members; const k = Object.keys(m).find((x) => x.startsWith(name) || name.startsWith(x)); return k ? m[k] : null',
      ],
    ]),
    timeout: 60_000,
  })

  await s.check('rig down forgets the tabs it closes, and only those', {
    assert: async () => {
      resetRecord()
      setWorld({ insert: 'back' })
      const hc = await mod('src/hc.js')
      hc.newWindow('x', 's1', tmp, 'true')
      const { recordCrew } = await mod('src/commands/up.js')
      await quiet(() => recordCrew(root, 'boss', ['s1']))
      const { recordMember } = await mod('src/crew.js')
      recordMember(root, 'elsewhere', { terminal: 't99', role: 'reviewer' })
      const r = rig(['down'])
      const m = record()
      return r.status === 0 && !m.s1 && !!m.boss && !!m.elsewhere && !state().spaces[0].tabs.some((t) => t.name === 's1')
    },
    breaks: broken([['src/commands/down.js', 'for (const name of closed) forgetMember(root, name)', 'void closed']]),
    timeout: 90_000,
  })

  await s.check('rig crew add / list / rm: records by hand, lists with live hc status, forgets', {
    assert: async () => {
      resetRecord()
      setWorld({}, true)
      const add = rig(['crew', 'add', 'rv-x', 't7', '--role', 'reviewer'])
      const list = rig(['crew'])
      const row = list.stdout.split('\n').find((l) => l.startsWith('rv-x'))
      const bad = rig(['crew', 'add', 'q', 't7', '--role', 'boss'])
      const rm = rig(['crew', 'rm', 'rv-x'])
      return (
        add.status === 0 &&
        /reviewer\s+t7\s+hc\s+idle/.test(row ?? '') &&
        bad.status !== 0 &&
        rm.status === 0 &&
        record()['rv-x'] === undefined &&
        rig(['crew']).stdout.includes('no crew recorded')
      )
    },
    // --role ignored: a reviewer added by hand comes out a slice.
    breaks: broken([['src/commands/crew.js', "flag('--role') || (name", '(name']]),
    timeout: 90_000,
  })

  await s.check('the brief tells a peer that rig tell wakes the agent it names, and the tell line is still its last line', {
    assert: async () => {
      const { askTheLead, tellLine } = await mod('src/brief.js')
      const text = askTheLead('boss', 'a1')
      return (
        /`rig tell <name>` reaches the agent it names: it wakes one in a Herdr app tab/.test(text) &&
        /queues/.test(text) &&
        /only file/.test(text) &&
        text.trimEnd().split('\n').pop() === tellLine('boss', 'a1')
      )
    },
    breaks: broken([['src/brief.js', 'it wakes one in a Herdr app tab as a turn', 'it files one in a folder']]),
    timeout: 60_000,
  })
})

process.env.PATH = saved.PATH
rmSync(tmp, { recursive: true, force: true })
