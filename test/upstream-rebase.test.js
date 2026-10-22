// rig rebase stops and asks before resolving when upstream superseded a slice's files.
//
// A bare "upstream", a clone that pushes to it, and the lead's clone with rig/s1 checked out in its
// own worktree. rig/s1 has two commits: one changes src/a.js, one changes the last line of src/b.js.
// Each check runs the real `rig rebase` and is made red once: by the Rig this build started from
// (its rebase is a stub), by a threshold that lets the rewrite through, or by leaving out the answer.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { suite } from '../harness/check.js'
import { supersededFiles } from '../src/commands/rebase.js'

const here = dirname(fileURLToPath(import.meta.url))
const RIG = join(here, '..', 'bin', 'rig.js')
// The scaffold commit r55u started from: its rebase.js throws "not built yet".
const START = '14a1ad6'
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')
const made = []
let rig = RIG
let old = null

const PLAN = `# Fixture plan

## Agents

### s1 — a and b
Owns:
- src/a.js
- src/b.js
`

function write(dir, files) {
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true })
    if (body === null) rmSync(join(dir, p))
    else writeFileSync(join(dir, p), body)
  }
}

function identity(dir) {
  git(['config', 'user.email', 'test@example.invalid'], dir)
  git(['config', 'user.name', 'test'], dir)
}

const B = 'export const b1 = 1\nexport const b2 = 2\nexport const b3 = 3\nexport const b4 = 4\n'

function fixture() {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'rig-rebase-')))
  made.push(top)
  const upstream = join(top, 'upstream.git')
  git(['init', '-q', '--bare', '-b', 'main', upstream], top)
  const other = join(top, 'other')
  git(['clone', '-q', upstream, other], top)
  identity(other)
  write(other, { 'PLAN.md': PLAN, 'src/a.js': 'export const a = 1\n', 'src/b.js': B, 'src/c.js': 'export const c = 1\n' })
  git(['add', '-A'], other)
  git(['commit', '-qm', 'first'], other)
  git(['push', '-q', 'origin', 'main'], other)

  const lead = join(top, 'lead')
  git(['clone', '-q', upstream, lead], top)
  identity(lead)
  mkdirSync(join(lead, '.rig'))
  writeFileSync(join(lead, '.rig', 'config.json'), JSON.stringify({ worktreeDir: join(top, 'wt'), terminal: 'tmux' }))
  git(['branch', 'rig/s1', 'main'], lead)
  const wt = join(top, 'wt', 's1')
  git(['worktree', 'add', '-q', wt, 'rig/s1'], lead)
  write(wt, { 'src/a.js': 'export const a = 2 // the slice\n' })
  git(['commit', '-qam', 's1: a is 2'], wt)
  write(wt, { 'src/b.js': B.replace('b4 = 4', 'b4 = 40 // the slice') })
  git(['commit', '-qam', 's1: b4 is 40'], wt)
  return { top, lead, other, wt, tip: () => git(['rev-parse', 'rig/s1'], lead) }
}

function land(fx, files, msg) {
  write(fx.other, files)
  git(['add', '-A'], fx.other)
  git(['commit', '-qm', msg], fx.other)
  git(['push', '-q', 'origin', 'main'], fx.other)
}

function rebase(fx, args) {
  const env = { ...process.env }
  for (const k of ['HERDR_ENV', 'HERDR_PANE_ID', 'DISPLAY', 'WAYLAND_DISPLAY', 'GIT_DIR', 'GIT_WORK_TREE']) delete env[k]
  const r = spawnSync(process.execPath, [rig, 'rebase', 's1', ...args], { cwd: fx.lead, env, encoding: 'utf8', timeout: 30_000 })
  return { code: r.status, out: plain(`${r.stdout}${r.stderr}`) }
}

const note = (fx) => join(fx.lead, '.rig', 'rebase-s1.md')
const subjects = (fx) => git(['log', '--format=%s', 'origin/main..rig/s1'], fx.lead).split('\n').filter(Boolean)

function oldRig() {
  if (!old) {
    old = realpathSync(mkdtempSync(join(tmpdir(), 'rig-old-')))
    made.push(old)
    execFileSync('sh', ['-c', `git -C "${join(here, '..')}" archive ${START} | tar -x -C "${old}"`])
  }
  rig = join(old, 'bin', 'rig.js')
  return () => {
    rig = RIG
  }
}

await suite('upstream: rig rebase asks before it resolves', async (s) => {
  await s.check('upstream deleted a file the slice changed: stop, write the question, exit 3, branch untouched', {
    assert: () => {
      const fx = fixture()
      land(fx, { 'src/a.js': null }, 'upstream: a.js is gone, b covers it')
      const before = fx.tip()
      const r = rebase(fx, [])
      if (r.code !== 3) throw new Error(`exit ${r.code}:\n${r.out}`)
      if (fx.tip() !== before) throw new Error('the branch moved')
      if (!existsSync(note(fx))) throw new Error('no .rig/rebase-s1.md')
      const text = readFileSync(note(fx), 'utf8')
      for (const want of ['`src/a.js`: upstream **deleted** it', 'upstream: a.js is gone', 's1: a is 2', 'rig rebase s1 --covered'])
        if (!text.includes(want)) throw new Error(`note lacks "${want}":\n${text}`)
      if (text.includes('src/b.js')) throw new Error('b.js was not superseded')
      if (!r.out.includes('STOPPED before resolving anything') || !r.out.includes('upstream **deleted** it'))
        throw new Error(`not printed:\n${r.out}`)
      if (git(['status', '--porcelain'], fx.wt)) throw new Error('the slice worktree was touched')
      return true
    },
    breaks: oldRig,
    timeout: 30_000,
  })

  let share = []
  await s.check('upstream rewrote 75% of a file the slice changed: stop at the 50% default and name the share', {
    assert: () => {
      const fx = fixture()
      land(
        fx,
        { 'src/b.js': 'export const b1 = 10\nexport const b2 = 20\nexport const b3 = 30\nexport const b4 = 4\n' },
        'upstream: b rewritten',
      )
      const r = rebase(fx, share)
      return r.code === 3 && readFileSync(note(fx), 'utf8').includes('`src/b.js`: upstream **rewrote 75%** of its lines')
    },
    // A threshold above the rewrite lets it through to an ordinary rebase.
    breaks: () => {
      share = ['--share', '0.9']
      return () => {
        share = []
      }
    },
    timeout: 30_000,
  })

  let answer = ['--covered', 'upstream removed a.js; b.js carries the value', '--drop', 'DROP']
  await s.check('--covered records the answer and --drop drops the superseded commit; the rest is rebased', {
    assert: () => {
      const fx = fixture()
      land(fx, { 'src/a.js': null }, 'upstream: a.js is gone')
      if (rebase(fx, []).code !== 3) throw new Error('did not stop first')
      const drop = git(['log', '--format=%H', '--grep', 's1: a is 2', 'rig/s1'], fx.lead)
      const r = rebase(
        fx,
        answer.map((a) => (a === 'DROP' ? drop.slice(0, 10) : a)),
      )
      if (r.code !== 0) throw new Error(`exit ${r.code}:\n${r.out}`)
      if (subjects(fx).join() !== 's1: b4 is 40') throw new Error(`commits: ${subjects(fx)}`)
      git(['merge-base', '--is-ancestor', 'origin/main', 'rig/s1'], fx.lead) // throws when the base is not under it
      const text = readFileSync(note(fx), 'utf8')
      if (!/Covered: upstream removed a\.js; b\.js carries the value/.test(text) || !/Dropped: `[0-9a-f]{9}` s1: a is 2/.test(text))
        throw new Error(`answer not recorded:\n${text}`)
      if (!r.out.includes('dropped ') || !r.out.includes('range-diff')) throw new Error(`not printed:\n${r.out}`)
      return !existsSync(join(fx.wt, 'src', 'a.js')) && readFileSync(join(fx.wt, 'src', 'b.js'), 'utf8').includes('b4 = 40')
    },
    // The answer without the drop: the superseded commit stays, and the rebase conflicts.
    breaks: () => {
      answer = ['--covered', 'upstream removed a.js']
      return () => {
        answer = ['--covered', 'upstream removed a.js; b.js carries the value', '--drop', 'DROP']
      }
    },
    timeout: 30_000,
  })

  await s.check('a conflict is aborted, never left half-done: exit 1, the file named, the branch as it was', {
    assert: () => {
      const fx = fixture()
      land(fx, { 'src/a.js': 'export const a = 3 // upstream\n' }, 'upstream: a is 3')
      const before = fx.tip()
      const r = rebase(fx, ['--covered', 'upstream set a differently; the slice still wants 2'])
      const inProgress = existsSync(join(git(['rev-parse', '--git-dir'], fx.wt), 'rebase-merge'))
      return (
        r.code === 1 &&
        /conflicting: src\/a\.js/.test(r.out) &&
        fx.tip() === before &&
        !inProgress &&
        !git(['status', '--porcelain'], fx.wt)
      )
    },
    breaks: oldRig,
    timeout: 30_000,
  })

  await s.check('nothing superseded: an ordinary rebase onto the moved base, every commit kept', {
    assert: () => {
      const fx = fixture()
      land(fx, { 'src/c.js': 'export const c = 2\n' }, 'upstream: c is 2')
      const r = rebase(fx, [])
      return (
        r.code === 0 &&
        subjects(fx).join() === 's1: b4 is 40,s1: a is 2' &&
        git(['merge-base', 'origin/main', 'rig/s1'], fx.lead) === git(['rev-parse', 'origin/main'], fx.lead) &&
        !existsSync(note(fx))
      )
    },
    breaks: oldRig,
    timeout: 30_000,
  })

  await s.check('--drop without --covered is refused: a dropped commit needs its reason on record', {
    assert: () => {
      const fx = fixture()
      land(fx, { 'src/a.js': null }, 'gone')
      const before = fx.tip()
      const r = rebase(fx, ['--drop', 'HEAD'])
      return r.code === 1 && /--drop needs --covered/.test(r.out) && fx.tip() === before
    },
    breaks: oldRig,
    timeout: 30_000,
  })

  let find = supersededFiles
  await s.check('supersededFiles: a rename away and a file both sides created are superseded; a small edit is not', {
    assert: () => {
      const fx = fixture()
      write(fx.wt, { 'src/new.js': 'mine\n' })
      git(['add', '-A'], fx.wt)
      git(['commit', '-qm', 's1: new'], fx.wt)
      git(['mv', 'src/a.js', 'src/moved.js'], fx.other)
      write(fx.other, { 'src/new.js': 'theirs\n', 'src/b.js': B.replace('b1 = 1', 'b1 = 11') })
      git(['add', '-A'], fx.other)
      git(['commit', '-qm', 'upstream: move a, add new, touch b1'], fx.other)
      git(['push', '-q', 'origin', 'main'], fx.other)
      git(['fetch', '-q'], fx.lead)
      const mb = git(['merge-base', 'rig/s1', 'origin/main'], fx.lead)
      const got = find(fx.lead, { mergeBase: mb, base: 'origin/main', head: 'rig/s1' })
      const by = Object.fromEntries(got.map((g) => [g.file, g]))
      return (
        by['src/a.js']?.what === 'renamed' && by['src/a.js'].to === 'src/moved.js' && by['src/new.js']?.what === 'added' && !by['src/b.js']
      )
    },
    // Deletions only: the move and the double creation slip through to the resolver.
    breaks: () => {
      find = (root, o) => supersededFiles(root, o).filter((f) => f.what === 'deleted')
      return () => {
        find = supersededFiles
      }
    },
  })
})

for (const d of made) rmSync(d, { recursive: true, force: true })
