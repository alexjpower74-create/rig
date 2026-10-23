// Rig 5.5, r55q: "0 new" is computed from two real runs, never typed; the repo's own CI is run as
// it is; a flake proof names its failing seeds; a second machine's tally sits beside this one's.
//
// Runs drive the real `rig qa`. Where a second machine is involved, a small driver script swaps a
// fake machine and a fake lease into src/qa/host.js before loading the command, so the same
// module instance runs with them and no test reaches ssh, a real host or a shared lease store.

import { suite } from '../harness/check.js'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rig-qa-base-')))
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')

function repoAt(name, files = {}, config = {}) {
  const repo = join(tmp, name)
  mkdirSync(repo, { recursive: true })
  git(['init', '-q', '-b', 'main'], repo)
  git(['config', 'user.email', 'test@example.invalid'], repo)
  git(['config', 'user.name', 'Rig Test'], repo)
  writeFileSync(join(repo, '.gitignore'), '.rig/\n.worktrees/\n')
  commitFiles(repo, files, 'base')
  setConfig(repo, config)
  return repo
}
function commitFiles(repo, files, msg) {
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, f)), { recursive: true })
    writeFileSync(join(repo, f), body)
  }
  git(['add', '-A'], repo)
  git(['commit', '-qm', msg], repo)
  return git(['rev-parse', 'HEAD'], repo)
}
const setConfig = (repo, config) => {
  mkdirSync(join(repo, '.rig'), { recursive: true })
  writeFileSync(join(repo, '.rig', 'config.json'), JSON.stringify({ worktreeDir: '.worktrees', qaPort: 5399, ...config }))
}

const DRIVER = join(tmp, 'drive.mjs')
writeFileSync(
  DRIVER,
  `// rig qa with a fake second machine and lease (FAKE_HOST: JSON), else exactly as the CLI runs it.
import { appendFileSync } from 'node:fs'
const fake = process.env.FAKE_HOST ? JSON.parse(process.env.FAKE_HOST) : null
if (fake) {
  const { remote } = await import(${JSON.stringify(pathToFileURL(join(ROOT, 'src', 'qa', 'host.js')).href)})
  const log = (o) => appendFileSync(fake.calls, JSON.stringify(o) + '\\n')
  remote.acquire = (root, resource, by) => (log({ acquire: resource, by }), fake.holder ? { ok: false, holder: fake.holder, why: 'held' } : { ok: true, holder: null, why: null })
  remote.release = (root, resource, by) => (log({ release: resource, by }), { ok: true, why: null })
  remote.runOnHost = async ({ host, sha, cmd, env, onOutput }) => {
    log({ run: cmd, host, sha, seed: env.RIG_SEED ?? null })
    const seedFails = env.RIG_SEED && fake.failSeeds?.includes(env.RIG_SEED)
    const out = seedFails ? 'not ok 1 - flaky on the second OS\\n' : fake.log
    onOutput(out)
    return { host, exit: seedFails ? 1 : fake.exit, ms: 1234, dir: '/fake/dir', db: 'fake_db', log: out }
  }
}
const qa = (await import(${JSON.stringify(pathToFileURL(join(ROOT, 'src', 'commands', 'qa.js')).href)})).default
await qa(process.argv.slice(2))
`,
)

/** `rig qa` in the repo; with `fake`, through the driver's fake machine. */
function rigQa(repo, args, { fake = null, env = {} } = {}) {
  const e = { ...process.env, ...env, ...(fake ? { FAKE_HOST: JSON.stringify(fake) } : {}) }
  delete e.DISPLAY
  delete e.WAYLAND_DISPLAY
  const t = Date.now()
  const r = spawnSync(process.execPath, [DRIVER, ...args], { cwd: repo, encoding: 'utf8', env: e, timeout: 120_000 })
  return { status: r.status, out: plain(r.stdout + r.stderr), ms: Date.now() - t }
}
const history = (repo) =>
  existsSync(join(repo, '.rig', 'qa-history.jsonl'))
    ? readFileSync(join(repo, '.rig', 'qa-history.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : []
const last = (repo, kind, host = 'local') =>
  history(repo)
    .filter((e) => e.kind === kind && (e.host ?? 'local') === host)
    .pop()

// A node:test file: one test that passes, and the tests named in `failing` that fail.
const specFile = (failing) => `const { test } = require('node:test')
test('adds two numbers', () => {})
${failing.map((n) => `test(${JSON.stringify(n)}, () => { throw new Error('broken: ' + ${JSON.stringify(n)}) })`).join('\n')}
`

await suite('rig 5.5, r55q: baselines, local CI, repeats, the second machine', async (s) => {
  // ---------------------------------------------------------------------------------------------
  // "0 new" from two real runs. main carries one known failure. A slice branch that leaves it as it
  // is has 0 new; a branch that adds a failing test has exactly that one new.
  const repo = repoAt('baseline', { 'test/a.test.js': specFile(['the known broken one']) })
  git(['checkout', '-q', '-b', 'rig/same'], repo)
  const same = commitFiles(repo, { 'README.md': 'docs only\n' }, 'docs only')
  git(['checkout', '-q', 'main'], repo)
  git(['checkout', '-q', '-b', 'rig/adds'], repo)
  const adds = commitFiles(repo, { 'test/a.test.js': specFile(['the known broken one', 'the new broken one']) }, 'adds a failure')
  git(['checkout', '-q', 'main'], repo)
  commitFiles(repo, { 'later.txt': 'main moved on\n' }, 'main moves on') // the merge base is not main's tip
  const RUN = ['--run', 'node --test test/']

  let graded = same
  await s.check('"0 new" is computed from a run on the head and a run on the merge base', {
    assert: async () => {
      const r = rigQa(repo, [graded, '--baseline', ...RUN])
      const b = last(repo, 'baseline')?.baseline
      if (!b) throw new Error(`no baseline recorded\n${r.out.slice(-800)}`)
      const base = git(['merge-base', graded, 'main'], repo)
      const twoRuns = b.baseSha === base && b.baseExit === 1 && b.baseFailed === 1 && /── baseline: merge-base with main/.test(r.out)
      if (!twoRuns) throw new Error(`baseline ${JSON.stringify(b)}\n${r.out.slice(-800)}`)
      return (
        b.complete &&
        b.newFailures.length === 0 &&
        b.known.length === 1 &&
        b.known[0].where === 'here' &&
        /0 new failures, 1 known/.test(r.out)
      )
    },
    // The control: the branch that adds a failure must not come out as "0 new".
    breaks: () => {
      graded = adds
      return () => {
        graded = same
      }
    },
    timeout: 90_000,
  })

  let against = []
  await s.check('a failure the base does not have is shown as new, and the known one as known', {
    assert: async () => {
      const r = rigQa(repo, [adds, '--baseline', ...against, ...RUN])
      const b = last(repo, 'baseline').baseline
      return (
        JSON.stringify(b.newFailures) === '["the new broken one"]' &&
        b.known.map((k) => k.name).join() === 'the known broken one' &&
        /1 NEW \(pass on the base, fail here\):\n\s+the new broken one/.test(r.out)
      )
    },
    // Compared against itself (an explicit --baseline <the same sha>) nothing can be new.
    breaks: () => {
      against = [adds]
      return () => {
        against = []
      }
    },
    timeout: 90_000,
  })

  const crashRepo = repoAt('crash', { 'crash.js': 'process.exit(Number(process.argv[2]))\n' })
  let crashCode = '3'
  await s.check('a red run with no failure rig qa can name never claims "0 new"', {
    assert: async () => {
      git(['checkout', '-q', '-b', 'rig/x'], crashRepo)
      const head = commitFiles(crashRepo, { 'x.txt': `${Date.now()}\n` }, 'x')
      git(['checkout', '-q', 'main'], crashRepo)
      git(['branch', '-D', '-q', 'rig/x'], crashRepo)
      const r = rigQa(crashRepo, [head, '--baseline', '--run', `node crash.js ${crashCode}`])
      const b = last(crashRepo, 'baseline').baseline
      return b.complete === false && /NOT COMPUTED/.test(r.out) && !/0 new failures/.test(r.out)
    },
    // A green run has nothing to name and is complete: the guard is about red runs only.
    breaks: () => {
      crashCode = '0'
      return () => {
        crashCode = '3'
      }
    },
    timeout: 60_000,
  })

  // ---------------------------------------------------------------------------------------------
  // The repo's own local CI.
  const CI = `const { readFileSync, writeFileSync } = require('node:fs')
console.log('ci: lint ok, unit ok, build ok')
writeFileSync(process.env.RIG_CI_STATUS, process.env.CI_POSTS ? readFileSync(process.env.CI_POSTS, 'utf8') : 'success 3 of 3 steps')
`
  const ciRepo = repoAt('ci', { 'ci.js': CI, 'package.json': JSON.stringify({ name: 'fixture', scripts: { ci: 'node ci.js' } }) })
  await s.check('scripts.ci is found and run as kind "ci", with the status it posted', {
    assert: async () => {
      rmSync(join(ciRepo, '.rig', 'qa-history.jsonl'), { force: true })
      const r = rigQa(ciRepo, ['HEAD'])
      const rec = last(ciRepo, 'ci')
      if (!rec) throw new Error(`no ci record\n${r.out.slice(-600)}`)
      return (
        r.status === 0 &&
        rec.cmd === 'npm run ci' &&
        rec.ciFrom === 'scripts.ci in package.json' &&
        rec.ciStatus?.state === 'success' &&
        rec.ciStatus.text === '3 of 3 steps' &&
        /CI status success/.test(r.out)
      )
    },
    // ciCommand: null in the config means "this repo has none": nothing is run, nothing recorded.
    breaks: () => {
      setConfig(ciRepo, { ciCommand: null })
      return () => setConfig(ciRepo, {})
    },
    timeout: 60_000,
  })

  let posted = 'failure lint found 2'
  await s.check('a CI that exits 0 but posts "failure" is not green (r55g review 2)', {
    assert: async () => {
      writeFileSync(join(ciRepo, '.rig', 'posted'), posted)
      const r = rigQa(ciRepo, ['HEAD', '--ci', '--run', 'true'], { env: { CI_POSTS: join(ciRepo, '.rig', 'posted') } })
      return r.status === 1 && /NOT green: the CI exited 0 but posted failure/.test(r.out) && last(ciRepo, 'ci').exit === 0
    },
    breaks: () => {
      posted = 'success'
      return () => {
        posted = 'failure lint found 2'
      }
    },
    timeout: 60_000,
  })

  let ciFlag = ['--ci']
  await s.check('--run alone does not run the CI; --ci runs it beside the test command', {
    assert: async () => {
      rmSync(join(ciRepo, '.rig', 'qa-history.jsonl'), { force: true })
      rigQa(ciRepo, ['HEAD', '--run', 'true', ...ciFlag])
      return last(ciRepo, 'ci')?.exit === 0 && last(ciRepo, 'test')?.cmd === 'true'
    },
    breaks: () => {
      ciFlag = []
      return () => {
        ciFlag = ['--ci']
      }
    },
    timeout: 60_000,
  })

  // ---------------------------------------------------------------------------------------------
  // Repeats: odd seeds fail. Listed seeds always run, and the failing ones are named.
  const FLAKY = `const { test } = require('node:test')
test('settles in time', () => { if (Number(process.env.RIG_SEED) % 2) throw new Error('lost the race at seed ' + process.env.RIG_SEED) })
`
  const flakyRepo = repoAt('flaky', { 'test/flaky.test.js': FLAKY })
  let seeds = '7,9'
  await s.check('--repeat names the failing seeds, and every listed seed runs', {
    assert: async () => {
      const r = rigQa(flakyRepo, ['HEAD', '--repeat', '2', '--seeds', seeds, '--run', 'node --test test/flaky.test.js'])
      const rec = last(flakyRepo, 'repeat')
      return (
        r.status === 1 &&
        JSON.stringify(rec.repeat.failedSeeds) === '["7","9"]' &&
        rec.repeat.how === 'node --test-random-seed' &&
        /--test-random-seed=7/.test(r.out) &&
        /2 of 2 FAILED, seeds 7, 9/.test(r.out)
      )
    },
    breaks: () => {
      seeds = '8,10'
      return () => {
        seeds = '7,9'
      }
    },
    timeout: 60_000,
  })

  let greenSeeds = '2,4,6'
  await s.check('N green is reported as N green, and a repeat never stands in for a suite pass', {
    assert: async () => {
      rmSync(join(flakyRepo, '.rig', 'qa-history.jsonl'), { force: true })
      const r = rigQa(flakyRepo, ['HEAD', '--repeat', '3', '--seeds', greenSeeds, '--run', 'node --test test/flaky.test.js'])
      const { lastQaOn } = await import('../src/qalog.js')
      const sha = git(['rev-parse', 'HEAD'], flakyRepo)
      return (
        r.status === 0 &&
        /3 of 3 green/.test(r.out) &&
        lastQaOn(flakyRepo, sha, 'test') === null &&
        lastQaOn(flakyRepo, sha, 'repeat')?.exit === 0
      )
    },
    // One odd seed in the list: not N green.
    breaks: () => {
      greenSeeds = '2,4,5'
      return () => {
        greenSeeds = '2,4,6'
      }
    },
    timeout: 60_000,
  })

  // ---------------------------------------------------------------------------------------------
  // The second machine, faked.
  const hostRepo = repoAt('host', { 'test/a.test.js': specFile(['the known broken one']) })
  const calls = join(tmp, 'host-calls.jsonl')
  const fakeBox = (extra = {}) => ({
    calls,
    exit: 1,
    log: 'TAP version 13\nnot ok 1 - the known broken one\nnot ok 2 - only on the second OS\n# pass 1\n# fail 2\n',
    ...extra,
  })
  let box = fakeBox()
  await s.check('--host runs the same sha there, under the lease, and prints both tallies side by side', {
    assert: async () => {
      rmSync(calls, { force: true })
      const r = rigQa(hostRepo, ['HEAD', '--host', 'build-box', '--by', 'r55q', '--run', 'node --test test/'], { fake: box })
      const log = readFileSync(calls, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
      const sha = git(['rev-parse', 'HEAD'], hostRepo)
      const rec = last(hostRepo, 'test', 'build-box')
      if (!rec) throw new Error(`no host record\n${r.out.slice(-800)}`)
      return (
        log[0].acquire === 'host:build-box' &&
        // held under this run's own token, and given back under the same one (Zyro, 949e12b)
        /^r55q\.[0-9a-f]{8}$/.test(log[0].by) &&
        log.some((c) => c.run === 'node --test test/' && c.sha === sha) &&
        log.some((c) => c.release === 'host:build-box' && c.by === log[0].by) &&
        /\n\s+exit\s+1\s+1\n/.test(r.out) &&
        /fails only on build-box: only on the second OS/.test(r.out) &&
        rec.failed === 2 &&
        // the host's full output is kept, like the local run's (lead, first real --host run)
        typeof rec.log === 'string' &&
        existsSync(join(hostRepo, rec.log)) &&
        readFileSync(join(hostRepo, rec.log), 'utf8').includes('not ok 2 - only on the second OS')
      )
    },
    // Someone else's lease refuses the run, by name, before anything runs.
    breaks: () => {
      box = fakeBox({ holder: { by: 'r55x', at: '2026-01-01T00:00:00Z', until: '2026-01-01T02:00:00Z' } })
      return () => {
        box = fakeBox()
      }
    },
    timeout: 60_000,
  })

  // The first real --host run (main 515b118): a passing suite printed a fixture suite's own
  // summary ("1 void") and the side-by-side said "failed 2" beside exit 0.
  let nestedExit = 0
  await s.check('a count that contradicts the exit is shown as "?" with the reason, not as a number', {
    assert: async () => {
      const cmd = `echo 'accept a shift: 0 passed, 1 failed, 0 void, 0 unproven'; echo 'suite: 5 passed, 0 failed, 0 void, 0 unproven'; exit ${nestedExit}`
      const r = rigQa(hostRepo, ['HEAD', '--host', 'build-box', '--by', 'r55q', '--run', cmd], {
        fake: fakeBox({ exit: 0, log: 'ok 1 - fine\n# pass 1\n# fail 0\n' }),
      })
      const rec = last(hostRepo, 'test')
      return (
        /\n\s+failed\s+\?\s+0\n/.test(r.out) &&
        /failed here: not counted: the output counts 1 failed but the run exited 0/.test(r.out) &&
        rec.failed === null
      )
    },
    // From a red run the same output is a consistent count, and the number is printed.
    breaks: () => {
      nestedExit = 1
      return () => {
        nestedExit = 0
      }
    },
    timeout: 60_000,
  })

  // main 949e12b: a host run that exited 1 on a harness VOID printed "failed 0" beside "exit 1".
  let voidLog =
    '  VOID  comps on a phone: a rating tapped after a swipe still counts 7269ms\nrig taste: 38 passed, 0 failed, 1 void, 0 unproven\n'
  await s.check('a red run with no FAIL line prints "failed ?" and names the VOID, never "failed 0"', {
    assert: async () => {
      const r = rigQa(hostRepo, ['HEAD', '--host', 'build-box', '--by', 'r55q', '--run', 'echo "# pass 1"; echo "# fail 0"'], {
        fake: fakeBox({ exit: 1, log: voidLog }),
      })
      const rec = last(hostRepo, 'test', 'build-box')
      return (
        /\n\s+failed\s+0\s+\?\n/.test(r.out) &&
        /\n\s+void\s+0\s+1\n/.test(r.out) &&
        /failed on build-box: not counted: exit 1 but no FAIL line; 1 void: comps on a phone/.test(r.out) &&
        rec.failed === null &&
        /no FAIL line/.test(rec.tallyConflict)
      )
    },
    // With a FAIL line the exit is explained, and the count is a number.
    breaks: () => {
      voidLog =
        '  FAIL  comps on a phone: a rating tapped after a swipe still counts 7269ms\nrig taste: 38 passed, 1 failed, 0 void, 0 unproven\n'
      return () => {
        voidLog =
          '  VOID  comps on a phone: a rating tapped after a swipe still counts 7269ms\nrig taste: 38 passed, 0 failed, 1 void, 0 unproven\n'
      }
    },
    timeout: 60_000,
  })

  // main after cf316d4: an UNPRV line in a green run printed "1 failing".
  let tag = 'UNPRV'
  await s.check('an UNPRV line in a green run is listed as unproven, never as failing', {
    assert: async () => {
      const line = tag === 'UNPRV' ? '  UNPRV the folded' : '  FAIL  the folded'
      const cmd = `echo '${line} commits keep the identity from git config 3ms'; echo '  PASS  folds 2ms'; exit 0`
      const r = rigQa(hostRepo, ['HEAD', '--run', cmd])
      const rec = last(hostRepo, 'test')
      return (
        /rig qa: 1 unproven: the folded commits keep the identity from git config/.test(r.out) &&
        !/failing/.test(r.out) &&
        rec.failures.length === 0 &&
        JSON.stringify(rec.unproven) === '["the folded commits keep the identity from git config"]'
      )
    },
    // The control: the same check printed as FAIL is a failing test, and is said to be.
    breaks: () => {
      tag = 'FAIL'
      return () => {
        tag = 'UNPRV'
      }
    },
    timeout: 60_000,
  })

  let holder = { by: 'r55x', at: '2026-01-01T00:00:00Z', until: '2026-01-01T02:00:00Z' }
  await s.check('a lease someone else holds is refused with the holder’s name, and nothing runs', {
    assert: async () => {
      rmSync(calls, { force: true })
      const before = history(hostRepo).length
      const r = rigQa(hostRepo, ['HEAD', '--host', 'build-box', '--run', 'node --test test/'], { fake: fakeBox({ holder }) })
      return r.status === 75 && /refused — build-box is leased by r55x/.test(r.out) && history(hostRepo).length === before
    },
    breaks: () => {
      holder = null
      return () => {
        holder = { by: 'r55x', at: '2026-01-01T00:00:00Z', until: '2026-01-01T02:00:00Z' }
      }
    },
    timeout: 60_000,
  })

  let failSeeds = ['5']
  await s.check('--repeat with a host runs every seed there too and names a seed that fails only there', {
    assert: async () => {
      const r = rigQa(hostRepo, ['HEAD', '--host', 'build-box', '--repeat', '2', '--seeds', '4,5', '--run', 'node --test test/a.test.js'], {
        fake: fakeBox({ exit: 0, log: 'ok 1 - fine\n', failSeeds }),
      })
      const rec = last(hostRepo, 'repeat', 'build-box')
      return /build-box: 1 of 2 FAILED, seeds 5/.test(r.out) && JSON.stringify(rec?.repeat.failedSeeds) === '["5"]'
    },
    breaks: () => {
      failSeeds = []
      return () => {
        failSeeds = ['5']
      }
    },
    timeout: 60_000,
  })

  let hostBase = fakeBox()
  await s.check('with a host, known failures say where they fail now: here, there or both', {
    assert: async () => {
      git(['checkout', '-q', '-b', 'rig/h'], hostRepo)
      const head = commitFiles(hostRepo, { 'test/a.test.js': specFile(['the known broken one', 'only here']) }, 'h')
      git(['checkout', '-q', 'main'], hostRepo)
      git(['branch', '-D', '-q', 'rig/h'], hostRepo)
      const r = rigQa(hostRepo, [head, '--host', 'build-box', '--baseline', '--run', 'node --test test/'], { fake: hostBase })
      const b = last(hostRepo, 'baseline').baseline
      const where = Object.fromEntries(b.known.map((k) => [k.name, k.where]))
      if (where['the known broken one'] !== 'both') throw new Error(`known ${JSON.stringify(b.known)}\n${r.out.slice(-600)}`)
      return JSON.stringify(b.newFailures.sort()) === '["only here","only on the second OS"]'
    },
    // When the box does not fail the known one, it is "here" only, not "both".
    breaks: () => {
      hostBase = fakeBox({ log: 'not ok 2 - only on the second OS\n' })
      return () => {
        hostBase = fakeBox()
      }
    },
    timeout: 90_000,
  })

  // ---------------------------------------------------------------------------------------------
  // Timings: every stage goes to recordTiming. Checked once r55m's timings.js stores them.
  const { recordTiming, readTimings } = await import('../src/timings.js')
  const probe = repoAt('timing-probe', {})
  recordTiming(probe, { stage: 'probe', ms: 1 })
  if (!readTimings(probe).length)
    console.log('  skipped: src/timings.js does not store timings yet (r55m), so qa:* timings are not checked')
  else {
    const tRepo = repoAt('timings', { 'test/a.test.js': specFile([]) })
    let run = ['--run', 'node --test test/', '--negative', 'true']
    await s.check('qa:test and qa:negative wall times go to .rig/timings.jsonl', {
      assert: async () => {
        rigQa(tRepo, ['HEAD', ...run])
        const stages = readTimings(tRepo).map((t) => t.stage)
        return stages.includes('qa:test') && stages.includes('qa:negative')
      },
      breaks: () => {
        rmSync(join(tRepo, '.rig', 'timings.jsonl'), { force: true })
        run = ['--run', 'node --test test/']
        return () => {
          run = ['--run', 'node --test test/', '--negative', 'true']
        }
      },
      timeout: 60_000,
    })

    // A repeat is a flake proof, not a stage of the round: its times go under their own names, so
    // `rig status --eta` (r55u) can leave them out of the round total.
    let repeatArgs = ['--repeat', '2', '--seeds', '2,4']
    await s.check('repeat runs record qa:repeat and qa:host:repeat, never qa:test or qa:host', {
      assert: async () => {
        rmSync(join(tRepo, '.rig', 'timings.jsonl'), { force: true })
        rigQa(tRepo, ['HEAD', '--host', 'build-box', '--by', 'r55q', ...repeatArgs, '--run', 'node --test test/a.test.js'], {
          fake: fakeBox({ exit: 0, log: 'ok 1 - fine\n' }),
        })
        const stages = [...new Set(readTimings(tRepo).map((t) => t.stage))].sort()
        if (JSON.stringify(stages) !== '["qa:host:repeat","qa:repeat"]') throw new Error(`stages ${JSON.stringify(stages)}`)
        return true
      },
      // The same command as a plain run: its times are round stages, qa:test and qa:host.
      breaks: () => {
        repeatArgs = []
        return () => {
          repeatArgs = ['--repeat', '2', '--seeds', '2,4']
        }
      },
      timeout: 60_000,
    })
  }
})

rmSync(tmp, { recursive: true, force: true })
