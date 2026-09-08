import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { repoRoot, loadConfig, currentBranch } from '../config.js'
import { loadPlan, matchesAny } from '../plan.js'
import { worktreePath, touchedFiles, stagedFiles } from '../worktrees.js'
import { isOwnReport } from '../reports.js'

// Enforces the one rule that keeps a multi-agent build from turning into a merge disaster:
// you edit your slice and nothing else. Runs as a pre-commit hook (`rig init --hook`) or by hand.

export default function guard (args) {
  const root = repoRoot()
  const cfg = loadConfig(root)
  const plan = loadPlan(join(root, cfg.plan))
  const staged = args.includes('--staged')
  const base = argOf(args, '--base') || 'main'

  // Which agent am I? Either named, or inferred from the branch we are standing on.
  const named = argOf(args, '--agent')
  const branch = currentBranch(process.cwd())
  const inferred = branch.startsWith(cfg.branchPrefix) ? branch.slice(cfg.branchPrefix.length) : null
  const id = named || inferred

  const check = (agent, files, where) => {
    // An agent's own report is exempt: it is deliberately tracked, deliberately outside every
    // slice, and the brief instructs the agent to commit it. Refusing it would make following the
    // brief impossible. The path carries the agent's own id, so this is not a general escape.
    const stray = files.filter(f => !matchesAny(f, agent.owns) && !f.startsWith('.rig/') && !isOwnReport(f, agent.id))
    if (!stray.length) { console.log(`\x1b[32mok\x1b[0m  ${agent.id}: ${files.length} file(s), all inside slice ${where}`); return 0 }
    console.error(`\x1b[31mREFUSED\x1b[0m  ${agent.id} reached outside its slice ${where}:`)
    for (const f of stray) console.error(`  ${f}`)
    console.error(`\n  ${agent.id} owns: ${agent.owns.join(', ')}`)
    console.error('  If the task genuinely needs this file, say so in your report and let its owner make the change.')
    return stray.length
  }

  let bad = 0
  if (id) {
    const agent = plan.agents.find(a => a.id === id)
    if (!agent) { console.error(`No slice "${id}" in ${cfg.plan}.`); process.exit(2) }
    const files = staged ? stagedFiles(process.cwd()) : touchedFiles(process.cwd(), base)
    bad += check(agent, files, staged ? '(staged)' : `(vs ${base})`)
  } else {
    // No agent context — sweep every worktree instead.
    for (const agent of plan.agents) {
      const path = worktreePath(root, cfg, agent.id)
      if (!existsSync(path)) continue
      bad += check(agent, touchedFiles(path, base), `(vs ${base})`)
    }
  }
  if (bad) process.exit(1)
}

function argOf (args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
