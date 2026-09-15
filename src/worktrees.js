import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { git, tryGit, gitRaw } from './sh.js'

export function worktreeBase (root, cfg) {
  return resolve(root, cfg.worktreeDir)
}

export function worktreePath (root, cfg, id) {
  return join(worktreeBase(root, cfg), id)
}

export function listWorktrees (root) {
  const out = git(['worktree', 'list', '--porcelain'], root)
  const trees = []
  let cur = null
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9), branch: null, detached: false }; trees.push(cur) }
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace('refs/heads/', '')
    else if (line === 'detached') cur.detached = true
  }
  return trees
}

/**
 * Create a worktree on a branch, reusing it if it already exists. Never destroys work.
 *
 * A branch left over from an earlier build is the trap. `rig down` keeps branches (it removes
 * checkouts, never commits), so the second build in a repo used to reattach `rig/c1` wherever the
 * first build left it: once 50 commits behind main, without the directories its slice owned. The
 * agent started work on a tree that did not have the files it was told to edit.
 *
 * So a leftover branch whose every commit is already in `base` is moved up to `base` before it is
 * checked out — nothing on it can be lost, by definition. A branch holding commits that are NOT in
 * `base` is left exactly as it is and reported, because that is someone's unmerged work.
 * `opts.keepBranches` turns the move off.
 */
export function ensureWorktree (root, cfg, id, base, opts = {}) {
  const path = worktreePath(root, cfg, id)
  const branch = cfg.branchPrefix + id
  mkdirSync(worktreeBase(root, cfg), { recursive: true })

  const existing = listWorktrees(root).find(w => w.path === path)
  if (existing) return { path, branch: existing.branch, created: false, ...divergence(root, existing.branch, base) }

  if (existsSync(path)) throw new Error(`${path} exists but is not a registered worktree. Move it aside; the rig will not delete it for you.`)

  const branchExists = tryGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], root).ok
  if (!branchExists) {
    git(['worktree', 'add', '-b', branch, path, base], root)
    return { path, branch, created: true, ahead: 0, behind: 0, moved: false }
  }

  const d = divergence(root, branch, base)
  let moved = false
  if (shouldMoveLeftover(d, opts)) {
    try { git(['branch', '-f', branch, base], root) } catch (e) { // every commit on it is already in base
      throw new Error(`could not move leftover ${branch} up to ${base}: ${String(e.message).split('\n')[0]}. ` +
        'If that branch is checked out in another checkout, switch that checkout off it, or re-run with --keep-branches.')
    }
    moved = true
  }
  git(['worktree', 'add', path, branch], root)
  return { path, branch, created: true, moved, ...divergence(root, branch, base), staleBehind: d.behind }
}

/** Move a leftover branch only when nothing on it is missing from base, and base has moved on. */
export const shouldMoveLeftover = (d, opts = {}) => !opts.keepBranches && d.ahead === 0 && d.behind > 0

/**
 * How far `branch` is from `base`: commits only on the branch (ahead) and only on base (behind).
 *
 * The branch is named by its full ref. Git resolves a short name tags-first, so with a tag that
 * happens to share the branch's name, `main..rig/c1` measured the tag — and a branch holding
 * unmerged work read as "nothing ahead" and was moved.
 */
export function divergence (root, branch, base) {
  const ref = branch.startsWith('refs/') ? branch : `refs/heads/${branch}`
  const ahead = tryGit(['rev-list', '--count', `${base}..${ref}`], root)
  const behind = tryGit(['rev-list', '--count', `${ref}..${base}`], root)
  return { ahead: ahead.ok ? Number(ahead.out) : 0, behind: behind.ok ? Number(behind.out) : 0 }
}

export function ensureDetachedWorktree (root, cfg, id, ref) {
  const path = worktreePath(root, cfg, id)
  mkdirSync(worktreeBase(root, cfg), { recursive: true })
  // Resolve the ref in the MAIN checkout, once. `HEAD` or `HEAD~1` resolved inside the QA worktree
  // means "the QA worktree's own last pin", so re-pinning to HEAD used to stay on the old commit
  // while printing "pinned to HEAD".
  const sha = git(['rev-parse', '--verify', `${ref}^{commit}`], root)
  const existing = listWorktrees(root).find(w => w.path === path)
  if (existing) {
    // Re-pin it, so `rig qa` twice in a row measures the newer commit rather than lying quietly.
    git(['checkout', '--detach', sha], path)
    return { path, created: false, sha: git(['rev-parse', 'HEAD'], path) }
  }
  git(['worktree', 'add', '--detach', path, sha], root)
  return { path, created: true, sha: git(['rev-parse', 'HEAD'], path) }
}

/** Files this worktree has touched relative to base: committed + working tree + staged. */
export function touchedFiles (worktree, base) {
  const set = new Set()
  const committed = tryGit(['diff', '--name-only', `${base}...HEAD`], worktree)
  if (committed.ok) committed.out.split('\n').filter(Boolean).forEach(f => set.add(f))
  for (const p of porcelainPaths(worktree)) set.add(p)
  return [...set]
}

/**
 * Paths this worktree has DELETED relative to base — staged, unstaged or committed.
 *
 * A deletion needs its own answer. A cross-slice edit is someone reaching where they should not,
 * and a refusal reads as the tool doing its job. A cross-slice deletion is usually someone who
 * does not know they touched the file at all, and the same refusal reads as a nuisance in the way
 * of a commit — right up until it turns out to have been the only copy of something.
 */
export function deletedFiles (cwd, base) {
  const out = new Set()
  const committed = tryGit(['diff', '--name-status', '--diff-filter=D', `${base}...HEAD`], cwd)
  if (committed.ok) committed.out.split('\n').filter(Boolean).forEach(l => out.add(l.split('\t').pop()))
  const r = gitRaw(['-c', 'core.quotePath=false', 'status', '--porcelain', '-uall'], cwd)
  if (r.ok) {
    for (const line of r.out.split('\n').filter(Boolean)) {
      if (line[0] === 'D' || line[1] === 'D') out.add(line.slice(3))
    }
  }
  return [...out]
}

export function stagedFiles (cwd) {
  const r = tryGit(['diff', '--cached', '--name-only'], cwd)
  return r.ok ? r.out.split('\n').filter(Boolean) : []
}

export function dirtyFiles (cwd) { return porcelainPaths(cwd) }

/**
 * Parse `git status --porcelain`. The first two columns are status codes, the third is a space,
 * and the path starts at column 4 — so this must read UNtrimmed output. `core.quotePath=false`
 * keeps non-ASCII filenames from coming back C-escaped.
 */
export function porcelainPaths (cwd) {
  const r = gitRaw(['-c', 'core.quotePath=false', 'status', '--porcelain', '-uall'], cwd)
  if (!r.ok) return []
  return r.out.split('\n').filter(Boolean).map(line => {
    const p = line.slice(3)
    // rename and copy lines read `R  old -> new`; the new path is the one that exists.
    return p.includes(' -> ') ? p.split(' -> ')[1] : p
  })
}
