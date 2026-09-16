import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync, readdirSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
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

/**
 * A detached worktree pinned to `ref`, cleaned first. `id` is the directory name under the
 * worktree base ("qa", "qa-2", …).
 *
 * The ref is resolved in the MAIN checkout, once. `HEAD` or `HEAD~1` resolved inside the QA
 * worktree means "the QA worktree's own last pin", so re-pinning to HEAD used to stay on the old
 * commit while printing "pinned to HEAD".
 *
 * Before the pin, the tree is reset and cleaned, and what was reset is returned by path so a
 * person sees it. A QA run refused checkout three ways in one night: a tracked evidence log a test
 * wrote, untracked files from `npm install`, and gate screenshots. A QA worktree holds nobody's
 * work, so nothing in it can be lost, but the reset is refused unless the worktree really is one:
 * under this project's worktree base and detached. A slice or the main checkout is never reset.
 *
 * `opts.fresh` adds `-x` (ignored files go too; `node_modules` is reinstalled). `opts.keep` is a
 * list of paths to spare from the clean, used for the run lock.
 */
export function ensureDetachedWorktree (root, cfg, id, ref, opts = {}) {
  const base = worktreeBase(root, cfg)
  const path = worktreePath(root, cfg, id)
  mkdirSync(base, { recursive: true })
  const sha = git(['rev-parse', '--verify', `${ref}^{commit}`], root)
  const existing = findWorktree(root, path)
  if (existing) {
    if (!existing.detached) {
      throw new Error(`${path} is on branch ${existing.branch}, not a detached QA worktree: refusing to reset it. ` +
        'A QA worktree holds nobody\'s work; a branch checkout might.')
    }
    if (!isUnder(path, base)) throw new Error(`${path} is not under ${base}: refusing to reset a worktree outside this project's QA area.`)
    const cleaned = cleanWorktree(path, opts)
    // Re-pin it, so `rig qa` twice in a row measures the newer commit rather than lying quietly.
    git(['checkout', '--detach', sha], path)
    return { path, created: false, sha: git(['rev-parse', 'HEAD'], path), ...cleaned }
  }
  if (existsSync(path)) throw new Error(`${path} exists but is not a registered worktree. Move it aside; the rig will not delete it for you.`)
  git(['worktree', 'add', '--detach', path, sha], root)
  return { path, created: true, sha: git(['rev-parse', 'HEAD'], path), reset: [], removed: [] }
}

/** The registered worktree at `path`, matched by real path so a symlinked base still finds it. */
export function findWorktree (root, path) {
  const want = safeReal(path)
  return listWorktrees(root).find(w => w.path === path || safeReal(w.path) === want) || null
}

function safeReal (p) { try { return realpathSync(p) } catch { return resolve(p) } }
function isUnder (path, base) {
  const rel = relative(safeReal(base), safeReal(path))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * `git reset --hard` then `git clean -fd` in a worktree, returning what went: `reset` is the
 * tracked files that had been modified or deleted, `removed` is the untracked (and with `fresh`,
 * ignored) files deleted. Not `-x` by default: `node_modules` stays, so a Playwright suite does
 * not reinstall every run.
 */
export function cleanWorktree (path, { fresh = false, keep = [] } = {}) {
  const before = porcelainLines(path)
  const reset = before.filter(l => !l.startsWith('??') && !l.startsWith('!!')).map(pathOf)
  git(['reset', '-q', '--hard'], path)
  const flags = '-fd' + (fresh ? 'x' : '')
  const excludes = keep.flatMap(k => ['-e', k])
  const out = tryGit(['clean', flags, ...excludes], path)
  const removed = out.ok ? out.out.split('\n').filter(l => l.startsWith('Removing ')).map(l => l.slice(9)) : []
  return { reset, removed }
}

// --- QA run locks --------------------------------------------------------------------------------
//
// One shared QA worktree was re-pinned by a second slice while the first slice's suite was still
// running in it, and that run died mid-way. So a run takes `<worktreeBase>/qa` when free, else
// `qa-2`, `qa-3`…; "free" means no live pid in the slot's lock. The lock lives BESIDE the worktree
// (`<worktreeBase>/<id>.lock`), not inside it: a lock inside the tree could only be written after
// `git worktree add`, and two runs starting in the same instant both created the tree, or one
// crashed on the add. Beside it, the lock is taken first with `wx`, so exactly one run owns a slot
// before anything touches git, and nothing a clean does can delete it.

export const qaLockPath = path => path + '.lock'

/** { live, pid } for the lock of a QA worktree path. A pid that is not running is not live. */
export function readQaLock (path) {
  const p = qaLockPath(path)
  if (!existsSync(p)) return { live: false, pid: null }
  const pid = Number(readFileSync(p, 'utf8').trim())
  if (!Number.isInteger(pid) || pid <= 0) return { live: false, pid: null }
  return { live: pidAlive(pid), pid }
}

export function pidAlive (pid) {
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

/** Every QA slot this project has: [{ id, path, lock: { live, pid } }], for `rig down` and status. */
export function qaSlots (root, cfg) {
  const base = worktreeBase(root, cfg)
  if (!existsSync(base)) return []
  return readdirSync(base).filter(n => /^qa(-\d+)?$/.test(n)).sort((a, b) => slotIndex(a) - slotIndex(b))
    .map(id => { const path = join(base, id); return { id, path, lock: readQaLock(path) } })
}
const slotIndex = id => id === 'qa' ? 1 : Number(id.slice(3))

/**
 * Pick, lock, clean and pin a QA worktree for this process. Returns the worktree, the names of the
 * files the clean touched, `notes` for the person, and `release()`.
 */
export function acquireQaWorktree (root, cfg, ref, opts = {}) {
  const notes = []
  mkdirSync(worktreeBase(root, cfg), { recursive: true })
  for (let n = 1; n <= 64; n++) {
    const id = n === 1 ? 'qa' : `qa-${n}`
    const path = worktreePath(root, cfg, id)
    const lock = readQaLock(path)
    if (lock.live) { notes.push(`${id} is in use by pid ${lock.pid}`); continue }
    if (lock.pid) { notes.push(`removed a stale lock in ${id} (pid ${lock.pid} is not running)`); rmSync(qaLockPath(path), { force: true }) }
    const existing = findWorktree(root, path)
    // Somebody's branch checkout in a QA slot is left exactly as it is; the run takes the next slot.
    if (existing && !existing.detached) { notes.push(`${id} is on branch ${existing.branch}, not a QA worktree: left alone`); continue }
    if (!existing && existsSync(path)) { notes.push(`${id} exists but is not a registered worktree: left alone`); continue }
    // The lock first, before any git: `wx` means exactly one of two simultaneous runs gets it.
    try { writeFileSync(qaLockPath(path), String(process.pid) + '\n', { flag: 'wx' }) } catch (e) {
      if (e.code === 'EEXIST') { notes.push(`${id} was taken while we looked`); continue }
      throw e
    }
    const release = () => {
      try { if (readFileSync(qaLockPath(path), 'utf8').trim() === String(process.pid)) rmSync(qaLockPath(path), { force: true }) } catch {}
    }
    let wt
    try { wt = ensureDetachedWorktree(root, cfg, id, ref, opts) } catch (e) {
      // A run that lost the race by a hair made the tree under us; that slot is theirs.
      if (/already exists|is a missing but|already checked out/.test(e.message)) { release(); notes.push(`${id} was taken while we looked`); continue }
      release(); throw e
    }
    return { ...wt, id, index: n - 1, notes, release }
  }
  throw new Error('every QA worktree slot (qa … qa-64) is in use; that is not a build, that is a stampede')
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
  return porcelainLines(cwd).map(pathOf)
}

/** Raw `git status --porcelain -uall` lines, untrimmed. */
export function porcelainLines (cwd) {
  const r = gitRaw(['-c', 'core.quotePath=false', 'status', '--porcelain', '-uall'], cwd)
  return r.ok ? r.out.split('\n').filter(Boolean) : []
}

function pathOf (line) {
  const p = line.slice(3)
  // rename and copy lines read `R  old -> new`; the new path is the one that exists.
  return p.includes(' -> ') ? p.split(' -> ')[1] : p
}
