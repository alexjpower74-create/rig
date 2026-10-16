// A taste board's state lives in one file, `.rig/taste/ratings.json`, rewritten whole on every
// answer: a closed tab, a crashed server or a flat battery loses nothing that was tapped.
// `docs/TASTE.md` is written from that file alone, so `rig taste --done` works with no server.
//
// The file keeps every round. A new round never replaces an old one: it is added after it, and
// answers a reference already had carry into the new round. Re-running `rig taste` with a folder
// left off, or a comps round on its own, used to write an empty round over every earlier rating.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { rigDir } from '../rigdir.js'

export const PRINCIPLES_PLACEHOLDER = '<name the principles behind these ratings before any design starts>'

export const tasteDir = (root) => join(rigDir(root), 'taste')
export const ratingsPath = (root) => join(tasteDir(root), 'ratings.json')
export const boardPath = (root) => join(tasteDir(root), 'board.json')
export const shotsDir = (root) => join(tasteDir(root), 'shots')
export const tasteMdPath = (root) => join(root, 'docs', 'TASTE.md')

/** A date as the person reads it on their own clock: YYYY-MM-DD in local time, never UTC. */
export function localDay(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function emptyRound(n, now = new Date()) {
  return {
    n,
    started: now.toISOString(),
    day: localDay(now),
    question: null,
    refs: [],
    comps: [],
    ratings: {},
    compRatings: {},
    pick: null,
  }
}

/** { version: 2, rounds: [...] }, oldest first; null when this repo has never had a round. */
export function loadState(root) {
  const p = join(root, '.rig', 'taste', 'ratings.json')
  if (!existsSync(p)) return null
  const raw = JSON.parse(readFileSync(p, 'utf8'))
  if (Array.isArray(raw.rounds)) return raw
  // A first-draft file held one round at the top level: it becomes round 1.
  const { version, ...round } = raw
  return { version: 2, rounds: [{ ...emptyRound(1), ...round, n: 1 }] }
}

/** Write the whole state at once, through a temp file, so a crash mid-write leaves the last good copy. */
export function saveState(root, state) {
  const p = ratingsPath(root)
  mkdirSync(dirname(p), { recursive: true })
  const tmp = `${p}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n')
  renameSync(tmp, p)
}

export const currentRound = (state) => state?.rounds?.[state.rounds.length - 1] || null

const ids = (cards) => cards.map((c) => c.id).join('\n')

/** True when `round` is over exactly these cards and this question, so running again resumes it. */
export function sameRound(round, { refs, comps, question }) {
  return (
    !!round &&
    ids(round.refs) === ids(refs) &&
    ids(round.comps) === ids(comps) &&
    (round.question || null) === (comps.length ? question || null : null)
  )
}

/**
 * Open the round over `refs` and `comps`. The same cards and question as the newest round resume it
 * (its cards are refreshed, its answers kept). Anything else adds a new round after the others;
 * each card starts with the newest answer it was given in any earlier round. Returns
 * { state, round, resumed }. Nothing is ever removed.
 */
export function openRound(prev, { refs, comps, question }, now = new Date()) {
  const state = prev ? { ...prev, rounds: [...prev.rounds] } : { version: 2, rounds: [] }
  const last = currentRound(state)
  if (sameRound(last, { refs, comps, question })) {
    Object.assign(last, { refs, comps })
    return { state, round: last, resumed: true }
  }
  const latest = (key, id) => {
    for (let i = state.rounds.length - 1; i >= 0; i--) {
      const a = state.rounds[i][key]?.[id]
      if (a) return { ...a }
    }
    return null
  }
  const carry = (key, cards) => Object.fromEntries(cards.map((c) => [c.id, latest(key, c.id)]).filter(([, a]) => a))
  const round = {
    ...emptyRound(state.rounds.length + 1, now),
    question: comps.length ? question || null : null,
    refs,
    comps,
    ratings: carry('ratings', refs),
    compRatings: carry('compRatings', comps),
  }
  state.rounds.push(round)
  return { state, round, resumed: false }
}

const cell = (s) =>
  String(s ?? '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()

/** A card's name for the record: the URL for a captured site, the file name for an image. Never a path. */
const label = (c) => (c.url ? c.url : c.name)

/** The `## Principles` body of an existing TASTE.md, when someone has written real principles there. */
function keptPrinciples(text) {
  const m = text.match(/^## Principles[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)
  const body = m ? m[1].trim() : ''
  return body && body !== PRINCIPLES_PLACEHOLDER ? body : null
}

const answered = (r) =>
  Object.values(r.ratings).some((a) => a.rating || a.note) || Object.values(r.compRatings).some((a) => a.rating || a.note) || !!r.pick

/**
 * docs/TASTE.md as Markdown. Pure: the caller decides where it goes. Every round with an answer is
 * listed, newest first: one table per round under `## Ratings`, and one `## Comps — "<question>"`
 * section per comps round.
 */
export function tasteMarkdown(state, { date = new Date(), previous = '' } = {}) {
  const cur = currentRound(state)
  const rounds = state.rounds.filter((r) => r === cur || answered(r)).reverse()
  const withRefs = rounds.filter((r) => r.refs.length)
  const rated = cur ? cur.refs.filter((r) => cur.ratings[r.id]?.rating).length : 0
  const many = rounds.length > 1
  const lines = [
    '# Taste',
    '',
    `Rated ${localDay(date)}: ${rated} of ${cur?.refs.length || 0} references${cur?.comps.length ? `, ${cur.comps.length} comps` : ''} in round ${cur?.n || 0}${many ? `; ${rounds.length} rounds below, newest first` : ''}. Written by \`rig taste\`; the ratings outrank anyone's own taste.`,
    '',
    '## Ratings',
    '',
  ]
  if (!withRefs.length) lines.push('No references in this round.', '')
  for (const r of withRefs) {
    if (many) lines.push(`### Round ${r.n} · ${r.day}`, '')
    lines.push('| Reference | Rating | Note |', '| --- | --- | --- |')
    for (const c of r.refs) {
      const a = r.ratings[c.id] || {}
      lines.push(`| ${cell(label(c))} | ${a.rating ? `${a.rating} / 5` : '—'} | ${cell(a.note)} |`)
    }
    lines.push('')
  }
  for (const r of rounds.filter((x) => x.comps.length)) {
    lines.push(`## Comps — "${cell(r.question || 'Which one?')}"`, '')
    if (many) lines.push(`Round ${r.n} · ${r.day}`, '')
    lines.push('| Comp | Rating | Picked | Note |', '| --- | --- | --- | --- |')
    for (const c of r.comps) {
      const a = r.compRatings[c.id] || {}
      lines.push(`| ${cell(label(c))} | ${a.rating ? `${a.rating} / 5` : '—'} | ${r.pick === c.id ? '★' : ''} | ${cell(a.note)} |`)
    }
    lines.push('')
  }
  lines.push('## Principles', '', keptPrinciples(previous) || PRINCIPLES_PLACEHOLDER, '')
  return lines.join('\n')
}

export function writeTasteMd(root, state, opts = {}) {
  const p = tasteMdPath(root)
  mkdirSync(dirname(p), { recursive: true })
  const previous = existsSync(p) ? readFileSync(p, 'utf8') : ''
  writeFileSync(p, tasteMarkdown(state, { ...opts, previous }))
  return p
}

/** A short stamp of a file's size and mtime: it changes when the image does, so its URL does too. */
export function stamp(path) {
  try {
    const s = statSync(path)
    return createHash('sha1').update(`${s.size}:${s.mtimeMs}`).digest('hex').slice(0, 10)
  } catch {
    return 'gone'
  }
}

/** What the page gets: this round's cards without their file paths, and every answer so far. */
export function publicState(round, token = null) {
  const card = (c) => ({
    id: c.id,
    name: c.url || c.name,
    views: Object.keys(c.shots),
    v: Object.fromEntries(Object.entries(c.shots).map(([k, p]) => [k, stamp(p)])),
  })
  return {
    token,
    round: round.n,
    question: round.question,
    refs: round.refs.map(card),
    comps: round.comps.map(card),
    ratings: round.ratings,
    compRatings: round.compRatings,
    pick: round.pick,
  }
}
