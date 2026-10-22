// Rig 5.5, r55g, item 13: `rig decision` writes docs/DECISIONS.md, a table a person can read and edit,
// and closes rows by id. Driven as `rig decision` would be, in a child process.

import { suite } from '../harness/check.js'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const RIG = join(here, '..')
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rig-decision-')))
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')
const { parseDecisions } = await import('../src/decisions.js')

function repoAt(name) {
  const repo = join(tmp, name)
  mkdirSync(repo, { recursive: true })
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  return repo
}
function rig(repo, args) {
  const r = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import('${join(RIG, 'src', 'commands', 'decision.js')}').then(m => m.default(process.argv.slice(1)))`,
      '--',
      ...args,
    ],
    { cwd: repo, encoding: 'utf8' },
  )
  return { status: r.status, out: plain(r.stdout + r.stderr) }
}
const rows = (repo) => parseDecisions(readFileSync(join(repo, 'docs', 'DECISIONS.md'), 'utf8'))

await suite('rig 5.5, rig decision (r55g)', async (s) => {
  const repo = repoAt('cli')
  let source = ['--source', 'thread: example.invalid/t/42']
  await s.check('a decision is appended open, with an id, a date, what and where; a pipe in the text survives', {
    assert: async () => {
      rmSync(join(repo, 'docs'), { recursive: true, force: true })
      const a = rig(repo, ['refunds round down | never up', ...source])
      const b = rig(repo, ['entries close at midnight', '--source', 'transcript: meetings/2026-10-22.md'])
      const r = rows(repo)
      return (
        a.status === 0 &&
        b.status === 0 &&
        /D1 \(open\): refunds round down \| never up\n {2}source: thread: example\.invalid\/t\/42/.test(a.out) &&
        r.length === 2 &&
        r[0].id === 'D1' &&
        r[0].what === 'refunds round down | never up' &&
        r[0].source === 'thread: example.invalid/t/42' &&
        r[0].kind === 'open' &&
        /^\d{4}-\d{2}-\d{2}$/.test(r[0].date) &&
        r[1].id === 'D2'
      )
    },
    // A decision with no source is a rumour: refused, and nothing is written.
    breaks: async () => {
      source = []
      return () => {
        source = ['--source', 'thread: example.invalid/t/42']
      }
    },
  })

  // The control above left one row; start the rest from the two.
  rmSync(join(repo, 'docs'), { recursive: true, force: true })
  rig(repo, ['refunds round down | never up', '--source', 'thread: example.invalid/t/42'])
  rig(repo, ['entries close at midnight', '--source', 'transcript: meetings/2026-10-22.md'])
  let flag = ['--scheduled', '5.6']
  await s.check('rig decision <id> closes a row in place: built, scheduled with a round, not in scope', {
    assert: async () => {
      const r1 = rig(repo, ['D1', ...flag])
      const r2 = rig(repo, ['2', '--not-in-scope'])
      const r = rows(repo)
      return (
        r1.status === 0 &&
        r2.status === 0 &&
        r[0].kind === 'scheduled' &&
        /^scheduled 5\.6 \(/.test(r[0].status) &&
        r[1].kind === 'not-in-scope'
      )
    },
    // --scheduled without a round says nothing about when: refused.
    breaks: async () => {
      rig(repo, ['D1', '--open'])
      flag = ['--scheduled']
      return () => {
        flag = ['--scheduled', '5.6']
      }
    },
  })

  let edit = 'stautus-typo'
  const p = join(repo, 'docs', 'DECISIONS.md')
  const original = readFileSync(p, 'utf8')
  await s.check('a hand edit that is not a known status leaves the decision open (a typo never closes one)', {
    assert: async () => {
      writeFileSync(p, original.replace(/\| not-in-scope \([^)]*\) \|/, `| ${edit} |`))
      return rows(repo)[1].kind === 'open'
    },
    breaks: async () => {
      edit = 'built'
      return () => {
        edit = 'stautus-typo'
      }
    },
  })

  writeFileSync(p, original)
  const BAD = [
    ['D1', '--built', '--not-in-scope'],
    ['D9', '--built'],
    ['--source', 'x'],
  ]
  let bad = BAD
  await s.check('usage errors write nothing: two statuses, an unknown id, no text', {
    assert: async () => {
      const before = readFileSync(p, 'utf8')
      const outs = bad.map((args) => rig(repo, args))
      return outs.every((o) => o.status !== 0) && readFileSync(p, 'utf8') === before
    },
    // A well-formed call in the same place does write: the assertion tells the two apart.
    breaks: async () => {
      bad = [['D1', '--built']]
      return () => {
        bad = BAD
        writeFileSync(p, original)
      }
    },
  })

  rig(repo, ['D2', '--open'])
  await s.check('--list prints every decision with OPEN beside the open ones', {
    assert: async () => {
      const out = rig(repo, ['--list']).out
      return /D2\s+OPEN/.test(out) && existsSync(join(repo, 'docs', 'DECISIONS.md'))
    },
    breaks: async () => {
      rig(repo, ['D2', '--built'])
      return () => rig(repo, ['D2', '--open'])
    },
  })
})

rmSync(tmp, { recursive: true, force: true })
