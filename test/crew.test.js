// Rig 2.0: the bugs a night of fifteen crews found in the rig, each pinned by a check that is shown
// to go red against the bug itself.
//
// Where a check swaps in "the old implementation" as its negative control, the old implementation is
// copied here from the version that shipped the bug. That is the honest test of a fix: the check must
// tell the fixed code from the broken code, not just pass. Where the only possible control is a change
// of state (a repo, a directory), the comment says so.

import { suite } from '../harness/check.js'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawn } from 'node:child_process'

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rig-crew-')))

function repoAt (name) {
  const repo = join(tmp, name)
  mkdirSync(repo)
  git(['init', '-q', '-b', 'main'], repo)
  git(['config', 'user.email', 'test@example.invalid'], repo)
  git(['config', 'user.name', 'Rig Test'], repo)
  return repo
}
const commit = (repo, file, msg) => { writeFileSync(join(repo, file), msg + '\n'); git(['add', '-A'], repo); git(['commit', '-qm', msg], repo); return git(['rev-parse', 'HEAD'], repo) }

await suite('rig 2.0, crew fixes', async s => {
  const { selectSliceTabs } = await import('../src/herdr.js')
  const { resolveRef, exitCodeFor, runShell } = await import('../src/commands/qa.js')
  const { ensureWorktree, ensureDetachedWorktree, divergence, shouldMoveLeftover } = await import('../src/worktrees.js')
  const { processesIn, insideDir } = await import('../src/procs.js')
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

  const ignoresHome = (tabs, ids) => tabs.filter(t => new Set(ids).has(t.label))
  let pickHome = selectSliceTabs
  await s.check('the tab the rig runs in is never a slice tab, even when labelled like one', {
    assert: async () => !pickHome(TABS, ['jr1', 'jr2'], 'w:t3').some(t => t.tab_id === 'w:t3'),
    breaks: async () => { pickHome = ignoresHome; return () => { pickHome = selectSliceTabs } }
  })

  // ---------------------------------------------------------------------------------------------
  // `rig qa <sha>` pins that sha, re-pins correctly, and cannot exit 0 on a failure.
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

  const qrepo = repoAt('qa-repo')
  const Q1 = commit(qrepo, 'one.txt', 'one')
  const Q2 = commit(qrepo, 'two.txt', 'two')
  const qcfg = { worktreeDir: '.worktrees', branchPrefix: 'rig/' }
  // The old re-pin: resolve the ref INSIDE the QA worktree, where HEAD is its own last pin.
  const legacyDetached = (root, cfg, id, r) => {
    const path = join(root, cfg.worktreeDir, id)
    try { git(['checkout', '--detach', r], path) } catch { git(['worktree', 'add', '--detach', path, r], root) }
    return { path }
  }
  let pin = ensureDetachedWorktree
  await s.check('re-pinning the QA worktree to HEAD after HEAD~1 lands on the main checkout’s HEAD', {
    assert: async () => {
      try { execFileSync('git', ['worktree', 'remove', '--force', join(qrepo, '.worktrees', 'qa')], { cwd: qrepo, stdio: 'ignore' }) } catch {}
      pin(qrepo, qcfg, 'qa', 'HEAD~1')
      const wt = pin(qrepo, qcfg, 'qa', 'HEAD')
      const at = git(['rev-parse', 'HEAD'], wt.path)
      if (at !== Q2) throw new Error(`pinned to ${at === Q1 ? 'the previous pin (HEAD~1)' : at}`)
      return true
    },
    breaks: async () => { pin = legacyDetached; return () => { pin = ensureDetachedWorktree } }
  })

  let shell
  await s.check('a failing test piped through `tail` exits non-zero (pipefail)', {
    assert: async () => (await runShell('false | cat', { cwd: tmp, env: process.env, shell })) !== 0,
    breaks: async () => { shell = '/bin/sh'; return () => { shell = undefined } }
  })

  const legacyExit = (code) => code ?? 0
  let exitOf = exitCodeFor
  await s.check('a run killed by a signal is not exit 0', {
    assert: async () => exitOf(null, 'SIGTERM') === 143 && exitOf(null, 'SIGKILL') === 137 && exitOf(0, null) === 0 && exitOf(2, null) === 2,
    breaks: async () => { exitOf = legacyExit; return () => { exitOf = exitCodeFor } }
  })

  let mapExit = exitCodeFor
  await s.check('…and for real: a test shell killed by SIGTERM mid-run is reported as 143', {
    assert: async () => (await runShell('kill -TERM $$; sleep 1', { cwd: tmp, env: process.env, mapExit })) === 143,
    breaks: async () => { mapExit = legacyExit; return () => { mapExit = exitCodeFor } }
  })

  // ---------------------------------------------------------------------------------------------
  // Leftover branches: merged ones move up to base; unmerged ones never move, even behind a tag.
  const repo = repoAt('repo')
  const A = commit(repo, 'a.txt', 'A')
  git(['branch', 'slice/c1', A], repo)
  git(['branch', 'slice/c2', A], repo)
  execFileSync('git', ['checkout', '-q', 'slice/c2'], { cwd: repo })
  const C = commit(repo, 'c2.txt', 'C unmerged')
  execFileSync('git', ['checkout', '-q', 'main'], { cwd: repo })
  const B = commit(repo, 'b.txt', 'B')
  const cfg = { worktreeDir: '.worktrees', branchPrefix: 'slice/' }
  const fresh = (id, at) => {
    try { execFileSync('git', ['worktree', 'remove', '--force', join(repo, '.worktrees', id)], { cwd: repo, stdio: 'ignore' }) } catch {}
    git(['branch', '-f', `slice/${id}`, at], repo)
  }

  const legacyShouldMove = (d) => d.behind > 0 // "behind base" alone, which would move unmerged work
  let decide = shouldMoveLeftover
  await s.check('the move rule: only a branch with nothing unmerged and base moved on', {
    assert: async () => decide({ ahead: 0, behind: 3 }) === true && decide({ ahead: 1, behind: 3 }) === false && decide({ ahead: 0, behind: 0 }) === false && decide({ ahead: 0, behind: 3 }, { keepBranches: true }) === false,
    breaks: async () => { decide = legacyShouldMove; return () => { decide = shouldMoveLeftover } }
  })

  let keep = false
  await s.check('a leftover branch with nothing unmerged starts at base, not where the last build left it', {
    assert: async () => {
      fresh('c1', A)
      const wt = ensureWorktree(repo, cfg, 'c1', 'main', { keepBranches: keep })
      return git(['rev-parse', 'HEAD'], wt.path) === B && wt.moved === true
    },
    breaks: async () => { keep = true; return () => { keep = false } }
  })

  // A tag with the branch's name, pointing at a merged commit, used to answer for the branch.
  git(['tag', 'slice/c2', A], repo)
  const legacyDivergence = (root, branch, base) => ({
    ahead: Number(git(['rev-list', '--count', `${base}..${branch}`], root)),
    behind: Number(git(['rev-list', '--count', `${branch}..${base}`], root))
  })
  let measure = divergence
  await s.check('a same-named tag cannot make unmerged work look merged (branch measured by its full ref)', {
    assert: async () => { let d; try { d = measure(repo, 'slice/c2', 'main') } catch { return false } return d.ahead === 1 },
    breaks: async () => { measure = legacyDivergence; return () => { measure = divergence } }
  })

  // State control: the only way to make this red without editing the code is to make the branch merged.
  let c2Tip = C
  await s.check('…and end to end: that branch is checked out untouched, with its unmerged commit', {
    assert: async () => {
      fresh('c2', c2Tip)
      const wt = ensureWorktree(repo, cfg, 'c2', 'main')
      return git(['rev-parse', 'HEAD'], wt.path) === C && wt.moved === false
    },
    breaks: async () => { c2Tip = A; return () => { c2Tip = C } }
  })

  // ---------------------------------------------------------------------------------------------
  // `rig down` stops only processes running inside the worktree it removes.
  const legacyInside = (cwd, dir) => cwd.startsWith(dir)
  let within = insideDir
  await s.check('“inside a worktree” means the directory or below it — not a sibling that shares its prefix', {
    assert: async () => within('/w/wt-a/src', '/w/wt-a') && within('/w/wt-a', '/w/wt-a') && within('/w/wt-a/x (deleted)', '/w/wt-a') && !within('/w/wt-ab', '/w/wt-a') && !within('/w', '/w/wt-a'),
    breaks: async () => { within = legacyInside; return () => { within = insideDir } }
  })

  const dirA = join(tmp, 'wt-a'); const dirAB = join(tmp, 'wt-ab'); const linkA = join(tmp, 'link-to-wt-a')
  mkdirSync(dirA); mkdirSync(dirAB); symlinkSync(dirA, linkA)
  const inA = spawn('sleep', ['30'], { cwd: dirA, stdio: 'ignore' })
  const inAB = spawn('sleep', ['30'], { cwd: dirAB, stdio: 'ignore' })
  await new Promise(r => setTimeout(r, 300))
  let resolve = true
  await s.check('processes are found through a symlinked worktree path, and a sibling’s are not', {
    assert: async () => {
      const pids = processesIn(linkA, { resolve })
      return pids.includes(inA.pid) && !pids.includes(inAB.pid)
    },
    breaks: async () => { resolve = false; return () => { resolve = true } }
  })
  inA.kill(); inAB.kill()

  // ---------------------------------------------------------------------------------------------
  // A node_modules symlinked into a worktree is flagged; a real one is not.
  const main = join(tmp, 'deps-main'); const wtLink = join(tmp, 'deps-wt-link'); const wtReal = join(tmp, 'deps-wt-real')
  mkdirSync(join(main, 'node_modules'), { recursive: true }); writeFileSync(join(main, 'package.json'), '{}')
  mkdirSync(wtLink); symlinkSync(join(main, 'node_modules'), join(wtLink, 'node_modules'))
  mkdirSync(join(wtReal, 'node_modules'), { recursive: true })
  const naiveDeps = () => 'node_modules is a symlink'
  let deps = depsWarning
  await s.check('a symlinked node_modules is flagged, and a real one installed in the worktree is not', {
    assert: async () => /symlink/.test(deps(main, wtLink) || '') && !/symlink/.test(deps(main, wtReal) || ''),
    breaks: async () => { deps = naiveDeps; return () => { deps = depsWarning } }
  })
})

rmSync(tmp, { recursive: true, force: true })
