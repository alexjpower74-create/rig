import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot, loadConfig, sessionName } from '../config.js'
import { loadPlan } from '../plan.js'
import { worktreePath, dirtyFiles } from '../worktrees.js'
import { tryGit, git } from '../sh.js'
import { sessionExists, killSession, hasTmux } from '../tmux.js'

export default function down (args) {
  const root = repoRoot()
  const cfg = loadConfig(root)
  const plan = loadPlan(join(root, cfg.plan))
  const force = args.includes('--force')
  const ids = [...plan.agents.map(a => a.id), 'qa']

  // Refuse to tear down over uncommitted work. Branches are always kept — the rig removes
  // checkouts, never commits.
  const blocked = []
  for (const id of ids) {
    const path = worktreePath(root, cfg, id)
    if (!existsSync(path)) continue
    const dirty = dirtyFiles(path)
    if (dirty.length && id !== 'qa') blocked.push({ id, path, dirty })
  }

  if (blocked.length && !force) {
    console.error('\x1b[31mrefusing to tear down\x1b[0m — uncommitted work in:')
    for (const b of blocked) console.error(`  ${b.id}: ${b.dirty.length} file(s)  ${b.path}`)
    console.error('\nCommit it (`git commit -- <paths>`) or re-run with --force to discard the checkout.')
    process.exit(1)
  }

  if (hasTmux() && sessionExists(sessionName(root))) {
    killSession(sessionName(root))
    console.log(`killed tmux session ${sessionName(root)}`)
  }

  for (const id of ids) {
    const path = worktreePath(root, cfg, id)
    if (!existsSync(path)) continue
    const r = tryGit(['worktree', 'remove', force ? '--force' : '', path].filter(Boolean), root)
    console.log(r.ok ? `removed worktree ${id}` : `could not remove ${id}: ${r.err}`)
  }
  git(['worktree', 'prune'], root)
  console.log('\nbranches kept. `git branch --list "' + cfg.branchPrefix + '*"` to see them.')
}
