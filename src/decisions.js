// Decision records. A meeting answer once reached a build only through a late review: it was said in
// a thread, nobody wrote it where the crew reads, and the code went the other way. A decision is now
// a row in docs/DECISIONS.md with an id, a date, what was decided, where it was decided, and a
// status, and `rig finish` refuses while any decision made this round is still open.
//
// The file is the record (tracked, reviewed, merged like code); a person can edit it by hand. Rows
// are one markdown table so it reads well on GitHub and parses without a dependency.

import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tryGit } from './sh.js'

export const DECISIONS = 'docs/DECISIONS.md'
export const decisionsPath = (root) => join(root, DECISIONS)

const HEADER = `# Decisions

What was decided for the build, where it was decided, and whether the build carries it. Add one with
\`rig decision "<what was decided>" --source <transcript|thread>\`; close it with
\`rig decision <id> --built\`, \`--scheduled <round>\` or \`--not-in-scope\`. \`rig finish\` lists every
decision made since the round started and refuses while one of them is open.

| id | date | what | source | status |
| --- | --- | --- | --- | --- |
`

/** Statuses a decision can be closed with. `open` is the only one that fails the gate. */
export const CLOSED = ['built', 'scheduled', 'not-in-scope']

const esc = (s) =>
  String(s)
    .replace(/\r?\n+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()
const unesc = (s) => s.replace(/\\\|/g, '|').trim()

/** Split a table row on unescaped pipes. */
function cells(line) {
  const out = []
  let cur = ''
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && line[i + 1] === '|') {
      cur += '\\|'
      i++
    } else if (line[i] === '|') {
      out.push(cur)
      cur = ''
    } else cur += line[i]
  }
  out.push(cur)
  return out.slice(1, -1).map(unesc)
}

/**
 * Every decision in the text, in file order: { id, n, date, what, source, status, kind, line }.
 * `kind` is the status's first word (open, built, scheduled, not-in-scope); an unknown word is open,
 * so a typo can never close a decision.
 */
export function parseDecisions(text) {
  const out = []
  const lines = String(text || '').split('\n')
  lines.forEach((line, i) => {
    const m = /^\|\s*D(\d+)\s*\|/.exec(line)
    if (!m) return
    const [id, date, what, source, status = 'open'] = cells(line.trim())
    const word = (status.split(/[\s(]/)[0] || 'open').toLowerCase()
    const kind = CLOSED.includes(word) ? word : 'open'
    out.push({ id, n: Number(m[1]), date, what, source, status: status || 'open', kind, line: i })
  })
  return out
}

export function readDecisions(root) {
  const p = decisionsPath(root)
  return existsSync(p) ? parseDecisions(readFileSync(p, 'utf8')) : []
}

/** The decisions as committed at `ref` (a sha or branch), or [] when the file is not there. */
export function decisionsAt(root, ref) {
  const r = tryGit(['show', `${ref}:${DECISIONS}`], root)
  return r.ok ? parseDecisions(r.out) : []
}

function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, path)
}

const today = (now = new Date()) => now.toISOString().slice(0, 10)

/** Append one open decision; returns it. The id is one past the highest in the file. */
export function addDecision(root, { what, source, now = new Date() }) {
  if (!what || !String(what).trim())
    throw new Error('rig decision: say what was decided, e.g. rig decision "refunds round down" --source <link>')
  if (!source || !String(source).trim())
    throw new Error('rig decision: --source <transcript|thread> is required: a decision nobody can trace back is a rumour')
  const p = decisionsPath(root)
  let text = existsSync(p) ? readFileSync(p, 'utf8') : HEADER
  if (!/^\|\s*id\s*\|/m.test(text)) text = text.replace(/\n*$/, '\n\n') + HEADER.slice(HEADER.indexOf('| id'))
  const n = Math.max(0, ...parseDecisions(text).map((d) => d.n)) + 1
  const d = { id: `D${n}`, n, date: today(now), what: esc(what), source: esc(source), status: 'open', kind: 'open' }
  const row = `| ${d.id} | ${d.date} | ${d.what} | ${d.source} | open |`
  // Append after the table's last row, so prose under the table stays under it.
  const lines = text.replace(/\n*$/, '').split('\n')
  let last = -1
  lines.forEach((l, i) => {
    if (/^\|/.test(l)) last = i
  })
  lines.splice(last + 1, 0, row)
  writeAtomic(p, lines.join('\n') + '\n')
  return { ...d, what: unesc(d.what), source: unesc(d.source) }
}

/**
 * Close (or reopen) a decision: kind is 'built', 'scheduled' (with a round), 'not-in-scope' or 'open'.
 * Returns the decision as written. Throws when the id is not in the file.
 */
export function setStatus(root, id, kind, { round = null, now = new Date() } = {}) {
  const p = decisionsPath(root)
  const want = String(id)
    .toUpperCase()
    .replace(/^(?!D)/, 'D')
  const text = existsSync(p) ? readFileSync(p, 'utf8') : ''
  const found = parseDecisions(text).find((d) => d.id.toUpperCase() === want)
  if (!found) throw new Error(`rig decision: no decision ${want} in ${DECISIONS}`)
  if (kind === 'scheduled' && !round) throw new Error('rig decision: --scheduled needs the round it is scheduled for, e.g. --scheduled 5.6')
  const status = kind === 'open' ? 'open' : kind === 'scheduled' ? `scheduled ${esc(round)} (${today(now)})` : `${kind} (${today(now)})`
  const lines = text.split('\n')
  lines[found.line] = `| ${found.id} | ${esc(found.date)} | ${esc(found.what)} | ${esc(found.source)} | ${status} |`
  writeAtomic(p, lines.join('\n'))
  return { ...found, status, kind }
}

/**
 * Where this round started: the oldest point a slice branch was cut from. That is the commit the
 * branch's reflog was created at (\`rig up\` cuts every slice from the base), else its merge base with
 * \`base\` (after a merge, that is the slice's tip: later than the cut, so fewer decisions count, never
 * more). Null when no slice branch is left to say.
 * @returns {{ ref: string, from: string } | null}
 */
export function roundStart(root, base, agents = [], branchPrefix = 'rig/') {
  let oldest = null
  for (const a of agents) {
    const ref = `refs/heads/${branchPrefix}${a.id}`
    if (!tryGit(['show-ref', '--verify', '--quiet', ref], root).ok) continue
    const log = tryGit(['reflog', 'show', '--format=%H', ref, '--'], root)
    const created = log.ok && log.out ? log.out.split('\n').pop() : null
    const point = created
      ? { ref: created, from: `${a.id} was cut here` }
      : (() => {
          const mb = tryGit(['merge-base', base, ref], root)
          return mb.ok && mb.out ? { ref: mb.out, from: `${a.id}'s merge base` } : null
        })()
    if (!point) continue
    if (!oldest || tryGit(['merge-base', '--is-ancestor', point.ref, oldest.ref], root).ok) oldest = point
  }
  return oldest
}

/**
 * The decisions this round made, as committed on `head`: every row on head that was not in the file
 * at `since`. With no `since`, every row counts (said in `scope`).
 * @returns {{ round: object[], older: object[], scope: string }}
 */
export function roundDecisions(root, head, since) {
  const all = decisionsAt(root, head)
  if (!since) return { round: all, older: [], scope: 'every decision (no round start found; pass --since <ref>)' }
  const before = new Set(decisionsAt(root, since.ref).map((d) => d.id))
  return {
    round: all.filter((d) => !before.has(d.id)),
    older: all.filter((d) => before.has(d.id)),
    scope: `since ${since.ref.slice(0, 7)} (${since.from})`,
  }
}
