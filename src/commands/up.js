import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot, loadConfig, sessionName, currentBranch } from '../config.js'
import { loadPlan } from '../plan.js'
import { ensureWorktree } from '../worktrees.js'
import { briefFor } from '../brief.js'
import { reportPath } from '../reports.js'
import { hasTmux, sessionExists, newSession, newWindow, listWindows } from '../tmux.js'
import { git } from '../sh.js'

export default function up (args) {
  const root = repoRoot()
  const cfg = loadConfig(root)
  const plan = loadPlan(join(root, cfg.plan))
  const dry = args.includes('--dry-run')
  const noLaunch = args.includes('--no-launch') || dry

  const base = arg(args, '--base') || currentBranch(root)
  const baseSha = git(['rev-parse', '--short', base], root)
  console.log(`plan: ${plan.title}`)
  console.log(`base: ${base} @ ${baseSha}`)
  console.log(`${plan.agents.length} slice(s)\n`)

  const session = sessionName(root)
  const made = []

  for (const agent of plan.agents) {
    if (dry) {
      console.log(`  ${agent.id}  would branch ${cfg.branchPrefix}${agent.id} from ${base}, owning ${agent.owns.length} pattern(s)`)
      continue
    }
    const wt = ensureWorktree(root, cfg, agent.id, base)
    const report = reportPath(agent.id)
    mkdirSync(join(wt.path, '.rig'), { recursive: true })
    mkdirSync(join(wt.path, 'docs'), { recursive: true })
    const brief = briefFor(plan, agent, {
      branch: wt.branch, path: wt.path, planPath: cfg.plan, reportPath: report
    })
    writeFileSync(join(wt.path, '.rig', 'BRIEF.md'), brief)
    made.push({ agent, wt })
    console.log(`  ${agent.id}  ${wt.created ? 'created' : 'reused '}  ${wt.branch}  ->  ${wt.path}`)
  }

  if (dry) { console.log('\ndry run — nothing created'); return }

  if (!noLaunch) {
    if (!hasTmux()) {
      console.log('\ntmux not found — worktrees and briefs are ready, but nothing was launched.')
    } else {
      const cmd = `${cfg.launch} "Read .rig/BRIEF.md and follow it."`
      if (!sessionExists(session)) {
        const first = made[0]
        newSession(session, first.agent.id, first.wt.path, cmd)
        for (const m of made.slice(1)) newWindow(session, m.agent.id, m.wt.path, cmd)
      } else {
        const have = new Set(listWindows(session))
        for (const m of made) if (!have.has(m.agent.id)) newWindow(session, m.agent.id, m.wt.path, cmd)
      }
      console.log(`\ntmux session: ${session}  (windows: ${listWindows(session).join(', ')})`)
      console.log(`attach with:  tmux attach -t ${session}`)
      console.log('\nDo not type into an agent pane — keystrokes interrupt the turn. Read one with:')
      console.log(`  tmux capture-pane -p -t ${session}:<id>`)
    }
  }

  console.log(`\nnext: \`rig status\` to watch slices, \`rig qa\` to grade a commit.`)
}

function arg (args, name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}
