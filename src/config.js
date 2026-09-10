import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { git, tryGit } from './sh.js'

export const DEFAULTS = {
  plan: 'PLAN.md',
  branchPrefix: 'rig/',
  worktreeDir: '../.rig-worktrees',
  portBase: 5180,
  qaPort: 5199,
  launch: 'claude',
  terminal: 'auto', // auto | herdr | tmux
  devCommand: null
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
  if (existsSync(p)) return { ...DEFAULTS, ...JSON.parse(readFileSync(p, 'utf8')) }
  // Called from inside a linked worktree, which has no .rig/ of its own.
  const shared = configPath(mainRoot(root))
  if (shared !== p && existsSync(shared)) return { ...DEFAULTS, ...JSON.parse(readFileSync(shared, 'utf8')) }
  return { ...DEFAULTS }
}

export function saveConfig (root, cfg) {
  mkdirSync(join(root, '.rig'), { recursive: true })
  writeFileSync(configPath(root), JSON.stringify(cfg, null, 2) + '\n')
}

export function sessionName (root) {
  return 'rig-' + root.split('/').pop().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function currentBranch (cwd) { return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) }
