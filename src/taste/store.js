// The round's state lives in one file, `.rig/taste/ratings.json`, rewritten whole on every answer:
// a closed tab, a crashed server or a flat battery loses nothing he has tapped. `docs/TASTE.md` is
// written from that file alone, so `rig taste --done` works with no server running.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { rigDir } from '../rigdir.js'

export const PRINCIPLES_PLACEHOLDER = '<name the principles behind these ratings before any design starts>'

export const tasteDir = (root) => join(rigDir(root), 'taste')
export const ratingsPath = (root) => join(tasteDir(root), 'ratings.json')
export const shotsDir = (root) => join(tasteDir(root), 'shots')
export const tasteMdPath = (root) => join(root, 'docs', 'TASTE.md')

export function emptyState() {
  return { version: 1, question: null, refs: [], comps: [], ratings: {}, compRatings: {}, pick: null }
}

export function loadState(root) {
  const p = join(root, '.rig', 'taste', 'ratings.json')
  if (!existsSync(p)) return null
  return { ...emptyState(), ...JSON.parse(readFileSync(p, 'utf8')) }
}

/** Write the whole state at once, through a temp file, so a crash mid-write leaves the last good copy. */
export function saveState(root, state) {
  const p = ratingsPath(root)
  mkdirSync(dirname(p), { recursive: true })
  const tmp = `${p}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n')
  renameSync(tmp, p)
}

/**
 * A new round over `refs` and `comps`. Answers already given to a reference with the same id carry
 * over, so re-running `rig taste` with one more URL does not throw away the first five ratings.
 */
export function newRound(prev, { refs, comps, question }) {
  const keep = (answers, cards) => Object.fromEntries(cards.filter((c) => answers?.[c.id]).map((c) => [c.id, answers[c.id]]))
  return {
    ...emptyState(),
    question: comps.length ? question || null : null,
    refs,
    comps,
    ratings: keep(prev?.ratings, refs),
    compRatings: keep(prev?.compRatings, comps),
    pick: prev?.pick && comps.some((c) => c.id === prev.pick) ? prev.pick : null,
  }
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

/** docs/TASTE.md as Markdown. Pure: the caller decides where it goes. */
export function tasteMarkdown(state, { date = new Date(), previous = '' } = {}) {
  const day = date.toISOString().slice(0, 10)
  const rated = state.refs.filter((r) => state.ratings[r.id]?.rating).length
  const lines = [
    '# Taste',
    '',
    `Rated ${day}: ${rated} of ${state.refs.length} references${state.comps.length ? `, ${state.comps.length} comps` : ''}. Written by \`rig taste\`; the ratings outrank anyone's own taste.`,
    '',
    '## Ratings',
    '',
    '| Reference | Rating | Note |',
    '| --- | --- | --- |',
  ]
  for (const r of state.refs) {
    const a = state.ratings[r.id] || {}
    lines.push(`| ${cell(label(r))} | ${a.rating ? `${a.rating} / 5` : '—'} | ${cell(a.note)} |`)
  }
  if (state.comps.length) {
    lines.push(
      '',
      `## Comps — "${cell(state.question || 'Which one?')}"`,
      '',
      '| Comp | Rating | Picked | Note |',
      '| --- | --- | --- | --- |',
    )
    for (const c of state.comps) {
      const a = state.compRatings[c.id] || {}
      lines.push(`| ${cell(label(c))} | ${a.rating ? `${a.rating} / 5` : '—'} | ${state.pick === c.id ? '★' : ''} | ${cell(a.note)} |`)
    }
  }
  lines.push('', '## Principles', '', keptPrinciples(previous) || PRINCIPLES_PLACEHOLDER, '')
  return lines.join('\n')
}

export function writeTasteMd(root, state, opts = {}) {
  const p = tasteMdPath(root)
  mkdirSync(dirname(p), { recursive: true })
  const previous = existsSync(p) ? readFileSync(p, 'utf8') : ''
  writeFileSync(p, tasteMarkdown(state, { ...opts, previous }))
  return p
}

/** What the page gets: cards without their file paths, plus every answer so far. */
export function publicState(state) {
  const card = (c) => ({ id: c.id, name: c.url || c.name, views: Object.keys(c.shots) })
  return {
    question: state.question,
    refs: state.refs.map(card),
    comps: state.comps.map(card),
    ratings: state.ratings,
    compRatings: state.compRatings,
    pick: state.pick,
  }
}
