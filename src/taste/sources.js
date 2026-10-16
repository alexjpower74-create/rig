// Where a taste round's references come from: image files in a folder, URLs on the command line, and
// URLs in the plan's `## The best at this job` section. Each becomes one card with a stable id, so a
// rating given yesterday still belongs to the same reference after the round is rebuilt today.

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { bullets, parseSections } from '../plan.js'

export const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
}

const short = (s) => createHash('sha1').update(s).digest('hex').slice(0, 6)
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

/** `stripe-phone.png` → { stem: 'stripe', view: 'phone' }. A file with no view suffix is one shot. */
function viewOf(file) {
  const stem = basename(file, extname(file))
  const m = stem.match(/^(.*?)[-_. @](desktop|phone|mobile)$/i)
  if (!m) return { stem, view: null }
  return { stem: m[1], view: m[2].toLowerCase() === 'desktop' ? 'desktop' : 'phone' }
}

/**
 * Image files in `dir`, in name order. `name-desktop.png` and `name-phone.png` pair up into one card
 * shown side by side; any other image is a card of its own.
 */
export function imageCards(dir, prefix = 'f') {
  const abs = resolve(dir)
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error(`No folder at ${dir}.`)
  const files = readdirSync(abs)
    .filter((f) => IMAGE_TYPES[extname(f).toLowerCase()] && !f.startsWith('.'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const byStem = new Map()
  const cards = []
  for (const f of files) {
    const { stem, view } = viewOf(f)
    if (view) {
      let card = byStem.get(stem)
      if (!card) {
        card = { id: `${prefix}-${slug(stem)}-${short(stem)}`, name: stem, source: 'file', shots: {} }
        byStem.set(stem, card)
        cards.push(card)
      }
      card.shots[view] = join(abs, f)
    } else {
      cards.push({ id: `${prefix}-${slug(f)}-${short(f)}`, name: f, source: 'file', shots: { single: join(abs, f) } })
    }
  }
  return cards
}

/** Every http(s) URL in a piece of text, without trailing punctuation or Markdown link brackets. */
export function urlsIn(text) {
  const out = []
  for (const m of (text || '').matchAll(/https?:\/\/[^\s<>()`"'\]]+/g)) {
    const u = m[0].replace(/[.,;:!?*_]+$/, '')
    if (!out.includes(u)) out.push(u)
  }
  return out
}

/** URLs in the bullets of the plan's `## The best at this job` (or `## References`) section. */
export function planUrls(planText) {
  const sections = parseSections((planText || '').split('\n'))
  const best = sections.find((s) => /^(the best at this job|references)\b/i.test(s.heading))
  if (!best) return []
  return bullets(best.body).flatMap(urlsIn)
}

/** A URL as a card name: host and path, without the scheme or a trailing slash. */
export function urlName(u) {
  try {
    const p = new URL(u)
    return (p.host + p.pathname + p.search).replace(/\/$/, '')
  } catch {
    return u
  }
}

export const urlId = (u) => `u-${slug(urlName(u))}-${short(u)}`

export function readPlan(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}
