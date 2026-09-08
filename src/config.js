import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { git, tryGit } from './sh.js'

export const DEFAULTS = {
  plan: 'PLAN.md',
  branchPrefix: 'rig/',
  worktreeDir: '../.rig-worktrees',
  portBase: 5180,
  qaPort: 5199,
  launch: 'claude',
  devCommand: null
}

export function repoRoot (cwd = process.cwd()) {
  const r = tryGit(['rev-parse', '--show-toplevel'], cwd)
  if (!r.ok) throw new Error('Not inside a git repository. The rig slices a repo; there has to be one.')
  return r.out
}

export function configPath (root) { return join(root, '.rig', 'config.json') }

export function loadConfig (root) {
  const p = configPath(root)
  if (!existsSync(p)) return { ...DEFAULTS }
  return { ...DEFAULTS, ...JSON.parse(readFileSync(p, 'utf8')) }
}

export function saveConfig (root, cfg) {
  mkdirSync(join(root, '.rig'), { recursive: true })
  writeFileSync(configPath(root), JSON.stringify(cfg, null, 2) + '\n')
}

export function sessionName (root) {
  return 'rig-' + root.split('/').pop().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function currentBranch (cwd) { return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) }
