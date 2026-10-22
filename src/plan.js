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
  return { title, agents, sections, ...fields, ui: uiLine(text), negativeCommand: negativeCommand(fields.checks) }
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
 * The parts of a good brief, found by heading. A plan is a brief first and a slice list second: an
 * agent that knows what must not happen can refuse to do it, and one that only knows its files
 * cannot. Rig 5 adds the parts an agent cannot guess: the feeling, the specialist, the best work to
 * start from (and what not to make), and the bar, with a number.
 */
export function briefFields(sections) {
  // Anchored, so a coincidental heading ("Page sizes", "Non-goals") cannot fill a brief field.
  const find = (re) => sections.find((s) => re.test(s.heading))?.body || ''
  // "What must not happen", "What must not change" and "What must not happen or change" are one
  // list. A plan that has two of them meant both, so their rules are combined, never one dropped.
  const mustNot = sections
    .filter((s) => /^(what must not (happen|change)|hard rules)\b/i.test(s.heading))
    .map((s) => s.body)
    .filter(Boolean)
    .join('\n')
  const refs = splitAnti(find(/^(the best at this job|references)\b/i))
  const antiSection = find(/^anti-?references\b/i)
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
    feeling: find(/^(the feeling|the one quality)\b/i),
    specialist: find(/^the specialist\b/i),
    referencesText: refs.refs,
    references: bullets(refs.refs),
    antiReferences: [...bullets(refs.anti), ...bullets(antiSection)],
    bar: find(/^the bar\b/i),
    start: find(/^where we.?re starting from\b/i),
    freedom: find(/^freedom\b/i),
    tools: find(/^tools\b/i),
    budget: find(/^budget (and|&) autonomy\b/i),
    handBack: find(/^what to hand back\b/i),
    refusals: find(/^refusals\b/i),
  }
}

// ------------------------------------------------------------------------------------------------
// Item 14: the refusal → repair matrix. Dead ends (a move refused with no way to fix it) were the
// largest class of defects found in one review round, so a plan whose work is a UI over rules lists
// every refusal a screen can hit and its repair: the field to fill, or the message naming who acts.

/** The plan's own `UI:` line (`UI: none`, `UI: web`…), lower-cased, or null when it has none. */
export function uiLine(text) {
  const m = (text || '').match(/^\s*[-*]?\s*\**UI\**:\**\s*(.+?)\s*$/m)
  return m ? m[1].replace(/[`*.]/g, '').trim().toLowerCase() : null
}

// A file a person looks at: markup, styles, components, screens.
const UI_PATH =
  /\.(html?|css|scss|jsx|tsx|vue|svelte|astro|swift|kt|xib|storyboard)\b|(^|\/)(ui|web|views?|pages|screens|components|app\/routes|public)(\/|$)/i
// Words that say there is a screen…
const UI_WORDS = /\b(screens?|pages?|forms?|buttons?|dialogs?|modals?|taps?|clicks?)\b/i
// …and words that say it enforces rules (refuses some moves).
const RULE_WORDS =
  /\b(rules?|refus\w*|reject\w*|validat\w*|permissions?|approv\w*|not allowed|allow(ed|s)?|forbid\w*|blocked|limits?|quota|eligib\w*|disabled?)\b/i

/** The refusal rows of a `## Refusals` body that are filled in: table rows or bullets, not the template's. */
export function refusalRows(body) {
  const rows = []
  for (const raw of (body || '').split('\n')) {
    const l = raw.trim()
    if (!l) continue
    let cells
    if (l.startsWith('|')) {
      cells = l
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim())
      if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) continue // the separator row
      if (/^refusal\b/i.test(cells[0])) continue // the header row
    } else if (/^[-*]\s+/.test(l)) cells = l.replace(/^[-*]\s+/, '').split(/\s*(?:→|->)\s*/)
    else continue
    if (cells.every((c) => /^<.*>$/.test(c) || c === '')) continue // the template's own example
    rows.push(cells.join(' → '))
  }
  return rows
}

/**
 * Why this plan needs a `## Refusals` matrix it does not have, as a sentence, or null when it has
 * one or needs none. A UI over rules is one of:
 * - a `UI:` line that is not `none`;
 * - a slice that owns UI files (not tests, examples or fixtures), and rule words anywhere in the
 *   brief or a task (rules, refusals, validation, permissions, limits);
 * - one sentence of the brief (not a task) that names a screen AND a rule ("a claim form that
 *   refuses claims over the limit").
 * Words alone have to meet in one sentence: a CLI plan says "page" in one place and "blocked" in
 * another, and the first version of this warned on the very plan it shipped in. The hard rules for
 * the agents (What must not happen, Rules) do not count as rules the product enforces.
 */
export function refusalsGap(plan) {
  const ui = plan.ui ?? null
  if (ui === 'none' || ui === 'no') return null
  if (refusalRows(plan.refusals).length) return null
  if (ui) return `its UI: line says "${ui}"`
  const clean = (parts) => parts.map((t) => withoutPlaceholders(t || '').replace(/`[^`]*`/g, ' ')).join('\n\n')
  // The brief says what the product is. Tasks say how to build it and talk about the crew's own
  // tools ("a permission dialog goes to the human"), so they count for rules, never for a screen.
  const brief = clean([plan.purpose, plan.users, plan.done, plan.feeling, plan.bar, plan.start])
  const prose = clean([brief, ...plan.agents.map((a) => a.task)])
  // Test fixtures and examples are pages nobody uses.
  const uiPath = plan.agents
    .flatMap((a) => a.owns)
    .find((o) => UI_PATH.test(o) && !/(^|\/)(tests?|examples?|fixtures?|__tests__)\//.test(o))
  if (uiPath) {
    const rule = prose.match(RULE_WORDS)?.[0]
    return rule ? `a slice owns ${uiPath} and the plan says "${rule}"` : null
  }
  for (const sentence of sentences(brief)) {
    const w = sentence.match(UI_WORDS)?.[0]
    const r = w && sentence.match(RULE_WORDS)?.[0]
    if (r) return `it talks about "${w}" and "${r}" in one sentence`
  }
  return null
}

/** Sentences of prose: split at . ! ? and at every paragraph, bullet and numbered item. */
function sentences(text) {
  return text
    .split(/(?<=[.!?])\s+|\n\s*\n|\n\s*(?:[-*]|\d+[.)])\s+/)
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/** A references body split at its `Anti-references:` line: what to start from, and what not to make. */
function splitAnti(body) {
  const lines = (body || '').split('\n')
  const at = lines.findIndex((l) => /^\s*\**anti-?references\**:?\**\s*$/i.test(l))
  if (at < 0) return { refs: body || '', anti: '' }
  return {
    refs: lines.slice(0, at).join('\n').trim(),
    anti: lines
      .slice(at + 1)
      .join('\n')
      .trim(),
  }
}

// A placeholder hugs its brackets with words: `<the one command>`, never `< 200 ms` or `x<3 and y>2`.
// Bars are where `<` and `>` turn up as comparisons ("answers in < 200 ms and fails > 1 time",
// "latency<200 ms and jank>1 frame"), and reading one as a placeholder once dropped the bar from every
// brief while nothing warned. So no space or digit right inside either bracket.
const WHOLE_PLACEHOLDER = /^<(?![\s\d])[^<>]*[^<>\s\d]>$/
// Inside a line, one counts as prose (and takes the line with it) when it is a phrase: three words.
const PROSE_PLACEHOLDER = /<(?![\s\d])[^<>`\n]*\s[^<>`\n]*\s[^<>`\n]*[^<>`\s\d]>/

/**
 * A section body with the template's `<placeholder>` text taken out. A line that is wholly a
 * placeholder goes, and so does a line carrying one written as prose (`Negative controls: <the one
 * command ...>`), so a half-filled template never reaches an agent as if it were the plan. Short
 * angle-bracket names (`<id>`, `<sha>`) and anything inside backticks are real text and stay.
 */
export function withoutPlaceholders(body) {
  return (body || '')
    .split('\n')
    .filter((l) => {
      const t = l.replace(/^\s*[-*]\s+/, '').trim()
      if (WHOLE_PLACEHOLDER.test(t)) return false
      return !PROSE_PLACEHOLDER.test(t.replace(/`[^`]*`/g, ''))
    })
    .join('\n')
    .trim()
}

/**
 * Lines the placeholder rule takes out of the briefs that still hold a number outside the placeholder:
 * [{ heading, line }]. A template line that is all placeholder is not one of them. Anything here is a
 * line an agent will never see, so `rig up` names each one: nothing numeric disappears without a word.
 */
export function droppedNumbers(plan) {
  const out = []
  for (const { heading, body } of plan.sections || []) {
    if (/^(agents|slices)\b/i.test(heading)) continue
    const kept = new Set(withoutPlaceholders(body).split('\n'))
    for (const l of body.split('\n')) {
      if (kept.has(l)) continue
      const t = l.replace(/^\s*[-*]\s+/, '').trim()
      if (!t || WHOLE_PLACEHOLDER.test(t)) continue
      const rest = t.replace(/`[^`]*`/g, '').replace(new RegExp(PROSE_PLACEHOLDER.source, 'g'), '')
      if (/\d/.test(rest)) out.push({ heading, line: t })
    }
  }
  return out
}

const isPlaceholder = (text) =>
  text
    .split('\n')
    .map((l) => l.replace(/^\s*[-*]\s+/, '').trim())
    .filter(Boolean)
    .every((l) => WHOLE_PLACEHOLDER.test(l))

/**
 * Which brief parts a plan leaves empty. `rig up` warns; it does not refuse. With `{ aim: true }`
 * (what `rig up` asks for) it also names the three an agent cannot guess: The feeling, The best at
 * this job and The bar. Without it the answer is Rig 4's five, so a caller written for them still
 * counts five.
 */
export function missingBrief(plan, { aim = false } = {}) {
  const want = [
    ['purpose', "What it's for"],
    ['users', 'Who uses it, on what'],
    ['done', 'What done looks like'],
    ['mustNot', 'What must not happen'],
    ['lives', 'Where it lives'],
  ]
  if (aim) want.push(['feeling', 'The feeling'], ['referencesText', 'The best at this job'], ['bar', 'The bar'])
  // A section still holding the template's <placeholder> lines counts as empty.
  return want.filter(([k]) => !plan[k] || isPlaceholder(plan[k])).map(([, label]) => label)
}

/**
 * True when the plan has a bar and no digit in it. "Fast" and "beautiful" cannot go red; "found in
 * under 10 s" can. An empty bar is missingBrief's to name, not this.
 */
export function barHasNoNumber(plan) {
  const bar = withoutPlaceholders(plan.bar || '')
  return bar !== '' && !/\d/.test(bar)
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
