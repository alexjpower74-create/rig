import { join, relative } from 'node:path'
import { existsSync } from 'node:fs'
import { mainRoot, loadConfig, sessionName, currentBranch } from '../config.js'
import { loadPlan, matchesAny } from '../plan.js'
import { worktreePath, touchedFiles, dirtyFiles } from '../worktrees.js'
import { tryGit } from '../sh.js'
import { terminal } from '../terminal.js'
import { blockedPanes } from '../blocked.js'

const RED = s => `\x1b[31m${s}\x1b[0m`
const GRN = s => `\x1b[32m${s}\x1b[0m`
const DIM = s => `\x1b[2m${s}\x1b[0m`
const YEL = s => `\x1b[33m${s}\x1b[0m`

export default function status (args) {
  const root = mainRoot()
  const cfg = loadConfig(root)
  const plan = loadPlan(join(root, cfg.plan))
  const base = argOf(args, '--base') || currentBranch(root)
  const session = sessionName(root)
  const term = terminal(cfg)
  const ids = plan.agents.map(a => a.id)
  const up = term.available() && term.sessionExists(session)
  const live = up ? new Set(term.listWindows(session, ids)) : new Set()
  // herdr knows whether each agent is working, idle, done or blocked; show it next to the slice.
  const states = new Map(up ? term.slicePanes(session, ids).map(p => [p.name, p.agentStatus]) : [])

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
    const state = states.get(agent.id)
    const stateTag = !state ? '' : state === 'blocked' ? ' ' + YEL('[blocked]') : ' ' + DIM('[' + state + ']')
    const head = `${pane} ${agent.id}${stateTag}${agent.title ? DIM(' · ' + agent.title) : ''}`
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

  // An agent stuck on a permission prompt is the failure this was blindest to: it looks exactly
  // like an agent thinking hard. Nothing else in `status` can tell the two apart.
  const blocked = term.available() ? blockedPanes() : []
  if (blocked.length) {
    console.log(YEL('WAITING ON YOU') + ` — ${blocked.length} session${blocked.length === 1 ? '' : 's'} stopped for a person:\n`)
    for (const b of blocked) {
      console.log(`  ${YEL(b.session + ':' + b.index)} ${DIM('(' + b.name + (b.pane ? ' · ' + b.pane : '') + ')')}`)
      console.log(`     ${b.question}`)
      for (const o of b.options) console.log(`       ${DIM(o)}`)
      console.log(`     ${DIM('answer it in that pane — do not send keys from here, it kills the turn')}`)
    }
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
