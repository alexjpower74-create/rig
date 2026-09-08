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
//   Task:
//   Build the hero section...

import { readFileSync, existsSync } from 'node:fs'

/** Turn a gitignore-ish glob into an anchored RegExp. Supports ** , * and ?. */
export function globToRegExp (glob) {
  let out = '^'
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` swallows any number of leading segments, including none.
        if (glob[i + 2] === '/') { out += '(?:.*/)?'; i += 2 } else { out += '.*'; i += 1 }
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

export function matchesAny (path, globs) {
  return globs.some(g => globToRegExp(g).test(path))
}

/** Parse a PLAN.md into { title, agents: [{ id, title, owns, task }] }. */
export function parsePlan (text) {
  const lines = text.split('\n')
  const title = (lines.find(l => l.startsWith('# ')) || '# Untitled').slice(2).trim()

  const agents = []
  let cur = null
  let mode = null

  const push = () => { if (cur) agents.push(cur) }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')

    const head = line.match(/^###\s+(\S+)\s*(?:[—–-]\s*(.*))?$/)
    if (head) {
      push()
      cur = { id: head[1], title: (head[2] || '').trim(), owns: [], task: [] }
      mode = null
      continue
    }
    if (!cur) continue

    // A new `## ` section ends the agent list.
    if (/^##\s+/.test(line)) { push(); cur = null; mode = null; continue }

    if (/^owns:/i.test(line)) { mode = 'owns'; continue }
    if (/^task:/i.test(line)) { mode = 'task'; continue }

    if (mode === 'owns') {
      const item = line.match(/^\s*[-*]\s+(.+)$/)
      if (item) { cur.owns.push(item[1].trim().replace(/^`|`$/g, '')); continue }
      if (line.trim() === '') continue
      mode = null // a non-bullet line ends the Owns block
    }
    if (mode === 'task') cur.task.push(line)
  }
  push()

  for (const a of agents) a.task = a.task.join('\n').trim()
  return { title, agents }
}

export function loadPlan (planPath) {
  if (!existsSync(planPath)) {
    throw new Error(`No plan file at ${planPath}. Run \`rig init\` first — the plan is the contract.`)
  }
  const plan = parsePlan(readFileSync(planPath, 'utf8'))
  if (plan.agents.length === 0) {
    throw new Error(`${planPath} declares no agents. A rig with no slices is just a checkout.`)
  }
  const seen = new Set()
  for (const a of plan.agents) {
    if (seen.has(a.id)) throw new Error(`Duplicate agent id "${a.id}" in the plan. Ids are addresses; they must be unique.`)
    seen.add(a.id)
    if (a.owns.length === 0) throw new Error(`Agent "${a.id}" owns no files. Every agent needs a slice, or it will edit someone else's.`)
  }
  return plan
}
