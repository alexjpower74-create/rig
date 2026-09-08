import { join, relative } from 'node:path'
import { existsSync } from 'node:fs'
import { repoRoot, loadConfig, sessionName, currentBranch } from '../config.js'
import { loadPlan, matchesAny } from '../plan.js'
import { worktreePath, touchedFiles, dirtyFiles } from '../worktrees.js'
import { tryGit } from '../sh.js'
import { hasTmux, sessionExists, listWindows } from '../tmux.js'

const RED = s => `\x1b[31m${s}\x1b[0m`
const GRN = s => `\x1b[32m${s}\x1b[0m`
const DIM = s => `\x1b[2m${s}\x1b[0m`
const YEL = s => `\x1b[33m${s}\x1b[0m`

export default function status (args) {
  const root = repoRoot()
  const cfg = loadConfig(root)
  const plan = loadPlan(join(root, cfg.plan))
  const base = argOf(args, '--base') || currentBranch(root)
  const session = sessionName(root)
  const live = hasTmux() && sessionExists(session) ? new Set(listWindows(session)) : new Set()

  console.log(`${plan.title}  ${DIM('base ' + base)}\n`)

  let violations = 0
  for (const agent of plan.agents) {
    const path = worktreePath(root, cfg, agent.id)
    if (!existsSync(path)) { console.log(`${agent.id}  ${DIM('no worktree — run `rig up`')}`); continue }

    const ahead = tryGit(['rev-list', '--count', `${base}..HEAD`], path)
    const dirty = dirtyFiles(path)
    const touched = touchedFiles(path, base)
    const stray = touched.filter(f => !matchesAny(f, agent.owns) && !f.startsWith('.rig/'))
    violations += stray.length

    const pane = live.has(agent.id) ? GRN('●') : DIM('○')
    const head = `${pane} ${agent.id}${agent.title ? DIM(' · ' + agent.title) : ''}`
    console.log(head)
    console.log(`   ${ahead.ok ? ahead.out : '?'} commit(s) ahead · ${dirty.length} dirty · ${touched.length} file(s) touched`)
    if (stray.length) {
      console.log(`   ${RED('OUTSIDE SLICE:')} ${stray.slice(0, 8).join(', ')}${stray.length > 8 ? ` …+${stray.length - 8}` : ''}`)
    }
    if (dirty.length) {
      console.log(`   ${YEL('uncommitted:')} ${dirty.slice(0, 6).join(', ')}${dirty.length > 6 ? ` …+${dirty.length - 6}` : ''}`)
      console.log(`   ${DIM('verified work left uncommitted does not survive a usage pause')}`)
    }
    const report = join(path, '.rig', `report-${agent.id}.md`)
    if (existsSync(report)) console.log(`   ${DIM('report: ' + relative(root, report))}`)
    console.log()
  }

  if (violations) {
    console.log(RED(`${violations} file(s) edited outside their slice.`) + ' Run `rig guard` for the detail.')
    process.exitCode = 1
  } else {
    console.log(GRN('every touched file is inside its slice.'))
  }
}

function argOf (args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
