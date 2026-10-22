// One organized fold, at the end. While reviews settle, fix commits stay plain: a reviewer reads the
// fix on its own, and nobody's sha moves under them. Once, at the end, `rig fold` folds each fix into
// the commit that owns it, and proves the fold lost nothing:
//
//   - the folded tip's tree must equal the old tip's tree (which already held every fix): a fold is
//     a rewrite of history, never of content, so `git diff old new` must be empty or it is undone;
//   - every new commit is checked out on its own and the test command run, exit recorded, so each
//     commit in the stack boots and passes alone (`git rebase -x`, without touching the branch);
//   - the new shas are stamped old → new in .rig/fold.json, so a verdict recorded on an old sha is
//     visibly an old sha.
//
// The rebase is the plain `git rebase -i` engine with a todo list written here, not by an editor:
// deterministic, non-interactive, and onto the stack's own merge base, so a fold never also pulls
// the upstream in (that is `rig rebase`, a different act with a different review).

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { git, tryGit, tryRun } from './sh.js'
import { rigDir } from './rigdir.js'
import { ensureDetachedWorktree, worktreePath } from './worktrees.js'

const FIX = /^(fixup|squash|amend)! /

/** The commits on HEAD since `mergeBase`, oldest first: { sha, subject, parents }. */
export function stackCommits(cwd, mergeBase, head = 'HEAD') {
  const r = tryGit(['log', '--reverse', '--format=%H%x00%P%x00%s', `${mergeBase}..${head}`], cwd)
  if (!r.ok || !r.out) return []
  return r.out.split('\n').map((l) => {
    const [sha, parents, subject] = l.split('\0')
    return { sha, subject, parents: parents.split(' ').filter(Boolean) }
  })
}

/** Files a commit changed. */
const filesOf = (cwd, sha) =>
  (tryGit(['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha], cwd).out || '').split('\n').filter(Boolean)

/**
 * Which commit each fix folds into, and the rebase todo that does it.
 *
 * A `fixup!`/`squash!`/`amend!` subject names its owner the way git does: the newest earlier commit
 * whose subject starts with the rest (prefixes stripped, so `fixup! fixup! X` lands on X), or whose
 * sha starts with it. A commit passed as `--fix <sha>` names its owner after `=` (`--fix a1b2=c3d4`),
 * or is given to the newest earlier non-fix commit that touched any file it touches (absorb's rule).
 *
 * @returns {{ commits, owners: {sha, subject, fixes: {sha, subject, how}[]}[], todo: string[], errors: string[] }}
 */
export function planFold(cwd, commits, fixes = []) {
  const errors = []
  const merges = commits.filter((c) => c.parents.length > 1)
  if (merges.length) errors.push(`the stack has merge commits (${merges.map((c) => c.sha.slice(0, 7)).join(', ')}): fold a linear stack`)

  const explicit = new Map()
  for (const f of fixes) {
    const [want, ownerWant] = String(f).split('=')
    const c = commits.find((x) => x.sha.startsWith(want))
    if (!c) {
      errors.push(`--fix ${want} is not a commit on this stack`)
      continue
    }
    explicit.set(c.sha, ownerWant || null)
  }
  const isFix = (c) => FIX.test(c.subject) || explicit.has(c.sha)
  const howOf = (c) => {
    const m = FIX.exec(c.subject)
    return !m || m[1] === 'fixup' ? 'fixup' : m[1] === 'squash' ? 'squash' : 'fixup -C'
  }

  const ownerOf = new Map()
  commits.forEach((c, i) => {
    if (!isFix(c)) return
    const earlier = commits.slice(0, i).filter((x) => !isFix(x))
    let owner = null
    if (explicit.has(c.sha) && explicit.get(c.sha)) {
      const want = explicit.get(c.sha)
      owner = earlier.find((x) => x.sha.startsWith(want))
      if (!owner) errors.push(`--fix ${c.sha.slice(0, 7)}=${want}: ${want} is not an earlier commit on this stack`)
    } else if (FIX.test(c.subject)) {
      const target = c.subject.replace(/^((fixup|squash|amend)! )+/, '')
      owner = [...earlier].reverse().find((x) => x.subject.startsWith(target) || (target.length >= 4 && x.sha.startsWith(target)))
      if (!owner) errors.push(`${c.sha.slice(0, 7)} "${c.subject}": no earlier commit on this stack has that subject`)
    } else {
      const touched = new Set(filesOf(cwd, c.sha))
      owner = [...earlier].reverse().find((x) => filesOf(cwd, x.sha).some((f) => touched.has(f)))
      if (!owner)
        errors.push(
          `--fix ${c.sha.slice(0, 7)}: no earlier commit touches the same files; name the owner with --fix ${c.sha.slice(0, 7)}=<sha>`,
        )
    }
    if (owner) ownerOf.set(c.sha, owner.sha)
  })

  const owners = commits
    .filter((c) => !isFix(c))
    .map((c) => ({
      sha: c.sha,
      subject: c.subject,
      fixes: commits.filter((f) => ownerOf.get(f.sha) === c.sha).map((f) => ({ sha: f.sha, subject: f.subject, how: howOf(f) })),
    }))
  const todo = owners.flatMap((o) => [`pick ${o.sha} ${o.subject}`, ...o.fixes.map((f) => `${f.how} ${f.sha} ${f.subject}`)])
  return { commits, owners, todo, errors, fixCount: ownerOf.size }
}

/** The environment a rewrite runs in: no editor, and the commit identity from git config only. */
function rewriteEnv(todoFile) {
  const env = { ...process.env }
  // A session's environment may carry another address; the rewritten commits are the owner's.
  for (const k of [
    'GIT_AUTHOR_NAME',
    'GIT_AUTHOR_EMAIL',
    'GIT_COMMITTER_NAME',
    'GIT_COMMITTER_EMAIL',
    'GIT_AUTHOR_DATE',
    'GIT_COMMITTER_DATE',
  ])
    delete env[k]
  env.GIT_SEQUENCE_EDITOR = `cp '${todoFile.replace(/'/g, "'\\''")}'`
  env.GIT_EDITOR = 'true'
  return env
}

/**
 * Fold the fix commits on the branch checked out at `cwd` into their owners.
 *
 * opts: { base, fixes, each, timeoutMs, walk, root, cfg }
 * hooks (tests only): { todo(lines) → lines } rewrites the todo before the rebase; { treeCheck: false }
 * turns the tree comparison off, which is exactly the defect the check exists to catch.
 *
 * @returns {{ state: 'folded'|'nothing'|'refused', why?, oldTip, newTip, mergeBase, map, walk, diff }}
 */
export function fold(cwd, opts = {}, hooks = {}) {
  const { base, fixes = [], each = null, timeoutMs = 20 * 60_000, root = cwd, cfg = {} } = opts
  const refuse = (why, extra = {}) => ({ state: 'refused', why, ...extra })

  const branch = tryGit(['symbolic-ref', '--short', '-q', 'HEAD'], cwd)
  if (!branch.ok || !branch.out) return refuse('HEAD is detached: check out the branch to fold')
  const gitDir = git(['rev-parse', '--absolute-git-dir'], cwd)
  if (existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply')))
    return refuse('a rebase is already in progress here: finish or abort it first')
  const dirty = tryGit(['status', '--porcelain', '--untracked-files=no'], cwd)
  if (dirty.out) return refuse(`uncommitted changes: commit them (a fix commit is fine) before folding\n${dirty.out}`)
  if (!tryGit(['rev-parse', '--verify', '-q', `${base}^{commit}`], cwd).ok) return refuse(`${base} is not a commit here: pass --base <ref>`)

  const oldTip = git(['rev-parse', 'HEAD'], cwd)
  const oldTree = git(['rev-parse', 'HEAD^{tree}'], cwd)
  const mergeBase = git(['merge-base', base, 'HEAD'], cwd)
  const planned = planFold(cwd, stackCommits(cwd, mergeBase), fixes)
  if (planned.errors.length) return refuse(planned.errors.join('\n'), { oldTip, mergeBase, planned })
  if (!planned.fixCount) return { state: 'nothing', oldTip, newTip: oldTip, mergeBase, planned, map: [], walk: [] }

  const todo = hooks.todo ? hooks.todo(planned.todo) : planned.todo
  const dir = mkdtempSync(join(tmpdir(), 'rig-fold-'))
  const todoFile = join(dir, 'todo')
  writeFileSync(todoFile, todo.join('\n') + '\n')
  const putBack = () => {
    if (existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply'))) tryGit(['rebase', '--abort'], cwd)
    if (git(['rev-parse', 'HEAD'], cwd) !== oldTip) git(['reset', '-q', '--hard', oldTip], cwd)
  }
  let rb
  try {
    rb = tryRun(
      'git',
      ['-c', 'rebase.autoSquash=false', '-c', 'rebase.updateRefs=false', '-c', 'rebase.instructionFormat=%s', 'rebase', '-i', mergeBase],
      { cwd, env: rewriteEnv(todoFile) },
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  if (!rb.ok) {
    putBack()
    return refuse(
      `the rebase stopped; the branch is back at ${oldTip.slice(0, 7)}\n${(rb.err || rb.out).split('\n').slice(0, 12).join('\n')}`,
      {
        oldTip,
        mergeBase,
        planned,
      },
    )
  }
  const newTip = git(['rev-parse', 'HEAD'], cwd)
  const newTree = git(['rev-parse', 'HEAD^{tree}'], cwd)
  if (hooks.treeCheck !== false && newTree !== oldTree) {
    const diff = tryGit(['diff', '--stat', oldTip, newTip], cwd).out
    putBack()
    return refuse(
      `the folded tree differs from the old tip's tree, so the fold dropped or changed content. The branch is back at ${oldTip.slice(0, 7)}.\n${diff}`,
      { oldTip, mergeBase, planned, diff, droppedAt: newTip },
    )
  }

  const after = stackCommits(cwd, mergeBase)
  const map =
    after.length === planned.owners.length
      ? planned.owners.map((o, i) => ({ old: [o.sha, ...o.fixes.map((f) => f.sha)], new: after[i].sha, subject: after[i].subject }))
      : after.map((c) => ({ old: [], new: c.sha, subject: c.subject }))
  const walk = each ? walkCommits(root, cfg, after, each, timeoutMs) : []
  return { state: 'folded', branch: branch.out, oldTip, newTip, tree: newTree, mergeBase, map, walk, each }
}

/**
 * Check each commit out on its own in a scratch worktree and run `cmd` there; returns
 * [{ sha, subject, exit, ms, tail }]. The display and clipboard are unset, like a QA run.
 */
export function walkCommits(root, cfg, commits, cmd, timeoutMs = 20 * 60_000) {
  const out = []
  const env = { ...process.env }
  delete env.DISPLAY
  delete env.WAYLAND_DISPLAY
  const path = worktreePath(root, cfg, 'fold-walk')
  try {
    for (const c of commits) {
      ensureDetachedWorktree(root, cfg, 'fold-walk', c.sha)
      const t0 = Date.now()
      const r = spawnSync('sh', ['-c', cmd], { cwd: path, env, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL' })
      const exit = r.error?.code === 'ETIMEDOUT' ? 124 : (r.status ?? 128)
      const tail = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-5).join('\n')
      out.push({ sha: c.sha, subject: c.subject, exit, ms: Date.now() - t0, tail })
    }
  } finally {
    tryGit(['worktree', 'remove', '--force', path], root)
  }
  return out
}

export const foldStampPath = (root) => join(root, '.rig', 'fold.json')

/** Every fold stamped so far: { folds: [...] }, newest last. */
export function readFolds(root) {
  const p = foldStampPath(root)
  if (!existsSync(p)) return { folds: [] }
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'))
    return Array.isArray(j.folds) ? j : { folds: [] }
  } catch {
    return { folds: [] }
  }
}

/** Stamp a fold: old → new shas, the tree both tips share, and every walked exit. */
export function stampFold(root, result) {
  rigDir(root)
  const all = readFolds(root)
  const entry = {
    at: new Date().toISOString(),
    branch: result.branch,
    mergeBase: result.mergeBase,
    oldTip: result.oldTip,
    newTip: result.newTip,
    tree: result.tree,
    each: result.each || null,
    map: result.map,
    walk: result.walk.map(({ sha, exit, ms }) => ({ sha, exit, ms })),
  }
  all.folds.push(entry)
  writeFileSync(foldStampPath(root), JSON.stringify(all, null, 2) + '\n')
  return entry
}
