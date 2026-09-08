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

/** Create a worktree on a branch, reusing it if it already exists. Never destroys work. */
export function ensureWorktree (root, cfg, id, base) {
  const path = worktreePath(root, cfg, id)
  const branch = cfg.branchPrefix + id
  mkdirSync(worktreeBase(root, cfg), { recursive: true })

  const existing = listWorktrees(root).find(w => w.path === path)
  if (existing) return { path, branch: existing.branch, created: false }

  if (existsSync(path)) throw new Error(`${path} exists but is not a registered worktree. Move it aside; the rig will not delete it for you.`)

  const branchExists = tryGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], root).ok
  if (branchExists) git(['worktree', 'add', path, branch], root)
  else git(['worktree', 'add', '-b', branch, path, base], root)
  return { path, branch, created: true }
}

export function ensureDetachedWorktree (root, cfg, id, ref) {
  const path = worktreePath(root, cfg, id)
  mkdirSync(worktreeBase(root, cfg), { recursive: true })
  const existing = listWorktrees(root).find(w => w.path === path)
  if (existing) {
    // Re-pin it, so `rig qa` twice in a row measures the newer HEAD rather than lying quietly.
    git(['checkout', '--detach', ref], path)
    return { path, created: false, sha: git(['rev-parse', 'HEAD'], path) }
  }
  git(['worktree', 'add', '--detach', path, ref], root)
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
