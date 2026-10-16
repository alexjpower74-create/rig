// rig taste, driven the way he uses it: real taps and clicks through the harness, at points checked
// with elementFromPoint, against the real server writing real files.
//
// Headless Chrome on debugging port 9352, the board on 5391, always --no-open: no window ever opens
// on anyone's screen. Every image is generated here; none is anyone's real work.
//
// The bar from the plan: 6 references in at most 7 taps (one per reference plus Done), with no typing
// and no scrolling, at 1440×900 and at 390×844. It runs as a target with a broken run beside it: a
// board whose rating buttons stop advancing by themselves has to cost more taps than the bar allows.
//
// Set RIG_TASTE_SHOTS=<dir> to also write the screenshots for docs/shots/ from the same real walk.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import * as H from '../harness/index.js'
import { runTaste } from '../src/commands/taste.js'
import { handlers } from '../src/taste/server.js'
import { tasteMarkdown } from '../src/taste/store.js'

const { suite, launch, click, tap, type, wheel, swipe, meetsTouchTarget, sleep } = H
const here = dirname(fileURLToPath(import.meta.url))
const RIG = join(here, '..', 'bin', 'rig.js')
const CDP_PORT = 9352
const BOARD_PORT = 5391
const SHOTS = process.env.RIG_TASTE_SHOTS || null

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────

/** A made-up site, drawn as SVG: nav, headline, image block, three cards. Nobody's real work. */
function mockSite({ w, h, bg, ink, accent, card, name, line, phone = false }) {
  const pad = phone ? 22 : 96
  const navH = phone ? 56 : 72
  const head = phone ? 34 : 64
  const cols = phone ? 1 : 3
  const cw = (w - pad * 2 - (cols - 1) * 24) / cols
  const top = navH + (phone ? 40 : 80)
  const cardsY = top + head * 2.6 + (phone ? 230 : 120)
  const cards = Array.from({ length: phone ? 2 : 3 }, (_, i) => {
    const x = phone ? pad : pad + i * (cw + 24)
    const y = phone ? cardsY + i * 170 : cardsY
    return `<rect x="${x}" y="${y}" width="${cw}" height="${phone ? 150 : 190}" rx="14" fill="${card}"/>
<rect x="${x + 20}" y="${y + 24}" width="${cw * 0.5}" height="14" rx="7" fill="${ink}" opacity=".8"/>
<rect x="${x + 20}" y="${y + 52}" width="${cw * 0.75}" height="10" rx="5" fill="${ink}" opacity=".35"/>
<rect x="${x + 20}" y="${y + 72}" width="${cw * 0.6}" height="10" rx="5" fill="${ink}" opacity=".35"/>`
  }).join('\n')
  const hero = phone
    ? `<rect x="${pad}" y="${top + head * 2.6}" width="${w - pad * 2}" height="200" rx="18" fill="${accent}" opacity=".9"/>`
    : `<rect x="${w * 0.56}" y="${top - 10}" width="${w * 0.44 - pad}" height="${head * 3.4}" rx="22" fill="${accent}" opacity=".9"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="${w}" height="${h}" fill="${bg}"/>
<rect width="${w}" height="${navH}" fill="${card}"/>
<circle cx="${pad + 12}" cy="${navH / 2}" r="12" fill="${accent}"/>
<text x="${pad + 34}" y="${navH / 2 + 6}" font-family="Georgia, serif" font-size="${phone ? 18 : 20}" fill="${ink}">${name}</text>
${phone ? '' : [0, 1, 2].map((i) => `<rect x="${w - pad - 300 + i * 100}" y="${navH / 2 - 5}" width="64" height="10" rx="5" fill="${ink}" opacity=".45"/>`).join('')}
<text x="${pad}" y="${top + head}" font-family="Georgia, serif" font-size="${head}" fill="${ink}">${line[0]}</text>
<text x="${pad}" y="${top + head * 2.1}" font-family="Georgia, serif" font-size="${head}" fill="${ink}">${line[1]}</text>
${hero}
${cards}
</svg>`
}

/** A real PNG, encoded here: diagonal bands, so a raster reference is in the round too. */
function bandsPng(w, h, a, b) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const c = Math.floor((x + y) / 60) % 2 ? a : b
      raw.set(c, y * (w * 3 + 1) + 1 + x * 3)
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const PALETTES = {
  ember: { bg: '#fbf3ec', ink: '#2a1a12', accent: '#d9623b', card: '#ffffff', name: 'Ember', line: ['Bread, baked', 'before you wake.'] },
  harbor: { bg: '#0f1b2a', ink: '#e8eef5', accent: '#3d8bd9', card: '#16263a', name: 'Harbor', line: ['Moorings for', 'small boats.'] },
  meadow: {
    bg: '#f1f5ec',
    ink: '#1f2a1a',
    accent: '#6f9a4a',
    card: '#ffffff',
    name: 'Meadow',
    line: ['A quiet place', 'to plan a garden.'],
  },
}

function makeFixtures(dir) {
  const refs = join(dir, 'refs')
  const comps = join(dir, 'comps')
  mkdirSync(refs, { recursive: true })
  mkdirSync(comps, { recursive: true })
  for (const [k, p] of Object.entries(PALETTES)) {
    writeFileSync(join(refs, `${k}-desktop.svg`), mockSite({ ...p, w: 1440, h: 900 }))
    writeFileSync(join(refs, `${k}-phone.svg`), mockSite({ ...p, w: 390, h: 844, phone: true }))
  }
  writeFileSync(join(refs, 'slate.png'), bandsPng(800, 500, [52, 58, 64], [92, 99, 106]))
  writeFileSync(
    join(refs, 'tide.svg'),
    mockSite({
      w: 1200,
      h: 800,
      bg: '#eef6f7',
      ink: '#0d2b30',
      accent: '#2a9d8f',
      card: '#ffffff',
      name: 'Tide',
      line: ['Tables for', 'the coast.'],
    }),
  )
  const compColors = ['#c8553d', '#2d6a4f', '#5a4fcf', '#b08900']
  compColors.forEach((accent, i) => {
    writeFileSync(
      join(comps, `header-${'abcd'[i]}.svg`),
      mockSite({
        w: 1440,
        h: 900,
        bg: i % 2 ? '#f6f6f2' : '#ffffff',
        ink: '#1b1b1b',
        accent,
        card: '#f0efe9',
        name: 'Ledger',
        line: [['Calm', 'Quiet', 'Plain', 'Still'][i] + ' money,', 'kept simply.'],
      }),
    )
  })
  return { refs, comps }
}

/** A local site for the --url path: one real page, and one that hangs up without answering. */
function siteServer() {
  const page = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Studio</title>
<style>body{margin:0;font:18px/1.5 Georgia,serif;background:#faf7f2;color:#222}nav{display:flex;justify-content:space-between;padding:20px 6vw;background:#fff}
h1{font-size:clamp(34px,6vw,72px);margin:8vh 6vw 2vh;font-weight:500}p{margin:0 6vw;max-width:36em;color:#555}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;margin:6vh 6vw}.grid div{height:160px;border-radius:14px;background:#e7ded1}</style>
<nav><b>Studio Nine</b><span>Work · About · Contact</span></nav><h1>Rooms that keep their light.</h1>
<p>A made-up interiors studio, served by the test so a URL can be captured.</p><div class="grid"><div></div><div></div><div></div></div>`
  const s = createServer((req, res) => {
    if (req.url === '/dead') return req.socket.destroy()
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(page)
  })
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r({ server: s, base: `http://127.0.0.1:${s.address().port}` })))
}

function makeRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rig-taste-')))
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root })
  writeFileSync(
    join(root, 'PLAN.md'),
    '# A plan\n\n## The best at this job\n- Named only, no links here.\n\n## Agents\n\n### a1 — x\nOwns:\n- src/**\n',
  )
  return root
}

// ── input, counted ──────────────────────────────────────────────────────────────────────────────

/**
 * Counts real input. fv2 is building `countInput(page)` into the harness; until it is on main this
 * is the same idea in miniature, wrapped around the harness's own tap/click/type/wheel/swipe.
 */
function countInputLocal(page) {
  let c = { taps: 0, keys: 0, gestures: 0 }
  let t0 = Date.now()
  return {
    tap: (x, y) => (c.taps++, tap(page, x, y)),
    click: (x, y, o) => (c.taps++, click(page, x, y, o)),
    type: (text, o) => ((c.keys += [...text].length), type(page, text, o)),
    wheel: (o) => (c.gestures++, wheel(page, o)),
    swipe: (o) => (c.gestures++, swipe(page, o)),
    counts: () => ({ ...c, ms: Date.now() - t0 }),
    reset() {
      c = { taps: 0, keys: 0, gestures: 0 }
      t0 = Date.now()
    },
  }
}

/** A target check: a number against a bar, and the broken run's number beside it. */
async function target(s, name, { measure, atMost, unit, breaks }) {
  let broken
  return s.check(`${name} (≤ ${atMost} ${unit})`, {
    assert: async () => {
      const v = await measure()
      if (broken !== undefined) broken = v
      console.log(`        ${broken === undefined ? 'measured' : 'broken run'}: ${v} ${unit} (bar ≤ ${atMost})`)
      return Number.isFinite(v) && v <= atMost
    },
    breaks: async () => {
      broken = null
      return breaks()
    },
    timeout: 120_000,
  })
}

// ── driving the board ───────────────────────────────────────────────────────────────────────────

/**
 * The centre of `selector`, refused unless elementFromPoint at that point lands on it. Returns
 * null when the element is missing or covered.
 */
async function pointOn(page, selector) {
  return page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return null
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2, y = r.top + r.height / 2
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return null
    const hit = document.elementFromPoint(x, y)
    return hit && (hit === el || el.contains(hit)) ? { x, y } : null
  })()`)
}

async function press(page, input, selector, { touch }) {
  const p = await pointOn(page, selector)
  if (!p) throw new Error(`${selector} is not hittable: a tap there lands on ${await H.whatIsAt(page, 1, 1)}`)
  await (touch ? input.tap(p.x, p.y) : input.click(p.x, p.y))
}

/** One key, as a keyboard sends it: key, code and key code set, down then up. */
async function pressKey(page, key) {
  const code = 48 + Number(key)
  const ev = { key, code: `Digit${key}`, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, text: key, unmodifiedText: key }
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...ev })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...ev })
}

const progress = (page) => page.eval('document.getElementById("progress")?.textContent || ""')
const onEnd = (page) => page.eval('!!document.getElementById("end")')

async function waitFor(fn, ms = 2000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (await fn()) return true
    await sleep(40)
  }
  return false
}

/** Nothing on the board needs a scroll: no overflow, and every control fully hittable in place. */
async function fitsWithoutScrolling(page) {
  return page.eval(`(() => {
    const d = document.documentElement
    if (d.scrollWidth > innerWidth || d.scrollHeight > innerHeight) return 'page overflows: ' + d.scrollWidth + '×' + d.scrollHeight
    const app = document.getElementById('app')
    if (app && app.scrollHeight > app.clientHeight + 1) return '#app overflows'
    const need = [...document.querySelectorAll('.rate'), document.getElementById('note'), document.getElementById('done'), document.getElementById('back')]
    for (const el of need) {
      if (getComputedStyle(document.getElementById('footer')).visibility === 'hidden' && document.getElementById('footer').contains(el)) continue
      const r = el.getBoundingClientRect()
      // Mid-edges and centre: Chrome's hit-test honours border-radius, so a rounded corner is not the button.
      const my = r.top + r.height / 2, mx = r.left + r.width / 2
      for (const [x, y] of [[r.left + 3, my], [r.right - 3, my], [mx, r.top + 3], [mx, r.bottom - 3], [mx, my]]) {
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return (el.id || el.className) + ' is off screen'
        const hit = document.elementFromPoint(x, y)
        if (!hit || !(hit === el || el.contains(hit))) return (el.id || el.className) + ' is covered'
      }
    }
    for (const f of document.querySelectorAll('#stage figure .shot')) {
      const r = f.getBoundingClientRect()
      if (r.width < 40 || r.height < 40 || r.bottom > innerHeight || r.right > innerWidth + 1) return 'a shot is clipped'
    }
    return true
  })()`)
}

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, dpr: 1, mobile: false, touch: false },
  phone: { width: 390, height: 844, dpr: 3, mobile: true, touch: true },
}

async function openBoard(browser, url, vp, { dark = false } = {}) {
  const page = await browser.newPage(null, { width: vp.width, height: vp.height, dpr: vp.dpr, mobile: vp.mobile })
  if (vp.touch) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] })
  await page.goto(url)
  for (const fn of pageBreaks) await page.eval(fn)
  await page.eval('Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r })))')
  return page
}

// Page-side breaks the controls install; each runs after every load.
const pageBreaks = []

/** The old board, in miniature: rating buttons that save but do not move on, and a Next button. */
const NO_AUTO_ADVANCE = `(() => {
  document.querySelectorAll('.rate').forEach((b) => {
    const c = b.cloneNode(true); b.replaceWith(c)
    c.addEventListener('click', () => {
      document.querySelectorAll('.rate').forEach((x) => x.setAttribute('aria-pressed', String(x === c)))
    })
  })
  const n = document.createElement('button'); n.id = 'next'; n.textContent = 'Next'
  n.style.cssText = 'height:48px;padding:0 24px;border-radius:24px'
  n.addEventListener('click', () => {
    const r = document.querySelector('.rate[aria-pressed=true]')
    if (r) document.dispatchEvent(new KeyboardEvent('keydown', { key: r.dataset.rating }))
  })
  document.getElementById('footer').appendChild(n)
})()`

/** A rating button wired to nothing. */
const DEAD_BUTTONS = `document.querySelectorAll('.rate').forEach((b) => b.replaceWith(b.cloneNode(true)))`

/**
 * Rate every reference with `ratings`, typing `notes[i]` first where given, then Done. Returns the
 * counted input and whether every step fitted the screen. Never throws on a board that misbehaves:
 * a broken board just costs more taps.
 */
async function walk(page, ratings, { touch, notes = {}, shots = null }) {
  const input = countInputLocal(page)
  input.reset()
  const fits = []
  for (let i = 0; i < ratings.length; i++) {
    const before = await progress(page)
    fits.push(await fitsWithoutScrolling(page))
    if (shots && i === 2) await shots(page, 'round')
    if (notes[i]) {
      await press(page, input, '#note', { touch })
      await input.type(notes[i])
    }
    await press(page, input, `.rate[data-rating="${ratings[i]}"]`, { touch })
    let moved = await waitFor(async () => (await progress(page)) !== before || (await onEnd(page)), 900)
    if (!moved && (await pointOn(page, '#next'))) {
      await press(page, input, '#next', { touch })
      moved = await waitFor(async () => (await progress(page)) !== before || (await onEnd(page)), 900)
    }
  }
  if (shots) await shots(page, 'end')
  await press(page, input, (await pointOn(page, '#finish')) ? '#finish' : '#done', { touch })
  await waitFor(() => page.eval('!!document.getElementById("closed")'), 3000)
  return { ...input.counts(), fits: fits.every((f) => f === true) ? true : fits.find((f) => f !== true) }
}

// ── the run ─────────────────────────────────────────────────────────────────────────────────────

const work = realpathSync(mkdtempSync(join(tmpdir(), 'rig-taste-fx-')))
const fx = makeFixtures(work)
const site = await siteServer()
const STUDIO = `${site.base}/studio`
const DEAD = `${site.base}/dead`
const browser = await launch({ headless: true, port: CDP_PORT })
const BOARD = `http://127.0.0.1:${BOARD_PORT}/`
const ARGS = ['--from', fx.refs, '--url', STUDIO, '--url', DEAD, '--port', String(BOARD_PORT), '--no-open']
const RATINGS = [5, 2, 4, 1, 3, 5]
const NAMES = ['ember', 'harbor', 'meadow', 'slate.png', 'tide.svg', STUDIO]
const NOTE = 'calm, but the type is too small'
const roots = []
let cliPreload = []
const quiet = { log: () => {}, warn: () => {} }

/** Start a board in a repo (a fresh one unless given), with any earlier answers cleared. */
async function board(args = ARGS, root = null, sink = quiet) {
  if (!root) {
    root = makeRepo()
    roots.push(root)
  }
  rmSync(join(root, '.rig', 'taste', 'ratings.json'), { force: true })
  rmSync(join(root, 'docs', 'TASTE.md'), { force: true })
  const b = await runTaste(args, { root, ...sink })
  b.root = root
  b.stop = async () => {
    b.server.closeAllConnections?.()
    await new Promise((r) => b.server.close(() => r()))
  }
  return b
}

/** One whole round: board up, page open, walk, Done; returns what was counted and what was written. */
async function round(vp, { notes = {}, ratings = RATINGS, dark = false, shots = null } = {}) {
  const b = await board()
  let page
  try {
    page = await openBoard(browser, BOARD, VIEWPORTS[vp], { dark })
    const counts = await walk(page, ratings, { touch: VIEWPORTS[vp].touch, notes, shots })
    const path = await Promise.race([b.finished, sleep(4000).then(() => null)])
    const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
    return {
      ...counts,
      tastePath: path,
      json: JSON.parse(read(join(b.root, '.rig', 'taste', 'ratings.json')) || '{}'),
      md: read(join(b.root, 'docs', 'TASTE.md')),
      refs: b.state.refs,
    }
  } finally {
    await page?.close()
    await b.stop().catch(() => {})
  }
}

/** The rows of the `## Ratings` table, as [name, rating, note]. */
function ratingRows(md) {
  const body = md.split('## Ratings')[1]?.split('\n## ')[0] || ''
  return body
    .split('\n')
    .filter((l) => l.startsWith('| ') && !l.startsWith('| Reference') && !l.startsWith('| ---'))
    .map((l) =>
      l
        .slice(2, -2)
        .split(' | ')
        .map((c) => c.trim()),
    )
}

/** True when ratings.json and TASTE.md both hold exactly RATINGS and the one note, in order. */
function holdsExactly(r, ratings = RATINGS) {
  const fromJson = r.refs.map((c) => r.json.ratings?.[c.id]?.rating ?? null)
  const noteJson = r.refs.map((c) => r.json.ratings?.[c.id]?.note || '')
  const rows = ratingRows(r.md)
  const want = NAMES.map((n, i) => [n, `${ratings[i]} / 5`, i === 2 ? NOTE : ''])
  const ok =
    JSON.stringify(fromJson) === JSON.stringify(ratings) &&
    JSON.stringify(noteJson) === JSON.stringify(want.map((w) => w[2])) &&
    JSON.stringify(rows) === JSON.stringify(want) &&
    /^Rated \d{4}-\d\d-\d\d: 6 of 6 references/m.test(r.md) &&
    r.md.includes('## Principles\n\n<name the principles behind these ratings before any design starts>')
  if (!ok)
    console.log(`        json: ${JSON.stringify(fromJson)} notes: ${JSON.stringify(noteJson)}\n        rows: ${JSON.stringify(rows)}`)
  return ok
}

await suite('rig taste', async (s) => {
  // Capture once up front; every later board reuses the shots, so a dead URL is named here.
  const warned = []
  const first = await board(ARGS, null, { log: () => {}, warn: (m) => warned.push(String(m)) })
  await first.stop()

  await s.check('a URL that fails to load is named and skipped, never a blank card', {
    assert: () =>
      warned.some((w) => w.includes(DEAD)) &&
      first.state.refs.length === 6 &&
      !first.state.refs.some((r) => r.url === DEAD) &&
      first.state.refs.some((r) => r.url === STUDIO && r.shots.desktop && r.shots.phone),
    // The control: the dead URL put back in as a card with no shots, the blank card this rules out.
    breaks: () => {
      first.state.refs.push({ id: 'u-dead', name: DEAD, url: DEAD, source: 'url', shots: {} })
      return () => first.state.refs.pop()
    },
  })

  await s.check('a captured URL has a desktop shot at 1440×900 and a phone shot at 390×844', {
    assert: () => {
      const st = first.state.refs.find((r) => r.url === STUDIO)
      const size = (p) => {
        const b = readFileSync(p)
        return [b.readUInt32BE(16), b.readUInt32BE(20)]
      }
      const [dw, dh] = size(st.shots.desktop)
      const [pw, ph] = size(st.shots.phone)
      return dw === 1440 && dh === 900 && pw === 780 && ph === 1688 && st.shots.desktop.includes(join('.rig', 'taste', 'shots'))
    },
    breaks: () => {
      const st = first.state.refs.find((r) => r.url === STUDIO)
      const keep = st.shots.phone
      st.shots.phone = st.shots.desktop
      return () => {
        st.shots.phone = keep
      }
    },
  })

  for (const vp of ['desktop', 'phone']) {
    const label = vp === 'desktop' ? '1440×900' : '390×844'
    let last
    await target(s, `${label}: 6 references rated, then Done`, {
      unit: 'taps',
      atMost: 7,
      measure: async () => {
        last = await round(vp)
        if (last.keys || last.gestures) return Number.NaN
        if (last.fits !== true) {
          console.log(`        does not fit: ${last.fits}`)
          return Number.NaN
        }
        return last.taps
      },
      breaks: () => {
        pageBreaks.push(NO_AUTO_ADVANCE)
        return () => pageBreaks.pop()
      },
    })
    await s.check(`${label}: no typing, no scrolling, and the round wrote TASTE.md`, {
      assert: async () => {
        const r = await round(vp)
        return r.keys === 0 && r.gestures === 0 && r.fits === true && !!r.tastePath && r.md.includes('## Ratings')
      },
      breaks: () => {
        // A board that runs past the screen: the footer pushed below the fold.
        pageBreaks.push(`document.getElementById('app').style.gridTemplateRows = 'auto 1fr 900px'`)
        return () => pageBreaks.pop()
      },
    })
  }

  await s.check('ratings.json and TASTE.md hold exactly what was tapped (the POST handler is the thing)', {
    assert: async () => holdsExactly(await round('desktop', { notes: { 2: NOTE } })),
    // The control: a POST handler that answers 200 and saves nothing.
    breaks: () => {
      const real = handlers.answer
      handlers.answer = () => {}
      return () => {
        handlers.answer = real
      }
    },
  })

  await s.check('ratings.json and TASTE.md hold exactly what was tapped (the rating button is the thing)', {
    assert: async () => holdsExactly(await round('phone', { notes: { 2: NOTE } })),
    breaks: () => {
      pageBreaks.push(DEAD_BUTTONS)
      return () => pageBreaks.pop()
    },
  })

  await s.check('the number keys rate and advance, as the buttons do', {
    assert: async () => {
      const b = await board()
      const page = await openBoard(browser, BOARD, VIEWPORTS.desktop)
      try {
        for (const k of ['4', '2']) {
          const before = await progress(page)
          await pressKey(page, k)
          await waitFor(async () => (await progress(page)) !== before, 900)
        }
        await sleep(200)
        const saved = JSON.parse(readFileSync(join(b.root, '.rig', 'taste', 'ratings.json'), 'utf8'))
        return (await progress(page)) === '3 of 6' && b.state.refs.slice(0, 2).every((c, i) => saved.ratings[c.id]?.rating === [4, 2][i])
      } finally {
        await page.close()
        await b.stop()
      }
    },
    breaks: () => {
      pageBreaks.push(`document.addEventListener('keydown', (e) => e.stopImmediatePropagation(), true)`)
      return () => pageBreaks.pop()
    },
  })

  await s.check('the way back returns to the last reference with its rating shown', {
    assert: async () => {
      const b = await board()
      const page = await openBoard(browser, BOARD, VIEWPORTS.phone)
      const input = countInputLocal(page)
      try {
        await press(page, input, '.rate[data-rating="4"]', { touch: true })
        await waitFor(async () => (await progress(page)) === '2 of 6')
        await press(page, input, '#back', { touch: true })
        await waitFor(async () => (await progress(page)) === '1 of 6')
        return (
          (await progress(page)) === '1 of 6' &&
          (await page.eval('document.querySelector(".rate[aria-pressed=true]")?.dataset.rating')) === '4'
        )
      } finally {
        await page.close()
        await b.stop()
      }
    },
    breaks: () => {
      pageBreaks.push(`(() => { const b = document.getElementById('back'); b.replaceWith(b.cloneNode(true)) })()`)
      return () => pageBreaks.pop()
    },
  })

  await s.check('a closed tab loses nothing: answers are on disk before Done, and --done writes TASTE.md', {
    assert: async () => {
      const b = await board()
      const page = await openBoard(browser, BOARD, VIEWPORTS.desktop)
      const input = countInputLocal(page)
      for (const r of [3, 5]) {
        const before = await progress(page)
        await press(page, input, `.rate[data-rating="${r}"]`, { touch: false })
        await waitFor(async () => (await progress(page)) !== before)
      }
      await sleep(150)
      await page.close()
      await b.stop()
      const out = spawnSync(process.execPath, [RIG, 'taste', '--done', '--port', String(BOARD_PORT)], { cwd: b.root, encoding: 'utf8' })
      const md = existsSync(join(b.root, 'docs', 'TASTE.md')) ? readFileSync(join(b.root, 'docs', 'TASTE.md'), 'utf8') : ''
      const rows = ratingRows(md)
      return (
        out.status === 0 &&
        /Wrote .*TASTE\.md/.test(out.stdout) &&
        rows[0]?.[1] === '3 / 5' &&
        rows[1]?.[1] === '5 / 5' &&
        rows[2]?.[1] === '—'
      )
    },
    breaks: () => {
      const real = handlers.answer
      handlers.answer = () => {}
      return () => {
        handlers.answer = real
      }
    },
  })

  await s.check('rig taste from the CLI: prints the URL, and --done from another shell stops it and prints the path', {
    assert: async () => {
      const root = makeRepo()
      roots.push(root)
      const child = spawn(process.execPath, [...cliPreload, RIG, 'taste', ...ARGS], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      child.stdout.on('data', (d) => {
        out += d
      })
      const exited = new Promise((r) => child.on('exit', r))
      const up = await waitFor(async () => out.includes(BOARD), 30_000)
      if (!up) {
        child.kill()
        return false
      }
      const answer = await fetch(`${BOARD}api/answer`, {
        method: 'POST',
        body: JSON.stringify({
          kind: 'ref',
          id: JSON.parse(readFileSync(join(root, '.rig', 'taste', 'ratings.json'), 'utf8')).refs[0].id,
          rating: 4,
        }),
      })
      const done = spawnSync(process.execPath, [RIG, 'taste', '--done', '--port', String(BOARD_PORT)], { cwd: root, encoding: 'utf8' })
      const code = await Promise.race([exited, sleep(5000).then(() => 'still running')])
      if (code === 'still running') child.kill()
      const md = existsSync(join(root, 'docs', 'TASTE.md')) ? readFileSync(join(root, 'docs', 'TASTE.md'), 'utf8') : ''
      if (!(answer.ok && done.status === 0 && code === 0))
        console.log(`        answer ${answer.status}, --done ${done.status} ${done.stderr.trim()}, board exit ${code}`)
      return answer.ok && done.status === 0 && code === 0 && /Wrote .*docs\/TASTE\.md/.test(out) && ratingRows(md)[0]?.[1] === '4 / 5'
    },
    // The control puts back the board that never ended: process.exit made a no-op in the child.
    breaks: () => {
      cliPreload = ['--import', 'data:text/javascript,process.exit=()=>{}']
      return () => {
        cliPreload = []
      }
    },
    timeout: 60_000,
  })

  // ── the comps round ──
  const COMPS_ARGS = [...ARGS, '--comps', fx.comps, '--ask', 'Which header feels calm?']
  await s.check('comps at 390 wide: question on top, every target ≥ 44 px, no sideways scroll, rated and starred into TASTE.md', {
    assert: async () => {
      const b = await board(COMPS_ARGS)
      const page = await openBoard(browser, BOARD, VIEWPORTS.phone)
      const input = countInputLocal(page)
      try {
        // Straight to the comps: the references are already rated.
        for (const r of RATINGS) {
          const before = await progress(page)
          await press(page, input, `.rate[data-rating="${r}"]`, { touch: true })
          await waitFor(async () => (await progress(page)) !== before)
        }
        if ((await progress(page)) !== 'Comps') return false
        const q = await page.eval('document.getElementById("question")?.textContent')
        const targets = [
          '.rate',
          '#note',
          '#done',
          '#back',
          ...[1, 2, 3, 4].flatMap((n) => [`.comp:nth-child(${n}) .star`, `.comp:nth-child(${n}) .pick`]),
        ]
        const small = []
        for (const t of targets) if (!(await meetsTouchTarget(page, t))) small.push(t)
        const fit = await fitsWithoutScrolling(page)
        for (const r of [2, 5, 3, 4]) await press(page, input, `.rate[data-rating="${r}"]`, { touch: true }).then(() => sleep(260))
        await press(page, input, '.comp:nth-child(2) .star', { touch: true })
        await sleep(150)
        await press(page, input, '#done', { touch: true })
        const path = await Promise.race([b.finished, sleep(4000).then(() => null)])
        const md = path ? readFileSync(path, 'utf8') : ''
        const rows = (md.split('## Comps')[1] || '')
          .split('\n')
          .filter((l) => /^\| header-/.test(l))
          .map((l) =>
            l
              .slice(2, -2)
              .split(' | ')
              .map((c) => c.trim()),
          )
        const want = [
          ['header-a.svg', '2 / 5', '', ''],
          ['header-b.svg', '5 / 5', '★', ''],
          ['header-c.svg', '3 / 5', '', ''],
          ['header-d.svg', '4 / 5', '', ''],
        ]
        if (small.length) console.log(`        under 44 px: ${small.join(', ')}`)
        if (fit !== true) console.log(`        ${fit}`)
        return (
          q === 'Which header feels calm?' &&
          !small.length &&
          fit === true &&
          md.includes('## Comps — "Which header feels calm?"') &&
          JSON.stringify(rows) === JSON.stringify(want)
        )
      } finally {
        await page.close()
        await b.stop()
      }
    },
    breaks: () => {
      const real = handlers.pick
      handlers.pick = () => {}
      return () => {
        handlers.pick = real
      }
    },
    timeout: 60_000,
  })

  await s.check('dark mode follows the system: the board goes dark', {
    assert: async () => {
      const b = await board()
      const light = await openBoard(browser, BOARD, VIEWPORTS.phone)
      const dark = await openBoard(browser, BOARD, VIEWPORTS.phone, { dark: true })
      try {
        const bg = (p) => p.eval('getComputedStyle(document.body).backgroundColor')
        const lum = (c) =>
          c
            .match(/\d+/g)
            .slice(0, 3)
            .reduce((a, n) => a + Number(n), 0) / 3
        return lum(await bg(light)) > 200 && lum(await bg(dark)) < 60
      } finally {
        await light.close()
        await dark.close()
        await b.stop()
      }
    },
    breaks: () => {
      pageBreaks.push(
        `[...document.styleSheets[0].cssRules].forEach((r, i, a) => { if (r.media && /dark/.test(r.media.mediaText)) document.styleSheets[0].deleteRule(a.indexOf(r)) })`,
      )
      return () => pageBreaks.pop()
    },
  })

  // The control swaps in the 5.0 draft that always wrote the placeholder, whatever was there.
  let render = tasteMarkdown
  await s.check('TASTE.md keeps principles someone already wrote', {
    assert: () => {
      const state = { ...first.state, ratings: {}, compRatings: {}, comps: [], pick: null }
      const md = render(state, { previous: '# Taste\n\n## Principles\n\n- Calm beats clever.\n' })
      return md.includes('## Principles\n\n- Calm beats clever.\n') && !md.includes('<name the principles')
    },
    breaks: () => {
      render = (st, o) => tasteMarkdown(st, { ...o, previous: '' })
      return () => {
        render = tasteMarkdown
      }
    },
  })

  if (SHOTS) await screenshots(SHOTS, COMPS_ARGS)
})

/** docs/shots: desktop and phone, light and dark, of a round in progress and of the comps view. */
async function screenshots(dir, compsArgs) {
  mkdirSync(dir, { recursive: true })
  const snap = async (page, name) => {
    await sleep(250)
    const shot = await page.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(dir, `${name}.png`), Buffer.from(shot.data, 'base64'))
    console.log(`        shot: ${name}.png`)
  }
  for (const vp of ['desktop', 'phone'])
    for (const dark of [false, true]) {
      const theme = dark ? 'dark' : 'light'
      await round(vp, { dark, shots: async (page, at) => at === 'round' && snap(page, `taste-round-${vp}-${theme}`) })
      const b = await board(compsArgs)
      const page = await openBoard(browser, BOARD, VIEWPORTS[vp], { dark })
      const input = countInputLocal(page)
      for (const r of RATINGS) {
        const before = await progress(page)
        await press(page, input, `.rate[data-rating="${r}"]`, { touch: VIEWPORTS[vp].touch })
        await waitFor(async () => (await progress(page)) !== before)
      }
      for (const r of [4, 2]) await press(page, input, `.rate[data-rating="${r}"]`, { touch: VIEWPORTS[vp].touch }).then(() => sleep(260))
      await press(page, input, '.comp:nth-child(1) .star', { touch: VIEWPORTS[vp].touch })
      await snap(page, `taste-comps-${vp}-${theme}`)
      await page.close()
      await b.stop()
    }
}

await browser.close()
site.server.close()
for (const r of roots) rmSync(r, { recursive: true, force: true })
rmSync(work, { recursive: true, force: true })
