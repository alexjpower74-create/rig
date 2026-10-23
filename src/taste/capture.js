// Screenshots of a reference URL, the way a person first sees it: the opening screen at 1440×900 and
// at 390×844, captured headless through the harness's own CDP client. A URL that fails to load, or
// answers with an HTTP error, is named and skipped: a card of "Page not found" asks for a rating of
// nothing.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch } from '../../harness/cdp.js'

/** No request in flight for this long, after load, and the page counts as settled. */
export const QUIET_MS = 250
/** A page that never goes quiet (a live ticker, a long poll) is shot after this long anyway. */
export const MAX_SETTLE_MS = 3000

export const VIEWS = {
  desktop: { width: 1440, height: 900, dpr: 1, mobile: false },
  phone: { width: 390, height: 844, dpr: 2, mobile: true },
}

/**
 * Capture every URL card into `shotsDir`. With `reuse`, cards whose shots already exist keep them
 * (resuming a round shows what was rated); otherwise every URL is captured fresh, so a new round
 * always shows the site as it is today. Returns { ok: [cards], failed: [{ card, why }] }.
 *
 * Each shot is taken once the page is ready (see settle()), not after a fixed pause: 5.0's 700 ms per
 * shot was most of the time a round took to open, and still too short for a page that loads late.
 */
export async function captureAll(
  cards,
  shotsDir,
  { log = console.error, quietMs = QUIET_MS, maxSettleMs = MAX_SETTLE_MS, timeout = 20_000, reuse = false } = {},
) {
  const ok = []
  const failed = []
  const todo = []
  mkdirSync(shotsDir, { recursive: true })
  for (const card of cards) {
    const shots = { desktop: join(shotsDir, `${card.id}-desktop.png`), phone: join(shotsDir, `${card.id}-phone.png`) }
    if (reuse && existsSync(shots.desktop) && existsSync(shots.phone)) ok.push({ ...card, shots })
    else todo.push({ ...card, shots })
  }
  if (!todo.length) return { ok, failed }

  const browser = await launch({ headless: true, width: 1440, height: 900 })
  try {
    for (const card of todo) {
      log(`  capturing ${card.url}`)
      try {
        for (const [view, v] of Object.entries(VIEWS)) {
          const page = await browser.newPage(null, { width: v.width, height: v.height, dpr: v.dpr, mobile: v.mobile })
          try {
            // The main document's HTTP status. goto() only throws on network errors and Chrome's
            // own error page; a 404 or 500 with an HTML body loads like any other page.
            let status = null
            const net = inFlight(page)
            await page.send('Network.enable')
            page.on('Network.responseReceived', (e) => {
              if (e.type === 'Document' && e.frameId === page.target.id) status = e.response.status
            })
            await page.goto(card.url, { timeout })
            if (status === null) throw new Error('no HTTP response for the page')
            if (status >= 400) throw new Error(`answered HTTP ${status}`)
            await settle(page, net, { quietMs, maxMs: maxSettleMs })
            const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
            writeFileSync(card.shots[view], Buffer.from(shot.data, 'base64'))
          } finally {
            await page.close()
          }
        }
        ok.push(card)
      } catch (e) {
        failed.push({ card, why: e.message })
        log(`\x1b[33m  skipped ${card.url}: ${e.message}\x1b[0m`)
      }
    }
  } finally {
    await browser.close()
  }
  return { ok, failed }
}

/** Requests this page has in flight, kept from before the navigation starts: { count, lastChange }. */
export function inFlight(page) {
  const live = new Set()
  const net = { count: 0, lastChange: Date.now() }
  const set = () => {
    net.count = live.size
    net.lastChange = Date.now()
  }
  page.on('Network.requestWillBeSent', (e) => (live.add(e.requestId), set()))
  page.on('Network.loadingFinished', (e) => (live.delete(e.requestId), set()))
  page.on('Network.loadingFailed', (e) => (live.delete(e.requestId), set()))
  return net
}

/**
 * Wait until the page is what a person would see: its web fonts loaded, every image decoded, no
 * request in flight for `quietMs` (a late fetch that fills the hero counts), and two frames painted
 * since. At most `maxMs`; a page that never settles is shot as it is then. Resolves the ms it took.
 */
export async function settle(page, net, { quietMs = QUIET_MS, maxMs = MAX_SETTLE_MS } = {}) {
  const start = Date.now()
  const left = () => Math.max(0, maxMs - (Date.now() - start))
  const inPage = (expr) => Promise.race([page.eval(expr).catch(() => null), new Promise((r) => setTimeout(r, left()))])
  await inPage(`(async () => {
    await document.fonts?.ready
    // Listen, never assign: a page that reveals an image in its own onload (a fade-in, a placeholder
    // swapped out) keeps that handler, or it is shot unrevealed (r55m's delta review of e80d49e).
    await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => {
      i.addEventListener('load', r, { once: true })
      i.addEventListener('error', r, { once: true })
    }))))
  })()`)
  while (left() > 0 && (net.count > 0 || Date.now() - net.lastChange < quietMs)) await new Promise((r) => setTimeout(r, 25))
  await inPage('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))')
  return Date.now() - start
}
