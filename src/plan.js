// PLAN.md is the contract. This parses it.
//
// The format is deliberately plain Markdown: a human reads it, an agent reads it, and this
// parser reads it. If those three ever disagree, the format is wrong, not the reader.
//
//   ## Agents
//
//   ### c1 — Hero and motion
//   Owns:
//   - src/hero/**
//   - src/motion/**
//
//   Report: docs/build-report-hero.md      (optional; defaults to docs/build-report-<id>.md)
//
//   Task:
//   Build the hero section...

import { readFileSync, existsSync } from 'node:fs'

/** Turn a gitignore-ish glob into an anchored RegExp. Supports ** , * and ?. */
export function globToRegExp(glob) {
  let out = '^'
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` swallows any number of leading segments, including none.
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?'
          i += 2
        } else {
          out += '.*'
          i += 1
        }
      } else {
        out += '[^/]*'
      }
    } else if (c === '?') {
      out += '[^/]'
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(out + '$')
}

export function matchesAny(path, globs) {
  return globs.some((g) => globToRegExp(g).test(path))
}

/** Parse a PLAN.md into { title, agents: [{ id, title, owns, task }] }. */
export function parsePlan(text) {
  const lines = text.split('\n')
  const title = (lines.find((l) => l.startsWith('# ')) || '# Untitled').slice(2).trim()

  const agents = []
  let cur = null
  let mode = null

  const push = () => {
    if (cur) agents.push(cur)
  }

  // Slices are `###` headings inside `## Agents` (or `## Slices`). A plan is a brief first now, and a
  // brief invites subheadings — `### Phone` under "What done looks like" used to become an agent with
  // no files and stop every command. Plans with no such section keep the old reading.
  const scoped = lines.some((l) => /^##\s+(agents|slices)\b/i.test(l))
  let inAgents = false

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    const section = line.match(/^##\s+(.+)$/)
    if (section) inAgents = /^(agents|slices)\b/i.test(section[1])

    const head = (!scoped || inAgents) && line.match(/^###\s+(\S+)\s*(?:[—–-]\s*(.*))?$/)
    if (head) {
      push()
      cur = { id: head[1], title: (head[2] || '').trim(), owns: [], task: [], report: null, issue: null }
      mode = null
      continue
    }
    if (!cur) continue

    // A new `## ` section ends the agent list.
    if (/^##\s+/.test(line)) {
      push()
      cur = null
      mode = null
      continue
    }

    if (/^owns:/i.test(line)) {
      mode = 'owns'
      continue
    }
    if (/^task:/i.test(line)) {
      mode = 'task'
      continue
    }
    // A slice may name its own report. Without this the path was derived from the id while the
    // plan's prose named something else, and the agent was refused by the guard for writing the
    // file its own brief told it to write.
    const rep = line.match(/^report:\s*(.+)$/i)
    if (rep) {
      cur.report = rep[1].trim().replace(/^`|`$/g, '')
      mode = null
      continue
    }
    // A slice may name an existing GitHub issue (`Issue: 42` or `Issue: #42`); `rig up` then records
    // that number instead of opening a new one. Kept out of the task text like Report:.
    // Inside a Task block the line is taken out of the text but the block goes on: an `Issue:` at
    // the end of a slice used to drop everything after it.
    const iss = line.match(/^issue:\s*#?(\d+)\s*$/i)
    if (iss) {
      cur.issue = Number(iss[1])
      if (mode !== 'task') mode = null
      continue
    }

    if (mode === 'owns') {
      const item = line.match(/^\s*[-*]\s+(.+)$/)
      if (item) {
        cur.owns.push(item[1].trim().replace(/^`|`$/g, ''))
        continue
      }
      if (line.trim() === '') continue
      mode = null // a non-bullet line ends the Owns block
    }
    if (mode === 'task') cur.task.push(line)
  }
  push()

  for (const a of agents) a.task = a.task.join('\n').trim()
  const sections = parseSections(lines)
  const fields = briefFields(sections)
  return { title, agents, sections, ...fields, negativeCommand: negativeCommand(fields.checks) }
}

/**
 * The plan's negative-control command: a line under Checks that starts exactly "Negative controls:"
 * or "Negative-control command [for this repo]:". Any other sentence beginning "Negative controls …:"
 * is prose (the CLAUDE.md rule "Negative controls are re-run after any formatter, on the new sha: …"
 * is copied into plans) and once became the shell command `rig finish` ran. `rig finish` refuses
 * until that command is recorded green on the sha being finished (`cfg.negativeCommand` wins when
 * set). A `<placeholder>` value is `null` even when it holds a backticked example; otherwise the
 * backticked span, when there is one, is the command and the rest is prose. `null` when unnamed.
 */
export function negativeCommand(checksBody) {
  for (const raw of (checksBody || '').split('\n')) {
    const m = raw.replace(/^\s*[-*]\s+/, '').match(/^negative(?: controls?|-control command(?: for this repo)?):\s*(.+?)\s*$/i)
    if (!m) continue
    if (/^<.*>$/.test(m[1])) continue
    const span = m[1].match(/`([^`]+)`/)
    const cmd = (span ? span[1] : m[1]).trim()
    if (cmd) return cmd
  }
  return null
}

/**
 * Every `## ` section of the plan, in order: [{ heading, body }]. The agent list is one of them;
 * the brief is the rest.
 */
export function parseSections(lines) {
  const out = []
  let cur = null
  for (const raw of lines) {
    const h = raw.match(/^##\s+(.+?)\s*$/)
    if (h) {
      cur = { heading: h[1], body: [] }
      out.push(cur)
      continue
    }
    if (/^#\s/.test(raw)) {
      cur = null
      continue
    }
    if (cur) cur.body.push(raw)
  }
  return out.map((s) => ({ heading: s.heading, body: s.body.join('\n').trim() }))
}

/**
 * Bullet items of a section body, without their markers. An indented line under a bullet is the
 * same bullet wrapped, and is joined to it with a space: rules in PLAN.md are wrapped at 100
 * columns, and every brief and FINISH.md used to carry only the first physical line ("Never run"
 * with nothing after it).
 */
export function bullets(body) {
  const out = []
  for (const l of (body || '').split('\n')) {
    const item = l.match(/^\s*[-*]\s+(.+)$/)
    if (item) {
      out.push(item[1].trim())
      continue
    }
    if (out.length && /^\s+\S/.test(l)) out[out.length - 1] += ' ' + l.trim()
  }
  return out
}

/**
 * The five parts of a good brief, found by heading. A plan is a brief first and a slice list
 * second: an agent that knows what must not happen can refuse to do it, and one that only knows its
 * files cannot.
 */
export function briefFields(sections) {
  // Anchored, so a coincidental heading ("Page sizes", "Non-goals") cannot fill a brief field.
  const find = (re) => sections.find((s) => re.test(s.heading))?.body || ''
  const mustNot = find(/^(what must not happen|hard rules)\b/i)
  return {
    purpose: find(/^(what it'?s for|purpose|goals?)\b/i),
    users: find(/^who uses it\b/i),
    done: find(/^(what done looks like|definition of done|done means)\b/i),
    mustNot,
    mustNotRules: bullets(mustNot),
    lives: find(/^where it lives\b/i),
    size: find(/^size (and|&) mode\b/i),
    checks: find(/^(checks|how we prove)\b/i),
    openQuestions: find(/^(open questions|needs (you|the owner))\b/i),
  }
}

/** Which of the five brief parts a plan leaves empty. `rig up` warns; it does not refuse. */
export function missingBrief(plan) {
  const want = [
    ['purpose', "What it's for"],
    ['users', 'Who uses it, on what'],
    ['done', 'What done looks like'],
    ['mustNot', 'What must not happen'],
    ['lives', 'Where it lives'],
  ]
  // A section still holding the template's <placeholder> lines counts as empty.
  const placeholder = (text) =>
    text
      .split('\n')
      .map((l) => l.replace(/^\s*[-*]\s+/, '').trim())
      .filter(Boolean)
      .every((l) => /^<.*>$/.test(l))
  return want.filter(([k]) => !plan[k] || placeholder(plan[k])).map(([, label]) => label)
}

export function loadPlan(planPath) {
  if (!existsSync(planPath)) {
    throw new Error(`No plan file at ${planPath}. Run \`rig init\` first — the plan is the contract.`)
  }
  const plan = parsePlan(readFileSync(planPath, 'utf8'))
  if (plan.agents.length === 0) {
    throw new Error(`${planPath} declares no agents. A rig with no slices is just a checkout.`)
  }
  const seen = new Set()
  for (const a of plan.agents) {
    // Ids become directory names and tab labels. `..` or `a/b` would put a worktree — and the
    // processes `rig down` stops inside it — somewhere else entirely.
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(a.id))
      throw new Error(`Slice id "${a.id}" is not a plain name. Use letters, digits, - and _ only (e.g. c1, jr2).`)
    if (seen.has(a.id)) throw new Error(`Duplicate agent id "${a.id}" in the plan. Ids are addresses; they must be unique.`)
    seen.add(a.id)
    if (a.owns.length === 0) throw new Error(`Agent "${a.id}" owns no files. Every agent needs a slice, or it will edit someone else's.`)
  }
  // Two slices writing to one report is two agents overwriting each other's reasoning, and the
  // loser never knows. Reports are addresses too.
  const reports = new Map()
  for (const a of plan.agents) {
    const r = a.report || `docs/build-report-${a.id}.md`
    if (reports.has(r))
      throw new Error(`Agents "${reports.get(r)}" and "${a.id}" both report to ${r}. One of them would overwrite the other.`)
    reports.set(r, a.id)
  }
  return plan
}
