import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { git, tryGit } from './sh.js'

export const DEFAULTS = {
  plan: 'PLAN.md',
  branchPrefix: 'rig/',
  worktreeDir: '../.rig-worktrees',
  portBase: 5180,
  qaPort: 5199,
  launch: 'claude --model claude-fable-5-1 --effort low',
  terminal: 'auto', // auto | herdr | tmux
  devCommand: null,
  // The app registry slug (`~/.claude/apps/<slug>.md`); `rig init` fills it in, `rig finish` jots under it.
  slug: null,
  // Open one GitHub issue per slice at `rig up` (when gh and a remote exist); `--no-issues` skips.
  issues: true
}

export function repoRoot (cwd = process.cwd()) {
  const r = tryGit(['rev-parse', '--show-toplevel'], cwd)
  if (!r.ok) throw new Error('Not inside a git repository. The rig slices a repo; there has to be one.')
  return r.out
}

/**
 * The MAIN checkout, even when called from inside a linked worktree.
 *
 * Everything the rig configures lives with the main repo: `.rig/config.json` is gitignored so a
 * worktree never has one, `worktreeDir` is a path relative to the main root, and PLAN.md is the
 * contract as it stands now rather than as it stood when a branch was cut.
 *
 * Without this, every rig command run from inside a worktree found no config, silently fell back
 * to DEFAULTS, and reported a worktree path, a port base and a branch prefix that were not the
 * ones in use — with no indication anything had gone wrong. An agent following that brief looks
 * for its own worktree in a directory that does not exist.
 *
 * `--git-common-dir` is the main repo's `.git` from anywhere inside it, linked worktrees included.
 */
export function mainRoot (cwd = process.cwd()) {
  const r = tryGit(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd)
  if (!r.ok) return repoRoot(cwd)
  const common = r.out
  // A bare-ish or unusual layout can answer something that is not `<root>/.git`; fall back rather
  // than confidently returning a wrong directory.
  return common.endsWith('/.git') || common.endsWith('\\.git') ? dirname(common) : repoRoot(cwd)
}

export function configPath (root) { return join(root, '.rig', 'config.json') }

export function loadConfig (root) {
  const p = configPath(root)
  if (existsSync(p)) return withWorktreeDir(root, JSON.parse(readFileSync(p, 'utf8')))
  // Called from inside a linked worktree, which has no .rig/ of its own.
  const shared = configPath(mainRoot(root))
  if (shared !== p && existsSync(shared)) return withWorktreeDir(root, JSON.parse(readFileSync(shared, 'utf8')))
  return withWorktreeDir(root, {})
}

/**
 * Where a repo's worktrees go when its config does not say: `../.rig-worktrees/<repo dir name>`.
 *
 * The 2.0 default was `../.rig-worktrees`, one directory shared by every repo under the same parent.
 * Two rigs in sibling repos then wrote their `qa` (and `c1`, `c2`…) worktrees to the same path: on
 * 2026-09-15 `rig qa` in this repo collided with another project's QA worktree and refused. A
 * per-repo subdirectory keeps them apart while still leaving the checkouts outside the repo, where
 * `npm test`, formatters and `git status` never see them. An explicit `worktreeDir` is honoured as is.
 */
export function defaultWorktreeDir (root) {
  let main = root
  try { main = mainRoot(root) } catch { /* not a git repo: name the directory itself */ }
  return `${DEFAULTS.worktreeDir}/${basename(main)}`
}

function withWorktreeDir (root, fileCfg) {
  const cfg = { ...DEFAULTS, ...fileCfg }
  // 2.0's `rig init` saved all of DEFAULTS, so every repo it initialised carries the literal shared
  // value. That is the value that collided; it reads as "unset" and gets the per-repo default. Any
  // other explicit value is the person's choice. `rig init` writes the resolved path back.
  if (!fileCfg.worktreeDir || fileCfg.worktreeDir === DEFAULTS.worktreeDir) cfg.worktreeDir = defaultWorktreeDir(root)
  return cfg
}

export function saveConfig (root, cfg) {
  mkdirSync(join(root, '.rig'), { recursive: true })
  writeFileSync(configPath(root), JSON.stringify(cfg, null, 2) + '\n')
}

export function sessionName (root) {
  return 'rig-' + root.split('/').pop().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function currentBranch (cwd) { return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) }

/**
 * The branch this checkout is on, or `null` when there is none to name: HEAD is unborn (a fresh
 * repo before its first commit) or detached without a branch. `currentBranch` throws in the first
 * case, which is how the pre-commit guard refused the very first commit of every repo it was
 * installed in — the hook ran, git had no HEAD to resolve, and the error read as a refusal.
 */
export function currentBranchOrNull (cwd) {
  const r = tryGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  if (!r.ok || !r.out || r.out === 'HEAD') return null
  return r.out
}

/** 'unborn' (no commit yet), 'detached' (a commit but no branch), or the branch name. */
export function headState (cwd) {
  const branch = currentBranchOrNull(cwd)
  if (branch) return branch
  // `--verify HEAD` fails only when HEAD points at nothing: a fresh repo. A detached HEAD resolves.
  return tryGit(['rev-parse', '--verify', '-q', 'HEAD'], cwd).ok ? 'detached' : 'unborn'
}
