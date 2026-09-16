import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { mainRoot, loadConfig, currentBranchOrNull } from '../config.js'
import { loadPlan, matchesAny } from '../plan.js'
import { worktreePath, touchedFiles, stagedFiles, deletedFiles } from '../worktrees.js'
import { isOwnReport, allReportPaths } from '../reports.js'

// Enforces the one rule that keeps a multi-agent build from turning into a merge disaster:
// you edit your slice and nothing else. Runs as a pre-commit hook (`rig init --hook`) or by hand.

export default function guard (args) {
  const root = mainRoot()
  const cfg = loadConfig(root)
  const staged = args.includes('--staged')
  const base = argOf(args, '--base') || 'main'

  // Which agent am I? Either named, or inferred from the branch we are standing on.
  const named = argOf(args, '--agent')
  const branch = currentBranchOrNull(process.cwd())
  const inferred = branch && branch.startsWith(cfg.branchPrefix) ? branch.slice(cfg.branchPrefix.length) : null
  const id = named || inferred

  // `--staged` is the pre-commit hook: it always means "this checkout's index", and only a slice has
  // an index to enforce. Both early exits happen before the plan is read, so a repo that has a hook
  // but no plan yet can still make its first commit.
  if (staged && !branch) {
    // A fresh repo: HEAD is unborn, so there is no branch to infer a slice from and nothing on a base
    // to compare against. `currentBranch()` used to throw here and the throw read as a refusal.
    console.log('first commit on an unborn branch: nothing to enforce yet')
    return
  }
  if (staged && !id) {
    // The lead committing on main (a review file, a merge). The bare `rig guard` sweep of every
    // worktree is for a person asking; a hook running it refused the lead's own commit because
    // another slice's checkout had untracked node_modules in it.
    console.log(`not a slice branch (${branch}); guard enforces slices only`)
    return
  }
  const plan = loadPlan(join(root, cfg.plan))

  const check = (agent, files, where, cwd) => {
    // An agent's own report is exempt: it is deliberately tracked, deliberately outside every
    // slice, and the brief instructs the agent to commit it. Refusing it would make following the
    // brief impossible. The path carries the agent's own id, so this is not a general escape.
    const stray = files.filter(f => !matchesAny(f, agent.owns) && !f.startsWith('.rig/') && !isOwnReport(f, agent))
    if (!stray.length) { console.log(`\x1b[32mok\x1b[0m  ${agent.id}: ${files.length} file(s), all inside slice ${where}`); return 0 }

    // Deletions get their own sentence. Somebody reaching into another slice usually knows they
    // did it; somebody deleting a file there usually does not, and the report they are removing
    // may be the only copy of another agent's reasoning.
    const deleted = new Set(cwd ? deletedFiles(cwd, base) : [])
    const declared = new Set(allReportPaths(plan))
    const goneReports = stray.filter(f => deleted.has(f) && declared.has(f))

    console.error(`\x1b[31mREFUSED\x1b[0m  ${agent.id} reached outside its slice ${where}:`)
    for (const f of stray) console.error(`  ${f}${deleted.has(f) ? '  \x1b[31m(deleted)\x1b[0m' : ''}`)
    if (goneReports.length) {
      console.error(`\n  \x1b[33mThat is another agent's build report, and you are deleting it.\x1b[0m`)
      console.error('  Reports are tracked because they outlive the worktree that wrote them, and')
      console.error('  they are usually the only record of why the code looks the way it does.')
      console.error('  If you did not mean to touch it:  git checkout -- ' + goneReports.join(' '))
    }
    console.error(`\n  ${agent.id} owns: ${agent.owns.join(', ')}`)
    console.error('  If the task genuinely needs this file, say so in your report and let its owner make the change.')
    return stray.length
  }

  let bad = 0
  if (id) {
    const agent = plan.agents.find(a => a.id === id)
    if (!agent) { console.error(`No slice "${id}" in ${cfg.plan}.`); process.exit(2) }
    const files = staged ? stagedFiles(process.cwd()) : touchedFiles(process.cwd(), base)
    bad += check(agent, files, staged ? '(staged)' : `(vs ${base})`, process.cwd())
  } else {
    // No agent context — sweep every worktree instead.
    for (const agent of plan.agents) {
      const path = worktreePath(root, cfg, agent.id)
      if (!existsSync(path)) continue
      bad += check(agent, touchedFiles(path, base), `(vs ${base})`, path)
    }
  }
  if (bad) process.exit(1)
}

function argOf (args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
