// Rig 5.5, r55g, item 1: `rig review --vendor` records a second-vendor verdict on a sha, and refuses a
// pass from the builders' own vendor with a message that says why. Driven as `rig review` would be,
// in a child process; the timing goes through recordTiming (stage 'review').

import { suite } from '../harness/check.js'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync, readFileSync, existsSync, utimesSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const RIG = join(here, '..')
const ENV = { ...process.env }
for (const k of [
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'RIG_LEAD',
])
  delete ENV[k]
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', env: ENV }).trim()
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rig-vendor-')))
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')

const { vendorOf, builderVendor, launchProgram, readVerdicts, reviewsPath, sameVendorReason } = await import('../src/vendor.js')

const PLAN = `# Depot draw

## What it's for
A monthly draw.

## What done looks like
A customer enters in under 30 seconds.

## What must not happen
- Nothing is sent to a customer without the owner.

## Agents

### c1 — Entry page
Owns:
- app/**

Task:
Build the entry page.
`

function repoAt(name, config = {}) {
  const repo = join(tmp, name)
  mkdirSync(join(repo, 'app'), { recursive: true })
  git(['init', '-q', '-b', 'main'], repo)
  git(['config', 'user.email', 'test@example.invalid'], repo)
  git(['config', 'user.name', 'Rig Test'], repo)
  writeFileSync(join(repo, '.gitignore'), '.rig/\n')
  writeFileSync(join(repo, 'PLAN.md'), PLAN)
  git(['add', '-A'], repo)
  git(['commit', '-qm', 'plan'], repo)
  git(['checkout', '-qb', 'rig/c1'], repo)
  writeFileSync(join(repo, 'app', 'entry.js'), 'export const entry = 1\n')
  git(['add', '-A'], repo)
  git(['commit', '-qm', 'c1: entry'], repo)
  git(['checkout', '-q', 'main'], repo)
  git(['merge', '-q', '--ff-only', 'rig/c1'], repo)
  mkdirSync(join(repo, '.rig'), { recursive: true })
  writeFileSync(join(repo, '.rig', 'config.json'), JSON.stringify({ branchPrefix: 'rig/', ...config }))
  return repo
}
const setConfig = (repo, config) => writeFileSync(join(repo, '.rig', 'config.json'), JSON.stringify({ branchPrefix: 'rig/', ...config }))

function rig(cmd, repo, args, env = {}) {
  const r = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import('${join(RIG, 'src', 'commands', cmd + '.js')}').then(m => m.default(process.argv.slice(1)))`,
      '--',
      ...args,
    ],
    { cwd: repo, encoding: 'utf8', env: { ...ENV, ...env } },
  )
  return { status: r.status, out: plain(r.stdout + r.stderr) }
}
const timingsOf = (repo) =>
  existsSync(join(repo, '.rig', 'timings.jsonl'))
    ? readFileSync(join(repo, '.rig', 'timings.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(JSON.parse)
    : []

await suite('rig 5.5, rig review --vendor (r55g)', async (s) => {
  let lp = launchProgram
  await s.check('vendor names resolve to the vendor that trained the model', {
    assert: async () =>
      vendorOf('codex') === 'openai' &&
      vendorOf('GPT-5.1') === 'openai' &&
      vendorOf('claude') === 'anthropic' &&
      vendorOf('claude-opus-5-5') === 'anthropic' &&
      vendorOf('gemini-3-pro') === 'google' &&
      vendorOf('SomeNewLab') === 'somenewlab' &&
      lp('env FOO=1 npx -y @openai/codex@1.2 --full-auto') === 'codex' &&
      builderVendor({ launch: 'claude --model opus' }).vendor === 'anthropic' &&
      builderVendor({ launch: 'codex', vendor: 'anthropic' }).vendor === 'anthropic' &&
      builderVendor({}).vendor === 'anthropic',
    breaks: async () => {
      // A launch-command reader that takes the first word: `env` is nobody's vendor.
      lp = (l) => l.split(' ')[0]
      return () => {
        lp = launchProgram
      }
    },
  })

  const repo = repoAt('cli')
  const head = git(['rev-parse', 'HEAD'], repo)
  const short = head.slice(0, 7)

  await s.check('a pass from the builders’ own vendor is refused, says why, and records nothing', {
    assert: async () => {
      const r = rig('review', repo, ['--vendor', 'claude', '--pass', 'ran npm test'])
      return (
        r.status === 1 &&
        /refused: claude is anthropic, the same vendor that built this round \(the launch command \(claude\)\)/.test(r.out) &&
        /Nothing was recorded/.test(r.out) &&
        readVerdicts(repo).length === 0
      )
    },
    // Builders on another vendor (the config says so): the very same pass is a second-vendor pass.
    breaks: async () => {
      setConfig(repo, { vendor: 'openai' })
      return () => {
        setConfig(repo, {})
        rmSync(reviewsPath(repo), { force: true })
      }
    },
  })

  await s.check('a second-vendor pass is recorded on the base’s tip, with the time given', {
    assert: async () => {
      const r = rig('review', repo, ['--vendor', 'codex', '--pass', 'npm test, read the whole diff', '--ms', '540000'])
      const v = readVerdicts(repo).at(-1)
      const t = timingsOf(repo).at(-1)
      const timed = !t || (t.stage === 'review' && t.ms === 540000) // r55m's recordTiming writes it once merged
      return (
        r.status === 0 &&
        new RegExp(`pass from openai on ${short}: npm test, read the whole diff`).test(r.out) &&
        v.sha === head &&
        v.vendor === 'openai' &&
        v.verdict === 'pass' &&
        v.ms === 540000 &&
        v.builder === 'anthropic' &&
        timed
      )
    },
    breaks: async () => {
      setConfig(repo, { vendor: 'codex' })
      return () => setConfig(repo, {})
    },
  })

  let shaArg = ['--sha', 'HEAD~1']
  await s.check('--sha names another commit; --fail records a failing verdict that the newest-wins rule reads', {
    assert: async () => {
      const prev = git(['rev-parse', 'HEAD~1'], repo)
      const r = rig('review', repo, ['--vendor', 'gemini', '--fail', 'app/entry.js:1 has no input check', ...shaArg])
      const v = readVerdicts(repo).at(-1)
      return r.status === 0 && v.sha === prev && v.verdict === 'fail' && v.vendor === 'google' && /fail from google/.test(r.out)
    },
    // Without --sha the verdict lands on the base's tip, not the commit named.
    breaks: async () => {
      shaArg = []
      return () => {
        shaArg = ['--sha', 'HEAD~1']
      }
    },
  })

  const BAD = [
    ['--vendor'],
    ['--vendor', 'codex', '--pass', 'x', '--fail', 'y'],
    ['--vendor', 'codex', '--pass'],
    ['--vendor', 'codex', '--pass', 'x', '--sha', 'nope'],
  ]
  let bad = BAD
  await s.check('usage errors write nothing: no name, both verdicts, an empty verdict, a sha that is not there', {
    assert: async () => {
      const before = readFileSync(reviewsPath(repo), 'utf8')
      const outs = bad.map((args) => rig('review', repo, args))
      return outs.every((o) => o.status === 2) && readFileSync(reviewsPath(repo), 'utf8') === before
    },
    // A well-formed call does write: the assertion can tell the two apart.
    breaks: async () => {
      bad = [['--vendor', 'codex', '--pass', 'x']]
      return () => {
        bad = BAD
      }
    },
  })

  let briefArgs = []
  await s.check('without a verdict it writes the second-vendor brief, pinned to the sha, ending with how to record', {
    assert: async () => {
      const r = rig('review', repo, ['--vendor', 'codex', ...briefArgs])
      const text = readFileSync(join(repo, '.rig', 'REVIEW-final.md'), 'utf8')
      return (
        r.status === 0 &&
        new RegExp(`Second-vendor review — Depot draw @ ${short}`).test(text) &&
        /app\/entry\.js/.test(text) &&
        new RegExp(`rig review --vendor openai --pass "<what you ran and read>" --sha ${short}`).test(text) &&
        /Nothing is sent to a customer without the owner/.test(text)
      )
    },
    // A brief for another sha must not read as this one's.
    breaks: async () => {
      briefArgs = ['--sha', 'HEAD~1']
      return () => {
        briefArgs = []
      }
    },
  })

  let msArg = []
  await s.check('the review time defaults to the age of the brief, and a day-old brief is not used', {
    assert: async () => {
      const brief = join(repo, '.rig', 'REVIEW-final.md')
      const tenMinAgo = (Date.now() - 600_000) / 1000
      utimesSync(brief, tenMinAgo, tenMinAgo)
      rig('review', repo, ['--vendor', 'codex', '--pass', 'second look', ...msArg])
      const fresh = readVerdicts(repo).at(-1).ms
      const dayAgo = (Date.now() - 86_400_000) / 1000
      utimesSync(brief, dayAgo, dayAgo)
      const r = rig('review', repo, ['--vendor', 'codex', '--pass', 'third look'])
      return fresh >= 590_000 && fresh < 700_000 && readVerdicts(repo).at(-1).ms == null && /h old; pass --ms/.test(r.out)
    },
    breaks: async () => {
      msArg = ['--ms', '5']
      return () => {
        msArg = []
      }
    },
  })

  let launch = ''
  await s.check('an unknown builder vendor refuses every pass until the config names one', {
    assert: async () => /builders' vendor is unknown/.test(sameVendorReason('codex', builderVendor({ launch })) || ''),
    breaks: async () => {
      launch = 'claude'
      return () => {
        launch = ''
      }
    },
  })
})

rmSync(tmp, { recursive: true, force: true })
