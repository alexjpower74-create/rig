import { join } from 'node:path'
import { repoRoot, loadConfig, currentBranch } from '../config.js'
import { loadPlan } from '../plan.js'
import { worktreePath } from '../worktrees.js'
import { briefFor } from '../brief.js'
import { reportPath } from '../reports.js'

// Prints the briefing so you can hand it over deliberately — paste it, or send it with whatever
// message channel your agents use. The rig will not type into a pane on your behalf.

export default function brief (args) {
  const root = repoRoot()
  const cfg = loadConfig(root)
  const plan = loadPlan(join(root, cfg.plan))
  const id = args.find(a => !a.startsWith('-'))
  if (!id) { console.error('usage: rig brief <agent-id>'); process.exit(2) }
  const agent = plan.agents.find(a => a.id === id)
  if (!agent) { console.error(`No slice "${id}" in ${cfg.plan}. Have: ${plan.agents.map(a => a.id).join(', ')}`); process.exit(2) }
  process.stdout.write(briefFor(plan, agent, {
    branch: cfg.branchPrefix + id,
    path: worktreePath(root, cfg, id),
    planPath: cfg.plan,
    reportPath: reportPath(id)
  }))
}
