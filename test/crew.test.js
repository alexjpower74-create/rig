// Rig 2.0: the bugs a night of fifteen crews found in the rig, each pinned by a check that is shown
// to go red against the bug itself.
//
// Where a check swaps in "the old implementation" as its negative control, the old implementation is
// copied here verbatim from the version that shipped the bug. That is the honest test of a fix: the
// check must tell the fixed code from the broken code, not just pass.

import { suite } from '../harness/check.js'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawn } from 'node:child_process'

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rig-crew-')))

await suite('rig 2.0, crew fixes', async s => {
  const { selectSliceTabs } = await import('../src/herdr.js')
  const { resolveRef, exitCodeFor, runShell } = await import('../src/commands/qa.js')
  const { ensureWorktree } = await import('../src/worktrees.js')
  const { processesIn } = await import('../src/procs.js')
  const { depsWarning } = await import('../src/commands/up.js')

  // ---------------------------------------------------------------------------------------------
  // Slice tabs are the plan's ids — not a label pattern.
  const legacyTabs = (tabs, ids, home) => tabs.filter(t => t.label && t.tab_id !== home && /^[a-z]\d+$/i.test(t.label))
  const TABS = [
    { tab_id: 'w:t1', label: 'Conductor' }, { tab_id: 'w:t2', label: 'jr-lead' },
    { tab_id: 'w:t3', label: 'jr1' }, { tab_id: 'w:t4', label: 'jr2' },
    { tab_id: 'w:t5', label: 'c1' }, { tab_id: 'w:t6', label: 'nb1' }
  ]
  let pick = selectSliceTabs
  await s.check('slice tabs are exactly the plan’s ids: two-letter ids found, other crews’ tabs untouched', {
    assert: async () => {
      const got = pick(TABS, ['jr1', 'jr2'], 'w:t2').map(t => t.label).join(',')
      if (got !== 'jr1,jr2') throw new Error(`selected [${got}]`)
      return true
    },
    breaks: async () => { pick = legacyTabs; return () => { pick = selectSliceTabs } }
  })

  let home = 'w:t3'
  await s.check('the tab the rig runs in is never a slice tab, even when labelled like one', {
    assert: async () => !selectSliceTabs(TABS, ['jr1', 'jr2'], home).some(t => t.tab_id === 'w:t3'),
    breaks: async () => { home = 'nowhere'; return () => { home = 'w:t3' } }
  })

  // ---------------------------------------------------------------------------------------------
  // `rig qa <sha>` pins that sha.
  const legacyRef = (args, fallback) => { const a = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }; return a('--ref') || a('--branch') || fallback }
  let ref = resolveRef
  await s.check('rig qa <sha> pins the sha typed, not the current branch', {
    assert: async () => {
      if (ref(['3f2a1b9', '--run', 'npm test'], 'main') !== '3f2a1b9') throw new Error('bare sha ignored')
      if (ref(['--run', 'npm test'], 'main') !== 'main') throw new Error('the --run value was taken as a ref')
      if (ref(['--port', '7409', 'abc1234'], 'main') !== 'abc1234') throw new Error('a flag value was taken as a ref')
      if (ref(['abc1234', '--ref', 'def5678'], 'main') !== 'def5678') throw new Error('--ref lost to the bare argument')
      return true
    },
    breaks: async () => { ref = legacyRef; return () => { ref = resolveRef } }
  })

  // A failing command piped through tail must not read as green.
  let shell
  await s.check('a failing test piped through `tail` exits non-zero (pipefail)', {
    assert: async () => (await runShell('false | cat', { cwd: tmp, env: process.env, shell })) !== 0,
    breaks: async () => { shell = '/bin/sh'; return () => { shell = undefined } }
  })

  // A test run killed by a signal must not read as green.
  const legacyExit = (code) => code ?? 0
  let exitOf = exitCodeFor
  await s.check('a run killed by a signal is not exit 0', {
    assert: async () => exitOf(null, 'SIGTERM') === 143 && exitOf(null, 'SIGKILL') === 137 && exitOf(0, null) === 0 && exitOf(2, null) === 2,
    breaks: async () => { exitOf = legacyExit; return () => { exitOf = exitCodeFor } }
  })
  let killed = 'kill -TERM $$; sleep 1'
  await s.check('…and for real: a shell that is sent SIGTERM mid-run exits 143', {
    assert: async () => (await runShell(killed, { cwd: tmp, env: process.env })) === 143,
    breaks: async () => { killed = 'exit 0'; return () => { killed = 'kill -TERM $$; sleep 1' } }
  })

  // ---------------------------------------------------------------------------------------------
  // A leftover branch whose work is all merged moves up to base; unmerged work is never moved.
  const repo = join(tmp, 'repo')
  mkdirSync(repo)
  git(['init', '-q', '-b', 'main'], repo)
  git(['config', 'user.email', 'test@example.invalid'], repo)
  git(['config', 'user.name', 'Rig Test'], repo)
  writeFileSync(join(repo, 'a.txt'), 'a\n'); git(['add', '-A'], repo); git(['commit', '-qm', 'A'], repo)
  const A = git(['rev-parse', 'HEAD'], repo)
  git(['branch', 'slice/c1', A], repo)
  git(['branch', 'slice/c2', A], repo)
  execFileSync('git', ['checkout', '-q', 'slice/c2'], { cwd: repo })
  writeFileSync(join(repo, 'c2.txt'), 'unmerged\n'); git(['add', '-A'], repo); git(['commit', '-qm', 'C unmerged'], repo)
  const C = git(['rev-parse', 'HEAD'], repo)
  execFileSync('git', ['checkout', '-q', 'main'], { cwd: repo })
  writeFileSync(join(repo, 'b.txt'), 'b\n'); git(['add', '-A'], repo); git(['commit', '-qm', 'B'], repo)
  const B = git(['rev-parse', 'HEAD'], repo)
  const cfg = { worktreeDir: '.worktrees', branchPrefix: 'slice/' }
  const fresh = (id, at) => {
    try { execFileSync('git', ['worktree', 'remove', '--force', join(repo, '.worktrees', id)], { cwd: repo, stdio: 'ignore' }) } catch {}
    git(['branch', '-f', `slice/${id}`, at], repo)
  }

  let keep = false
  await s.check('a leftover branch with nothing unmerged starts at base, not where the last build left it', {
    assert: async () => {
      fresh('c1', A)
      const wt = ensureWorktree(repo, cfg, 'c1', 'main', { keepBranches: keep })
      return git(['rev-parse', 'HEAD'], wt.path) === B && wt.moved === true
    },
    breaks: async () => { keep = true; return () => { keep = false } }
  })

  let c2Tip = C
  await s.check('a leftover branch holding unmerged commits is never moved', {
    assert: async () => {
      fresh('c2', c2Tip)
      const wt = ensureWorktree(repo, cfg, 'c2', 'main')
      return git(['rev-parse', 'HEAD'], wt.path) === C && wt.ahead === 1
    },
    breaks: async () => { c2Tip = A; return () => { c2Tip = C } }
  })

  // ---------------------------------------------------------------------------------------------
  // `rig down` stops only processes running inside the worktree it removes.
  const dirA = join(tmp, 'wt-a'); const dirAB = join(tmp, 'wt-ab')
  mkdirSync(dirA); mkdirSync(dirAB)
  const inA = spawn('sleep', ['30'], { cwd: dirA, stdio: 'ignore' })
  const inAB = spawn('sleep', ['30'], { cwd: dirAB, stdio: 'ignore' })
  await new Promise(r => setTimeout(r, 300))
  let target = dirA
  await s.check('processes inside a worktree are found; a sibling directory with a longer name is not', {
    assert: async () => {
      const pids = processesIn(target)
      return pids.includes(inA.pid) && !pids.includes(inAB.pid)
    },
    breaks: async () => { target = tmp; return () => { target = dirA } }
  })
  inA.kill(); inAB.kill()

  // ---------------------------------------------------------------------------------------------
  // A node_modules symlinked into a worktree is flagged.
  const main = join(tmp, 'deps-main'); const wt = join(tmp, 'deps-wt')
  mkdirSync(join(main, 'node_modules'), { recursive: true }); writeFileSync(join(main, 'package.json'), '{}')
  mkdirSync(wt)
  symlinkSync(join(main, 'node_modules'), join(wt, 'node_modules'))
  await s.check('a symlinked node_modules in a worktree is flagged before an npm install empties the shared one', {
    assert: async () => /symlink/.test(depsWarning(main, wt) || ''),
    breaks: async () => {
      unlinkSync(join(wt, 'node_modules')); mkdirSync(join(wt, 'node_modules'))
      return () => { rmSync(join(wt, 'node_modules'), { recursive: true }); symlinkSync(join(main, 'node_modules'), join(wt, 'node_modules')) }
    }
  })
})

rmSync(tmp, { recursive: true, force: true })
