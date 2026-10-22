import { writeFileSync, mkdirSync, existsSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { mainRoot, loadConfig, sessionName, currentBranch } from '../config.js'
import { loadPlan, missingBrief, barHasNoNumber, droppedNumbers, refusalsGap } from '../plan.js'
import { ensureWorktree } from '../worktrees.js'
import { briefFor, shareTaste } from '../brief.js'
import { openSliceIssues } from '../issues.js'
import { reportPath } from '../reports.js'
import { terminal } from '../terminal.js'
import { git } from '../sh.js'
import { rigDir } from '../rigdir.js'
import { inboxRoot, leadName, leadDir, watcherState, DEFAULT_WAIT_MIN } from '../inbox.js'
import inbox from './inbox.js'

const YEL = (s) => `\x1b[33m${s}\x1b[0m`

export default async function up(args) {
  const root = mainRoot()
  const cfg = loadConfig(root)
  const plan = loadPlan(join(root, cfg.plan))
  const dry = args.includes('--dry-run')
  const noLaunch = args.includes('--no-launch') || dry
  const launchCmd = arg(args, '--launch') || cfg.launch
  const ids = plan.agents.map((a) => a.id)

  const base = arg(args, '--base') || currentBranch(root)
  const baseSha = git(['rev-parse', '--short', base], root)
  console.log(`plan: ${plan.title}`)
  console.log(`base: ${base} @ ${baseSha}`)
  console.log(`${plan.agents.length} slice(s)\n`)

  const session = sessionName(root)
  const made = []
  const warnings = []
  // Said before anything is created, dry run included: a thin brief is cheapest to fix now.
  const gaps = missingBrief(plan, { aim: true })
  if (gaps.length)
    console.log(
      YEL('the plan’s brief is missing: ') + gaps.join(', ') + '\n  Agents build what the brief says; every gap here is a round later.\n',
    )
  for (const d of droppedNumbers(plan))
    console.log(YEL(`read as a placeholder and left out of the briefs, though it has a number (## ${d.heading}): `) + d.line)
  if (barHasNoNumber(plan)) console.log(YEL('the bar has no number: nothing can measure it, so nothing can say it was missed.') + '\n')
  const refusals = refusalsGap(plan)
  if (refusals)
    console.log(
      YEL('the plan has a UI over rules and no ## Refusals matrix') +
        ` (${refusals}).\n  List every refusal a screen can hit and its repair: the field to fill, or the message naming who acts.\n  A refusal with no repair is a dead end. No UI here? Add the line \`UI: none\` to the plan.\n`,
    )
  const lead = leadName(cfg)
  if (!lead)
    console.log(
      YEL('no lead named: ') +
        'set "lead" in .rig/config.json (or export RIG_LEAD). Peers tell the lead when they finish or block, and the tell line in each brief needs the name.\n',
    )

  for (const agent of plan.agents) {
    if (dry) {
      console.log(`  ${agent.id}  would branch ${cfg.branchPrefix}${agent.id} from ${base}, owning ${agent.owns.length} pattern(s)`)
      continue
    }
    const wt = ensureWorktree(root, cfg, agent.id, base, { keepBranches: args.includes('--keep-branches') })
    made.push({ agent, wt })

    const note = wt.moved ? `  (leftover branch moved up ${wt.staleBehind} commit(s) to ${base}; all its work was already merged)` : ''
    console.log(`  ${agent.id}  ${wt.created ? 'created' : 'reused '}  ${wt.branch}  ->  ${wt.path}${note}`)
    if (wt.ahead > 0 && wt.behind > 0) {
      warnings.push(
        `${agent.id}: ${wt.branch} has ${wt.ahead} commit(s) not on ${base} and is ${wt.behind} behind it. Left as it is — merge or rebase it before briefing the agent, or it starts on an old tree.`,
      )
    } else if (wt.behind > 0 && !wt.moved) {
      warnings.push(`${agent.id}: ${wt.branch} is ${wt.behind} commit(s) behind ${base}.`)
    }
    const deps = depsWarning(root, wt.path)
    if (deps) warnings.push(`${agent.id}: ${deps}`)
  }

  if (dry) {
    console.log('\ndry run — nothing created')
    watcherNote(cfg, lead)
    return
  }

  // One GitHub issue per slice, before the briefs are written so each brief can name its own.
  // Recorded in .rig/issues.json; `rig finish` closes them. Absent gh is said once, not fatal.
  const issueCfg = { ...cfg, issues: args.includes('--no-issues') ? false : cfg.issues }
  const opened = openSliceIssues(root, plan, issueCfg)
  if (opened.lines.length) {
    console.log('')
    for (const l of opened.lines) console.log(l)
  }

  for (const m of made) {
    rigDir(m.wt.path)
    mkdirSync(join(m.wt.path, 'docs'), { recursive: true })
    const brief = briefFor(plan, m.agent, {
      branch: m.wt.branch,
      path: m.wt.path,
      planPath: cfg.plan,
      reportPath: reportPath(m.agent),
      issue: opened.issues[m.agent.id] || null,
      taste: shareTaste(root, m.wt.path),
      lead,
    })
    writeFileSync(join(m.wt.path, '.rig', 'BRIEF.md'), brief)
  }

  if (warnings.length) {
    console.log('\n' + YEL('check before the agents start:'))
    for (const w of warnings) console.log('  ' + w)
  }

  if (!noLaunch) {
    const term = terminal(cfg)
    if (!term.available()) {
      console.log(`\n${term.name} not available — worktrees and briefs are ready, but nothing was launched.`)
      if (term.name === 'herdr') console.log('(run `rig up` from inside a herdr pane, or set "terminal": "tmux" in .rig/config.json)')
    } else {
      const cmd = `${launchCmd} "Read .rig/BRIEF.md and follow it."`
      if (!term.sessionExists(session)) {
        const first = made[0]
        term.newSession(session, first.agent.id, first.wt.path, cmd)
        for (const m of made.slice(1)) term.newWindow(session, m.agent.id, m.wt.path, cmd)
      } else {
        const have = new Set(term.listWindows(session, ids))
        for (const m of made) if (!have.has(m.agent.id)) term.newWindow(session, m.agent.id, m.wt.path, cmd)
      }
      console.log(
        `\n${term.name} session: ${session}  (${term.name === 'herdr' ? 'tabs' : 'windows'}: ${term.listWindows(session, ids).join(', ')})`,
      )
      console.log(`attach with:  ${term.attachHint(session)}`)
      console.log('\nDo not type into an agent pane — keystrokes interrupt the turn. Read one with:')
      console.log(`  ${term.readHint(session, ids)}`)
    }
  }

  const watch = watcherNote(cfg, lead)
  console.log(`\nnext: \`rig status\` to watch slices, \`rig qa <sha>\` to grade a commit.`)
  // --watch: `rig up` becomes the watcher itself. Run `rig up --watch` as a background job and its
  // exit, on the first message or the deadline, wakes the lead.
  if (watch && args.includes('--watch')) {
    console.log(`\nwatching: ${watch.join(' ')}`)
    await inbox(watch.slice(2))
  }
}

/**
 * The lead's inbox watcher: whether one is armed, and the exact background command when not.
 * Returns that command as argv (['rig', 'inbox', lead, …]), or null when there is no lead to watch for.
 */
function watcherNote(cfg, lead) {
  if (!lead) return null
  const minutes = cfg.inboxDeadline ?? DEFAULT_WAIT_MIN
  const cmd = ['rig', 'inbox', lead, '--wait', '--deadline', String(minutes)]
  const root = inboxRoot(cfg)
  const w = watcherState(root, lead)
  console.log(`\nlead inbox: ${lead}  (${leadDir(root, lead)})`)
  if (w) console.log(`  watcher armed: pid ${w.pid}, until ${new Date(w.until).toTimeString().slice(0, 5)}`)
  else {
    console.log(`  ${YEL('no watcher armed.')} Run this as a background job; it exits when a peer tells you something. Re-arm after each:`)
    console.log(`    ${cmd.join(' ')}`)
  }
  return cmd
}

/**
 * A worktree is a fresh checkout: no node_modules. The obvious shortcut is a symlink to the main
 * checkout's, and it holds until someone runs `npm install` inside a worktree — which writes
 * through the link and rewrites (or empties) the folder every slice depends on.
 */
export function depsWarning(root, worktree) {
  if (!existsSync(join(root, 'package.json')) || !existsSync(join(root, 'node_modules'))) return null
  const nm = join(worktree, 'node_modules')
  let link = false
  try {
    link = lstatSync(nm).isSymbolicLink()
  } catch {
    /* absent */
  }
  if (link)
    return 'node_modules is a symlink to another checkout. An `npm install` here would rewrite the shared one; replace it with `npm ci` in this worktree.'
  if (!existsSync(nm)) return 'no node_modules yet: run `npm ci` in this worktree (do not symlink the main checkout’s).'
  return null
}

function arg(args, name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}
