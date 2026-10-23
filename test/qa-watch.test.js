// Rig 5.5, r55q: a QA run cannot hang and cannot touch the desktop.
//
// Every check drives the real `rig qa` in a child process, on a fixture repo in a temp dir, with a
// fake suite as the command. The negative controls change what that real run is given: the watchdog
// switched off or its window cut below the suite's pace, the per-worker logs not named, --desktop.
// Nothing here reaches the real clipboard or display: the "real" clipboard tool is a fake further
// down PATH that leaves a marker when it is reached, and the run has DISPLAY unset.

import { suite } from '../harness/check.js'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const RIG = join(here, '..', 'bin', 'rig.js')
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rig-qa-watch-')))
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')

function repoAt(name, files = {}, config = {}) {
  const repo = join(tmp, name)
  mkdirSync(repo, { recursive: true })
  git(['init', '-q', '-b', 'main'], repo)
  git(['config', 'user.email', 'test@example.invalid'], repo)
  git(['config', 'user.name', 'Rig Test'], repo)
  writeFileSync(join(repo, '.gitignore'), '.rig/\n.worktrees/\nlogs/\n')
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, f)), { recursive: true })
    writeFileSync(join(repo, f), body)
  }
  git(['add', '-A'], repo)
  git(['commit', '-qm', 'fixture'], repo)
  setConfig(repo, config)
  return repo
}
const setConfig = (repo, config) => {
  mkdirSync(join(repo, '.rig'), { recursive: true })
  writeFileSync(join(repo, '.rig', 'config.json'), JSON.stringify({ worktreeDir: '.worktrees', qaPort: 5299, ...config }))
}

/** `rig qa` as a person runs it, with the time it took. DISPLAY is unset for every run here. */
function rigQa(repo, args, env = {}) {
  const t = Date.now()
  const e = { ...process.env, ...env }
  delete e.DISPLAY
  delete e.WAYLAND_DISPLAY
  const r = spawnSync(process.execPath, [RIG, 'qa', ...args], { cwd: repo, encoding: 'utf8', env: e, timeout: 120_000 })
  return { status: r.status, out: plain(r.stdout + r.stderr), ms: Date.now() - t }
}
const history = (repo) =>
  readFileSync(join(repo, '.rig', 'qa-history.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
const last = (repo, kind = 'test') =>
  history(repo)
    .filter((e) => e.kind === kind)
    .pop()

// A fake suite: says which spec it is on, writes `ticks` lines `every` ms apart (to stdout, or to its
// own worker log), then either finishes or hangs without a word, the way a spec waiting on a server
// that never answers does.
const FAKE = `
const { appendFileSync, mkdirSync } = require('node:fs')
const [ticks, every, hang, where] = process.argv.slice(2)
const say = (s) => where === 'log' ? (mkdirSync('logs', { recursive: true }), appendFileSync('logs/worker-1.log', s + '\\n')) : console.log(s)
say('running tests/checkout.spec.js')
let n = 0
const t = setInterval(() => {
  say('  tick ' + ++n + ' tests/checkout.spec.js')
  if (n < Number(ticks)) return
  clearInterval(t)
  if (hang === 'hang') { say('running tests/payment.spec.js'); setInterval(() => {}, 1e9) }
  else console.log('done')
}, Number(every))
`

const WINDOW_MIN = 0.05 // 3 s: the bar's 5 minutes, scaled down so the suite runs in seconds
const WINDOW_MS = WINDOW_MIN * 60_000

await suite('rig 5.5, r55q: QA that cannot hang or touch the desktop', async (s) => {
  // ---------------------------------------------------------------------------------------------
  // The stall watchdog.
  const stallRepo = repoAt('stall', { 'fake.js': FAKE }, { qaStallMinutes: WINDOW_MIN })
  let stallArgs = []
  let stalled
  await s.check(`a suite that stops writing is stopped and named within the window (${WINDOW_MS / 1000} s)`, {
    assert: async () => {
      stalled = rigQa(stallRepo, ['HEAD', '--run', 'node fake.js 3 200 hang', ...stallArgs])
      const rec = last(stallRepo)
      const named = /STALLED/.test(stalled.out) && /Worker: output; last spec: tests\/payment\.spec\.js/.test(stalled.out)
      // Writing stops ~0.8 s in; the run must be over by then + the window + one poll + the group stop.
      const inTime = stalled.ms < 800 + WINDOW_MS + 1000 + 5000
      if (!(stalled.status === 124 && named && inTime && rec.stalled?.spec === 'tests/payment.spec.js'))
        throw new Error(`exit ${stalled.status} in ${stalled.ms} ms, stalled ${JSON.stringify(rec?.stalled)}\n${stalled.out.slice(-600)}`)
      if (!stallArgs.length)
        console.log(
          `        measured: stopped after ${rec.stalled.quietMs} ms quiet (bar: window ${WINDOW_MS} ms + one poll); whole run ${stalled.ms} ms`,
        )
      return rec.stalled.quietMs >= WINDOW_MS && rec.stalled.quietMs < WINDOW_MS + 2000
    },
    // The guard removed: with the watchdog off, the same hung suite is not stopped and not named.
    // (The hard --timeout of 0.2 min stops it, so the control ends instead of hanging the suite.)
    breaks: () => {
      stallArgs = ['--stall', '0', '--timeout', '0.2']
      return () => {
        stallArgs = []
      }
    },
    timeout: 60_000,
  })

  let paceArgs = []
  await s.check('a suite that keeps writing past the window is never stopped by it', {
    assert: async () => {
      // 10 lines 800 ms apart: 8 s of run, well past the 3 s window, never quiet for 3 s.
      const r = rigQa(stallRepo, ['HEAD', '--run', 'node fake.js 10 800 finish', ...paceArgs])
      if (r.status !== 0 || /STALLED/.test(r.out)) throw new Error(`exit ${r.status}\n${r.out.slice(-400)}`)
      return r.ms > 8000 && last(stallRepo).stalled === null
    },
    // The control: a window shorter than the suite's pace must stop it, or this check proves nothing.
    breaks: () => {
      paceArgs = ['--stall', '0.01']
      return () => {
        paceArgs = []
      }
    },
    timeout: 60_000,
  })

  const workerRepo = repoAt('worker-logs', { 'fake.js': FAKE }, { qaStallMinutes: WINDOW_MIN, qaWorkerLogs: 'logs/worker-*.log' })
  await s.check('progress written only to a worker log (qaWorkerLogs) counts as writing', {
    assert: async () => {
      const r = rigQa(workerRepo, ['HEAD', '--run', 'node fake.js 10 800 finish log'])
      if (r.status !== 0) throw new Error(`exit ${r.status}\n${r.out.slice(-400)}`)
      return last(workerRepo).stalled === null
    },
    // Without the glob the watchdog sees only stdout, which goes quiet after one line: stopped.
    breaks: () => {
      setConfig(workerRepo, { qaStallMinutes: WINDOW_MIN })
      return () => setConfig(workerRepo, { qaStallMinutes: WINDOW_MIN, qaWorkerLogs: 'logs/worker-*.log' })
    },
    timeout: 60_000,
  })

  await s.check('a worker that hangs is named by its log and its last spec', {
    assert: async () => {
      const r = rigQa(workerRepo, ['HEAD', '--run', 'node fake.js 2 200 hang log'])
      const rec = last(workerRepo)
      if (r.status !== 124) throw new Error(`exit ${r.status}\n${r.out.slice(-400)}`)
      return rec.stalled?.worker === 'logs/worker-1.log' && rec.stalled?.spec === 'tests/payment.spec.js'
    },
    // Without the glob there is no worker to name: the output is blamed, and its spec is the first one.
    breaks: () => {
      setConfig(workerRepo, { qaStallMinutes: WINDOW_MIN })
      return () => setConfig(workerRepo, { qaStallMinutes: WINDOW_MIN, qaWorkerLogs: 'logs/worker-*.log' })
    },
    timeout: 60_000,
  })

  const defRepo = repoAt('default-window', {})
  await s.check('the default window is 5 minutes', {
    assert: async () => {
      const r = rigQa(defRepo, ['HEAD', '--run', 'true'])
      return r.status === 0 && /stall watchdog: 5 min\b/.test(r.out)
    },
    breaks: () => {
      setConfig(defRepo, { qaStallMinutes: 7 })
      return () => setConfig(defRepo, {})
    },
    timeout: 30_000,
  })

  // ---------------------------------------------------------------------------------------------
  // Desktop-free runs. A node:test file with one spec that copies to the clipboard and one that
  // does not. The "real" xclip is a fake later on PATH that leaves a marker file when it is reached.
  const realBin = join(tmp, 'real-bin')
  const marker = join(tmp, 'real-xclip-was-reached')
  mkdirSync(realBin, { recursive: true })
  writeFileSync(join(realBin, 'xclip'), `#!/bin/sh\ncat > /dev/null\necho reached > '${marker}'\nexit 0\n`)
  chmodSync(join(realBin, 'xclip'), 0o755)
  const SPEC = `
const { test } = require('node:test')
const assert = require('node:assert')
const { execSync } = require('node:child_process')
test('adds two numbers', () => assert.equal(1 + 1, 2))
test('copies the share link', () => {
  execSync('xclip -selection clipboard', { input: 'https://example.invalid/share', stdio: ['pipe', 'ignore', 'pipe'] })
})
test('reads no display', () => assert.equal(process.env.DISPLAY, undefined))
`
  const deskRepo = repoAt('desktop', { 'test/share.test.js': SPEC })
  const env = { PATH: [realBin, process.env.PATH].join(delimiter) }
  let deskArgs = []
  await s.check('a spec that calls the clipboard tool is listed "needs a stub", and the real tool is never reached', {
    assert: async () => {
      rmSync(marker, { force: true })
      const r = rigQa(deskRepo, ['HEAD', '--run', 'node --test test/*.test.js', ...deskArgs], env)
      const rec = last(deskRepo)
      if (existsSync(marker)) throw new Error('the real xclip was reached')
      if (r.status === 0) throw new Error(`the clipboard spec passed:\n${r.out.slice(-600)}`)
      const ok = rec.needsStub.length === 1 && rec.needsStub[0] === 'copies the share link' && /needs a stub/.test(r.out)
      if (!ok) throw new Error(`needsStub ${JSON.stringify(rec.needsStub)}, failures ${JSON.stringify(rec.failures)}\n${r.out.slice(-800)}`)
      return true
    },
    // --desktop lets the run reach the (fake) real tool: the marker appears and nothing needs a stub.
    breaks: () => {
      deskArgs = ['--desktop']
      return () => {
        deskArgs = []
      }
    },
    timeout: 60_000,
  })

  await s.check('the clipboard spec fails fast: the whole run takes seconds, not a hang', {
    assert: async () => {
      const r = rigQa(deskRepo, ['HEAD', '--run', 'node --test test/*.test.js', '--stall', '0', '--timeout', '0.25', ...deskArgs], env)
      return r.ms < 12_000 && r.status !== 124
    },
    // The hang the shims exist to stop: a clipboard tool that waits for ever (as xclip does holding
    // the selection with no display). Put first on PATH under --desktop it hangs the run to the limit.
    breaks: () => {
      writeFileSync(join(realBin, 'xclip'), `#!/bin/sh\ncat > /dev/null\nexec sleep 600\n`)
      deskArgs = ['--desktop']
      return () => {
        writeFileSync(join(realBin, 'xclip'), `#!/bin/sh\ncat > /dev/null\necho reached > '${marker}'\nexit 0\n`)
        deskArgs = []
      }
    },
    timeout: 120_000,
  })
})

rmSync(tmp, { recursive: true, force: true })
