// Rig 5.6.1: `rig tell <name>` reaches the agent it names, as a turn, and never types into one that
// is busy or blocked. Every check runs against a fake `hc` on PATH (test/fixtures/fake-hc), whose
// terminals' states are files the test rewrites; the real hc, the Herdr app and the display are never
// touched. Most controls swap 5.6.0's own `rig tell` back in (it only filed the message), the rest take
// one guard out, so each check has been seen red.

import './clean-env.js'
import { suite } from '../harness/check.js'
import { mkdtempSync, writeFileSync, mkdirSync, realpathSync, readFileSync, readdirSync, cpSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn, spawnSync, execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rig-tell-wake-')))
const home = join(tmp, 'home')
mkdirSync(home)
const fakeHcBin = join(here, 'fixtures', 'fake-hc')
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

// ---------------------------------------------------------------------------------------------------
// Trees: the real one, or a copy with a control applied.

/** 5.6.0's `rig tell`: it filed the message and said "told", nothing else. */
const OLD_TELL = git(['show', 'bf44de6:src/commands/tell.js'], repo)

function brokenTree({ patches = [], files = {} }) {
  const root = mkdtempSync(join(tmp, 'broken-'))
  for (const d of ['bin', 'src', 'templates']) cpSync(join(repo, d), join(root, d), { recursive: true })
  cpSync(join(repo, 'package.json'), join(root, 'package.json'))
  for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), text)
  for (const [file, from, to] of patches) {
    const p = join(root, file)
    const text = readFileSync(p, 'utf8')
    if (!text.includes(from)) throw new Error(`control patch not found in ${file}: ${from}`)
    writeFileSync(p, text.replace(from, to))
  }
  return root
}
let tree = repo
const broken = (spec) => async () => {
  tree = brokenTree(spec)
  return () => {
    tree = repo
  }
}
const oldTell = broken({ files: { 'src/commands/tell.js': OLD_TELL } })
const mod = (rel) => import(pathToFileURL(join(tree, rel)).href + `?t=${tree === repo ? 0 : tree}`)

// ---------------------------------------------------------------------------------------------------
// A crew: a git repo whose .rig/crew.json names the members, an inbox, and fake hc terminals.

let n = 0
async function crew(members) {
  const id = ++n
  const root = join(tmp, `repo-${id}`)
  mkdirSync(root)
  git(['init', '-q', '-b', 'main'], root)
  writeFileSync(join(root, 'README.md'), 'x\n')
  writeFileSync(join(root, '.gitignore'), '.rig/\n')
  git(['add', '.'], root)
  git(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'x'], root)
  const { recordMember } = await import(pathToFileURL(join(repo, 'src', 'crew.js')).href)
  const hcDir = join(tmp, `hc-${id}`)
  mkdirSync(hcDir)
  for (const [name, m] of Object.entries(members)) {
    recordMember(root, name, { terminal: m.terminal, role: m.role ?? 'slice', backend: m.backend ?? 'hc' })
    if (m.state) writeFileSync(join(hcDir, `${m.terminal}.state`), m.state + '\n')
    if (m.afterSend) writeFileSync(join(hcDir, `${m.terminal}.after-send`), m.afterSend + '\n')
  }
  const inbox = join(tmp, `inbox-${id}`)
  const env = {
    ...process.env,
    HOME: home,
    RIG_INBOX_DIR: inbox,
    FAKE_HC_DIR: hcDir,
    PATH: `${fakeHcBin}:${process.env.PATH}`,
    RIG_DELIVER_DEADLINE_MIN: '2',
  }
  for (const k of ['RIG_LEAD', 'RIG_AGENT_ID', 'CODEX_PERSONA', 'XDG_STATE_HOME', 'HERDR_ENV', 'HERDR_PANE_ID', 'HC_TERMINAL_ID'])
    delete env[k]
  const state = (t, s) => writeFileSync(join(hcDir, `${t}.state`), s + '\n')
  const sends = () =>
    existsSync(join(hcDir, 'sends.log'))
      ? readFileSync(join(hcDir, 'sends.log'), 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l))
      : []
  const typed = (t) => sends().filter((s) => s.typed && (!t || s.terminal === t))
  const as = (terminal) => ({ ...env, ...(terminal ? { HC_TERMINAL_ID: terminal } : {}) })
  const tell = (args, e = env) =>
    spawnSync(process.execPath, [join(tree, 'bin', 'rig.js'), 'tell', ...args], { cwd: root, encoding: 'utf8', env: e })
  const tellBg = (args, e = env) => bg(['tell', ...args], root, e)
  const pendingFor = (name) =>
    existsSync(join(inbox, name)) ? readdirSync(join(inbox, name)).filter((f) => f.endsWith('.md') && !f.startsWith('.')) : []
  const readFor = (name) => (existsSync(join(inbox, name, 'read')) ? readdirSync(join(inbox, name, 'read')) : [])
  const deliverLog = (name) =>
    existsSync(join(inbox, name, '.deliver.log')) ? readFileSync(join(inbox, name, '.deliver.log'), 'utf8') : ''
  /** End every fake terminal, so a delivery watcher left running sees "gone" and exits. */
  const end = async () => {
    for (const f of readdirSync(hcDir)) if (f.endsWith('.state')) rmSync(join(hcDir, f), { force: true })
    for (let i = 0; i < 100; i++) {
      const locks = existsSync(inbox) ? readdirSync(inbox).filter((d) => existsSync(join(inbox, d, '.deliver.lock'))) : []
      if (!locks.length) return
      await sleep(50)
    }
  }
  return { root, inbox, hcDir, env, state, sends, typed, as, tell, tellBg, pendingFor, readFor, deliverLog, end }
}

function bg(args, cwd, env, limit = 60_000) {
  const child = spawn(process.execPath, [join(tree, 'bin', 'rig.js'), ...args], { cwd, env })
  let out = ''
  child.stdout.on('data', (d) => (out += d))
  child.stderr.on('data', (d) => (out += d))
  const kill = setTimeout(() => child.kill('SIGKILL'), limit)
  const done = new Promise((resolve) =>
    child.on('close', (code) => {
      clearTimeout(kill)
      resolve({ code, out, at: Date.now() })
    }),
  )
  return { child, done }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms) {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() >= end) return null
    await sleep(25)
  }
}

const team = () => ({
  boss: { terminal: 't1', role: 'lead', state: 'idle', afterSend: 'working' },
  tw1: { terminal: 't2', role: 'slice', state: 'idle', afterSend: 'working' },
  'rv-1': { terminal: 't3', role: 'reviewer', state: 'idle', afterSend: 'working' },
})

/** Seconds past which a measurement stops waiting: the message was never typed (twice the slowest bar). */
const NEVER = 20

await suite('rig 5.6.1: rig tell wakes the agent it names', async (s) => {
  // -------------------------------------------------------------------------------------------------
  // Idle: a turn within 5 s, every direction.
  await s.target('rig tell to an IDLE agent is typed in as a turn (slowest of helper→lead, lead→helper, lead→reviewer, reviewer→lead)', {
    measure: async () => {
      const c = await crew(team())
      let worst = 0
      for (const [from, to, t] of [
        ['t2', 'boss', 't1'],
        ['t1', 'tw1', 't2'],
        ['t1', 'rv-1', 't3'],
        ['t3', 'boss', 't1'],
      ]) {
        c.state(t, 'idle')
        const before = c.typed(t).length
        const at = Date.now()
        const r = c.tellBg([to, `ping ${from}->${to}`], c.as(from))
        const got = await until(() => c.typed(t).length > before && c.typed(t).at(-1), 8000)
        await r.done
        worst = Math.max(worst, got ? (got.at - at) / 1000 : NEVER)
      }
      const unread = ['boss', 'tw1', 'rv-1'].reduce((k, x) => k + c.pendingFor(x).length, 0)
      await c.end()
      return unread ? NEVER : worst
    },
    atMost: 5,
    unit: 's',
    breaks: oldTell,
    timeout: 4 * NEVER * 1000 + 20_000,
  })

  await s.check('the turn says it is a rig tell, who it is from (by the crew record), and the text; the file moves to read/', {
    assert: async () => {
      const c = await crew(team())
      const r = c.tell(['boss', 'tw1: done, abc123, 12 tests'], c.as('t2'))
      const sent = c.typed('t1')
      const ok =
        r.status === 0 &&
        /^delivered: boss \(t1\) has it as a turn now/m.test(r.stdout) &&
        sent.length === 1 &&
        sent[0].if === 'idle' &&
        sent[0].text === '[rig tell from tw1 (answer with: rig tell tw1 "…")] tw1: done, abc123, 12 tests' &&
        c.pendingFor('boss').length === 0 &&
        c.readFor('boss').length === 1
      await c.end()
      return ok
    },
    breaks: oldTell,
    timeout: 30_000,
  })

  await s.check('a lead with no slice branch is named by its terminal in the record, not "peer"', {
    assert: async () => {
      const c = await crew(team())
      c.tell(['tw1', 'go'], c.as('t1'))
      const ok = c.typed('t2')[0]?.text.startsWith('[rig tell from boss ')
      await c.end()
      return ok
    },
    breaks: broken({ patches: [['src/commands/tell.js', '(memberAt(root, process.env.HC_TERMINAL_ID) ?? ', '(null ?? ']] }),
    timeout: 30_000,
  })

  await s.check('an agent whose turn ended (hc says "done") is typed to; hc refuses --if idle there, so no --if', {
    assert: async () => {
      const c = await crew({ boss: { terminal: 't1', role: 'lead', state: 'done' } })
      const r = c.tell(['boss', 'x'])
      const t = c.typed('t1')
      await c.end()
      return r.status === 0 && t.length === 1 && t[0].if === null && /^delivered:/m.test(r.stdout)
    },
    breaks: broken({
      patches: [
        [
          'src/deliver.js',
          "if (s.state === 'idle' || s.state === 'done' || s.state === 'error') return 'send'",
          "if (s.state === 'idle') return 'send'",
        ],
      ],
    }),
    timeout: 30_000,
  })

  // -------------------------------------------------------------------------------------------------
  // Busy: queued, never typed while working, typed within 10 s of going idle.
  await s.target('rig tell to a BUSY agent: typed in after it goes idle (seconds from idle to the turn)', {
    measure: async () => {
      const c = await crew({ tw1: { terminal: 't2', state: 'working', afterSend: 'working' } })
      const r = c.tell(['tw1', 'review is in'])
      const queued = r.status === 0 && /^queued: tw1 \(t2\) is working/m.test(r.stdout)
      if (!queued) {
        await c.end()
        return NEVER
      }
      await sleep(1500)
      const early = c.typed('t2').length
      const idleAt = Date.now()
      c.state('t2', 'idle')
      const got = await until(() => c.typed('t2')[0], NEVER * 1000)
      const left = c.pendingFor('tw1').length
      await c.end()
      return queued && !early && got && !left ? (got.at - idleAt) / 1000 : NEVER
    },
    atMost: 10,
    unit: 's',
    breaks: oldTell,
    timeout: NEVER * 1000 + 20_000,
  })

  await s.check('nothing is ever typed into a working agent (every send the fake saw was to an idle or done one)', {
    assert: async () => {
      const c = await crew({ tw1: { terminal: 't2', state: 'working' } })
      c.tell(['tw1', 'one'])
      await sleep(2500)
      c.state('t2', 'idle')
      await until(() => c.typed('t2').length, 15_000)
      const all = c.sends()
      await c.end()
      return all.length > 0 && all.every((x) => !x.typed || x.state === 'idle' || x.state === 'done')
    },
    // The naive delivery: type whatever the status (what a plain `hc send` does to a working agent).
    breaks: broken({
      patches: [['src/deliver.js', "if (s.state === 'working') return 'busy'", "if (s.state === 'working') return 'send'"]],
    }),
    timeout: 40_000,
  })

  await s.check(
    'an agent that turns busy between the status read and the send is refused by hc (--if idle), and the message is queued, not lost',
    {
      assert: async () => {
        const c = await crew({ tw1: { terminal: 't2', state: 'idle' } })
        writeFileSync(join(c.hcDir, 'send-delay-ms'), '600')
        const r = c.tellBg(['tw1', 'race'])
        await sleep(300)
        c.state('t2', 'working') // after tell read "idle", before the fake types
        const out = await r.done
        rmSync(join(c.hcDir, 'send-delay-ms'))
        const typedWhileWorking = c.typed('t2').length
        const queued = /^queued:/m.test(out.out) && out.code === 0
        c.state('t2', 'idle')
        const later = await until(() => c.typed('t2').length === 1, 15_000)
        await c.end()
        return !typedWhileWorking && queued && later
      },
      breaks: broken({ patches: [['src/deliver.js', "{ ifIdle: status.state === 'idle' }", '{ ifIdle: false }']] }),
      timeout: 40_000,
    },
  )

  await s.check('two concurrent tells to one busy agent start one delivery watcher and deliver both, in order', {
    assert: async () => {
      const c = await crew({ tw1: { terminal: 't2', state: 'working' } })
      const a = c.tellBg(['tw1', 'first'])
      const b = c.tellBg(['tw1', 'second'])
      const [ra, rb] = await Promise.all([a.done, b.done])
      await sleep(1200)
      const watchers = (c.deliverLog('tw1').match(/ watching tw1 /g) || []).length
      c.state('t2', 'idle')
      await until(() => c.pendingFor('tw1').length === 0 && c.typed('t2').length, 15_000)
      await sleep(300)
      const text = c
        .typed('t2')
        .map((x) => x.text)
        .join('\n')
      // The order is the order the files were filed in (their names sort by time and sequence).
      const filed = c.readFor('tw1').sort()
      const firstFiled = readFileSync(join(c.inbox, 'tw1', 'read', filed[0]), 'utf8')
        .trim()
        .split('\n')
        .at(-1)
      const second = firstFiled === 'first' ? 'second' : 'first'
      await c.end()
      return (
        ra.code === 0 &&
        rb.code === 0 &&
        watchers === 1 &&
        text.includes(`] ${firstFiled}`) &&
        text.indexOf(`] ${firstFiled}`) < text.indexOf(`] ${second}`) &&
        filed.length === 2
      )
    },
    breaks: broken({
      patches: [
        ['src/deliver.js', 'const live = watcherFor(inbox, name)', 'const live = null'],
        ['src/deliver.js', "{ flag: 'wx' }", "{ flag: 'w' }"],
      ],
    }),
    timeout: 40_000,
  })

  await s.check('the delivery watcher exits when its queue is empty (no lock, no process left)', {
    assert: async () => {
      const c = await crew({ tw1: { terminal: 't2', state: 'working' } })
      const r = c.tell(['tw1', 'x'])
      const pid = Number(r.stdout.match(/delivery watcher pid (\d+)/)?.[1])
      c.state('t2', 'idle')
      await until(() => c.typed('t2').length, 15_000)
      const gone = await until(() => {
        try {
          process.kill(pid, 0)
          return false
        } catch {
          return true
        }
      }, 5000)
      const ok = pid > 0 && gone && !existsSync(join(c.inbox, 'tw1', '.deliver.lock')) && /stopped: empty/.test(c.deliverLog('tw1'))
      try {
        process.kill(pid) // the control's watcher never stops on its own
      } catch {}
      await c.end()
      return ok
    },
    breaks: broken({
      patches: [
        ['src/deliver.js', "        log(dir, 'stopped: empty')\n        return 'empty'", '        await sleep(every)\n        continue'],
      ],
    }),
    timeout: 40_000,
  })

  // -------------------------------------------------------------------------------------------------
  // Blocked: nothing typed, a distinct exit, the file kept.
  await s.check('rig tell to a BLOCKED agent types nothing, says what it is blocked on, exits 3, and the message stays filed', {
    assert: async () => {
      const c = await crew({ tw1: { terminal: 't2', state: 'blocked permission Bash(rm -rf build)' } })
      const r = c.tell(['tw1', 'are you there?'])
      const ok =
        r.status === 3 &&
        r.stdout.includes('not delivered: tw1 is blocked on permission (Bash(rm -rf build))') &&
        c.typed().length === 0 &&
        c.sends().every((x) => !x.force) &&
        c.pendingFor('tw1').length === 1
      await c.end()
      return ok
    },
    breaks: oldTell,
    timeout: 30_000,
  })

  await s.check('rig tell to a member whose terminal is gone exits 3 and says so; the message stays filed', {
    assert: async () => {
      const c = await crew({ tw1: { terminal: 't9' } }) // no state file: hc has no such terminal
      const r = c.tell(['tw1', 'hello'])
      const fin = await crew({ tw2: { terminal: 't8', state: 'finished' } })
      const f = fin.tell(['tw2', 'hello'])
      const ok =
        r.status === 3 &&
        /not delivered: tw1's terminal t9 is gone/.test(r.stdout) &&
        c.pendingFor('tw1').length === 1 &&
        f.status === 3 &&
        /t8 is gone \(it finished\)/.test(f.stdout)
      await c.end()
      await fin.end()
      return ok
    },
    breaks: oldTell,
    timeout: 30_000,
  })

  // -------------------------------------------------------------------------------------------------
  // No Herdr app tab: filed only, exit 0.
  await s.check('no Herdr app tab (not in the record, a tmux member, outside a repo): "filed only" in one line, exit 0, nothing typed', {
    assert: async () => {
      const c = await crew({ tm: { terminal: 'build:2', backend: 'tmux' }, boss: { terminal: 't1', role: 'lead', state: 'idle' } })
      const stranger = c.tell(['nobody', 'hi'])
      const tmux = c.tell(['tm', 'hi'])
      const outside = spawnSync(process.execPath, [join(tree, 'bin', 'rig.js'), 'tell', 'boss', 'hi'], {
        cwd: home,
        encoding: 'utf8',
        env: c.env,
      })
      const line = (x) => `filed only: ${x} has no Herdr app tab; it reads this with rig inbox ${x}`
      const ok =
        stranger.status === 0 &&
        stranger.stdout.includes(line('nobody')) &&
        tmux.status === 0 &&
        tmux.stdout.includes(line('tm')) &&
        outside.status === 0 &&
        outside.stdout.includes(line('boss')) &&
        c.typed().length === 0 &&
        c.pendingFor('nobody').length === 1 &&
        c.pendingFor('tm').length === 1
      await c.end()
      return ok
    },
    breaks: oldTell,
    timeout: 30_000,
  })

  await s.check('a name resolves only by its exact record entry: a member called "tw1" is not reached by "tw" or "TW1"', {
    assert: async () => {
      const c = await crew({ tw1: { terminal: 't2', state: 'idle' } })
      c.tell(['tw', 'x'])
      c.tell(['TW1', 'x'])
      const none = c.typed().length === 0
      c.tell(['tw1', 'x'])
      const one = c.typed('t2').length === 1
      await c.end()
      return none && one
    },
    breaks: oldTell,
    timeout: 30_000,
  })

  await s.check('a terminal that never reports status (it could be a shell) is never typed to: filed only, exit 0', {
    assert: async () => {
      const c = await crew({ tw1: { terminal: 't2', state: 'silent' } })
      const r = c.tell(['tw1', 'rm -rf /'])
      const ok = r.status === 0 && /^filed only: tw1 \(t2\) does not report whether it is busy/m.test(r.stdout) && c.typed().length === 0
      await c.end()
      return ok
    },
    breaks: broken({ patches: [['src/deliver.js', "  return 'silent'\n}", "  return 'send'\n}"]] }),
    timeout: 30_000,
  })

  // -------------------------------------------------------------------------------------------------
  // A lead with an armed `rig inbox --wait`: each message exactly once, both orders.
  await s.check('a lead whose rig inbox --wait is armed gets the message through its watcher, once, and nothing is typed', {
    assert: async () => {
      const c = await crew(team())
      const w = bg(['inbox', 'boss', '--wait', '--deadline', '1'], c.root, { ...c.env, RIG_INBOX_POLL_MS: '100' })
      await until(() => existsSync(join(c.inbox, 'boss', '.watcher.json')), 15_000)
      const r = c.tell(['boss', 'tw1: done'], c.as('t2'))
      const out = await w.done
      const ok =
        r.status === 0 &&
        /^filed for boss's inbox watcher/m.test(r.stdout) &&
        (out.out.match(/tw1: done/g) || []).length === 1 &&
        c.typed('t1').length === 0
      await c.end()
      return ok
    },
    breaks: broken({ patches: [['src/deliver.js', "  if (watcherState(inbox, name)) return { outcome: 'watcher' }\n", '']] }),
    timeout: 40_000,
  })

  await s.check(
    'the other order: a tell that claimed the message first types it once, and a watcher armed meanwhile does not print it too',
    {
      assert: async () => {
        const c = await crew(team())
        writeFileSync(join(c.hcDir, 'send-delay-ms'), '1500') // the tell holds its claim while hc "types"
        const r = c.tellBg(['boss', 'tw1: done'], c.as('t2'))
        await until(() => existsSync(join(c.inbox, 'boss', 'delivering')), 10_000)
        const w = bg(['inbox', 'boss', '--wait', '--deadline', '1'], c.root, { ...c.env, RIG_INBOX_POLL_MS: '100' })
        await until(() => existsSync(join(c.inbox, 'boss', '.watcher.json')), 5000)
        const told = await r.done
        await sleep(800) // the watcher polls every 100 ms: had it taken the message, it would have exited by now
        const watcherSaw = w.child.exitCode !== null && /tw1: done/.test((await w.done).out)
        w.child.kill()
        const typed = c.typed('t1').length
        rmSync(join(c.hcDir, 'send-delay-ms'))
        await c.end()
        return told.code === 0 && typed === 1 && !watcherSaw && c.readFor('boss').length === 1
      },
      // Claim by copy instead of rename: the watcher can take the same message the tell is typing.
      breaks: broken({
        patches: [
          [
            'src/deliver.js',
            'renameSync(join(dir, name), join(claimDir, name))',
            'writeFileSync(join(claimDir, name), readFileSync(join(dir, name)))',
          ],
        ],
      }),
      timeout: 40_000,
    },
  )

  // -------------------------------------------------------------------------------------------------
  // Crash safety: a claim left by a dead deliverer goes back to the inbox.
  await s.check('a message claimed by a deliverer that died is put back and delivered, not lost', {
    assert: async () => {
      const c = await crew({ tw1: { terminal: 't2', state: 'working' } })
      const { tellMessage } = await mod('src/inbox.js')
      const f = tellMessage(c.inbox, 'tw1', 'x', 'orphan')
      const dead = join(c.inbox, 'tw1', 'delivering', '999999999')
      mkdirSync(dead, { recursive: true })
      cpSync(f, join(dead, f.split('/').at(-1)))
      rmSync(f)
      c.state('t2', 'idle')
      c.tell(['tw1', 'new'])
      const text = c
        .typed('t2')
        .map((x) => x.text)
        .join('\n')
      await c.end()
      return text.includes('] orphan') && text.includes('] new') && text.indexOf('orphan') < text.indexOf('] new')
    },
    breaks: broken({ patches: [['src/deliver.js', '  recoverStale(dir)\n  if (watcherState', '  if (watcherState']] }),
    timeout: 30_000,
  })
})
