import { existsSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mainRoot, loadConfig, sessionName, currentBranch } from '../config.js'
import { loadPlan, withoutPlaceholders } from '../plan.js'
import { tryGit } from '../sh.js'
import { terminal } from '../terminal.js'
import { rigDir } from '../rigdir.js'
import { MINDSET } from '../mindset.js'
import { tellLine } from '../brief.js'
import { recordTiming } from '../timings.js'
import { builderVendor, recordVerdict, sameVendorReason, vendorOf } from '../vendor.js'
import { roundStart } from '../decisions.js'

// Fresh eyes before done. Every real defect on a multi-agent build crossed a boundary between two
// people's work, and self-review found none of them: an author's tests share the author's blind
// spots. `rig review <id>` writes a review brief for someone who did not write the code — another
// slice, or a fresh agent in its own tab — pointed at exactly that slice's diff and the plan's rules.

export const USAGE = `rig review <id> [--by <slice>] [--base <ref>] [--launch] [--launch-cmd "<cmd>"]
rig review --vendor <name> [--base <ref>] [--sha <sha>] [--since <ref>]
rig review --vendor <name> --pass "<what ran>" | --fail "<what it found>" [--sha <sha>] [--ms <n>]

  <id>                 write .rig/REVIEW-<id>.md: a fresh-eyes brief for one slice's diff
  --vendor <name>      the reviewer's vendor or tool (openai, codex, gemini, anthropic, claude …)
                       alone: write .rig/REVIEW-final.md, the second-vendor brief for the round's diff,
                       pinned to the sha
  --pass "<what ran>"  record a pass on the sha (the base's tip, or --sha); refused from the
                       builders' own vendor (\`vendor\` in .rig/config.json, else the launch command)
  --fail "<found>"     record a failing verdict; the newest verdict on a sha wins
  --ms <n>             how long the review took (else: since the review brief was written)

\`rig finish\` needs a second-vendor pass on the very sha it finishes.`

export default function review(args) {
  if (args.includes('--help') || args.includes('-h')) return console.log(USAGE)
  const root = mainRoot()
  const cfg = loadConfig(root)
  const plan = loadPlan(join(root, cfg.plan))
  if (args.includes('--vendor')) return vendorReview(args, root, cfg, plan)
  const id = firstBare(args)
  if (!id) throw new Error('usage: rig review <slice-id> [--base <ref>] [--by <slice-id>] [--launch]')
  const agent = plan.agents.find((a) => a.id === id)
  if (!agent) throw new Error(`no slice "${id}" in ${cfg.plan}`)

  const base = argOf(args, '--base') || currentBranch(root)
  const branch = cfg.branchPrefix + id
  const by = argOf(args, '--by')
  const brief = reviewBrief(plan, agent, { root, base, branch, by, lead: leadOf(cfg) })
  const rel = join('.rig', `REVIEW-${id}.md`)
  rigDir(root)
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
    if (!term.available()) {
      console.log(`\n${term.name} not available; start a reviewer yourself with that brief.`)
      return
    }
    const label = `rv-${id}`
    const cmd = `${argOf(args, '--launch-cmd') || cfg.launch} "Read ${rel} and follow it."`
    const session = sessionName(root)
    if (term.sessionExists(session)) term.newWindow(session, label, root, cmd)
    else term.newSession(session, label, root, cmd)
    console.log(`\nlaunched a fresh reviewer in ${term.name === 'herdr' ? 'tab' : 'window'} ${label}`)
  }
}

const VALUE_FLAGS = new Set(['--base', '--by', '--launch-cmd', '--vendor', '--pass', '--fail', '--sha', '--ms', '--since'])
const leadOf = (cfg) => cfg.lead || process.env.RIG_LEAD || null

/**
 * `rig review --vendor`: write the second-vendor brief, or record its verdict on a sha. A pass from
 * the builders' own vendor is refused before anything is written; a fail is recorded from anyone.
 */
export function vendorReview(args, root, cfg, plan, { now = Date.now() } = {}) {
  const vendor = argOf(args, '--vendor')
  const pass = args.includes('--pass') ? argOf(args, '--pass') : null
  const fail = args.includes('--fail') ? argOf(args, '--fail') : null
  const stop = (msg, code = 2) => {
    console.error(`rig review: ${msg}`)
    process.exitCode = code
    return null
  }
  if (!vendor || vendor.startsWith('--')) return stop('--vendor needs a name, e.g. --vendor openai. Nothing was recorded.')
  if (pass !== null && fail !== null) return stop('--pass and --fail contradict each other. Nothing was recorded.')
  if ((pass !== null && (!pass || pass.startsWith('--'))) || (fail !== null && (!fail || fail.startsWith('--'))))
    return stop(`say what ran or what it found, e.g. --pass "npm test, read the whole diff". Nothing was recorded.`)
  const base = argOf(args, '--base') || currentBranch(root)
  const want = argOf(args, '--sha') || base
  const resolved = tryGit(['rev-parse', '--verify', '-q', `${want}^{commit}`], root)
  if (!resolved.ok) return stop(`${want} is not a commit here. Nothing was recorded.`)
  const sha = resolved.out
  const short = sha.slice(0, 7)
  const builder = builderVendor(cfg)
  const v = vendorOf(vendor)

  if (pass === null && fail === null) {
    const since = argOf(args, '--since')
      ? { ref: argOf(args, '--since'), from: '--since' }
      : roundStart(root, sha, plan.agents, cfg.branchPrefix)
    const brief = vendorBrief(plan, { root, sha, since, vendor: v, builder, lead: leadOf(cfg) })
    rigDir(root)
    writeFileSync(join(root, FINAL_BRIEF), brief.text)
    console.log(`second-vendor brief for ${short}: ${FINAL_BRIEF}`)
    console.log(`  diff: git diff ${brief.from}..${short}  (${brief.files.length} file(s))`)
    console.log(`  builders: ${builder.vendor || 'unknown'} (${builder.from}); reviewer: ${v}`)
    const why = sameVendorReason(vendor, builder, cfg)
    if (why) console.log(`\x1b[33m  warning: a pass from ${vendor} will be refused: ${why}\x1b[0m`)
    console.log(`\nhand it over: rig job <pane> "Read ${FINAL_BRIEF} and follow it." --id rv-${v}`)
    return brief
  }

  const verdict = pass !== null ? 'pass' : 'fail'
  if (verdict === 'pass') {
    const why = sameVendorReason(vendor, builder, cfg)
    if (why) return stop(`refused: ${why}. Nothing was recorded.`, 1)
  }
  const ms = durationMs(args, root, now)
  const entry = recordVerdict(root, { sha, vendor: v, verdict, what: pass ?? fail, builder: builder.vendor, ms: ms.ms })
  if (ms.ms != null) recordTiming(root, { stage: 'review', ms: ms.ms, sha, ok: verdict === 'pass' })
  const tag = verdict === 'pass' ? '\x1b[32mpass\x1b[0m' : '\x1b[31mfail\x1b[0m'
  console.log(`${tag} from ${entry.vendor} on ${short}: ${entry.what}`)
  console.log(
    `  ${ms.ms != null ? `took ${Math.round(ms.ms / 60000)} min (${ms.from}); timing recorded as stage review` : `no timing: ${ms.from}`}`,
  )
  console.log('  the newest verdict on this sha is the one rig finish reads')
  return entry
}

/**
 * Questions every review brief asks. A same-vendor review once missed three defects a second vendor
 * found: it checked each state at the moment of the check, never what changes before the result is
 * used, and read a duration as elapsed time without ever moving the clock.
 */
export const ASK_THESE = `## Ask these
1. **What changes between the check and its use or delivery, and is it checked again?** A file, a
   sha, a lease, a status, a permission: the fact true when it was checked may not be true when
   the result is used, sent or shown.
2. **Time edges.** A daylight-saving night, another time zone, a clock that moves, and exactly at
   the boundary (the deadline itself, midnight, the last second of the window). Is a duration
   measured with a clock that cannot jump?
3. **A state that flips off and back on.** Revoked then restored, removed then re-added, failed
   then passed: is the second "on" treated as new, or does an old record answer for it?
4. **Every feature flag off.** Is each new endpoint, action, prop and job unreachable on every surface
   (UI, API, CLI, tool servers, background jobs), and does the old behaviour hold exactly?
5. **A saved user preference.** Does the change override one (theme, locale, notifications) instead
   of reading it?
6. **A negative test counted exactly.** An assertion that something did NOT happen, written as "not
   exactly once", passes when it happened twice. Absence is "never happened" (at least once, negated).
   Would each negative control go red if the thing happened more than once?`

export const FINAL_BRIEF = join('.rig', 'REVIEW-final.md')
const STALE_BRIEF_MS = 12 * 3_600_000

/** --ms, else the age of the newest review brief (the final one first), else none (and why). */
function durationMs(args, root, now) {
  const given = argOf(args, '--ms')
  if (given != null) {
    const n = Number(given)
    if (Number.isFinite(n) && n >= 0) return { ms: Math.round(n), from: '--ms' }
    return { ms: null, from: `--ms "${given}" is not a number of milliseconds` }
  }
  const id = firstBare(args)
  for (const rel of [FINAL_BRIEF, id && join('.rig', `REVIEW-${id}.md`)].filter(Boolean)) {
    const p = join(root, rel)
    if (!existsSync(p)) continue
    const age = Math.max(0, now - statSync(p).mtimeMs)
    // A brief from yesterday is another review's clock: a median fed with it lies about the next one.
    if (age > STALE_BRIEF_MS) return { ms: null, from: `${rel} is ${Math.round(age / 3_600_000)} h old; pass --ms` }
    return { ms: age, from: `since ${rel} was written` }
  }
  return { ms: null, from: 'no --ms and no review brief to time it from' }
}

/** The second-vendor brief: the round's whole diff, pinned to one sha, ending with how to record. */
export function vendorBrief(plan, { root, sha, since, vendor, builder, lead }) {
  const short = sha.slice(0, 7)
  const from = since?.ref ? tryGit(['rev-parse', '--short', since.ref], root).out || since.ref : `${short}~1`
  const files = (() => {
    const r = tryGit(['diff', '--name-only', `${from}..${sha}`], root)
    return r.ok ? r.out.split('\n').filter(Boolean) : []
  })()
  const rules = (plan.mustNotRules || []).filter((r) => !/^<.*>$/.test(r))
  const bar = withoutPlaceholders(plan.bar)
  const tell = tellLine(lead, `rv-${vendor}`)
  const text = `# Second-vendor review — ${plan.title} @ ${short}

${MINDSET}

You are the second-vendor reviewer: the builders were ${builder.vendor || 'an unknown vendor'}, and you are
${vendor}. Your pass is the only one \`rig finish\` accepts, and only on **${short}**. **Read only: do not
edit, commit or fix anything.** Find what reviews from the builders' own vendor could not.

## What to read
\`git diff ${from}..${sha}\`  (${since?.from || 'the tip commit only: no round start found'})

${files.length ? files.map((f) => '- `' + f + '`').join('\n') : '- (no changes in that range)'}

Run the project's own checks on that sha, in a clean checkout of it, and read the diff against the
plan at the repo root (the contract), not against itself.

## What to look for
1. **Where two slices meet**: a field named differently on each side, a code path one side never calls.
2. **Checks that cannot fail**: no negative control, an exit code read through a pipe, a mocked boundary.
3. **Bypasses**: an input, flag or order of calls that passes a gate without the fact the gate is for.
4. **The hard rules below**, and anything that sends, deploys, spends or deletes.
${bar ? `\nThe bar, from the plan:\n${bar}\n` : ''}
${ASK_THESE}

${rules.length ? `## What must not happen (from the plan)\n${rules.map((r) => '- ' + r).join('\n')}\n\n` : ''}## Verdict
Record it on this sha, one line each, with what you ran or what you found:

    rig review --vendor ${vendor} --pass "<what you ran and read>" --sha ${short}
    rig review --vendor ${vendor} --fail "<file:line — what goes wrong>" --sha ${short}

A pass on any other sha does not count. Findings beyond one line go to \`docs/review-final.md\`.

${tell}
`
  return { text, files, from }
}
function firstBare(args) {
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i])) {
      i++
      continue
    }
    if (!args[i].startsWith('-')) return args[i]
  }
  return null
}
function argOf(args, name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}

/** The review brief text, and the files and output path it names. Pure apart from reading git. */
export function reviewBrief(plan, agent, { root, base, branch, by, lead = null }) {
  const files = (() => {
    const r = tryGit(['diff', '--name-only', `${base}...${branch}`], root)
    return r.ok ? r.out.split('\n').filter(Boolean) : []
  })()
  const out = `docs/review-${agent.id}.md`
  const rules = (plan.mustNotRules || []).filter((r) => !/^<.*>$/.test(r))
  const bar = withoutPlaceholders(plan.bar)
  const text = `# Review brief — ${agent.id}${agent.title ? ' · ' + agent.title : ''}

${MINDSET}

You are reviewing work you did not write${by ? ` (you are ${by})` : ''}. **Read only: do not edit, commit
or fix anything.** Your job is to find what the author's own tests could not.

Project: **${plan.title}**. The contract is the plan at the repo root; read it first, and \`docs/API.md\`
if the project has one.

## What to read
\`git diff ${base}...${branch}\`

${files.length ? files.map((f) => '- `' + f + '`').join('\n') : '- (no changes on that branch yet)'}

The slice owns: ${agent.owns.map((o) => '`' + o + '`').join(', ')}

## What to look for
1. **Where this slice meets another.** Every real defect on a crew build has crossed that line: a
   field named differently on each side, a status code one side never sends, a time zone, an empty
   list. Check the diff against the contract, not against itself.
2. **Checks that cannot fail.** A test with no negative control, an assertion that passes on an
   empty page, an exit code read through a pipe.
3. **Paths nobody ran.** Errors, retries, offline, a second tab, two requests at once, midnight, a
   daylight-saving night.
4. **The hard rules below**, and anything in the diff that sends, deploys, spends or deletes.
5. **The bar, measured and looked at.** Is the plan's bar written as an \`s.target\` check (with
   \`countInput\` where it counts input) that was seen red once, with the number printed beside the
   bar? And how does the work look beside the references: put the screenshots side by side and say
   where it falls short of them.
${
  bar
    ? `\n   The bar, from the plan:\n${bar
        .split('\n')
        .map((l) => '   ' + l)
        .join('\n')}\n`
    : ''
}
${ASK_THESE}

${rules.length ? `## What must not happen (from the plan)\n${rules.map((r) => '- ' + r).join('\n')}\n\n` : ''}## Report
Write \`${out}\`: actionable findings only, each with the file and line, the concrete input or state
that goes wrong, and what the author should check. Say "no findings" if there are none; do not pad it.
Commit only that file.

${tellLine(lead, by || `rv-${agent.id}`)}
`
  return { text, files, out }
}
