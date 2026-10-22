// Drift is known before a final round: drift() and `rig status`, on fixture repos whose base moved.
//
// The fixture is three repos in a temp dir: a bare "upstream", a second clone that pushes to it
// (someone else's work landing), and the lead's clone with a slice branch on it. Each check is made
// red once with the old behaviour swapped back in: the 5.0 stub that reported nothing, or a drift
// that skips the fetch and so compares against a stale copy of the base.

import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { suite } from '../harness/check.js'
import { drift, liveBase, mergeTree } from '../src/drift.js'
import { duration, formatEta, roundStages } from '../src/commands/status.js'

const here = dirname(fileURLToPath(import.meta.url))
const RIG = join(here, '..', 'bin', 'rig.js')
// The scaffold commit r55u started from: its status.js is 5.0's, with no drift and no --eta.
const START = '14a1ad6'
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')
const made = []
const etaBlock = (out) => out.slice(out.indexOf('eta for a final round'), out.indexOf('\n\n', out.indexOf('eta for a final round')))
let rig = RIG
let old = null

const PLAN = `# Fixture plan

## Agents

### s1 — the a and b files
Owns:
- src/a.js
- src/b.js

### s2 — docs
Owns:
- docs/**
`

function write(dir, files) {
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true })
    writeFileSync(join(dir, p), body)
  }
}

function identity(dir) {
  git(['config', 'user.email', 'test@example.invalid'], dir)
  git(['config', 'user.name', 'test'], dir)
}

/** upstream (bare), other (pushes to it), lead (the main checkout, with rig/s1 cut from main). */
function fixture() {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'rig-drift-')))
  made.push(top)
  const upstream = join(top, 'upstream.git')
  git(['init', '-q', '--bare', '-b', 'main', upstream], top)
  const other = join(top, 'other')
  git(['clone', '-q', upstream, other], top)
  identity(other)
  write(other, {
    'PLAN.md': PLAN,
    'src/a.js': 'export const a = 1\n',
    'src/b.js': 'export const b = 1\n',
    'src/c.js': 'export const c = 1\n',
    'docs/x.md': '# x\n',
  })
  git(['add', '-A'], other)
  git(['commit', '-qm', 'first'], other)
  git(['push', '-q', 'origin', 'main'], other)

  const lead = join(top, 'lead')
  git(['clone', '-q', upstream, lead], top)
  identity(lead)
  git(['branch', 'rig/s1', 'main'], lead)
  git(['worktree', 'add', '-q', join(top, 'wt', 's1'), 'rig/s1'], lead)
  const wt = join(top, 'wt', 's1')
  write(wt, { 'src/a.js': 'export const a = 2 // the slice\n' })
  git(['commit', '-qam', 's1: a is 2'], wt)
  return { top, upstream, other, lead, wt }
}

/** Someone else's commit lands upstream. */
function land(fx, files, msg) {
  write(fx.other, files)
  git(['add', '-A'], fx.other)
  git(['commit', '-qm', msg], fx.other)
  git(['push', '-q', 'origin', 'main'], fx.other)
}

const SLICES = [
  { id: 's1', owns: ['src/a.js', 'src/b.js'] },
  { id: 's2', owns: ['docs/**'] },
]

// The 5.0 stub, verbatim in behaviour: drift reported nothing at all.
const stub = (_root, { base = 'origin/main', head = 'HEAD' } = {}) => ({
  base,
  head,
  moved: false,
  since: [],
  touched: [],
  safe: [],
  merges: null,
  conflicts: [],
  error: 'drift: not built yet',
})

await suite('upstream: drift is known before the round', async (s) => {
  let impl = drift

  await s.check('a base that moved and touched an owned file is flagged, with the owner named and untouched files safe', {
    assert: () => {
      const fx = fixture()
      land(fx, { 'src/b.js': 'export const b = 2 // upstream\n', 'README.md': 'new\n' }, 'upstream: b is 2')
      const d = impl(fx.lead, { base: 'origin/main', head: 'rig/s1', slices: SLICES })
      if (d.error) throw new Error(`error: ${d.error}`)
      if (!d.moved || d.since.length !== 1 || d.since[0].subject !== 'upstream: b is 2')
        throw new Error(`since: ${JSON.stringify(d.since)}`)
      const b = d.touched.find((t) => t.file === 'src/b.js')
      if (b?.slices.join() !== 's1' || b.headChanged) throw new Error(`touched: ${JSON.stringify(d.touched)}`)
      if (d.touched.some((t) => t.file === 'README.md'))
        throw new Error('README.md is nobody’s and the head did not change it: not touched')
      for (const f of ['src/a.js', 'docs/x.md']) if (!d.safe.includes(f)) throw new Error(`${f} should be safe: ${JSON.stringify(d.safe)}`)
      if (d.safe.includes('src/b.js') || d.safe.includes('src/c.js')) throw new Error(`safe: ${JSON.stringify(d.safe)}`)
      if (d.merges !== true) throw new Error(`merges: ${d.merges}`)
      return true
    },
    // The old behaviour: no drift at all.
    breaks: () => {
      impl = stub
      return () => {
        impl = drift
      }
    },
  })

  await s.check('drift fetches first: a move pushed since the last fetch is seen', {
    assert: () => {
      const fx = fixture()
      land(fx, { 'src/b.js': 'export const b = 3\n' }, 'upstream: b is 3')
      const d = impl(fx.lead, { base: 'origin/main', head: 'rig/s1', slices: SLICES })
      return d.moved && d.fetched && d.touched.some((t) => t.file === 'src/b.js')
    },
    // Compare against the copy of origin/main the clone already had.
    breaks: () => {
      impl = (root, opts) => drift(root, { ...opts, fetch: false })
      return () => {
        impl = drift
      }
    },
  })

  await s.check('a stack that no longer merges is reported, with the conflicting file', {
    assert: () => {
      const fx = fixture()
      land(fx, { 'src/a.js': 'export const a = 3 // upstream rewrote the same line\n' }, 'upstream: a is 3')
      const d = impl(fx.lead, { base: 'origin/main', head: 'rig/s1', slices: SLICES })
      const a = d.touched.find((t) => t.file === 'src/a.js')
      if (!a?.headChanged) throw new Error(`touched: ${JSON.stringify(d.touched)}`)
      if (d.merges !== false || d.conflicts.join() !== 'src/a.js') throw new Error(`merges ${d.merges}, conflicts ${d.conflicts}`)
      // merge-tree wrote no work tree: the slice's checkout is untouched.
      if (git(['status', '--porcelain'], fx.wt)) throw new Error('the slice worktree was touched')
      return true
    },
    // A drift that guesses from file overlap and never asks merge-tree.
    breaks: () => {
      impl = (root, opts) => ({ ...drift(root, opts), merges: true, conflicts: [] })
      return () => {
        impl = drift
      }
    },
  })

  let mt = mergeTree
  await s.check('mergeTree: a clean merge is true, a conflicted one names its file, a bad ref is null with a reason', {
    assert: () => {
      const fx = fixture()
      land(fx, { 'src/a.js': 'clash\n' }, 'clash')
      git(['fetch', '-q'], fx.lead)
      const bad = mt(fx.lead, 'origin/main', 'no-such-ref')
      const conflicted = mt(fx.lead, 'origin/main', 'rig/s1')
      const clean = mt(fx.lead, 'origin/main', 'main')
      return (
        clean.merges === true &&
        conflicted.merges === false &&
        conflicted.conflicts.join() === 'src/a.js' &&
        bad.merges === null &&
        /merge-tree could not run/.test(bad.why)
      )
    },
    // Read the exit alone: any non-zero exit is "conflicted", so a bad ref reads as a conflict.
    breaks: () => {
      mt = (root, base, head) => {
        const r = mergeTree(root, base, head)
        return r.merges === null ? { merges: false, conflicts: [], why: null } : r
      }
      return () => {
        mt = mergeTree
      }
    },
  })

  await s.check('no remote: error says so and the compare still runs against the local base, never a throw', {
    assert: () => {
      const fx = fixture()
      git(['remote', 'remove', 'origin'], fx.lead)
      const missing = impl(fx.lead, { base: 'origin/main', head: 'rig/s1', slices: SLICES })
      const local = impl(fx.lead, { base: 'main', head: 'rig/s1', slices: SLICES })
      return /does not name a commit/.test(missing.error || '') && missing.merges === null && local.error === null && local.merges === true
    },
    breaks: () => {
      impl = stub
      return () => {
        impl = drift
      }
    },
  })

  let live = liveBase
  await s.check('the live base is the local one once the lead merged a slice there unpushed, else its upstream', {
    assert: () => {
      const fx = fixture()
      if (live(fx.lead, 'main') !== 'origin/main') throw new Error('an untouched main should be measured against origin/main')
      // The lead merges another slice into local main and has not pushed: that is a move for s1.
      git(['checkout', '-q', '-b', 'rig/s2', 'main'], fx.lead)
      write(fx.lead, { 'src/b.js': 'export const b = 5 // s2 merged first\n' })
      git(['commit', '-qam', 's2 lands'], fx.lead)
      git(['checkout', '-q', 'main'], fx.lead)
      git(['merge', '-q', '--ff-only', 'rig/s2'], fx.lead)
      const base = live(fx.lead, 'main')
      const d = drift(fx.lead, { base, head: 'rig/s1', slices: SLICES })
      return base === 'main' && d.moved && d.touched.some((t) => t.file === 'src/b.js')
    },
    // Always the upstream: the unpushed merge is invisible.
    breaks: () => {
      live = (root, branch) => git(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], root)
      return () => {
        live = liveBase
      }
    },
  })

  await s.check('rig status prints drift before the slices, and --no-fetch skips the fetch', {
    assert: () => {
      const fx = fixture()
      statusSetup(fx)
      land(fx, { 'src/b.js': 'export const b = 4\n' }, 'upstream: b is 4')
      const out = rigStatus(fx, [])
      const at = out.indexOf('drift vs origin/main')
      const slice = out.search(/^\S+ s1/m)
      if (at < 0 || slice < 0 || at > slice) throw new Error(`drift not first:\n${out}`)
      if (!/s1\s+origin\/main moved 1 commit\(s\) · 1 owned file\(s\) touched upstream: src\/b\.js · \d+ safe · merges cleanly/.test(out))
        throw new Error(`no s1 drift line:\n${out}`)
      if (!/upstream: b is 4/.test(out)) throw new Error(`commit not listed:\n${out}`)
      land(fx, { 'src/a.js': 'export const a = 9\n' }, 'upstream: a is 9')
      const stale = rigStatus(fx, ['--no-fetch'])
      if (!/not fetched \(--no-fetch\)/.test(stale) || /DOES NOT MERGE/.test(stale)) throw new Error(`--no-fetch fetched:\n${stale}`)
      const fresh = rigStatus(fx, [])
      if (!/DOES NOT MERGE: src\/a\.js/.test(fresh)) throw new Error(`conflict not shown:\n${fresh}`)
      return true
    },
    // Swap in the 5.0 Rig (the commit this build started from): its status has no drift block.
    breaks: oldRig,
    timeout: 30_000,
  })

  await s.check('rig status --eta says "no data" when nothing was measured, and prints no total', {
    assert: () => {
      const fx = fixture()
      statusSetup(fx)
      const out = rigStatus(fx, ['--eta', '--no-fetch'])
      return (
        /eta for a final round/.test(out) &&
        /qa:test\s+no data/.test(out) &&
        /total\s+no data/.test(out) &&
        !/\d+ (s|min)\b/.test(etaBlock(out))
      )
    },
    breaks: oldRig,
    timeout: 30_000,
  })

  let fmt = formatEta
  await s.check('formatEta prints each measured median with its run count, and a total only when every stage has data', {
    assert: () => {
      const full = plain(
        fmt({
          stages: [
            { stage: 'qa:test', medianMs: 125_000, n: 3 },
            { stage: 'review', medianMs: 40_000, n: 1 },
          ],
          totalMs: 165_000,
          note: null,
        }).join('\n'),
      )
      const part = plain(
        fmt({
          stages: [
            { stage: 'qa:test', medianMs: 125_000, n: 3 },
            { stage: 'fold', medianMs: null, n: 0 },
          ],
          totalMs: null,
          note: 'no data for fold',
        }).join('\n'),
      )
      return (
        /qa:test\s+2 min 05 s\s+median of 3/.test(full) &&
        /total\s+2 min 45 s/.test(full) &&
        /fold\s+no data/.test(part) &&
        /total\s+no data for fold/.test(part) &&
        /at least 2 min 05 s from the 1 measured stage\(s\)/.test(part) &&
        !/total\s+\d/.test(part)
      )
    },
    // A formatter that fills the gap with the stages it has: the guess the bar forbids.
    breaks: () => {
      fmt = (est) => formatEta({ ...est, totalMs: est.stages.reduce((t, x) => t + (x.medianMs || 0), 0) })
      return () => {
        fmt = formatEta
      }
    },
  })

  let stages = roundStages
  await s.check('roundStages adds qa:host and qa:ci only when configured or measured; duration reads like a person', {
    assert: () =>
      stages({}).join() === 'qa:test,qa:negative,qa:baseline,review,fold' &&
      stages({ qaHost: 'h' }, [{ stage: 'qa:ci' }]).join() === 'qa:test,qa:negative,qa:baseline,qa:ci,qa:host,review,fold' &&
      duration(950) === '950 ms' &&
      duration(59_400) === '59 s' &&
      duration(3_725_000) === '1 h 02 min',
    // Every stage always: an unconfigured second machine would hold the total at "no data" forever.
    breaks: () => {
      stages = () => ['qa:test', 'qa:negative', 'qa:baseline', 'qa:ci', 'qa:host', 'review', 'fold']
      return () => {
        stages = roundStages
      }
    },
  })
})

// The Rig this build started from, unpacked once, for the status checks' red run.
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

// `rig status` needs a config whose worktreeDir holds the slice worktrees, and no terminal.
function statusSetup(fx) {
  mkdirSync(join(fx.lead, '.rig'), { recursive: true })
  writeFileSync(join(fx.lead, '.rig', 'config.json'), JSON.stringify({ worktreeDir: join(fx.top, 'wt'), terminal: 'tmux' }))
  // A tmux that is not there: status must not reach a real terminal.
  const bin = join(fx.top, 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'tmux'), '#!/bin/sh\nexit 1\n')
  chmodSync(join(bin, 'tmux'), 0o755)
}

function rigStatus(fx, args) {
  const env = { ...process.env, PATH: `${join(fx.top, 'bin')}:${process.env.PATH}` }
  for (const k of ['HERDR_ENV', 'HERDR_PANE_ID', 'DISPLAY', 'WAYLAND_DISPLAY', 'TMUX']) delete env[k]
  const r = spawnSync(process.execPath, [rig, 'status', ...args], { cwd: fx.lead, env, encoding: 'utf8', timeout: 20_000 })
  return plain(`${r.stdout}${r.stderr}`)
}

for (const d of made) rmSync(d, { recursive: true, force: true })
