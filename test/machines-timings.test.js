// Measured time (item 9). `rig status --eta` may print only medians of stage times this machine
// recorded, and "no data" where it has none. Each check is shown red against a mutant of
// src/timings.js with the old or naive behaviour put back.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { suite } from '../harness/check.js'
import { mutant } from './fixtures/fake-ssh/kit.js'
import * as real from '../src/timings.js'

const tmp = mkdtempSync(join(tmpdir(), 'rig-timings-'))
const repo = join(tmp, 'repo')
execFileSync('git', ['init', '-q', repo])

// Fixture: three ok qa:test runs (median 200, mean would be 250), four reviews (median 25), one
// failed qa:test run that must not count, one fold run on another host, and a torn last line.
const lines = [
  { stage: 'qa:test', ms: 100, ok: true, host: 'local' },
  { stage: 'qa:test', ms: 450, ok: true, host: 'local' },
  { stage: 'review', ms: 10, ok: true, host: 'local' },
  { stage: 'qa:test', ms: 3, ok: false, host: 'local' },
  { stage: 'review', ms: 40, ok: true, host: 'local' },
  { stage: 'qa:test', ms: 200, ok: true, host: 'local' },
  { stage: 'review', ms: 20, ok: true, host: 'local' },
  { stage: 'review', ms: 30, ok: true, host: 'local' },
  { stage: 'qa:host', ms: 900, ok: true, host: 'box' },
]
const fixture = join(tmp, 'fixture')
execFileSync('git', ['init', '-q', fixture])
execFileSync('mkdir', ['-p', join(fixture, '.rig')])
writeFileSync(join(fixture, '.rig', 'timings.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n{"stage":"qa:te`)

let T = real
const swap = (mod) => async () => {
  const keep = T
  T = await mod()
  return () => (T = keep)
}

await suite('machines: measured timings and the estimate', async (s) => {
  await s.check('median per stage is exact on fixture data (odd and even counts, failed runs left out)', {
    assert: () => {
      const e = T.estimate(fixture, ['qa:test', 'review'])
      const [q, r] = e.stages
      return q.medianMs === 200 && q.n === 3 && r.medianMs === 25 && r.n === 4 && e.totalMs === 225 && e.note === null
    },
    // A mean instead of a median: 250 for qa:test.
    breaks: swap(() =>
      mutant('timings.js', [['return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2', 'return s.reduce((a, b) => a + b, 0) / s.length']]),
    ),
  })

  await s.check('a failed run does not count toward the median', {
    assert: () => T.estimate(fixture, ['qa:test']).stages[0].n === 3,
    breaks: swap(() => mutant('timings.js', [['r.ok !== false && (', '(']])),
  })

  await s.check('a stage with no data says "no data" and totalMs is null', {
    assert: () => {
      const e = T.estimate(fixture, ['qa:test', 'fold'])
      return (
        e.totalMs === null &&
        e.note === 'no data for fold' &&
        e.stages[1].medianMs === null &&
        e.stages[1].n === 0 &&
        e.stages[0].medianMs === 200
      )
    },
    // The guess: a stage with no runs counted as zero, so the total looks complete.
    breaks: swap(() => mutant('timings.js', [['if (missing.length) return', 'if (false) return']])),
  })

  await s.check('no records at all: no stages, no total, and a note that says so', {
    assert: () => {
      const e = T.estimate(repo, [])
      const named = T.estimate(repo, ['qa:test'])
      return e.totalMs === null && e.note === 'no timings recorded yet' && named.totalMs === null && named.note === 'no data for qa:test'
    },
    breaks: swap(() => mutant('timings.js', [["note: 'no timings recorded yet'", "note: null, totalMs: 0, _: ''"]])),
  })

  await s.check('host narrows the estimate to one machine', {
    assert: () => {
      const e = T.estimate(fixture, ['qa:host'], { host: 'box' })
      const here = T.estimate(fixture, ['qa:host'], { host: 'local' })
      return e.totalMs === 900 && here.totalMs === null
    },
    breaks: swap(() => mutant('timings.js', [['(host === undefined || r.host === host)', 'true']])),
  })

  await s.check('recordTiming appends through rigDir: .rig/ is ignored by git, and the record reads back', {
    assert: () => {
      T.recordTiming(repo, { stage: 'fold', ms: 1234.4, sha: 'abc', host: 'local' })
      T.recordTiming(repo, { stage: 'fold', ms: 1000, ok: false })
      const back = T.readTimings(repo)
      const ignored = (() => {
        try {
          execFileSync('git', ['check-ignore', '-q', '.rig/timings.jsonl'], { cwd: repo })
          return true
        } catch {
          return false
        }
      })()
      const ok = ignored && back.length >= 2 && back.at(-2).ms === 1234 && back.at(-2).sha === 'abc' && back.at(-1).ok === false
      rmSync(join(repo, '.rig'), { recursive: true, force: true })
      execFileSync('sh', ['-c', ': > .git/info/exclude'], { cwd: repo })
      return ok
    },
    // A plain mkdir: the file is written, and git sees it as something to commit.
    breaks: swap(() =>
      mutant('timings.js', [
        ['join(rigDir(root), FILE)', "join((mkdirSync(join(root, '.rig'), { recursive: true }), join(root, '.rig')), FILE)"],
        [
          "import { appendFileSync, existsSync, readFileSync } from 'node:fs'",
          "import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'",
        ],
      ]),
    ),
  })

  await s.check('a torn last line is skipped, not fatal', {
    assert: () =>
      T.readTimings(fixture).length === lines.length && readFileSync(join(fixture, '.rig', 'timings.jsonl'), 'utf8').endsWith('qa:te'),
    breaks: swap(() => mutant('timings.js', [['    } catch {\n      /* torn line */\n    }', '    } finally {\n    }']])),
  })
})

rmSync(tmp, { recursive: true, force: true })
