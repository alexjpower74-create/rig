import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mainRoot, loadConfig, sessionName } from '../config.js'
import { loadPlan } from '../plan.js'
import { worktreePath, dirtyFiles } from '../worktrees.js'
import { tryGit, git } from '../sh.js'
import { sessionExists, killSession, hasTmux } from '../tmux.js'

export default function down (args) {
  const root = mainRoot()
  const cfg = loadConfig(root)
  const plan = loadPlan(join(root, cfg.plan))
  const force = args.includes('--force')
  const ids = [...plan.agents.map(a => a.id), 'qa']

  // Refuse to tear down over uncommitted work. Branches are always kept — the rig removes
  // checkouts, never commits.
  const blocked = []
  const reports = []
  for (const id of ids) {
    const path = worktreePath(root, cfg, id)
    if (!existsSync(path)) continue
    const dirty = dirtyFiles(path)
    if (dirty.length && id !== 'qa') blocked.push({ id, path, dirty })

    // An agent's report lives in .rig/, which is gitignored by design — so it is never "dirty",
    // never committed, and teardown would take the only copy of its reasoning with it. The work
    // is protected by the commit check above; the account of the work was not protected by
    // anything. On this project those reports ran to 500 lines and were the most detailed record
    // of how the thing was built.
    // Belt and braces behind the real fix, which is briefs pointing reports at a tracked path.
    // Older builds wrote them here, and an agent can always ignore where it was told to write.
    const dir = join(path, '.rig')
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        if (/^report-.*\.md$/.test(f)) reports.push({ id, file: join(dir, f) })
      }
    }
  }

  if (reports.length && !args.includes('--discard-reports')) {
    console.error(`\x1b[33m${reports.length} agent report(s) live only inside the worktrees:\x1b[0m`)
    for (const r of reports) console.error(`  ${r.file}`)
    console.error('\nThese are gitignored, so they were never committed and removing the worktrees deletes them.')
    console.error('Copy them somewhere first, then re-run — or pass --discard-reports if you genuinely do not want them.')
    process.exit(1)
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
