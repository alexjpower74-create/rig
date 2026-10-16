// rig taste, driven the way he uses it: real taps and clicks through the harness, at points checked
// with elementFromPoint, against the real server writing real files.
//
// Headless Chrome on debugging port 9352, the board on 5391, always --no-open: no window ever opens
// on anyone's screen. Every image is generated here; none is anyone's real work.
//
// The bar from the plan: 6 references in at most 7 taps (one per reference plus Done), with no typing
// and no scrolling, at 1440×900 and at 390×844. It is an s.target counted by countInput, with a
// broken run beside it: a board whose rating buttons stop advancing by themselves has to cost more
// taps than the bar allows.
//
// Every other check has a control that puts the old behaviour back (a handler, a guard, a page
// listener) and must then go red.
//
// Set RIG_TASTE_SHOTS=<dir> to also write the screenshots for docs/shots/ from the same real walk.

// A zone where local midnight and UTC midnight are different days, so the date check can go red.
process.env.TZ = 'America/Toronto'

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import * as H from '../harness/index.js'
import { policy, runTaste } from '../src/commands/taste.js'
import { guards, handlers, lanAddresses } from '../src/taste/server.js'
import { localDay, tasteMarkdown } from '../src/taste/store.js'

const { suite, launch, countInput, meetsTouchTarget, sleep } = H
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
    if (req.url === '/missing') {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
      return res.end('<!doctype html><title>Not found</title><h1>Page not found</h1>')
    }
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
  if (!p) throw new Error(`${selector} is not hittable`)
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
    if (d.scrollWidth > innerWidth || d.scrollHeight > innerHeight) return 'the page overflows: ' + d.scrollWidth + '×' + d.scrollHeight
    const app = document.getElementById('app')
    if (app && app.scrollHeight > app.clientHeight + 1) return '#app overflows'
    const footer = document.getElementById('footer')
    const need = [...document.querySelectorAll('.rate, .comp .star, .comp .pick'), document.getElementById('note'), document.getElementById('done'), document.getElementById('back')]
    for (const el of need) {
      if (getComputedStyle(footer).visibility === 'hidden' && footer.contains(el)) continue
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

// Page-side breaks the controls install; each runs after every load.
const pageBreaks = []

async function openBoard(browser, url, vp, { dark = false } = {}) {
  const page = await browser.newPage(null, { width: vp.width, height: vp.height, dpr: vp.dpr, mobile: vp.mobile })
  if (vp.touch) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] })
  await page.goto(url)
  for (const fn of pageBreaks) await page.eval(fn)
  await page.eval('Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r })))')
  return page
}

/** The old board, in miniature: rating buttons that mark a choice but do not move on, and a Next button. */
const NO_AUTO_ADVANCE = `(() => {
  document.querySelectorAll('.rate').forEach((b) => {
    const c = b.cloneNode(true); b.replaceWith(c)
    c.addEventListener('click', () => {
      document.querySelectorAll('.rate').forEach((x) => x.setAttribute('aria-pressed', String(x === c)))
    })
  })
  const n = document.createElement('button'); n.id = 'next'; n.textContent = 'Next'
  n.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:5;height:44px;padding:0 16px;border-radius:22px'
  n.addEventListener('click', () => {
    const r = document.querySelector('.rate[aria-pressed=true]')
    if (r) document.dispatchEvent(new KeyboardEvent('keydown', { key: r.dataset.rating }))
  })
  document.body.appendChild(n)
})()`

/** A rating button wired to nothing. */
const DEAD_BUTTONS = `document.querySelectorAll('.rate').forEach((b) => b.replaceWith(b.cloneNode(true)))`

/**
 * Rate every reference with `ratings`, typing `notes[i]` first where given, then Done. Returns the
 * counted input and whether every step fitted the screen. A broken board does not throw here: it
 * just costs more taps.
 */
async function walk(page, ratings, { touch, notes = {}, shots = null }) {
  const input = countInput(page)
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
    const moved = await waitFor(async () => (await progress(page)) !== before || (await onEnd(page)), 900)
    if (!moved && (await pointOn(page, '#next'))) {
      await press(page, input, '#next', { touch })
      await waitFor(async () => (await progress(page)) !== before || (await onEnd(page)), 900)
    }
  }
  if (shots) await shots(page, 'end')
  await press(page, input, (await pointOn(page, '#finish')) ? '#finish' : '#done', { touch })
  const closed = await waitFor(() => page.eval('!!document.getElementById("closed")'), 4000)
  return { ...input.counts(), closed, fits: fits.every((f) => f === true) ? true : fits.find((f) => f !== true) }
}

// ── the run ─────────────────────────────────────────────────────────────────────────────────────

const work = realpathSync(mkdtempSync(join(tmpdir(), 'rig-taste-fx-')))
const fx = makeFixtures(work)
const site = await siteServer()
const STUDIO = `${site.base}/studio`
const DEAD = `${site.base}/dead`
const MISSING = `${site.base}/missing`
const browser = await launch({ headless: true, port: CDP_PORT })
const ARGS = ['--from', fx.refs, '--url', STUDIO, '--url', DEAD, '--url', MISSING, '--port', String(BOARD_PORT), '--no-open']
const COMPS_ARGS = [...ARGS, '--comps', fx.comps, '--ask', 'Which header feels calm?']
const RATINGS = [5, 2, 4, 1, 3, 5]
const NAMES = ['ember', 'harbor', 'meadow', 'slate.png', 'tide.svg', STUDIO]
const NOTE = 'calm, but the type is too small'
const roots = []
let cliPreload = []
let keepStamp = null
const quiet = { log: () => {}, warn: () => {} }
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const ratingsJson = (root) => JSON.parse(read(join(root, '.rig', 'taste', 'ratings.json')) || '{"rounds":[]}')
const newest = (j) => j.rounds[j.rounds.length - 1] || {}

function freshRepo() {
  const root = makeRepo()
  roots.push(root)
  return root
}

/** Start a board in a repo (a fresh one unless given). */
async function board(args = ARGS, root = freshRepo(), sink = quiet) {
  const b = await runTaste(args, { root, ...sink })
  b.root = root
  return b
}

/** One whole round: board up, page open, walk, Done; returns what was counted and what was written. */
async function round(vp, { notes = {}, ratings = RATINGS, dark = false, shots = null } = {}) {
  const b = await board()
  let page
  try {
    page = await openBoard(browser, b.url, VIEWPORTS[vp], { dark })
    const counts = await walk(page, ratings, { touch: VIEWPORTS[vp].touch, notes, shots })
    const path = await Promise.race([b.finished, sleep(4000).then(() => null)])
    return { ...counts, tastePath: path, json: ratingsJson(b.root), md: read(join(b.root, 'docs', 'TASTE.md')), refs: b.round.refs }
  } finally {
    await page?.close()
    await b.stop()
  }
}

/** The rows of the first table under `heading`, as arrays of cells. */
function tableRows(md, heading = '## Ratings') {
  const body = md.split(heading)[1]?.split('\n## ')[0] || ''
  const out = []
  for (const l of body.split('\n')) {
    if (l.startsWith('| ---') || /^\| (Reference|Comp) \|/.test(l)) continue
    if (l.startsWith('| '))
      out.push(
        l
          .slice(2, -2)
          .split(' | ')
          .map((c) => c.trim()),
      )
    else if (out.length) break
  }
  return out
}

/** True when ratings.json and TASTE.md both hold exactly RATINGS and the one note, in order. */
function holdsExactly(r, ratings = RATINGS) {
  const rd = newest(r.json)
  const fromJson = r.refs.map((c) => rd.ratings?.[c.id]?.rating ?? null)
  const noteJson = r.refs.map((c) => rd.ratings?.[c.id]?.note || '')
  const rows = tableRows(r.md)
  const want = NAMES.map((n, i) => [n, `${ratings[i]} / 5`, i === 2 ? NOTE : ''])
  const ok =
    JSON.stringify(fromJson) === JSON.stringify(ratings) &&
    JSON.stringify(noteJson) === JSON.stringify(want.map((w) => w[2])) &&
    JSON.stringify(rows) === JSON.stringify(want) &&
    /^Rated \d{4}-\d\d-\d\d: 6 of 6 references in round 1\./m.test(r.md) &&
    r.md.includes('## Principles\n\n<name the principles behind these ratings before any design starts>')
  if (!ok)
    console.log(`        json: ${JSON.stringify(fromJson)} notes: ${JSON.stringify(noteJson)}\n        rows: ${JSON.stringify(rows)}`)
  return ok
}

/** Swap one property of an object for the length of a control. */
const swap = (obj, key, value) => () => {
  const real = obj[key]
  obj[key] = value
  return () => {
    obj[key] = real
  }
}
const pageBreak = (script) => () => {
  pageBreaks.push(script)
  return () => pageBreaks.pop()
}

await suite('rig taste', async (s) => {
  // Capture once up front, and keep what was said about the URLs that did not load.
  const warned = []
  const first = await board(ARGS, freshRepo(), { log: () => {}, warn: (m) => warned.push(String(m)) })
  await first.stop()

  await s.check('URLs that do not load, or answer 404, are named and skipped, never a blank card', {
    assert: () =>
      warned.some((w) => w.includes(DEAD)) &&
      warned.some((w) => w.includes(MISSING) && /HTTP 404/.test(w)) &&
      first.round.refs.length === 6 &&
      !first.round.refs.some((r) => r.url === DEAD || r.url === MISSING) &&
      first.round.refs.some((r) => r.url === STUDIO && r.shots.desktop && r.shots.phone),
    // The control: the 404 page put back in as a card, the "Page not found" this rules out.
    breaks: () => {
      first.round.refs.push({ id: 'u-missing', name: MISSING, url: MISSING, source: 'url', shots: {} })
      return () => first.round.refs.pop()
    },
  })

  await s.check('a captured URL has a desktop shot at 1440×900 and a phone shot at 390×844', {
    assert: () => {
      const st = first.round.refs.find((r) => r.url === STUDIO)
      const size = (p) => {
        const b = readFileSync(p)
        return [b.readUInt32BE(16), b.readUInt32BE(20)]
      }
      const [dw, dh] = size(st.shots.desktop)
      const [pw, ph] = size(st.shots.phone)
      return dw === 1440 && dh === 900 && pw === 780 && ph === 1688 && st.shots.desktop.includes(join('.rig', 'taste', 'shots'))
    },
    breaks: () => {
      const st = first.round.refs.find((r) => r.url === STUDIO)
      const keep = st.shots.phone
      st.shots.phone = st.shots.desktop
      return () => {
        st.shots.phone = keep
      }
    },
  })

  // ── the bar ──
  for (const vp of ['desktop', 'phone']) {
    const label = vp === 'desktop' ? '1440×900' : '390×844'
    await s.target(`${label}: 6 references rated, then Done`, {
      unit: 'taps',
      atMost: 7,
      measure: async () => {
        const r = await round(vp)
        if (r.keys) throw new Error(`the walk typed ${r.keys} keys`)
        if (r.gestures) throw new Error(`the walk scrolled ${r.gestures} times`)
        if (r.fits !== true) throw new Error(`the board does not fit the screen: ${r.fits}`)
        if (!r.closed) throw new Error('Done never finished the round')
        return r.taps
      },
      breaks: pageBreak(NO_AUTO_ADVANCE),
      timeout: 120_000,
    })
    await s.check(`${label}: no typing, no scrolling, and the round wrote TASTE.md`, {
      assert: async () => {
        const r = await round(vp)
        if (r.fits !== true) console.log(`        ${r.fits}`)
        return r.keys === 0 && r.gestures === 0 && r.fits === true && !!r.tastePath && r.md.includes('## Ratings')
      },
      // A board that runs past the screen: the footer pushed below the fold.
      breaks: pageBreak(`document.getElementById('app').style.gridTemplateRows = 'auto 1fr 900px'`),
    })
  }

  // ── every answer saved ──
  await s.check('ratings.json and TASTE.md hold exactly what was tapped (the POST handler is the thing)', {
    assert: async () => holdsExactly(await round('desktop', { notes: { 2: NOTE } })),
    // The control: a POST handler that answers 200 and saves nothing.
    breaks: swap(handlers, 'answer', () => {}),
  })

  await s.check('ratings.json and TASTE.md hold exactly what was tapped (the rating button is the thing)', {
    assert: async () => holdsExactly(await round('phone', { notes: { 2: NOTE } })),
    breaks: pageBreak(DEAD_BUTTONS),
  })

  // The page is left by navigating away: Chrome then stops its timers at once, as a phone does when
  // the tab is swiped away. A CDP close keeps them running long enough for the 250 ms debounce to
  // save the note anyway, which would hide the bug this check is for.
  await s.check('a note typed and the page left at once is on disk', {
    assert: async () => {
      const b = await board()
      const page = await openBoard(browser, b.url, VIEWPORTS.desktop)
      const input = countInput(page)
      try {
        await press(page, input, '#note', { touch: false })
        await input.type('closed too soon', { ms: 0 })
        await page.send('Page.navigate', { url: 'about:blank' })
        await waitFor(() => newest(ratingsJson(b.root)).ratings?.[b.round.refs[0].id]?.note === 'closed too soon', 2000)
        return newest(ratingsJson(b.root)).ratings?.[b.round.refs[0].id]?.note === 'closed too soon'
      } finally {
        await page.close()
        await b.stop()
      }
    },
    // The control: the page as first built, where nothing reached the server once the page was going.
    breaks: pageBreak(`(() => {
      let leaving = false
      window.addEventListener('beforeunload', () => { leaving = true })
      const f = window.fetch
      window.fetch = (...a) => (leaving ? Promise.reject(new Error('page gone')) : f(...a))
    })()`),
  })

  await s.check('a fast second tap is queued onto the next card, never dropped', {
    assert: async () => {
      const b = await board()
      const page = await openBoard(browser, b.url, VIEWPORTS.desktop)
      const input = countInput(page)
      try {
        const p5 = await pointOn(page, '.rate[data-rating="5"]')
        const p3 = await pointOn(page, '.rate[data-rating="3"]')
        await input.click(p5.x, p5.y)
        await input.click(p3.x, p3.y) // inside the 160 ms the board takes to move on
        await waitFor(async () => (await progress(page)) === '3 of 6', 2000)
        await sleep(300)
        const rd = newest(ratingsJson(b.root))
        return rd.ratings?.[b.round.refs[0].id]?.rating === 5 && rd.ratings?.[b.round.refs[1].id]?.rating === 3
      } finally {
        await page.close()
        await b.stop()
      }
    },
    // The control: the first draft's rule, a tap inside the busy window thrown away.
    breaks: pageBreak(`(() => {
      let last = 0
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.rate')) return
        if (Date.now() - last < 160) e.stopImmediatePropagation()
        else last = Date.now()
      }, true)
    })()`),
  })

  await s.check('the number keys rate and advance, as the buttons do', {
    assert: async () => {
      const b = await board()
      const page = await openBoard(browser, b.url, VIEWPORTS.desktop)
      try {
        for (const k of ['4', '2']) {
          const before = await progress(page)
          await pressKey(page, k)
          await waitFor(async () => (await progress(page)) !== before, 900)
        }
        await sleep(200)
        const rd = newest(ratingsJson(b.root))
        return (await progress(page)) === '3 of 6' && b.round.refs.slice(0, 2).every((c, i) => rd.ratings[c.id]?.rating === [4, 2][i])
      } finally {
        await page.close()
        await b.stop()
      }
    },
    breaks: pageBreak(`document.addEventListener('keydown', (e) => e.stopImmediatePropagation(), true)`),
  })

  await s.check('the way back returns to the last reference with its rating shown', {
    assert: async () => {
      const b = await board()
      const page = await openBoard(browser, b.url, VIEWPORTS.phone)
      const input = countInput(page)
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
    breaks: pageBreak(`(() => { const b = document.getElementById('back'); b.replaceWith(b.cloneNode(true)) })()`),
  })

  await s.check('a re-run keeps every round: a comps-only round after round 1 loses none of its ratings', {
    assert: async () => {
      const b1 = await board()
      const page = await openBoard(browser, b1.url, VIEWPORTS.desktop)
      const input = countInput(page)
      for (const r of [3, 5]) {
        const before = await progress(page)
        await press(page, input, `.rate[data-rating="${r}"]`, { touch: false })
        await waitFor(async () => (await progress(page)) !== before)
      }
      await sleep(150)
      await page.close()
      await b1.stop()
      // Round 2: the comps alone, as `rig taste --comps … --ask …` with no --from.
      const b2 = await board(['--comps', fx.comps, '--ask', 'Which header feels calm?', '--port', String(BOARD_PORT), '--no-open'], b1.root)
      await b2.stop()
      const j = ratingsJson(b1.root)
      const r1 = j.rounds[0]
      const md = tasteMarkdown(j)
      const kept = j.rounds.length === 2 && r1.ratings[b1.round.refs[0].id]?.rating === 3 && r1.ratings[b1.round.refs[1].id]?.rating === 5
      const listed = md.indexOf('### Round 1') > 0 && tableRows(md, '### Round 1')[0]?.[1] === '3 / 5'
      if (!kept || !listed) console.log(`        rounds on disk: ${j.rounds.length}; round 1 listed: ${listed}`)
      return kept && listed
    },
    // The control: the first draft's newRound, which kept only the answers whose card was in the new round.
    breaks: () => {
      const real = policy.openRound
      policy.openRound = (prev, { refs, comps, question }) => {
        const last = prev?.rounds?.[prev.rounds.length - 1]
        const keep = (a, cards) => Object.fromEntries(cards.filter((c) => a?.[c.id]).map((c) => [c.id, a[c.id]]))
        const r = {
          n: 1,
          day: localDay(),
          question,
          refs,
          comps,
          ratings: keep(last?.ratings, refs),
          compRatings: keep(last?.compRatings, comps),
          pick: null,
        }
        return { state: { version: 2, rounds: [r] }, round: r, resumed: false }
      }
      return () => {
        policy.openRound = real
      }
    },
  })

  await s.check('a closed tab loses nothing: answers are on disk before Done, and --done writes TASTE.md', {
    assert: async () => {
      const b = await board()
      const page = await openBoard(browser, b.url, VIEWPORTS.desktop)
      const input = countInput(page)
      for (const r of [3, 5]) {
        const before = await progress(page)
        await press(page, input, `.rate[data-rating="${r}"]`, { touch: false })
        await waitFor(async () => (await progress(page)) !== before)
      }
      await sleep(150)
      await page.close()
      await b.stop()
      const out = spawnSync(process.execPath, [RIG, 'taste', '--done'], { cwd: b.root, encoding: 'utf8' })
      const rows = tableRows(read(join(b.root, 'docs', 'TASTE.md')))
      return (
        out.status === 0 &&
        /Wrote .*TASTE\.md/.test(out.stdout) &&
        rows[0]?.[1] === '3 / 5' &&
        rows[1]?.[1] === '5 / 5' &&
        rows[2]?.[1] === '—'
      )
    },
    breaks: swap(handlers, 'answer', () => {}),
  })

  await s.check('a 4xx ends the round on the page, plainly, and Done does not hang', {
    assert: async () => {
      const b = await board()
      const page = await openBoard(browser, b.url, VIEWPORTS.desktop)
      const input = countInput(page)
      try {
        // The board is re-run under the open tab: a new token, so this tab's answers are refused.
        await b.stop()
        const b2 = await board(ARGS, b.root)
        try {
          await press(page, input, '.rate[data-rating="4"]', { touch: false })
          const shown = await waitFor(() => page.eval('/round has ended/.test(document.getElementById("ended")?.textContent || "")'), 3000)
          await press(page, input, '#done', { touch: false })
          await sleep(400)
          const doneIdle = await page.eval('document.getElementById("done").textContent === "Done"')
          return shown && doneIdle
        } finally {
          await b2.stop()
        }
      } finally {
        await page.close()
      }
    },
    // The control: the first draft's post(), which took every non-2xx for a network hiccup and retried.
    breaks: pageBreak(`(() => {
      const f = window.fetch
      window.fetch = (...a) => f(...a).then((r) => (r.status >= 400 && r.status < 500 ? Promise.reject(new Error('HTTP ' + r.status)) : r))
    })()`),
  })

  await s.check('only the page it served can talk to the board: no token, a foreign Origin, text/plain or a strange Host are refused', {
    assert: async () => {
      const b = await board()
      const id = b.round.refs[0].id
      const base = `http://127.0.0.1:${BOARD_PORT}`
      const body = JSON.stringify({ kind: 'ref', id, rating: 1 })
      const json = { 'content-type': 'application/json', 'x-taste-token': b.token }
      try {
        const tries = {
          noToken: await fetch(`${base}/api/answer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }),
          foreign: await fetch(`${base}/api/answer`, { method: 'POST', headers: { ...json, origin: 'http://elsewhere.example' }, body }),
          textPlain: await fetch(`${base}/api/answer`, {
            method: 'POST',
            headers: { 'content-type': 'text/plain', 'x-taste-token': b.token },
            body,
          }),
          pageNoToken: await fetch(`${base}/`),
        }
        // node:http lets the Host header lie, as a DNS-rebinding page's would.
        const rebind = await new Promise((res) => {
          request(
            { host: '127.0.0.1', port: BOARD_PORT, path: `/?t=${b.token}`, headers: { host: `attacker.example:${BOARD_PORT}` } },
            (r) => res(r.statusCode),
          ).end()
        })
        const saved = !!newest(ratingsJson(b.root)).ratings?.[id]
        const own = await fetch(`${base}/api/answer`, { method: 'POST', headers: { ...json, origin: base }, body })
        const codes = Object.fromEntries(Object.entries(tries).map(([k, r]) => [k, r.status]))
        const ok =
          codes.noToken === 403 &&
          codes.foreign === 403 &&
          codes.textPlain === 415 &&
          codes.pageNoToken === 403 &&
          rebind === 421 &&
          !saved &&
          own.ok
        if (!ok) console.log(`        ${JSON.stringify({ ...codes, rebind, saved, own: own.status })}`)
        return ok
      } finally {
        await b.stop()
      }
    },
    // The control: the first draft's server, which checked none of it.
    breaks: () => {
      const real = { ...guards }
      for (const k of Object.keys(guards)) guards[k] = () => true
      return () => Object.assign(guards, real)
    },
  })

  await s.check('a reworked image gets a new URL and is never cached stale', {
    assert: async () => {
      const b = await board(COMPS_ARGS)
      try {
        const v = async () => {
          const st = await (await fetch(`http://127.0.0.1:${BOARD_PORT}/api/state?t=${b.token}`)).json()
          return st.comps[1].v.single
        }
        const before = await v()
        const file = b.round.comps[1].shots.single
        const was = readFileSync(file, 'utf8')
        writeFileSync(file, was.replace('#2d6a4f', '#ff00aa'))
        if (keepStamp) spawnSync('touch', ['-r', keepStamp, file])
        const after = await v()
        const img = await fetch(`http://127.0.0.1:${BOARD_PORT}/img/${b.round.comps[1].id}/single?t=${b.token}&v=${after}`)
        writeFileSync(file, was)
        return before !== after && img.headers.get('cache-control') === 'no-cache' && (await img.text()).includes('#ff00aa')
      } finally {
        await b.stop()
      }
    },
    // The control: the first draft's fixed image URL, modelled as an edit the URL cannot see (same
    // size, timestamps copied back to the nanosecond from a preserved copy).
    breaks: () => {
      keepStamp = join(work, 'header-b.stamp')
      spawnSync('cp', ['-p', join(fx.comps, 'header-b.svg'), keepStamp])
      return () => {
        keepStamp = null
      }
    },
  })

  await s.check('the date line is the local day, not UTC', {
    assert: () => {
      const late = new Date(2026, 9, 16, 22, 30) // 22:30 in Toronto is 02:30 UTC the next day
      return tasteMarkdown(first.state, { date: late }).includes('Rated 2026-10-16:')
    },
    breaks: () => {
      const real = Date.prototype.getDate
      Date.prototype.getDate = Date.prototype.getUTCDate
      return () => {
        Date.prototype.getDate = real
      }
    },
  })

  await s.check('rig taste from the CLI: prints the tokened URL, and --done from another shell stops it and prints the path', {
    assert: async () => {
      const root = freshRepo()
      const child = spawn(process.execPath, [RIG, 'taste', ...ARGS], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      child.stdout.on('data', (d) => {
        out += d
      })
      const exited = new Promise((r) => child.on('exit', r))
      const m = await waitFor(async () => /http:\/\/127\.0\.0\.1:5391\/\?t=\S+/.test(out), 30_000)
      if (!m) {
        child.kill()
        return false
      }
      const url = out.match(/http:\/\/127\.0\.0\.1:5391\/\?t=(\S+)/)
      const id = newest(ratingsJson(root)).refs[0].id
      const answer = await fetch(`http://127.0.0.1:5391/api/answer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-taste-token': url[1] },
        body: JSON.stringify({ kind: 'ref', id, rating: 4 }),
      })
      const done = spawnSync(process.execPath, [...cliPreload, RIG, 'taste', '--done'], { cwd: root, encoding: 'utf8' })
      const code = await Promise.race([exited, sleep(5000).then(() => 'still running')])
      if (code === 'still running') child.kill()
      const md = read(join(root, 'docs', 'TASTE.md'))
      const ok = answer.ok && done.status === 0 && code === 0 && /Wrote .*docs\/TASTE\.md/.test(out) && tableRows(md)[0]?.[1] === '4 / 5'
      if (!ok) console.log(`        answer ${answer.status}, --done ${done.status}, board exit ${code}`)
      return ok
    },
    // The control: a --done that cannot reach the running board (its fetch fails), as before it asked.
    breaks: () => {
      cliPreload = ['--import', 'data:text/javascript,globalThis.fetch=()=>Promise.reject(new Error("off"))']
      return () => {
        cliPreload = []
      }
    },
    timeout: 60_000,
  })

  await s.check('--lan: the board answers on the network address with its token; without --lan it does not', {
    assert: async () => {
      const ip = lanAddresses()[0]
      if (!ip) throw new Error('this machine has no LAN address to test on')
      const local = await board()
      const reach = (u) =>
        fetch(u, { signal: AbortSignal.timeout(1500) }).then(
          (r) => r.status,
          () => 'refused',
        )
      const viaLanDefault = await reach(`http://${ip}:${BOARD_PORT}/?t=${local.token}`)
      await local.stop()
      const lan = await board([...ARGS, '--lan'])
      try {
        const viaLan = await reach(lan.lanUrls[0] || 'http://0.0.0.0:1/')
        const noToken = await reach(`http://${ip}:${BOARD_PORT}/`)
        return viaLanDefault === 'refused' && viaLan === 200 && noToken === 403 && lan.lanUrls[0]?.includes(`?t=${lan.token}`)
      } finally {
        await lan.stop()
      }
    },
    // The control: a default board that listens on every interface, as --lan does.
    breaks: () => {
      ARGS.push('--lan')
      return () => ARGS.pop()
    },
  })

  // ── the comps round ──
  /** A comps board on a phone, references already rated, ready on the comps view. */
  async function compsBoard(vp = 'phone', dark = false) {
    const b = await board(COMPS_ARGS)
    const page = await openBoard(browser, b.url, VIEWPORTS[vp], { dark })
    const input = countInput(page)
    for (const r of RATINGS) {
      const before = await progress(page)
      await press(page, input, `.rate[data-rating="${r}"]`, { touch: VIEWPORTS[vp].touch })
      await waitFor(async () => (await progress(page)) !== before)
    }
    return { b, page, input, close: async () => (await page.close(), await b.stop()) }
  }

  await s.check('comps: the question on top, each comp rated and the favourite starred into TASTE.md', {
    assert: async () => {
      const { b, page, input, close } = await compsBoard()
      try {
        if ((await progress(page)) !== 'Comps') return false
        const q = await page.eval('document.getElementById("question")?.textContent')
        for (const r of [2, 5, 3, 4]) await press(page, input, `.rate[data-rating="${r}"]`, { touch: true })
        await sleep(300)
        await press(page, input, '.comp:nth-child(2) .star', { touch: true })
        await sleep(150)
        await press(page, input, '#done', { touch: true })
        const path = await Promise.race([b.finished, sleep(4000).then(() => null)])
        const md = path ? readFileSync(path, 'utf8') : ''
        const want = [
          ['header-a.svg', '2 / 5', '', ''],
          ['header-b.svg', '5 / 5', '★', ''],
          ['header-c.svg', '3 / 5', '', ''],
          ['header-d.svg', '4 / 5', '', ''],
        ]
        const rows = tableRows(md, '## Comps — "Which header feels calm?"')
        if (JSON.stringify(rows) !== JSON.stringify(want)) console.log(`        comps rows: ${JSON.stringify(rows)}`)
        return q === 'Which header feels calm?' && JSON.stringify(rows) === JSON.stringify(want)
      } finally {
        await close()
      }
    },
    breaks: swap(handlers, 'pick', () => {}),
    timeout: 60_000,
  })

  const TARGETS = [
    '.rate',
    '#note',
    '#done',
    '#back',
    ...[1, 2, 3, 4].flatMap((n) => [`.comp:nth-child(${n}) .star`, `.comp:nth-child(${n}) .pick`]),
  ]
  await s.check('comps at 390 wide: every target is at least 44 px', {
    assert: async () => {
      const { page, close } = await compsBoard()
      try {
        const small = []
        for (const t of TARGETS) if (!(await meetsTouchTarget(page, t))) small.push(t)
        if (small.length) console.log(`        under 44 px: ${small.join(', ')}`)
        return !small.length
      } finally {
        await close()
      }
    },
    breaks: pageBreak(`document.head.insertAdjacentHTML('beforeend', '<style>.star{width:30px!important;height:30px!important}</style>')`),
    timeout: 60_000,
  })

  // The control: four fixed 160 px columns, the layout that runs off a phone's right edge.
  await s.check('comps at 390 wide: no sideways scroll, every control in reach', {
    assert: async () => {
      const { page, close } = await compsBoard()
      try {
        const fit = await fitsWithoutScrolling(page)
        if (fit !== true) console.log(`        ${fit}`)
        return fit === true
      } finally {
        await close()
      }
    },
    breaks: pageBreak(
      `document.head.insertAdjacentHTML('beforeend', '<style>.grid{grid-template-columns:repeat(4,160px)!important}</style>')`,
    ),
    timeout: 60_000,
  })

  await s.check('dark mode follows the system: the board goes dark', {
    assert: async () => {
      const b = await board()
      const light = await openBoard(browser, b.url, VIEWPORTS.phone)
      const dark = await openBoard(browser, b.url, VIEWPORTS.phone, { dark: true })
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
    breaks: pageBreak(
      `[...document.styleSheets[0].cssRules].forEach((r, i, a) => { if (r.media && /dark/.test(r.media.mediaText)) document.styleSheets[0].deleteRule(a.indexOf(r)) })`,
    ),
  })

  // The control swaps in the first draft, which always wrote the placeholder, whatever was there.
  let render = tasteMarkdown
  await s.check('TASTE.md keeps principles someone already wrote', {
    assert: () => {
      const md = render(first.state, { previous: '# Taste\n\n## Principles\n\n- Calm beats clever.\n' })
      return md.includes('## Principles\n\n- Calm beats clever.\n') && !md.includes('<name the principles')
    },
    breaks: () => {
      render = (st, o) => tasteMarkdown(st, { ...o, previous: '' })
      return () => {
        render = tasteMarkdown
      }
    },
  })

  if (SHOTS) await screenshots(SHOTS)

  /** docs/shots: desktop and phone, light and dark, of a round in progress and of the comps view. */
  async function screenshots(dir) {
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
        await round(vp, { dark, notes: {}, shots: async (page, at) => at === 'round' && snap(page, `taste-round-${vp}-${theme}`) })
        const { page, input, close } = await compsBoard(vp, dark)
        for (const r of [4, 2]) await press(page, input, `.rate[data-rating="${r}"]`, { touch: VIEWPORTS[vp].touch }).then(() => sleep(260))
        await press(page, input, '.comp:nth-child(1) .star', { touch: VIEWPORTS[vp].touch })
        await snap(page, `taste-comps-${vp}-${theme}`)
        await close()
      }
  }
})

await browser.close()
site.server.close()
for (const r of roots) rmSync(r, { recursive: true, force: true })
rmSync(work, { recursive: true, force: true })
