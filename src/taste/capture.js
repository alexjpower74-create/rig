// Screenshots of a reference URL, the way a person first sees it: the opening screen at 1440×900 and
// at 390×844, captured headless through the harness's own CDP client. A URL that fails to load, or
// answers with an HTTP error, is named and skipped: a card of "Page not found" asks for a rating of
// nothing.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { launch } from '../../harness/cdp.js'

export const VIEWS = {
  desktop: { width: 1440, height: 900, dpr: 1, mobile: false },
  phone: { width: 390, height: 844, dpr: 2, mobile: true },
}

/** A free TCP port on 127.0.0.1, so a capture never collides with a debugging port in use. */
export function freePort() {
  return new Promise((res, rej) => {
    const s = createServer()
    s.once('error', rej)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => res(port))
    })
  })
}

/**
 * Capture every URL card into `shotsDir`. With `reuse`, cards whose shots already exist keep them
 * (resuming a round shows what was rated); otherwise every URL is captured fresh, so a new round
 * always shows the site as it is today. Returns { ok: [cards], failed: [{ card, why }] }.
 */
export async function captureAll(cards, shotsDir, { log = console.error, settleMs = 700, timeout = 20_000, reuse = false } = {}) {
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

  const browser = await launch({ headless: true, port: await freePort(), width: 1440, height: 900 })
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
            await page.send('Network.enable')
            page.on('Network.responseReceived', (e) => {
              if (e.type === 'Document' && e.frameId === page.target.id) status = e.response.status
            })
            await page.goto(card.url, { timeout })
            if (status === null) throw new Error('no HTTP response for the page')
            if (status >= 400) throw new Error(`answered HTTP ${status}`)
            await new Promise((r) => setTimeout(r, settleMs))
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
