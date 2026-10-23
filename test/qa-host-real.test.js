// Rig 5.5, r55q × r55m: `rig qa --host` end to end through the real runOnHost and the real lease,
// with r55m's fake ssh (test/fixtures/fake-ssh) standing in for the second machine. No network, no
// real host: each "host" is a directory the fake ssh runs commands in with a clean environment.
//
// Until r55m's slice is merged the fixture is not here, and the file says so and exits green: the
// in-process host checks in qa-baseline.test.js cover rig qa's side meanwhile.

import { suite } from '../harness/check.js'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const KIT = join(here, 'fixtures', 'fake-ssh', 'kit.js')
if (!existsSync(KIT)) {
  console.log('qa-host-real: skipped — test/fixtures/fake-ssh is not here yet (r55m), so rig qa --host is not run end to end')
  process.exit(0)
}
const { world, fixtureRepo, git, runNode } = await import(KIT)
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
// The CI command is set in the config, so it runs the same here and there; what it posts is fixed per check.
let writeCi = () => {}

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

  let held = true
  await s.check('the host’s lease, held by another session, refuses the run by name', {
    assert: async () => {
      const take = rig(['lease', 'host:box', '--by', 'r55x'])
      if (take.status !== 0) throw new Error(`could not take the lease: ${take.out}`)
      if (!held) rig(['lease', 'host:box', '--by', 'r55x', '--release'])
      const q = rig(['qa', sha, '--host', 'box', '--by', 'r55q', '--run', 'node --test test/'])
      rig(['lease', 'host:box', '--by', 'r55x', '--release'])
      // and a run that went ahead gave the lease back when it finished
      const after = rig(['lease', 'host:box']).out
      return q.status === 75 && /refused — box is leased by r55x/.test(q.out) && /free/.test(after)
    },
    // Given back before the run, the lease is free and the run goes ahead.
    breaks: () => {
      held = false
      return () => {
        held = true
      }
    },
    timeout: 90_000,
  })

  // Zyro's review of 949e12b, P1: with no --by and no RIG_SESSION every run on a branch held the
  // lease as the branch name, so a second run at once was taken as a renewal of the first and ran in
  // its checkout, on its test DB, while the first suite was still going.
  let together = true
  await s.check('a second rig qa on the same branch while the first runs on the host is refused, never a renewal', {
    assert: async () => {
      const env = { ...process.env }
      delete env.RIG_SESSION
      const marker = join(w.root, 'host-started')
      rmSync(marker, { force: true })
      const first = runNode(
        [RIG, 'qa', sha, '--host', 'box', '--no-ci', '--run', `if [ -n "$RIG_TEST_DB" ]; then touch '${marker}'; sleep 3; fi`],
        { cwd: repo, env },
      )
      if (together) {
        const until = Date.now() + 20_000
        while (!existsSync(marker) && Date.now() < until) await new Promise((r) => setTimeout(r, 20))
        if (!existsSync(marker)) throw new Error('the first run never started on the host')
      } else await first
      const second = await runNode([RIG, 'qa', sha, '--host', 'box', '--no-ci', '--run', 'true'], { cwd: repo, env })
      const one = await first
      const after = rig(['lease', 'host:box']).out
      return (
        one.code === 0 && second.code === 75 && /refused — box is leased by \S+\.[0-9a-f]{8}/.test(plain(second.out)) && /free/.test(after)
      )
    },
    // One after the other, the second run finds the lease given back and goes ahead.
    breaks: () => {
      together = false
      return () => {
        together = true
      }
    },
    timeout: 90_000,
  })

  let quiet = 'sleep 30'
  await s.check('a host run that stops writing is caught by the stall watchdog and named (r55g review 1)', {
    assert: async () => {
      const t = Date.now()
      rig(['qa', sha, '--host', 'box', '--by', 'r55q', '--stall', '0.05', '--run', `echo running tests/slow.spec.js; ${quiet}`])
      const st = lastOn('box').stalled
      return st?.worker === 'box' && st.spec === 'tests/slow.spec.js' && Date.now() - t < 25_000
    },
    breaks: () => {
      quiet = 'for i in 1 2 3 4 5 6; do sleep 1; echo tick; done'
      return () => {
        quiet = 'sleep 30'
      }
    },
    timeout: 90_000,
  })

  let hostPost = 'failure lint found 2'
  writeCi = () =>
    writeFileSync(
      join(repo, '.rig', 'config.json'),
      JSON.stringify({ worktreeDir: '.worktrees', qaPort: 5499, ciCommand: `echo ci ok; printf '%s' '${hostPost}' > "$RIG_CI_STATUS"` }),
    )
  writeCi()
  await s.check('the CI status posted on the host is recorded, and a posted failure is not green (r55g review 3)', {
    assert: async () => {
      const q = rig(['qa', sha, '--host', 'box', '--by', 'r55q', '--ci', '--run', 'true'], {})
      const rec = lastOn('box', 'ci')
      return q.status === 1 && rec?.ciStatus?.state === 'failure' && rec.ciStatus.text === 'lint found 2'
    },
    breaks: () => {
      hostPost = 'success'
      writeCi()
      return () => {
        hostPost = 'failure lint found 2'
        writeCi()
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
