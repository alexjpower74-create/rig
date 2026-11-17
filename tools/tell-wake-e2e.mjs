#!/usr/bin/env node
// The real-hc proof for `rig tell` delivery (Rig 5.6.1). Run by hand, once, from a terminal in the
// Herdr desktop app; it is not part of `npm test`.
//
//   node tools/tell-wake-e2e.mjs [--keep]
//
// It starts four throwaway terminals with the real `hc run --bg --no-parent` and no window labels, so
// no tab opens and nobody's view moves. Each runs a small stand-in agent: it reports its status to hc
// the way agents do (OSC 7501), records every line typed into it with the time it arrived, and after
// a turn arrives works for a moment, then goes idle, as an agent does. The test sets each one's status
// (idle, working, blocked on a permission) through a control file, never by typing into it.
//
// A temp git repo holds the crew record (.rig/crew.json: a lead, a helper, a reviewer and a spare) and
// RIG_INBOX_DIR a temp inbox; `rig tell` is this checkout's bin/rig.js, run as each member (its
// HC_TERMINAL_ID set to that member's terminal). It prints every measured time beside its bar and
// exits 1 if any misses. The terminals are ended and removed afterwards (--keep leaves the temp dir).
//
// Bars: helper→lead (idle), lead→helper, lead→reviewer, reviewer→lead (done, where real agents sit
// between turns) each typed in within 5 s; two tells 250 ms apart to a done agent never type into the
// turn the first started; a busy agent never typed to while working and typed to within 10 s of its
// turn ending; a blocked agent refused (exit 3, nothing typed, the message filed) and typed to once
// the prompt is answered; 0 messages unread at the end. The stand-in ends every turn in "done".

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const keep = process.argv.includes('--keep')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const hc = (...args) => JSON.parse(execFileSync('hc', [...args, '--json'], { encoding: 'utf8' }))

if (!process.env.HC_TERMINAL_ID) {
  console.error('tell-wake-e2e: run this from a terminal in the Herdr app (HC_TERMINAL_ID is not set)')
  process.exit(2)
}

const work = mkdtempSync(join(tmpdir(), 'rig-tell-e2e-'))
const agentJs = join(work, 'agent.cjs')
// The stand-in agent. argv: <name> <dir>. Status from <dir>/<name>.ctl ("idle", "working",
// "blocked permission <msg>"); every line typed in goes to <dir>/<name>.log as {at, line}.
writeFileSync(
  agentJs,
  `const fs = require('node:fs'), path = require('node:path')
const [name, dir] = process.argv.slice(2)
const ctl = path.join(dir, name + '.ctl'), log = path.join(dir, name + '.log')
let last = ''
const report = (s) => {
  const [state, kind, ...msg] = s.replace(/ auto$/, '').split(' ')
  const p = ['state=' + state, kind && 'kind=' + kind, msg.length && 'msg=' + msg.join(' ')].filter(Boolean).join(':')
  process.stdout.write('\\x1b]7501;' + p + '\\x07')
}
setInterval(() => {
  let want = 'idle'
  try { want = fs.readFileSync(ctl, 'utf8').trim() || 'idle' } catch {}
  if (want !== last) { report(want); last = want }
}, 50)
let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.search(/[\\r\\n]/)) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    const was = fs.readFileSync(ctl, 'utf8').trim()
    fs.appendFileSync(log, JSON.stringify({ at: Date.now(), line, state: was }) + '\\n')
    // A turn: work for a second, then end in "done", where real agents sit between turns.
    // "working auto" marks the turn as its own, so the timer never ends a state the test set.
    if (was === 'idle' || was === 'done') {
      fs.writeFileSync(ctl, 'working auto')
      setTimeout(() => { if (fs.readFileSync(ctl, 'utf8').trim() === 'working auto') fs.writeFileSync(ctl, 'done') }, 1000)
    }
  }
})
`,
)

// A crew repo with its record.
const root = join(work, 'repo')
mkdirSync(root)
const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'ignore' })
git('init', '-q', '-b', 'main')
writeFileSync(join(root, '.gitignore'), '.rig/\n')
git('add', '.')
git('-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', 'commit', '-qm', 'e2e')
const { recordMember } = await import(pathToFileURL(join(repo, 'src', 'crew.js')).href)
const inbox = join(work, 'inbox')

const members = { lead: 'lead', helper: 'slice', 'rv-e2e': 'reviewer' }
const term = {}
const terminals = []
const results = []
let failed = false
const row = (name, value, bar, ok, note = '') => {
  results.push({ name, value, bar, ok, note })
  if (!ok) failed = true
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${value}${bar ? ` (bar ${bar})` : ''}${note ? ` · ${note}` : ''}`)
}

try {
  for (const [name, role] of Object.entries(members)) {
    writeFileSync(join(work, `${name}.ctl`), 'idle')
    const r = hc('run', '--bg', '--no-parent', '--', process.execPath, agentJs, name, work)
    term[name] = r.address
    terminals.push(r.address)
    recordMember(root, name, { terminal: r.address, role, backend: 'hc' })
  }
  // Wait for each stand-in to report idle.
  for (const name of Object.keys(members)) for (let i = 0; i < 100 && hc('get', term[name]).status?.state !== 'idle'; i++) await sleep(50)
  console.log(
    `terminals: ${Object.entries(term)
      .map(([n, t]) => `${n}=${t}`)
      .join(' ')}  (no window tabs)\n`,
  )

  const ctl = (name, s) => writeFileSync(join(work, `${name}.ctl`), s)
  const arrivals = (name) =>
    existsSync(join(work, `${name}.log`))
      ? readFileSync(join(work, `${name}.log`), 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l))
      : []
  const tell = (from, to, text) => {
    const env = { ...process.env, RIG_INBOX_DIR: inbox, HC_TERMINAL_ID: term[from] }
    delete env.RIG_AGENT_ID
    return spawnSync(process.execPath, [join(repo, 'bin', 'rig.js'), 'tell', to, text], { cwd: root, encoding: 'utf8', env })
  }
  const arrived = async (name, marker, ms) => {
    const end = Date.now() + ms
    for (;;) {
      const a = arrivals(name).find((x) => x.line.includes(marker))
      if (a) return a
      if (Date.now() > end) return null
      await sleep(25)
    }
  }
  const all = async (state) => {
    for (const n of Object.keys(members)) ctl(n, state)
    for (const n of Object.keys(members)) for (let i = 0; i < 100 && hc('get', term[n]).status?.state !== state; i++) await sleep(50)
  }
  const idleAll = () => all('idle')
  const tellAsync = (from, to, text) =>
    new Promise((resolve) => {
      const env = { ...process.env, RIG_INBOX_DIR: inbox, HC_TERMINAL_ID: term[from] }
      delete env.RIG_AGENT_ID
      const child = spawn(process.execPath, [join(repo, 'bin', 'rig.js'), 'tell', to, text], { cwd: root, env })
      let out = ''
      child.stdout.on('data', (d) => (out += d))
      child.on('close', (code) => resolve({ code, out }))
    })

  // 1. Free agents, every direction: one idle, then "done" (where real agents sit between turns).
  for (const [from, to, state] of [
    ['helper', 'lead', 'idle'],
    ['lead', 'helper', 'done'],
    ['lead', 'rv-e2e', 'done'],
    ['rv-e2e', 'lead', 'done'],
  ]) {
    await all(state)
    const marker = `${state}-${from}-${to}-${Date.now()}`
    const at = Date.now()
    const r = tell(from, to, marker)
    const got = await arrived(to, marker, 15_000)
    const s = got ? (got.at - at) / 1000 : Number.POSITIVE_INFINITY
    row(
      `${state} ${from}→${to}`,
      got ? `${s.toFixed(2)} s` : 'never',
      '≤ 5 s',
      s <= 5 && r.status === 0,
      (r.stdout.split('\n')[0] || r.stderr).trim(),
    )
  }

  // 1b. Two tells 250 ms apart to a "done" agent: the second is never typed into the turn the first
  // started (the stand-in logs its own state at each arrival).
  await all('done')
  const m1 = `concurrent-a-${Date.now()}`
  const m2 = `concurrent-b-${Date.now()}`
  const pa = tellAsync('helper', 'lead', m1)
  await sleep(250)
  const pb = tellAsync('rv-e2e', 'lead', m2)
  const [ca, cb] = await Promise.all([pa, pb])
  const a1 = await arrived('lead', m1, 15_000)
  const a2 = await arrived('lead', m2, 15_000)
  const intoWorking = arrivals('lead').filter((x) => /^working/.test(x.state ?? '')).length
  row(
    'done: two tells 250 ms apart',
    `${a1 && a2 ? 'both arrived' : 'missing'}, ${intoWorking} typed while working`,
    'both, 0 while working',
    !!(a1 && a2) && intoWorking === 0 && ca.code === 0 && cb.code === 0,
    `${ca.out.split('\n')[0].trim()} | ${cb.out.split('\n')[0].trim()}`,
  )

  // 2. Busy: queued, nothing typed while working, typed within 10 s of the turn ending.
  await idleAll()
  ctl('helper', 'working')
  for (let i = 0; i < 100 && hc('get', term.helper).status?.state !== 'working'; i++) await sleep(50)
  const busyMarker = `busy-${Date.now()}`
  const busy = tell('lead', 'helper', busyMarker)
  await sleep(3000)
  const early = await arrived('helper', busyMarker, 0)
  row(
    'busy: nothing typed while working (3 s)',
    early ? 'typed' : 'nothing typed',
    '',
    !early && busy.status === 0,
    busy.stdout.split('\n')[0].trim(),
  )
  const idleAt = Date.now()
  ctl('helper', 'done')
  const late = await arrived('helper', busyMarker, 20_000)
  const bs = late ? (late.at - idleAt) / 1000 : Number.POSITIVE_INFINITY
  row('busy: typed in after its turn ends (done)', late ? `${bs.toFixed(2)} s` : 'never', '≤ 10 s', bs <= 10)

  // 3. Blocked: refused, exit 3, nothing typed, the file kept.
  await idleAll()
  ctl('rv-e2e', 'blocked permission Bash(rm -rf build)')
  for (let i = 0; i < 100 && hc('get', term['rv-e2e']).status?.state !== 'blocked'; i++) await sleep(50)
  const blockedMarker = `blocked-${Date.now()}`
  const blocked = tell('lead', 'rv-e2e', blockedMarker)
  await sleep(2000)
  const typedBlocked = await arrived('rv-e2e', blockedMarker, 0)
  const filed = readdirSync(join(inbox, 'rv-e2e')).filter((f) => f.endsWith('.md')).length
  row(
    'blocked: refused',
    `exit ${blocked.status}, ${typedBlocked ? 'typed' : 'nothing typed'}, ${filed} filed`,
    'exit 3, nothing typed, 1 filed',
    blocked.status === 3 && !typedBlocked && filed === 1,
    blocked.stdout.split('\n')[0].trim(),
  )

  // The refused message is queued behind the delivery watcher: it goes in once the prompt is answered.
  const freeAt = Date.now()
  ctl('rv-e2e', 'done')
  const afterBlock = await arrived('rv-e2e', blockedMarker, 20_000)
  const fs2 = afterBlock ? (afterBlock.at - freeAt) / 1000 : Number.POSITIVE_INFINITY
  row('blocked: typed in once the prompt is answered', afterBlock ? `${fs2.toFixed(2)} s` : 'never', '≤ 10 s', fs2 <= 10)

  // 0 messages left unread.
  const unread = Object.keys(members).flatMap((n) =>
    existsSync(join(inbox, n)) ? readdirSync(join(inbox, n)).filter((f) => f.endsWith('.md') && !f.startsWith('.')) : [],
  )
  row('unread after the run', `${unread.length}`, '0', unread.length === 0)
} finally {
  for (const t of terminals) {
    spawnSync('hc', ['kill', t], { stdio: 'ignore' })
    spawnSync('hc', ['rm', t], { stdio: 'ignore' })
  }
  if (!keep) rmSync(work, { recursive: true, force: true })
  else console.log(`\nkept: ${work}`)
}
console.log(
  `\n${failed ? 'FAIL' : 'PASS'}: ${results.filter((r) => r.ok).length}/${results.length} (${execFileSync('hc', ['--version'], { encoding: 'utf8' }).trim()})`,
)
process.exit(failed ? 1 : 0)
