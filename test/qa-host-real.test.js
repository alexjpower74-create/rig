// Rig 5.5, r55q × r55m: `rig qa --host` end to end through the real runOnHost and the real lease,
// with r55m's fake ssh (test/fixtures/fake-ssh) standing in for the second machine. No network, no
// real host: each "host" is a directory the fake ssh runs commands in with a clean environment.
//
// Until r55m's slice is merged the fixture is not here, and the file says so and exits green: the
// in-process host checks in qa-baseline.test.js cover rig qa's side meanwhile.

import { suite } from '../harness/check.js'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const KIT = join(here, 'fixtures', 'fake-ssh', 'kit.js')
if (!existsSync(KIT)) {
  console.log('qa-host-real: skipped — test/fixtures/fake-ssh is not here yet (r55m), so rig qa --host is not run end to end')
  process.exit(0)
}
const { world, fixtureRepo, git } = await import(KIT)
const RIG = join(here, '..', 'bin', 'rig.js')
const w = world('rig-qa-host-')
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')

const SPEC = `const { test } = require('node:test')
const { execSync } = require('node:child_process')
test('adds two numbers', () => {})
test('platform quirk', () => { if (process.env.PLATFORM_QUIRK) throw new Error('only on that OS') })
test('copies the link', () => { if (process.env.WITH_CLIPBOARD) execSync('xclip -selection clipboard', { input: 'x', stdio: ['pipe', 'ignore', 'pipe'] }) })
`
const { dir: repo } = fixtureRepo(w.root, 'app', [{ 'test/a.test.js': SPEC, '.gitignore': '.rig/\n.worktrees/\n' }])
mkdirSync(join(repo, '.rig'), { recursive: true })
writeFileSync(join(repo, '.rig', 'config.json'), JSON.stringify({ worktreeDir: '.worktrees', qaPort: 5499 }))
const sha = git(repo, 'rev-parse', 'HEAD')

const rig = (args, env = {}) => {
  const r = spawnSync(process.execPath, [RIG, ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120_000 })
  return { status: r.status, out: plain(r.stdout + r.stderr) }
}
const lastOn = (host, kind = 'test') =>
  readFileSync(join(repo, '.rig', 'qa-history.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => e.kind === kind && (e.host ?? 'local') === host)
    .pop()
const hostEnv = (body) => writeFileSync(join(w.hostDir('box'), '.env'), body)

await suite('rig 5.5, r55q × r55m: rig qa --host through the real runner and lease', async (s) => {
  mkdirSync(w.hostDir('box'), { recursive: true })
  hostEnv('')
  await s.check('the same sha runs on the host, and both tallies sit side by side', {
    assert: async () => {
      const r = rig(['qa', sha, '--host', 'box', '--by', 'r55q', '--run', 'node --test test/'])
      const there = lastOn('box')
      if (!there) throw new Error(`no host record\n${r.out.slice(-1200)}`)
      const same = r.status === 0 && there.exit === 0 && there.sha === sha && lastOn('local').exit === 0
      return same && /\n\s+exit\s+0\s+0\n/.test(r.out) && !/fails only/.test(r.out)
    },
    // A host whose environment trips one spec: its tally differs and the spec is named as host-only.
    breaks: () => {
      hostEnv('PLATFORM_QUIRK=1')
      return () => hostEnv('')
    },
    timeout: 90_000,
  })

  hostEnv('PLATFORM_QUIRK=1')
  const r = rig(['qa', sha, '--host', 'box', '--by', 'r55q', '--run', 'node --test test/'])
  await s.check('a failure only the host shows is named, and the run is not green', {
    assert: async () =>
      r.status !== 0 && /fails only on box: platform quirk/.test(r.out) && lastOn('box').failures.includes('platform quirk'),
    breaks: () => {
      hostEnv('')
      const again = rig(['qa', sha, '--host', 'box', '--by', 'r55q', '--run', 'node --test test/'])
      Object.assign(r, again)
      return () => hostEnv('PLATFORM_QUIRK=1')
    },
    timeout: 90_000,
  })
  hostEnv('')

  let holder = 'r55x'
  await s.check('the host’s lease, held by another session, refuses the run by name', {
    assert: async () => {
      const take = rig(['lease', 'host:box', '--by', holder])
      if (take.status !== 0) throw new Error(`could not take the lease: ${take.out}`)
      const q = rig(['qa', sha, '--host', 'box', '--by', 'r55q', '--run', 'node --test test/'])
      rig(['lease', 'host:box', '--by', holder, '--release'])
      // and a run that went ahead gave the lease back when it finished
      const after = rig(['lease', 'host:box']).out
      return q.status === 75 && /refused — box is leased by r55x/.test(q.out) && /free/.test(after)
    },
    // Held by the same session, the lease is a renewal and the run goes ahead.
    breaks: () => {
      holder = 'r55q'
      return () => {
        holder = 'r55x'
      }
    },
    timeout: 90_000,
  })

  hostEnv('WITH_CLIPBOARD=1')
  await s.check('a host spec that reaches for the clipboard is listed "needs a stub"', {
    assert: async () => {
      rig(['qa', sha, '--host', 'box', '--by', 'r55q', '--run', 'node --test test/'])
      return JSON.stringify(lastOn('box').needsStub) === '["copies the link"]'
    },
    breaks: () => {
      hostEnv('')
      return () => hostEnv('WITH_CLIPBOARD=1')
    },
    timeout: 90_000,
  })
})

w.done()
