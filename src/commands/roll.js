// rig roll — a cross-repo crew from one brief.
//
//   rig roll up <brief.md>      one tab per list in THIS workspace, a brief per tab, roll.json
//   rig roll status [<dir>]     per tab, per repo: untouched / in progress / committed / pushed / skipped
//   rig roll finish [<dir>]     the gate: every repo reported, clean, pushed; ROLL-FINISH.md; jot
//   rig roll down [<dir>]       close this roll's tabs (by id), refusing over a dirty repo
//
// A roll touches many repos and owns none, so everything it writes lives under ~/.rig/rolls/<name>/,
// outside every repo. It makes no worktrees and no branches: each tab works on the default branch of
// each repo in turn, one commit per repo, and the report file is the only record it keeps.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { mainRoot, loadConfig, DEFAULTS } from '../config.js'
import { terminal } from '../terminal.js'
import { blockedPanes } from '../blocked.js'
import { tryRun } from '../sh.js'
import { preTrust } from '../trust.js'
import { parseRoll, resolveRepos, rollName, reportPathFor, tabBrief, rollStatus } from '../roll.js'

const RED = s => `\x1b[31m${s}\x1b[0m`
const GRN = s => `\x1b[32m${s}\x1b[0m`
const YEL = s => `\x1b[33m${s}\x1b[0m`
const DIM = s => `\x1b[2m${s}\x1b[0m`

export const USAGE = `rig roll — a cross-repo crew from one brief (tabs in this workspace, one list of repos each)

  rig roll up <brief.md>   [--dir <rollsDir>] [--no-launch] [--dry-run] [--launch "<cmd>"]
  rig roll status [<rollDir>]   [--no-fetch]  newest roll by default; exit 1 while any repo is in progress
  rig roll finish [<rollDir>]   [--no-fetch]  every repo reported, clean and pushed; writes ROLL-FINISH.md; jots
  rig roll down   [<rollDir>]   [--force]  closes only this roll's tabs; makes and removes no worktrees

The brief: templates/ROLL.md. Rolls live under ~/.rig/rolls/<brief>-<date>/, outside every repo.
Tab ids must be unique across the workspace: a tab with the same label already open refuses the launch.`

export default async function roll (args) {
  if (args.includes('-h') || args.includes('--help')) { console.log(USAGE); return }
  const [verb, ...rest] = args
  const cfg = config()
  switch (verb) {
    case 'up': return up(rest, cfg)
    case 'status': return status(rest, cfg)
    case 'finish': return finish(rest, cfg)
    case 'down': return down(rest, cfg)
    default: throw new Error(`rig roll needs a verb: up | status | finish | down\n\n${USAGE}`)
  }
}

/** A roll is run from a lead pane that may not be inside any repo: fall back to the defaults. */
function config () {
  try { return loadConfig(mainRoot()) } catch { return { ...DEFAULTS } }
}

const home = () => process.env.HOME || homedir()
export const rollsDir = (args) => arg(args, '--dir') || process.env.RIG_ROLLS_DIR || join(home(), '.rig', 'rolls')
const sessionFor = (name) => 'rig-roll-' + name

// ------------------------------------------------------------------------------------------------
export function up (args, cfg) {
  const briefArg = args.find(a => !a.startsWith('--') && a !== arg(args, '--dir') && a !== arg(args, '--launch'))
  if (!briefArg) throw new Error('rig roll up <brief.md>')
  const briefPath = resolve(briefArg)
  if (!existsSync(briefPath)) throw new Error(`no such brief: ${briefPath}`)
  const dry = args.includes('--dry-run')
  const noLaunch = args.includes('--no-launch') || dry
  const launchCmd = arg(args, '--launch') || cfg.launch

  // Parse and resolve first: a slug that resolves nowhere, or sits in two lists, stops the roll
  // before a folder is made or a tab opened.
  const roll = parseRoll(readFileSync(briefPath, 'utf8'))
  const tabs = resolveRepos(roll, { home: home() })
  const ids = Object.keys(tabs)

  const name = uniqueName(rollsDir(args), rollName(briefPath))
  const rollDir = join(rollsDir(args), name)
  const startedAt = new Date().toISOString()
  console.log(`roll: ${roll.title}`)
  console.log(`dir:  ${rollDir}`)
  console.log(`${ids.length} tab(s), ${ids.reduce((n, t) => n + tabs[t].length, 0)} repo(s)\n`)
  if (!roll.commitSubject) console.log(YEL('the brief has no `## Commit subject`: ') + 'status will find roll commits by date alone.\n')
  if (!roll.procedure.length) console.log(YEL('the brief has no `## Procedure per repo` steps: ') + 'each tab will have to ask.\n')

  // A tab with one of these labels already open belongs to another roll or crew in this
  // workspace; a second set of same-named tabs would make `down` on either close both. Refused
  // before a folder is made, so the brief can be fixed and re-run.
  if (!noLaunch) {
    const term = terminal(cfg)
    if (term.available()) {
      const open = term.listWindows(sessionFor(name), ids)
      if (open.length) throw new Error(`tab(s) already open in this workspace with these ids: ${open.join(', ')}. Give this roll's lists their own ids (they are the tab labels), or \`rig roll down\` the roll that owns them.`)
    }
  }

  const reports = {}
  for (const id of ids) {
    const reportPath = reportPathFor(roll, rollDir, id, home())
    reports[id] = reportPath
    const line = tabs[id].map(r => r.slug).join(', ')
    if (dry) { console.log(`  ${id}  would open a tab at ${tabs[id][0].path} for: ${line}`); continue }
    mkdirSync(join(rollDir, id), { recursive: true })
    const bp = join(rollDir, id, 'BRIEF.md')
    writeFileSync(bp, tabBrief(roll, id, tabs[id], { rollDir, reportPath, briefPath: bp }))
    console.log(`  ${id}  ${tabs[id].length} repo(s): ${line}\n       brief ${bp}`)
  }
  if (dry) { console.log('\ndry run — nothing created'); return }

  copyFileSync(briefPath, join(rollDir, 'ROLL.md'))
  const record = {
    brief: briefPath, name, title: roll.title, startedAt, commitSubject: roll.commitSubject || null,
    tabs: Object.fromEntries(ids.map(id => [id, tabs[id].map(r => ({ slug: r.slug, path: r.path }))])),
    reports
  }
  writeFileSync(join(rollDir, 'roll.json'), JSON.stringify(record, null, 2) + '\n')

  if (!noLaunch) launchTabs(cfg, name, ids, tabs, rollDir, launchCmd)
  console.log(`\nnext: \`rig roll status\` to watch the repos, \`rig roll finish\` when every report is in.`)
}

/** One tab per list, in the workspace the rig is running in. Under tmux, one window per list in
 *  the roll's own session. The cwd is the first repo of the list; the brief carries the rest. */
function launchTabs (cfg, name, ids, tabs, rollDir, launchCmd) {
  const term = terminal(cfg)
  const session = sessionFor(name)
  if (!term.available()) {
    console.log(`\n${term.name} not available — briefs are ready, but nothing was launched.`)
    if (term.name === 'herdr') console.log('(run `rig roll up` from inside a herdr pane, or set "terminal": "tmux" in .rig/config.json)')
    return
  }
  const cmdFor = id => `${launchCmd}${addDirs(launchCmd, tabs[id])} "Read ${join(rollDir, id, 'BRIEF.md')} and follow it."`
  let first = true
  for (const id of ids) {
    const cwd = tabs[id][0].path
    // The driver pre-trusts the cwd; the rest of the list would each raise the trust prompt (and
    // every write outside the project root a permission prompt) the first time the tab got there.
    for (const r of tabs[id].slice(1)) preTrust(r.path)
    if (first && !term.sessionExists(session)) term.newSession(session, id, cwd, cmdFor(id))
    else term.newWindow(session, id, cwd, cmdFor(id))
    first = false
  }
  console.log(`\n${term.name}: ${term.name === 'herdr' ? 'tabs' : session + ' windows'}: ${term.listWindows(session, ids).join(', ')}`)
  console.log(`attach with:  ${term.attachHint(session)}`)
  console.log('\nDo not type into an agent pane — keystrokes interrupt the turn. Read one with:')
  console.log(`  ${term.readHint(session, ids)}`)
}

/** Claude Code takes extra working directories with --add-dir; another launcher gets none. */
export function addDirs (launchCmd, repos) {
  if (!/^\s*claude(\s|$)/.test(launchCmd)) return ''
  // The launch line is typed into a shell: a path with a space (a registry code: can point anywhere)
  // would split into two arguments and land the tab in the wrong place.
  return repos.slice(1).map(r => ` --add-dir ${shellQuote(r.path)}`).join('')
}
export function shellQuote (s) { return /^[A-Za-z0-9_\/.:+@%,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'` }

function uniqueName (base, name) {
  if (!existsSync(join(base, name, 'roll.json'))) return name
  for (let n = 2; ; n++) if (!existsSync(join(base, `${name}-${n}`, 'roll.json'))) return `${name}-${n}`
}

// ------------------------------------------------------------------------------------------------
/** The roll named on the command line, else the newest roll.json under the rolls dir. */
export function pickRoll (args) {
  const named = args.find(a => !a.startsWith('--') && a !== arg(args, '--dir'))
  if (named) {
    const dir = resolve(named)
    if (!existsSync(join(dir, 'roll.json'))) throw new Error(`no roll.json in ${dir}`)
    return dir
  }
  const base = rollsDir(args)
  if (!existsSync(base)) throw new Error(`no rolls yet under ${base}; run \`rig roll up <brief.md>\``)
  const rolls = readdirSync(base).map(d => join(base, d)).filter(d => existsSync(join(d, 'roll.json')))
    .map(d => ({ d, at: JSON.parse(readFileSync(join(d, 'roll.json'), 'utf8')).startedAt || '' }))
    .sort((a, b) => a.at < b.at ? 1 : -1)
  if (!rolls.length) throw new Error(`no rolls under ${base}`)
  return rolls[0].d
}

const paint = (state) => state === 'pushed' ? GRN(state) : state === 'in progress' ? YEL(state) : state === 'missing' ? RED(state) : state === 'untouched' ? DIM(state) : state

export function status (args, cfg) {
  const rollDir = pickRoll(args)
  const { record, tabs } = rollStatus(rollDir, { fetch: !args.includes('--no-fetch') })
  const ids = Object.keys(tabs)
  const term = terminal(cfg)
  const session = sessionFor(record.name)
  const up = term.available() && term.sessionExists(session)
  const live = up ? new Set(term.listWindows(session, ids)) : new Set()
  const states = new Map(up ? term.slicePanes(session, ids).map(p => [p.name, p.agentStatus]) : [])

  console.log(`${record.title}  ${DIM(rollDir)}  ${DIM('started ' + record.startedAt)}\n`)
  let inProgress = 0
  for (const id of ids) {
    const t = tabs[id]
    const state = states.get(id)
    const tag = !state ? '' : state === 'blocked' ? ' ' + YEL('[blocked]') : ' ' + DIM('[' + state + ']')
    console.log(`${live.has(id) ? GRN('●') : DIM('○')} ${id}${tag}  ${DIM(t.reportExists ? 'report: ' + t.reportPath : 'no report yet')}`)
    for (const r of t.repos) {
      if (r.state === 'in progress') inProgress++
      console.log(`   ${r.slug.padEnd(24)} ${paint(r.state)}${r.sha ? ' ' + r.sha : ''}${r.state === 'committed' ? DIM(' (not on ' + r.remote + ')') : ''}`)
    }
    console.log()
  }

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
  if (inProgress) { console.log(YEL(`${inProgress} repo(s) in progress.`)); process.exitCode = 1 } else console.log(GRN('no repo mid-edit.'))
  return { inProgress, tabs }
}

// ------------------------------------------------------------------------------------------------
/** The gate, as data: every failure named, so a test can assert on them and the transcript reads
 *  the same as the check. Nothing here writes or jots. */
export function finishChecks (rollDir, opts = {}) {
  const { record, tabs } = rollStatus(rollDir, opts)
  const checks = []
  const rows = []
  for (const [id, t] of Object.entries(tabs)) {
    if (!t.reportExists) checks.push({ name: `${id} report`, ok: false, detail: `missing: ${t.reportPath}` })
    else {
      const unnamed = t.repos.map(r => r.slug).filter(s => !t.named.has(s))
      checks.push({ name: `${id} report names every repo`, ok: !unnamed.length, detail: unnamed.length ? `not in the report: ${unnamed.join(', ')}` : `${t.repos.length} repo(s) accounted for` })
    }
    for (const r of t.repos) {
      rows.push({ slug: r.slug, tab: id, state: r.state, sha: r.sha })
      const ok = r.state === 'pushed' || r.state === 'local only' || r.state === 'skipped'
      const why = r.state === 'contradiction' ? `report says SKIPPED but ${r.sha} carries the roll's commit subject; one of them is wrong` : r.state === 'in progress' ? 'uncommitted changes' : r.state === 'committed' ? `${r.sha} is not on ${r.remote}` : r.state === 'untouched' ? 'no commit since the roll started and not SKIPPED in the report' : r.state === 'missing' ? 'folder is gone' : `${r.state}${r.sha ? ' ' + r.sha : ''}`
      checks.push({ name: `${r.slug} (${id})`, ok, detail: why })
    }
  }
  return { record, rows, checks, ok: checks.every(c => c.ok) }
}

export function finish (args, cfg) {
  const rollDir = pickRoll(args)
  const { record, rows, checks, ok } = finishChecks(rollDir, { fetch: !args.includes('--no-fetch') })
  console.log(`${record.title}  ${DIM(rollDir)}\n`)
  for (const c of checks) console.log(`  ${c.ok ? GRN('PASS') : RED('FAIL')} ${c.name}  ${DIM(c.detail)}`)
  console.log()
  const table = rollTable(rows)
  console.log(table)
  const n = s => rows.filter(r => r.state === s).length
  const summary = `${n('pushed')} pushed, ${n('skipped')} skipped, ${n('local only')} local`
  if (!ok) {
    console.log('\n' + RED('roll not finished') + ` — ${checks.filter(c => !c.ok).length} check(s) failed. Nothing closed, nothing jotted.`)
    process.exitCode = 1
    return { ok, rows }
  }
  const jotLine = `[workflow] roll ${record.name}: ${summary}`
  const jot = tryRun('jot', [jotLine])
  const jotNote = jot.ok ? `jot: ${jotLine}` : `jot not run (${/ENOENT/.test(jot.err) ? 'not on PATH' : jot.err.split('\n')[0]}): ${jotLine}`
  writeFileSync(join(rollDir, 'ROLL-FINISH.md'), `# ${record.title} — finished ${new Date().toISOString()}

Roll: \`${rollDir}\`  started ${record.startedAt}

## Repos
${table}

${summary}

## Checks
${checks.map(c => `- ${c.ok ? 'PASS' : 'FAIL'} ${c.name} — ${c.detail}`).join('\n')}

## Desk
- ${jotNote}
`)
  console.log('\n' + GRN('roll finished') + ` — ${summary}`)
  console.log(`  ${jotNote}`)
  console.log(`  wrote ${join(rollDir, 'ROLL-FINISH.md')}`)
  console.log(`\nnext: wrap --none "roll ${record.name}: ${summary}"  (the lead runs wrap; the roll never does)`)
  return { ok, rows }
}

export function rollTable (rows) {
  const w = [Math.max(4, ...rows.map(r => r.slug.length)), Math.max(3, ...rows.map(r => r.tab.length)), 11]
  const line = (a, b, c, d) => `| ${a.padEnd(w[0])} | ${b.padEnd(w[1])} | ${c.padEnd(w[2])} | ${d.padEnd(7)} |`
  return [line('slug', 'tab', 'state', 'sha'), line('-'.repeat(w[0]), '-'.repeat(w[1]), '-'.repeat(w[2]), '-------'),
    ...rows.map(r => line(r.slug, r.tab, r.state, r.sha || '-'))].join('\n')
}

// ------------------------------------------------------------------------------------------------
export function down (args, cfg) {
  const rollDir = pickRoll(args)
  const force = args.includes('--force')
  const { record, tabs } = rollStatus(rollDir, { fetch: false })
  const ids = Object.keys(tabs)
  const dirty = Object.values(tabs).flatMap(t => t.repos).filter(r => r.state === 'in progress')
  if (dirty.length && !force) {
    console.error(RED('refusing to close the roll') + ' — uncommitted work in:')
    for (const r of dirty) console.error(`  ${r.slug}: ${r.path}`)
    console.error('\nCommit it in the repo, or re-run with --force to close the tabs anyway (the repos are untouched either way).')
    process.exitCode = 1
    return
  }
  const term = terminal(cfg)
  const session = sessionFor(record.name)
  if (!term.available() || !term.sessionExists(session)) { console.log(`${term.name} not available or no session; nothing to close`); return }
  // Only this roll's tab ids, never a label pattern: another crew's tabs share the workspace.
  const closed = term.killSession(session, ids)
  if (Array.isArray(closed)) console.log(closed.length ? `closed roll tabs: ${closed.join(', ')}` : 'no tabs of this roll were open')
  else console.log(`closed ${term.name} session ${session}`)
  console.log('no worktrees to remove: a roll makes none.')
}

function arg (args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
