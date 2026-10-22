// staleBaselines(): snapshot baselines know the sha they were recorded from, and the base moving
// past it is reported with how far. Fixture repos in a temp dir; each check made red once with the
// old behaviour (the stub that found nothing, a count that includes the baseline's own commit, or
// no reading of the config) swapped back in.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { suite } from '../harness/check.js'
import { writeBaseline } from '../harness/snapshot.js'
import { formatStale, staleBaselines } from '../src/baselines.js'

const here = dirname(fileURLToPath(import.meta.url))
// The tip r55m's review (docs/review-r55u.md on rig/r55m) was answered from: the code before its fixes.
const REVIEWED = '7d6e987'

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const made = []

function repo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rig-baselines-')))
  made.push(root)
  git(['init', '-q', '-b', 'main', root], root)
  git(['config', 'user.email', 'test@example.invalid'], root)
  git(['config', 'user.name', 'test'], root)
  commit(root, { 'src/app.js': 'v1\n' }, 'app v1')
  return root
}

function commit(root, files, msg) {
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true })
    writeFileSync(join(root, p), body)
  }
  git(['add', '-A'], root)
  git(['commit', '-qm', msg], root)
  return git(['rev-parse', 'HEAD'], root)
}

/** Record a baseline from HEAD and commit it on its own, as a person does. */
function record(root, path) {
  const sha = git(['rev-parse', 'HEAD'], root)
  writeBaseline(join(root, path), { nodes: [{ path: 'body', text: 'x' }] }, { sha })
  git(['add', '-A'], root)
  git(['commit', '-qm', `record ${path}`], root)
  return sha
}

const stub = () => []

await suite('upstream: baselines that know their sha', async (s) => {
  let stale = staleBaselines

  await s.check('the base moved two commits past a baseline: it is reported 2 behind; a fresh one is not reported', {
    assert: () => {
      const root = repo()
      const old = record(root, 'test/__snapshots__/home.snap')
      commit(root, { 'src/app.js': 'v2\n' }, 'app v2')
      commit(root, { 'src/app.js': 'v3\n' }, 'app v3')
      record(root, 'test/__snapshots__/fresh.snap')
      const got = stale(root, { base: 'main' })
      return got.length === 1 && got[0].file === 'test/__snapshots__/home.snap' && got[0].recordedFrom === old && got[0].behind === 2
    },
    breaks: () => {
      stale = stub
      return () => {
        stale = staleBaselines
      }
    },
  })

  await s.check('committing a fresh baseline does not make it stale: commits that only change baselines are not the base moving', {
    assert: () => {
      const root = repo()
      record(root, 'test/__snapshots__/a.snap')
      record(root, 'test/__snapshots__/b.snap')
      return stale(root, { base: 'main' }).length === 0
    },
    // Count every commit since the recorded sha, the baseline's own included.
    breaks: () => {
      stale = (root, opts) =>
        staleBaselines(root, opts).concat(
          ['test/__snapshots__/a.snap', 'test/__snapshots__/b.snap'].map((file) => ({ file, recordedFrom: 'x', behind: 1 })),
        )
      return () => {
        stale = staleBaselines
      }
    },
  })

  let dirs = ['qa/golden']
  await s.check('snapshotDirs from the config (or opts) is where baselines are looked for', {
    assert: () => {
      const root = repo()
      record(root, 'qa/golden/page.txt')
      commit(root, { 'src/app.js': 'v2\n' }, 'app v2')
      const byOpts = stale(root, { base: 'main', dirs })
      mkdirSync(join(root, '.rig'), { recursive: true })
      writeFileSync(join(root, '.rig', 'config.json'), JSON.stringify({ snapshotDirs: dirs }))
      const byConfig = stale(root, { base: 'main' })
      return byOpts.length === 1 && byOpts[0].file === 'qa/golden/page.txt' && byConfig.length === 1
    },
    // The default folders only: qa/golden is never looked at.
    breaks: () => {
      dirs = ['nowhere']
      return () => {
        dirs = ['qa/golden']
      }
    },
  })

  await s.check('a recorded sha this clone lacks is reported unknown, not silently fresh; RECORDED_FROM in a comment counts', {
    assert: () => {
      const root = repo()
      commit(
        root,
        { 'tests/snapshots/list.js.snap': '// RECORDED_FROM: 0123456789abcdef0123456789abcdef01234567\nexports[`x`] = 1\n' },
        'gone',
      )
      commit(root, { 'baselines/shot.meta': `# RECORDED_FROM: ${git(['rev-parse', 'HEAD~1'], root)}\n` }, 'meta')
      commit(root, { 'src/app.js': 'v2\n' }, 'app v2')
      const got = stale(root, { base: 'main' })
      const by = Object.fromEntries(got.map((g) => [g.file, g]))
      return (
        by['tests/snapshots/list.js.snap']?.unknown === true &&
        by['tests/snapshots/list.js.snap'].behind === null &&
        by['baselines/shot.meta']?.behind === 1
      )
    },
    breaks: () => {
      stale = (root, opts) => staleBaselines(root, opts).filter((x) => !x.unknown)
      return () => {
        stale = staleBaselines
      }
    },
  })

  await s.check('no origin: origin/main falls back to the live base of the current branch instead of finding nothing', {
    assert: () => {
      const root = repo()
      record(root, 'test/__snapshots__/home.snap')
      commit(root, { 'src/app.js': 'v2\n' }, 'app v2')
      return stale(root).length === 1
    },
    breaks: () => {
      stale = (root, opts) => staleBaselines(root, { ...opts, base: 'origin/main' }).filter(() => git(['remote'], root) !== '')
      return () => {
        stale = staleBaselines
      }
    },
  })

  let fmt = formatStale
  await s.check('formatStale names each baseline and how far behind, and prints nothing when none is stale', {
    assert: () => {
      const lines = fmt([{ file: 'a.snap', recordedFrom: 'abcdef1234', behind: 3 }], { base: 'main' })
      return (
        fmt([]).length === 0 &&
        /1 snapshot baseline\(s\) recorded before main moved on/.test(lines[0]) &&
        /a\.snap {2}3 commit\(s\) behind/.test(lines[1])
      )
    },
    breaks: () => {
      fmt = () => []
      return () => {
        fmt = formatStale
      }
    },
  })

  await s.check('review 5: when there is no base to compare against it says so (a throw with the reason), never "none stale"', {
    assert: () => {
      const root = repo()
      record(root, 'test/__snapshots__/home.snap')
      commit(root, { 'src/app.js': 'v2\n' }, 'app v2')
      git(['checkout', '-q', '--detach'], root) // no origin, no branch: nothing to resolve a base from
      try {
        const got = stale(root)
        throw new Error(`answered ${JSON.stringify(got)} instead of saying it could not check`)
      } catch (e) {
        return /no base to compare baselines against: origin\/main does not resolve here/.test(e.message)
      }
    },
    // staleBaselines as reviewed: [] for "could not check", the same answer as "all fresh".
    breaks: async () => {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rig-old-')))
      made.push(dir)
      execFileSync('sh', ['-c', `git -C "${join(here, '..')}" archive ${REVIEWED} | tar -x -C "${dir}"`])
      stale = (await import(join(dir, 'src', 'baselines.js'))).staleBaselines
      return () => {
        stale = staleBaselines
      }
    },
  })
})

for (const d of made) rmSync(d, { recursive: true, force: true })
