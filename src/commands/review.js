import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { mainRoot, loadConfig, sessionName, currentBranch } from '../config.js'
import { loadPlan } from '../plan.js'
import { tryGit } from '../sh.js'
import { terminal } from '../terminal.js'

// Fresh eyes before done. Every real defect on a multi-agent build crossed a boundary between two
// people's work, and self-review found none of them: an author's tests share the author's blind
// spots. `rig review <id>` writes a review brief for someone who did not write the code — another
// slice, or a fresh agent in its own tab — pointed at exactly that slice's diff and the plan's rules.

export default function review (args) {
  const root = mainRoot()
  const cfg = loadConfig(root)
  const plan = loadPlan(join(root, cfg.plan))
  const id = firstBare(args)
  if (!id) throw new Error('usage: rig review <slice-id> [--base <ref>] [--by <slice-id>] [--launch]')
  const agent = plan.agents.find(a => a.id === id)
  if (!agent) throw new Error(`no slice "${id}" in ${cfg.plan}`)

  const base = argOf(args, '--base') || currentBranch(root)
  const branch = cfg.branchPrefix + id
  const by = argOf(args, '--by')
  const brief = reviewBrief(plan, agent, { root, base, branch, by })
  const rel = join('.rig', `REVIEW-${id}.md`)
  mkdirSync(join(root, '.rig'), { recursive: true })
  writeFileSync(join(root, rel), brief.text)

  console.log(`review brief for ${id}: ${rel}`)
  console.log(`  diff: git diff ${base}...${branch}  (${brief.files.length} file(s))`)
  console.log(`  findings go to: ${brief.out}`)

  if (by) {
    console.log(`\nhand it to ${by} when it is idle: "Read ${rel} and follow it."`)
    console.log('(the rig never types into a running agent — a keystroke interrupts its turn)')
  }
  if (args.includes('--launch')) {
    const term = terminal(cfg)
    if (!term.available()) { console.log(`\n${term.name} not available; start a reviewer yourself with that brief.`); return }
    const label = `rv-${id}`
    const cmd = `${argOf(args, '--launch-cmd') || cfg.launch} "Read ${rel} and follow it."`
    const session = sessionName(root)
    if (term.sessionExists(session)) term.newWindow(session, label, root, cmd)
    else term.newSession(session, label, root, cmd)
    console.log(`\nlaunched a fresh reviewer in ${term.name === 'herdr' ? 'tab' : 'window'} ${label}`)
  }
}

const VALUE_FLAGS = new Set(['--base', '--by', '--launch-cmd'])
function firstBare (args) {
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i])) { i++; continue }
    if (!args[i].startsWith('-')) return args[i]
  }
  return null
}
function argOf (args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }

/** The review brief text, and the files and output path it names. Pure apart from reading git. */
export function reviewBrief (plan, agent, { root, base, branch, by }) {
  const files = (() => {
    const r = tryGit(['diff', '--name-only', `${base}...${branch}`], root)
    return r.ok ? r.out.split('\n').filter(Boolean) : []
  })()
  const out = `docs/review-${agent.id}.md`
  const rules = (plan.mustNotRules || []).filter(r => !/^<.*>$/.test(r))
  const text = `# Review brief — ${agent.id}${agent.title ? ' · ' + agent.title : ''}

You are reviewing work you did not write${by ? ` (you are ${by})` : ''}. **Read only: do not edit, commit
or fix anything.** Your job is to find what the author's own tests could not.

Project: **${plan.title}**. The contract is the plan at the repo root; read it first, and \`docs/API.md\`
if the project has one.

## What to read
\`git diff ${base}...${branch}\`

${files.length ? files.map(f => '- `' + f + '`').join('\n') : '- (no changes on that branch yet)'}

The slice owns: ${agent.owns.map(o => '`' + o + '`').join(', ')}

## What to look for
1. **Where this slice meets another.** Every real defect on a crew build has crossed that line: a
   field named differently on each side, a status code one side never sends, a time zone, an empty
   list. Check the diff against the contract, not against itself.
2. **Checks that cannot fail.** A test with no negative control, an assertion that passes on an
   empty page, an exit code read through a pipe.
3. **Paths nobody ran.** Errors, retries, offline, a second tab, two requests at once, midnight, a
   daylight-saving night.
4. **The hard rules below**, and anything in the diff that sends, deploys, spends or deletes.

${rules.length ? `## What must not happen (from the plan)\n${rules.map(r => '- ' + r).join('\n')}\n\n` : ''}## Report
Write \`${out}\`: actionable findings only, each with the file and line, the concrete input or state
that goes wrong, and what the author should check. Say "no findings" if there are none; do not pad it.
Commit only that file.
`
  return { text, files, out }
}
