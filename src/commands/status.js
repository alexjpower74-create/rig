import { join, relative } from 'node:path'
import { existsSync } from 'node:fs'
import { mainRoot, loadConfig, sessionName, currentBranch } from '../config.js'
import { loadPlan, matchesAny } from '../plan.js'
import { worktreePath, touchedFiles, dirtyFiles } from '../worktrees.js'
import { tryGit } from '../sh.js'
import { terminal } from '../terminal.js'
import { blockedPanes } from '../blocked.js'
import { drift, fetchBase, formatDrift, liveBase } from '../drift.js'
import { estimate, readTimings } from '../timings.js'

const RED = (s) => `\x1b[31m${s}\x1b[0m`
const GRN = (s) => `\x1b[32m${s}\x1b[0m`
const DIM = (s) => `\x1b[2m${s}\x1b[0m`
const YEL = (s) => `\x1b[33m${s}\x1b[0m`

export default function status(args) {
  const root = mainRoot()
  const cfg = loadConfig(root)
  const plan = loadPlan(join(root, cfg.plan))
  const base = argOf(args, '--base') || currentBranch(root)
  const session = sessionName(root)
  const term = terminal(cfg)
  const ids = plan.agents.map((a) => a.id)
  const up = term.available() && term.sessionExists(session)
  const live = up ? new Set(term.listWindows(session, ids)) : new Set()
  // herdr knows whether each agent is working, idle, done or blocked; show it next to the slice.
  const states = new Map(up ? term.slicePanes(session, ids).map((p) => [p.name, p.agentStatus]) : [])

  console.log(`${plan.title}  ${DIM('base ' + base)}\n`)

  // Drift first: a round spent on a tree that no longer merges is the most expensive thing to find late.
  printDrift(root, cfg, plan, base, { fetch: !args.includes('--no-fetch') })
  if (args.includes('--eta')) printEta(root, cfg)

  let violations = 0
  for (const agent of plan.agents) {
    const path = worktreePath(root, cfg, agent.id)
    if (!existsSync(path)) {
      console.log(`${agent.id}  ${DIM('no worktree — run `rig up`')}`)
      continue
    }

    const ahead = tryGit(['rev-list', '--count', `${base}..HEAD`], path)
    const dirty = dirtyFiles(path)
    const touched = touchedFiles(path, base)
    const stray = touched.filter((f) => !matchesAny(f, agent.owns) && !f.startsWith('.rig/'))
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

/**
 * Every slice branch against the live base (the upstream of `base` when it has one), one fetch for
 * all of them. A slice with no branch yet is skipped: there is nothing of its to drift.
 */
function printDrift(root, cfg, plan, base, { fetch }) {
  // Fetch the upstream even when the local base is the one compared: a move upstream is still a
  // move, and "pull before the round" can only be said from a fresh copy.
  const up = tryGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${base}@{upstream}`], root)
  const upstream = up.ok && up.out ? up.out : null
  const f = fetch ? fetchBase(root, upstream || base) : { ok: false, why: null }
  const live = liveBase(root, base)
  const how = !fetch
    ? 'not fetched (--no-fetch)'
    : f.ok
      ? `${upstream || live} fetched just now`
      : f.why
        ? YEL(f.why)
        : 'local base, nothing to fetch'
  console.log(`drift vs ${live}  ${DIM(how)}`)
  if (upstream && upstream !== live) {
    // Slices merge into the local base; upstream lands there only when it is pulled. Say when the two differ.
    const count = (range) => Number(tryGit(['rev-list', '--count', range], root).out) || 0
    const a = count(`${upstream}..${base}`)
    const b = count(`${base}..${upstream}`)
    console.log(
      `  ${b ? YEL(`${upstream} has ${b} commit(s) ${base} lacks: pull before the round`) : DIM(`${base} is ${a} ahead of ${upstream}, so slices are measured against ${base}`)}`,
    )
  }
  const commits = new Map()
  for (const agent of plan.agents) {
    const branch = cfg.branchPrefix + agent.id
    if (!tryGit(['rev-parse', '--verify', '-q', `refs/heads/${branch}`], root).ok) continue
    const d = drift(root, { base: live, head: `refs/heads/${branch}`, slices: [agent], fetch: false })
    for (const c of d.since) commits.set(c.sha, c)
    for (const line of formatDrift(d, { label: agent.id })) console.log(`  ${line}`)
  }
  if (commits.size) {
    const newest = [...commits.values()]
    console.log(`  ${DIM(`new on ${live}:`)}`)
    for (const c of newest.slice(0, 6)) console.log(`    ${DIM(c.sha.slice(0, 9))} ${c.subject}`)
    if (newest.length > 6) console.log(`    ${DIM(`…+${newest.length - 6} more`)}`)
    console.log(`  ${YEL('the base moved: rebuild the round before reviews, not after them')} ${DIM('(rig rebase <id>)')}`)
  }
  console.log()
}

/** The stages of a final round, as `rig qa`, `rig review` and `rig fold` record them. */
export function roundStages(cfg = {}, recorded = []) {
  const stages = ['qa:test', 'qa:negative', 'qa:baseline']
  const seen = new Set(recorded.map((t) => t.stage))
  if (cfg.ciCommand || seen.has('qa:ci')) stages.push('qa:ci')
  if (cfg.qaHost || seen.has('qa:host')) stages.push('qa:host')
  stages.push('review', 'fold')
  return stages
}

/**
 * The lines `rig status --eta` prints for an estimate(): each stage's median and how many runs it
 * came from, or "no data". The total is printed only when every stage has data; a guess is never
 * filled in for a stage nobody measured.
 */
export function formatEta(est) {
  const lines = ['eta for a final round  ' + DIM('(median of measured stage times)')]
  for (const s of est.stages) {
    const v = s.medianMs === null || s.medianMs === undefined ? DIM('no data') : `${duration(s.medianMs)}  ${DIM(`median of ${s.n}`)}`
    lines.push(`  ${s.stage.padEnd(12)} ${v}`)
  }
  if (est.totalMs === null || est.totalMs === undefined) {
    const has = (s) => s.medianMs !== null && s.medianMs !== undefined
    const missing = est.stages.filter((s) => !has(s)).map((s) => s.stage)
    lines.push(`  ${'total'.padEnd(12)} ${YEL('no data')}${DIM(` for ${missing.join(', ') || 'every stage'}`)}`)
    // The measured part is still a measurement: a floor, never a guess at the rest.
    const known = est.stages.filter(has)
    if (known.length)
      lines.push(
        `  ${''.padEnd(12)} ${DIM(`at least ${duration(known.reduce((t, s) => t + s.medianMs, 0))} from the ${known.length} measured stage(s)`)}`,
      )
  } else {
    lines.push(`  ${'total'.padEnd(12)} ${duration(est.totalMs)}`)
  }
  return lines
}

function printEta(root, cfg) {
  const stages = roundStages(cfg, readTimings(root))
  for (const line of formatEta(estimate(root, stages))) console.log(line)
  console.log()
}

export function duration(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}

function argOf(args, name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}
