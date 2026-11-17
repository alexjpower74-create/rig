// 5.6.1, tw3: `rig qa` grades a test, never a server. On 5.6.0 a bare `rig qa` ran devCommand
// (`npm start`) as the test, and a server that ran until the deadline was counted green. Now a
// server-shaped command is refused outright, devCommand is never preferred to testCommand, and a run
// the deadline or a signal stopped is never recorded or read as green.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, realpathSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const RIG = join(here, '..')
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rig-noserver-')))
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')

const { finishChecks } = await import('../src/commands/finish.js')
const { lastQaOn, readQa, recordQa } = await import('../src/qalog.js')
const { loadPlan } = await import('../src/plan.js')
const { serverShaped, testCommandFor } = await import('../src/config.js')

let n = 0
function repoAt(config = {}) {
  const repo = join(tmp, `r${n++}`)
  mkdirSync(repo, { recursive: true })
  git(['init', '-q', '-b', 'main'], repo)
  git(['config', 'user.email', 'test@example.invalid'], repo)
  git(['config', 'user.name', 'Rig Test'], repo)
  writeFileSync(join(repo, '.gitignore'), '.rig/\n.worktrees/\n')
  writeFileSync(join(repo, 'README.md'), '# x\n')
  // a "server": listens on a port and never exits (a stand-in for `npm start`)
  writeFileSync(
    join(repo, 'server.js'),
    "require('node:http').createServer((q,s)=>s.end('ok')).listen(Number(process.env.PORT)||0,()=>console.log('listening'))\n",
  )
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { start: 'node server.js', test: 'node -e "process.exit(0)"' } }))
  git(['add', '-A'], repo)
  git(['commit', '-qm', 'init'], repo)
  mkdirSync(join(repo, '.rig'), { recursive: true })
  writeFileSync(
    join(repo, '.rig', 'config.json'),
    JSON.stringify({ worktreeDir: '.worktrees', qaPort: 0, branchPrefix: 'rig/', ...config }),
  )
  return repo
}

function rig(repo, args) {
  const r = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import('${join(RIG, 'src', 'commands', 'qa.js')}').then(m => m.default(process.argv.slice(1)))`,
      '--',
      ...args,
    ],
    { cwd: repo, encoding: 'utf8', env: { ...process.env, HC_TERMINAL_ID: '' }, timeout: 60_000 },
  )
  return { status: r.status, out: plain(r.stdout + r.stderr) }
}

test('only devCommand: "npm start" configured: rig qa refuses to grade it, runs nothing and records nothing', () => {
  const repo = repoAt({ devCommand: 'npm start' })
  const r = rig(repo, ['main', '--no-ci'])
  assert.equal(r.status, 2, r.out)
  assert.match(r.out, /refused: devCommand "npm start" starts a server/)
  assert.match(r.out, /testCommand/)
  assert.equal(readQa(repo).length, 0, 'nothing recorded, so nothing can be green')
  assert.equal(existsSync(join(repo, '.worktrees')), false, 'refused before a worktree was touched')
})

test('--run with a server command is refused the same way; a real test command runs', () => {
  const repo = repoAt()
  for (const bad of ['npm start', 'npm run dev', 'cd app && npm run serve', 'node_modules/.bin/vite dev']) {
    const r = rig(repo, ['main', '--no-ci', '--run', bad])
    assert.equal(r.status, 2, `${bad}: ${r.out}`)
    assert.match(r.out, /starts a server/)
  }
  const ok = rig(repo, ['main', '--no-ci', '--run', 'npm test'])
  assert.equal(ok.status, 0, ok.out)
  assert.equal(lastQaOn(repo, git(['rev-parse', 'main'], repo)).exit, 0)
})

test('testCommand is the default test, and devCommand never wins over it', () => {
  const repo = repoAt({ devCommand: 'npm start', testCommand: 'npm test' })
  const r = rig(repo, ['main', '--no-ci'])
  assert.equal(r.status, 0, r.out)
  const rec = lastQaOn(repo, git(['rev-parse', 'main'], repo))
  assert.equal(rec.cmd, 'npm test')
  assert.deepEqual(testCommandFor({ devCommand: 'npm start', testCommand: 'npm test' }, null), { cmd: 'npm test', from: 'testCommand' })
  // a testCommand that is itself a server is refused too
  assert.match(testCommandFor({ testCommand: 'npm run dev' }, null).refused, /starts a server/)
})

test('an older config whose devCommand is a real test command still runs, with a note', () => {
  const repo = repoAt({ devCommand: 'npm test' })
  const r = rig(repo, ['main', '--no-ci'])
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /no testCommand set; grading devCommand "npm test" as the test/)
})

test('serverShaped: servers yes, tests and look-alikes no', () => {
  for (const c of [
    'npm start',
    'npm run dev',
    'yarn start',
    'pnpm run serve',
    'bun run watch',
    'next dev',
    'nodemon app.js',
    'cd x && npm run start',
  ])
    assert.equal(serverShaped(c), true, c)
  for (const c of [
    'npm test',
    'npm run start-tests',
    'node --test',
    'npm run test:e2e',
    'pytest -q',
    'npx playwright test',
    'make start-test',
  ])
    assert.equal(serverShaped(c), false, c)
})

test('a run the deadline stopped is recorded exit 124 with timedOut, never green, and the gate refuses it', () => {
  const repo = repoAt()
  // The server really starts and listens; only the deadline ends it.
  const r = rig(repo, ['main', '--no-ci', '--run', 'node server.js; true', '--timeout', '0.03'])
  // `node server.js` is not server-shaped by name, which is exactly the case the deadline must catch.
  assert.notEqual(r.status, 0, r.out)
  assert.match(r.out, /still running after .*stopping it \(exit 124\)/)
  assert.match(r.out, /NOT green/)
  const sha = git(['rev-parse', 'main'], repo)
  const rec = lastQaOn(repo, sha)
  assert.equal(rec.exit, 124)
  assert.equal(rec.timedOut, true)

  const gate = (extra) => {
    const cfg = { plan: 'PLAN.md', worktreeDir: '.worktrees', branchPrefix: 'rig/' }
    const short = git(['rev-parse', '--short', 'main'], repo)
    return finishChecks(repo, cfg, loadPlan(join(repo, 'PLAN.md')), 'main', extra).checks.find((c) => c.name === `QA green on ${short}`)
  }
  writeFileSync(join(repo, 'PLAN.md'), '# P\n\n## Agents\n\n### c1 — A\nOwns:\n- a/**\n\nTask:\nDo.\n')
  assert.equal(gate().state, 'fail')
  // Known-bad for the guard: a record that says exit 0 but was stopped by the deadline is still not green.
  recordQa(repo, { kind: 'test', sha, exit: 0, timedOut: true, cmd: 'node server.js' })
  assert.equal(gate().state, 'fail')
  assert.match(gate().detail, /stopped/)
  recordQa(repo, { kind: 'test', sha, exit: 0, cmd: 'npm test' })
  assert.equal(gate().state, 'ok')
})

test('a run killed by a signal is not green', () => {
  const repo = repoAt()
  const r = rig(repo, ['main', '--no-ci', '--run', 'kill -9 $$'])
  assert.notEqual(r.status, 0, r.out)
  assert.equal(lastQaOn(repo, git(['rev-parse', 'main'], repo)).exit, 137)
})
