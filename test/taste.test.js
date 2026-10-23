// rig taste, driven the way he uses it: real taps and clicks through the harness, at points checked
// with elementFromPoint, against the real server writing real files.
//
// Headless Chrome on a debugging port it picks itself, every board on a free port (--port 0, never
// 5391: that is the default his real board listens on), always --no-open: no window ever opens
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
import { crc32, deflateSync, inflateSync } from 'node:zlib'
import * as H from '../harness/index.js'
import { policy, runTaste } from '../src/commands/taste.js'
import { captureAll } from '../src/taste/capture.js'
import { guards, handlers, lanAddresses, view } from '../src/taste/server.js'
import { localDay, tasteMarkdown } from '../src/taste/store.js'

const { suite, launch, countInput, meetsTouchTarget, sleep } = H
const here = dirname(fileURLToPath(import.meta.url))
const RIG = join(here, '..', 'bin', 'rig.js')
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

/**
 * The top-left pixel of a PNG, as [r, g, b]. Row 0's first pixel reads the same under every PNG
 * filter (its left and upper neighbours are zero), so no unfiltering is needed for it.
 */
function firstPixel(png) {
  const type = png[25]
  const bpp = type === 6 ? 4 : type === 2 ? 3 : null
  if (!bpp || png[24] !== 8) throw new Error(`firstPixel: an 8-bit RGB or RGBA PNG, not type ${type}`)
  const idat = []
  for (let at = 8; at < png.length; ) {
    const len = png.readUInt32BE(at)
    if (png.toString('ascii', at + 4, at + 8) === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + len))
    at += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  return [raw[1], raw[2], raw[3]]
}

/** src/taste as it stood at `sha` (default 3de1d59, before the load fix), unpacked once, for a capture control. */
const oldTasteDirs = new Map()
function oldTaste(sha = '3de1d59') {
  if (!oldTasteDirs.has(sha)) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rig-taste-old-')))
    roots.push(dir)
    const r = spawnSync('sh', ['-c', `git -C "${join(here, '..')}" archive ${sha} src harness | tar -x -C "${dir}"`])
    if (r.status !== 0) throw new Error(`could not unpack ${sha} for a control: ${String(r.stderr).trim()}`)
    oldTasteDirs.set(sha, dir)
  }
  return oldTasteDirs.get(sha)
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
    // A page that fills in late, as a real one does from its API: white until its data comes, 1.2 s on.
    if (req.url === '/late') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(
        '<!doctype html><title>Late</title><body style="margin:0;background:#fff"><script>fetch("/late-data").then(() => { document.body.style.background = "rgb(58, 143, 143)" })</script>',
      )
    }
    if (req.url === '/late-data') return setTimeout(() => res.end('{}'), 1200)
    // A page that adds its hero after load and reveals the page in that image's own onload.
    if (req.url === '/late-img') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(
        '<!doctype html><title>Late image</title><body style="margin:0;background:#fff"><script>addEventListener("load", () => { const i = new Image(); i.onload = () => { document.body.style.background = "rgb(58, 143, 143)" }; i.src = "/late-img.png"; document.body.appendChild(i) })</script>',
      )
    }
    if (req.url === '/late-img.png')
      return setTimeout(() => {
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end(bandsPng(8, 8, [0, 0, 0], [0, 0, 0]))
      }, 300)
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

/**
 * Tap or click the centre of `selector`, and resolve whether a click came of it. The page counts every
 * click it is given (openBoard installs the counter ahead of the page's own script, and of any
 * control's), so "did my tap register?" is a fact, not a wait: a tap a fling swallowed never becomes
 * a click, and a dead button gets its click and does nothing with it.
 */
async function press(page, input, selector, { touch }) {
  const p = await pointOn(page, selector)
  if (!p) throw new Error(`${selector} is not hittable`)
  const before = await clicks(page)
  await (touch ? input.tap(p.x, p.y) : input.click(p.x, p.y))
  return waitFor(async () => (await clicks(page)) > before)
}
const clicks = (page) => page.eval('window.__rigClicks || 0')
// Each click is also logged with the card the board showed when it arrived, so a check can know a tap
// landed while the board was still busy with the one before, rather than hope it did.
const CLICK_COUNTER = `window.__rigClicks = 0; window.__rigClickLog = []
window.addEventListener('click', () => {
  window.__rigClicks++
  window.__rigClickLog.push(document.getElementById('progress')?.textContent || '')
}, true)`

/** One key, as a keyboard sends it: key, code and key code set, down then up. */
async function pressKey(page, key) {
  const code = 48 + Number(key)
  const ev = { key, code: `Digit${key}`, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, text: key, unmodifiedText: key }
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...ev })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...ev })
}

const progress = (page) => page.eval('document.getElementById("progress")?.textContent || ""')
const onEnd = (page) => page.eval('!!document.getElementById("end")')
const header = (page) => page.eval('document.getElementById("save")?.textContent || ""')
/**
 * The page's own word that every answer it took is on disk: "Saved" shows only once its queue is
 * empty, and an answer leaves the queue only when the server says it wrote it. The barrier to read
 * the disk after, in place of a sleep that guessed how long a save takes.
 */
const saved = (page) => waitFor(async () => (await header(page)) === 'Saved')
/** One painted frame and the task after it: what a page does at once in answer to input has been done. */
const frame = (page) => page.eval('new Promise((r) => requestAnimationFrame(() => setTimeout(() => r(true), 0)))')

/**
 * Wait until `fn` holds, and return true the moment it does. `ms` is a hang guard, not a budget: no
 * check here may pass or fail on how fast this machine is. Every wait used to carry its own window
 * (0.9 to 5 s) for a save, a swipe or a page to move on, and under a crew's load those windows went
 * red on boards that were right: "a rating tapped straight after a swipe" found B on disk at 4, just
 * after its 2 s ran out. A wait that must decide that something did NOT happen says how it knows
 * (walk() does), and never leans on a window.
 */
const GUARD = 10_000
async function waitFor(fn, ms = GUARD) {
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
    // Sideways too: body's overflow:hidden clips a too-wide #app, so the document never reports it
    // (5.0.0 on the Mac: scrollWidth 390, the board 409). Found by the 5.0.1 review.
    if (app && app.scrollWidth > app.clientWidth + 1) return '#app overflows sideways: ' + app.scrollWidth + ' in ' + app.clientWidth
    if (app && app.getBoundingClientRect().right > innerWidth + 1) return '#app is wider than the screen: ' + Math.round(app.getBoundingClientRect().right)
    const footer = document.getElementById('footer')
    const need = [...document.querySelectorAll('.rate, .comp .star, .comp .pick, .comp .enlarge'), document.getElementById('note'), document.getElementById('done'), document.getElementById('back')]
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

async function openBoard(browser, url, vp, { dark = false, before = null } = {}) {
  const page = await browser.newPage(null, { width: vp.width, height: vp.height, dpr: vp.dpr, mobile: vp.mobile })
  if (vp.touch) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] })
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: CLICK_COUNTER })
  // `before` runs ahead of the page's own script on every load (a skewed clock, for one).
  if (before) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: before })
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
    const landed = await press(page, input, `.rate[data-rating="${ratings[i]}"]`, { touch })
    // What the tap did is known one frame after its click, never from a window: the board marks the
    // rating pressed in the click itself and moves on 160 ms later; the old board (a control) marks it
    // and waits for Next; a dead button does nothing at all, and the walk goes on, a tap the poorer.
    await frame(page)
    const moves = async () => (await progress(page)) !== before || (await onEnd(page))
    const answered =
      landed && ((await moves()) || (await page.eval(`!!document.querySelector('.rate[data-rating="${ratings[i]}"][aria-pressed=true]')`)))
    if (answered && !(await moves()) && (await pointOn(page, '#next'))) await press(page, input, '#next', { touch })
    if (answered) await waitFor(moves)
  }
  if (shots) await shots(page, 'end')
  await press(page, input, (await pointOn(page, '#finish')) ? '#finish' : '#done', { touch })
  const closed = await waitFor(() => page.eval('!!document.getElementById("closed")'))
  return { ...input.counts(), closed, fits: fits.every((f) => f === true) ? true : fits.find((f) => f !== true) }
}

// ── the run ─────────────────────────────────────────────────────────────────────────────────────

// His board's default port is held for the whole run, as it is when he has a round open. Nothing
// here may need it: every board takes --port 0. If his real board already has it, that is the same test.
const squatter = createServer((_, res) => res.end('his board'))
await new Promise((r) => squatter.once('error', r).listen(5391, '127.0.0.1', r))

const work = realpathSync(mkdtempSync(join(tmpdir(), 'rig-taste-fx-')))
const fx = makeFixtures(work)
const site = await siteServer()
const STUDIO = `${site.base}/studio`
const DEAD = `${site.base}/dead`
const MISSING = `${site.base}/missing`
const browser = await launch({ headless: true })
const ARGS = ['--from', fx.refs, '--url', STUDIO, '--url', DEAD, '--url', MISSING, '--port', '0', '--no-open']
const COMPS_ARGS = [...ARGS, '--comps', fx.comps, '--ask', 'Which header feels calm?']
const LAN_ARGS = ['--from', fx.refs, '--port', '0', '--no-open']
const RATINGS = [5, 2, 4, 1, 3, 5]
const NAMES = ['ember', 'harbor', 'meadow', 'slate.png', 'tide.svg', STUDIO]
const NOTE = 'calm, but the type is too small'
const roots = []
// Every board started, so a check that fails before its own stop() cannot keep the run alive.
const boards = []
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
  boards.push(b)
  return b
}

/** One whole round: board up, page open, walk, Done; returns what was counted and what was written. */
async function round(vp, { notes = {}, ratings = RATINGS, dark = false, shots = null } = {}) {
  const b = await board()
  let page
  try {
    page = await openBoard(browser, b.url, VIEWPORTS[vp], { dark })
    const counts = await walk(page, ratings, { touch: VIEWPORTS[vp].touch, notes, shots })
    const path = await Promise.race([b.finished, sleep(GUARD).then(() => null)])
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
  // A check's timeout here is a hang guard. The harness's 10 s default was a budget every check that
  // starts a board (Chrome, three URLs) paid out of, and under a crew's load the --lan check went red
  // inside it with nothing wrong. Every wait inside a check is a guard on a real condition (waitFor).
  const check = s.check.bind(s)
  s.check = (name, o) => check(name, { timeout: 90_000, ...o })

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

  // 5.0 waited a fixed 700 ms per shot: most of the time a round took to open, and a page that filled
  // in later than that was shot blank. A shot is now taken once the page is quiet.
  let capture = captureAll
  await s.check('a page that fills in after load is shot filled in, not as its first blank paint', {
    assert: async () => {
      const dir = mkdtempSync(join(tmpdir(), 'rig-taste-late-'))
      roots.push(dir)
      const card = { id: 'late', name: 'late', url: `${site.base}/late`, source: 'url', shots: {} }
      const { ok } = await capture([card], dir, { log: () => {} })
      const px = ok[0] && firstPixel(readFileSync(ok[0].shots.desktop))
      if (px?.join() !== '58,143,143') console.log(`        first pixel of the shot: ${px?.join() ?? 'no shot'}`)
      return px?.join() === '58,143,143'
    },
    // The control: capture as it was at 3de1d59, with its fixed 700 ms pause.
    breaks: async () => {
      capture = (await import(join(oldTaste(), 'src', 'taste', 'capture.js'))).captureAll
      return () => {
        capture = captureAll
      }
    },
    timeout: 60_000,
  })

  let captureNow = captureAll
  await s.check('a page that reveals itself in an image’s own onload keeps that handler, and is shot revealed', {
    assert: async () => {
      const dir = mkdtempSync(join(tmpdir(), 'rig-taste-lateimg-'))
      roots.push(dir)
      const card = { id: 'late-img', name: 'late-img', url: `${site.base}/late-img`, source: 'url', shots: {} }
      const { ok } = await captureNow([card], dir, { log: () => {} })
      const px = ok[0] && firstPixel(readFileSync(ok[0].shots.desktop))
      if (px?.join() !== '58,143,143') console.log(`        first pixel of the shot: ${px?.join() ?? 'no shot'}`)
      return px?.join() === '58,143,143'
    },
    // The control: e80d49e's settle(), which set i.onload = i.onerror and threw the page's handler away.
    breaks: async () => {
      captureNow = (await import(join(oldTaste('e80d49e'), 'src', 'taste', 'capture.js'))).captureAll
      return () => {
        captureNow = captureAll
      }
    },
    timeout: 60_000,
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
        await waitFor(() => newest(ratingsJson(b.root)).ratings?.[b.round.refs[0].id]?.note === 'closed too soon')
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

  // fv2's probe, kept: 1d896e0's page emptied its queue when the tab was hidden and never looked at
  // the result, so an answer given while the board was unreachable vanished, and the next good tap
  // showed "Saved" over the hole. The control serves that page (from git) instead of today's.
  const OLD_PAGE = (() => {
    const old = spawnSync('git', ['show', '1d896e0:src/taste/page.js'], { cwd: here, encoding: 'utf8' })
    if (old.status !== 0) return null
    const file = join(work, 'page-1d896e0.mjs')
    writeFileSync(file, old.stdout)
    return file
  })()
  const offline = (page, on) =>
    page.send('Network.emulateNetworkConditions', { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await s.check('an answer given offline, through a hidden tab, reaches disk once the board is back', {
    assert: async () => {
      const b = await board()
      const page = await openBoard(browser, b.url, VIEWPORTS.desktop)
      const input = countInput(page)
      const [r0, r1] = b.round.refs.map((c) => c.id)
      try {
        await page.send('Network.enable')
        await offline(page, true)
        await press(page, input, '.rate[data-rating="4"]', { touch: false })
        await waitFor(async () => (await progress(page)) === '2 of 6')
        await waitFor(async () => (await header(page)) === 'Not saved')
        const whileOffline = await header(page)
        // The tab is hidden (switched away, phone locked) and shown again.
        await page.eval(`(() => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
          document.dispatchEvent(new Event('visibilitychange'))
          delete document.visibilityState
          document.dispatchEvent(new Event('visibilitychange'))
        })()`)
        await sleep(300)
        await offline(page, false)
        await press(page, input, '.rate[data-rating="2"]', { touch: false })
        const both = () => {
          const rd = newest(ratingsJson(b.root))
          return rd.ratings?.[r0]?.rating === 4 && rd.ratings?.[r1]?.rating === 2
        }
        await waitFor(async () => both())
        await saved(page)
        const after = await header(page)
        const rd = newest(ratingsJson(b.root))
        if (!both() || after !== 'Saved' || whileOffline !== 'Not saved')
          console.log(
            `        offline header "${whileOffline}", then "${after}"; on disk ${rd.ratings?.[r0]?.rating ?? '—'}, ${rd.ratings?.[r1]?.rating ?? '—'}`,
          )
        return both() && after === 'Saved' && whileOffline === 'Not saved'
      } finally {
        await page.close()
        await b.stop()
      }
    },
    breaks: OLD_PAGE
      ? async () => {
          const { pageHtml } = await import(OLD_PAGE)
          return swap(view, 'page', pageHtml)()
        }
      : undefined,
    timeout: 60_000,
  })

  // fv2's second re-check: the hide flush sends every queued answer at once, so a card re-rated
  // while its first answer was in flight could end on the older rating. CDP's Fetch domain holds
  // the first answer back and lets it land last, so the race is the same on every run.
  await s.check('a re-rating that overtakes the first answer wins, even when the first lands last', {
    assert: async () => {
      const b = await board()
      const page = await openBoard(browser, b.url, VIEWPORTS.desktop)
      const input = countInput(page)
      const r0 = b.round.refs[0].id
      let held = null
      const passed = []
      page.on('Fetch.requestPaused', (e) => {
        if (!held) held = e.requestId
        else page.send('Fetch.continueRequest', { requestId: e.requestId }).then(() => passed.push(e.requestId))
      })
      try {
        await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/answer*', requestStage: 'Request' }] })
        await press(page, input, '.rate[data-rating="4"]', { touch: false })
        await waitFor(async () => (await progress(page)) === '2 of 6' && !!held)
        await press(page, input, '#back', { touch: false })
        await waitFor(async () => (await progress(page)) === '1 of 6')
        await press(page, input, '.rate[data-rating="2"]', { touch: false })
        await sleep(200)
        // Hidden: the flush sends the waiting re-rating while the first is still held.
        await page.eval(`(() => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
          document.dispatchEvent(new Event('visibilitychange'))
          delete document.visibilityState
        })()`)
        await waitFor(async () => newest(ratingsJson(b.root)).ratings?.[r0]?.rating === 2)
        await page.send('Fetch.continueRequest', { requestId: held })
        // The held answer leaves the queue only when the server has taken it: then it has landed.
        await saved(page)
        const final = newest(ratingsJson(b.root)).ratings?.[r0]?.rating
        if (final !== 2) console.log(`        card 1 ended at ${final}`)
        return final === 2
      } finally {
        await page.send('Fetch.disable').catch(() => {})
        await page.close()
        await b.stop()
      }
    },
    // The control: 94c50dc's answer handler, which took whatever arrived last.
    breaks: swap(handlers, 'answer', (round, body) => {
      const map = body.kind === 'comp' ? round.compRatings : round.ratings
      const next = { ...(map[body.id] || {}), at: new Date().toISOString() }
      if ('rating' in body) next.rating = body.rating
      if ('note' in body) next.note = String(body.note ?? '')
      map[body.id] = next
    }),
    timeout: 60_000,
  })

  // fv2's probe E: c8f3088 numbered answers by each tab's own clock and compared them across tabs,
  // so a phone whose clock runs 2 minutes behind could not change what the desktop said; the old
  // value stayed on disk under "Saved". The control serves c8f3088's page and handler together.
  const PAGE_C8 = (() => {
    const old = spawnSync('git', ['show', 'c8f3088:src/taste/page.js'], { cwd: here, encoding: 'utf8' })
    if (old.status !== 0) return null
    const file = join(work, 'page-c8f3088.mjs')
    writeFileSync(file, old.stdout)
    return file
  })()
  const answerC8 = (round, body) => {
    const map = body.kind === 'comp' ? round.compRatings : round.ratings
    const next = { ...(map[body.id] || {}), at: new Date().toISOString() }
    const seq = Number.isFinite(body.seq) ? body.seq : null
    const newer = (held) => seq === null || !(held > seq)
    if ('rating' in body && newer(next.ratingSeq)) {
      next.rating = body.rating
      if (seq !== null) next.ratingSeq = seq
    }
    if ('note' in body && newer(next.noteSeq)) {
      next.note = String(body.note ?? '')
      if (seq !== null) next.noteSeq = seq
    }
    map[body.id] = next
  }
  await s.check('a second tab whose clock runs 2 minutes behind can still change a rating', {
    assert: async () => {
      const b = await board()
      const r0 = b.round.refs[0].id
      const desk = await openBoard(browser, b.url, VIEWPORTS.desktop)
      const phone = await openBoard(browser, b.url, VIEWPORTS.phone, {
        before: 'Date.now = ((n) => () => n() - 120000)(Date.now.bind(Date))',
      })
      try {
        await press(desk, countInput(desk), '.rate[data-rating="5"]', { touch: false })
        await waitFor(() => newest(ratingsJson(b.root)).ratings?.[r0]?.rating === 5)
        await press(phone, countInput(phone), '.rate[data-rating="2"]', { touch: true })
        await waitFor(() => newest(ratingsJson(b.root)).ratings?.[r0]?.rating === 2)
        await saved(phone)
        const final = newest(ratingsJson(b.root)).ratings?.[r0]?.rating
        const said = await header(phone)
        if (final !== 2) console.log(`        card 1 on disk: ${final}, the phone's header: "${said}"`)
        return final === 2 && said === 'Saved'
      } finally {
        await desk.close()
        await phone.close()
        await b.stop()
      }
    },
    breaks: PAGE_C8
      ? async () => {
          const { pageHtml } = await import(PAGE_C8)
          const restorePage = swap(view, 'page', pageHtml)()
          const restoreAnswer = swap(handlers, 'answer', answerC8)()
          return () => {
            restoreAnswer()
            restorePage()
          }
        }
      : undefined,
    timeout: 60_000,
  })

  // The set-up can miss on a loaded machine. A miss is never scored: in the real run it is a FAIL
  // ("could not set up"), and in the control it is a pass, so a control that never exercised the rule
  // grades VOID, never PASS (r55m's delta review: a throw in the control used to count as "seen red").
  const fastTap = {
    inControl: false,
    forceMiss: false, // the meta-check's way to make every set-up miss
    giveUp: () => {
      if (fastTap.inControl) return true
      throw new Error('could not land a second tap while the board was busy in 3 tries')
    },
    async assert() {
      // The second click must land while the board is still moving on from the first (on card 1),
      // or the check measures nothing. Both are sent at once, and the page's click log says where
      // the second one landed; a set-up that missed (a loaded machine) is set up again, never scored.
      for (let attempt = 1; attempt <= 3; attempt++) {
        const b = await board()
        const page = await openBoard(browser, b.url, VIEWPORTS.desktop)
        try {
          const p5 = await pointOn(page, '.rate[data-rating="5"]')
          const p3 = await pointOn(page, '.rate[data-rating="3"]')
          const at = (p) =>
            [
              ['mouseMoved', 'none'],
              ['mousePressed', 'left'],
              ['mouseReleased', 'left'],
            ].map(([type, button]) => page.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button, clickCount: 1 }))
          await Promise.all([...at(p5), ...at(p3)])
          await waitFor(async () => (await clicks(page)) >= 2)
          const log = await page.eval('window.__rigClickLog')
          if (fastTap.forceMiss || log[1] !== '1 of 6') {
            console.log(`        attempt ${attempt}: the second tap landed on "${log[1]}", after the board moved on; setting up again`)
            continue
          }
          await waitFor(async () => (await progress(page)) === '3 of 6')
          await saved(page)
          const rd = newest(ratingsJson(b.root))
          return rd.ratings?.[b.round.refs[0].id]?.rating === 5 && rd.ratings?.[b.round.refs[1].id]?.rating === 3
        } finally {
          await page.close()
          await b.stop()
        }
      }
      return fastTap.giveUp()
    },
    // The control: the first draft's rule, a tap inside the busy window thrown away.
    breaks: () => {
      fastTap.inControl = true
      const restore = pageBreak(`(() => {
      let last = 0
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.rate')) return
        if (Date.now() - last < 160) e.stopImmediatePropagation()
        else last = Date.now()
      }, true)
    })()`)()
      return () => {
        fastTap.inControl = false
        restore()
      }
    },
  }
  await s.check('a fast second tap is queued onto the next card, never dropped', {
    assert: () => fastTap.assert(),
    breaks: fastTap.breaks,
  })

  const realGiveUp = fastTap.giveUp
  let giveUp = realGiveUp
  await s.check('a fast-second-tap control whose set-up never landed grades VOID, never PASS', {
    assert: async () => {
      fastTap.giveUp = giveUp
      const inner = new H.Suite('inner')
      const log = console.log
      console.log = () => {}
      try {
        const r = await inner.check('(inner) a fast second tap, every control set-up missing', {
          assert: () => fastTap.assert(),
          breaks: () => {
            const restore = fastTap.breaks()
            fastTap.forceMiss = true
            return () => {
              fastTap.forceMiss = false
              restore()
            }
          },
          timeout: 60_000,
        })
        if (r.state !== 'VOID') log(`        inner check graded ${r.state}: ${r.detail}`)
        return r.state === 'VOID'
      } finally {
        console.log = log
        fastTap.giveUp = realGiveUp
      }
    },
    // The control: e80d49e's give-up, a throw in either run, which the harness reads as "seen red".
    breaks: () => {
      giveUp = () => {
        throw new Error('could not land a second tap while the board was busy in 3 tries')
      }
      return () => {
        giveUp = realGiveUp
      }
    },
  })

  await s.check('the number keys rate and advance, as the buttons do', {
    assert: async () => {
      const b = await board()
      const page = await openBoard(browser, b.url, VIEWPORTS.desktop)
      try {
        for (const k of ['4', '2']) {
          const before = await progress(page)
          await pressKey(page, k)
          await frame(page)
          // The key is answered in its own keydown (the rating marked) or not at all. Under load the
          // frame can come after the board has already moved on, which answers it too.
          const moved = async () => (await progress(page)) !== before
          const marked = (await moved()) || (await page.eval(`!!document.querySelector('.rate[data-rating="${k}"][aria-pressed=true]')`))
          if (!marked || !(await waitFor(moved))) break
        }
        await saved(page)
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

  // On the Mac the phone board was 409 px wide on a 390 px screen: #app's one grid column took the
  // reference's whole name as its minimum width (Apple's serif is wider than Linux's), and the 5 and
  // Done went off the edge. A name long enough does it on any machine. Found by the Mac run of 5.0.0.
  await s.check('a long reference name or question never widens the board past a phone screen', {
    assert: async () => {
      const dir = join(work, 'long-name-refs')
      mkdirSync(dir, { recursive: true })
      const name = 'a-reference-with-a-very-long-file-name-that-will-never-fit-across-a-phone-screen.png'
      writeFileSync(join(dir, name), bandsPng(800, 500, [52, 58, 64], [92, 99, 106]))
      const w = VIEWPORTS.phone.width
      // The same header carries a comps round's question: a long --ask did it too (985 px on 5.0.0).
      const ask = 'Which of these headers feels calm enough to read at the counter on a busy Saturday morning?'
      const rounds = [
        [['--from', dir, '--port', '0', '--no-open'], 'the long name'],
        [['--comps', fx.comps, '--ask', ask, '--port', '0', '--no-open'], 'the long question'],
      ]
      for (const [args, what] of rounds) {
        const b = await board(args)
        const page = await openBoard(browser, b.url, VIEWPORTS.phone)
        try {
          const fit = await fitsWithoutScrolling(page)
          const edge = await page.eval('Math.round(document.querySelector("header").getBoundingClientRect().right)')
          // The name is cut, not just narrow: its ellipsis is on.
          const cut =
            what === 'the long name'
              ? await page.eval('(() => { const n = document.getElementById("name"); return n.scrollWidth > n.clientWidth })()')
              : true
          if (fit !== true || edge > w || !cut)
            console.log(`        ${what}: ${fit}; the header ends at ${edge} px on a ${w} px screen; cut ${cut}`)
          if (fit !== true || edge > w || !cut) return false
        } finally {
          await page.close()
          await b.stop()
        }
      }
      return true
    },
    // The control: #app's column back to auto, as in 5.0.0.
    breaks: pageBreak(`document.getElementById('app').style.gridTemplateColumns = 'auto'`),
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
      await saved(page)
      await page.close()
      await b1.stop()
      // Round 2: the comps alone, as `rig taste --comps … --ask …` with no --from.
      const b2 = await board(['--comps', fx.comps, '--ask', 'Which header feels calm?', '--port', '0', '--no-open'], b1.root)
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
      await saved(page)
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
        // Same port as the open tab, so its answers reach the new board and are refused.
        const b2 = await board(
          ARGS.map((a, i) => (ARGS[i - 1] === '--port' ? String(b.port) : a)),
          b.root,
        )
        try {
          await press(page, input, '.rate[data-rating="4"]', { touch: false })
          const shown = await waitFor(() => page.eval('/round has ended/.test(document.getElementById("ended")?.textContent || "")'))
          await press(page, input, '#done', { touch: false })
          // Done on an ended round answers at once or not at all: one frame later is the answer.
          await frame(page)
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
      const base = `http://127.0.0.1:${b.port}`
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
          request({ host: '127.0.0.1', port: b.port, path: `/?t=${b.token}`, headers: { host: `attacker.example:${b.port}` } }, (r) =>
            res(r.statusCode),
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
          const st = await (await fetch(`http://127.0.0.1:${b.port}/api/state?t=${b.token}`)).json()
          return st.comps[1].v.single
        }
        const before = await v()
        const file = b.round.comps[1].shots.single
        const was = readFileSync(file, 'utf8')
        writeFileSync(file, was.replace('#2d6a4f', '#ff00aa'))
        if (keepStamp) spawnSync('touch', ['-r', keepStamp, file])
        const after = await v()
        const img = await fetch(`http://127.0.0.1:${b.port}/img/${b.round.comps[1].id}/single?t=${b.token}&v=${after}`)
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
      // A throw below (a fetch, a ratings file not there yet) must not leave the board running: its
      // pipes would keep the suite alive, the shape of the 2026-10-16 hang (fv3, review of e4ac688).
      try {
        let out = ''
        child.stdout.on('data', (d) => {
          out += d
        })
        const exited = new Promise((r) => child.on('exit', r))
        const m = await waitFor(async () => /http:\/\/127\.0\.0\.1:\d+\/\?t=\S+/.test(out), 30_000)
        if (!m) {
          child.kill()
          return false
        }
        const url = out.match(/http:\/\/127\.0\.0\.1:(\d+)\/\?t=(\S+)/)
        const id = newest(ratingsJson(root)).refs[0].id
        const answer = await fetch(`http://127.0.0.1:${url[1]}/api/answer`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-taste-token': url[2] },
          body: JSON.stringify({ kind: 'ref', id, rating: 4 }),
        })
        const done = spawnSync(process.execPath, [...cliPreload, RIG, 'taste', '--done'], { cwd: root, encoding: 'utf8' })
        const code = await Promise.race([exited, sleep(GUARD).then(() => 'still running')])
        if (code === 'still running') child.kill()
        const md = read(join(root, 'docs', 'TASTE.md'))
        const ok = answer.ok && done.status === 0 && code === 0 && /Wrote .*docs\/TASTE\.md/.test(out) && tableRows(md)[0]?.[1] === '4 / 5'
        if (!ok) console.log(`        answer ${answer.status}, --done ${done.status}, board exit ${code}`)
        return ok
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }
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
      // A board of images alone: what is under test is where it listens, not capturing URLs, which
      // took two Chromes and most of this check's time.
      const local = await board(LAN_ARGS)
      const reach = (u) =>
        fetch(u, { signal: AbortSignal.timeout(1500) }).then(
          (r) => r.status,
          () => 'refused',
        )
      const viaLanDefault = await reach(`http://${ip}:${local.port}/?t=${local.token}`)
      await local.stop()
      const lan = await board([...LAN_ARGS, '--lan'])
      try {
        const viaLan = await reach(lan.lanUrls[0] || 'http://0.0.0.0:1/')
        const noToken = await reach(`http://${ip}:${lan.port}/`)
        return viaLanDefault === 'refused' && viaLan === 200 && noToken === 403 && lan.lanUrls[0]?.includes(`?t=${lan.token}`)
      } finally {
        await lan.stop()
      }
    },
    // The control: a default board that listens on every interface, as --lan does.
    breaks: () => {
      LAN_ARGS.push('--lan')
      return () => LAN_ARGS.pop()
    },
  })

  // ── the comps round ──
  /** Which comp the phone view shows, and what each chip says. */
  const shownComp = (page) => page.eval('document.querySelector("#grid .comp")?.dataset.id')
  const chipText = (page, k) => page.eval(`document.querySelector('.chip[data-k="${k}"]')?.innerText.replace(/\\s+/g, ' ').trim()`)
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
        if (!(await progress(page)).startsWith('Comps')) return false
        const q = await page.eval('document.getElementById("name")?.textContent')
        for (const r of [2, 5, 3, 4]) await press(page, input, `.rate[data-rating="${r}"]`, { touch: true })
        await waitFor(() => Object.keys(newest(ratingsJson(b.root)).compRatings || {}).length === 4)
        // One comp at a time on a phone: B's chip, then its star.
        await press(page, input, '.chip[data-k="1"]', { touch: true })
        await waitFor(async () => (await shownComp(page)) === b.round.comps[1].id)
        await press(page, input, '.comp .star', { touch: true })
        await saved(page)
        await press(page, input, '#done', { touch: true })
        const path = await Promise.race([b.finished, sleep(GUARD).then(() => null)])
        const md = path ? readFileSync(path, 'utf8') : ''
        const want = [
          ['header-a.svg', '2 / 5', '', ''],
          ['header-b.svg', '5 / 5', '★', ''],
          ['header-c.svg', '3 / 5', '', ''],
          ['header-d.svg', '4 / 5', '', ''],
        ]
        const rows = tableRows(md, '## Comps — "Which header feels calm?"')
        if (JSON.stringify(rows) !== JSON.stringify(want)) console.log(`        comps rows: ${JSON.stringify(rows)}`)
        if (q !== 'Which header feels calm?') console.log(`        header reads ${q}`)
        return q === 'Which header feels calm?' && JSON.stringify(rows) === JSON.stringify(want)
      } finally {
        await close()
      }
    },
    breaks: swap(handlers, 'pick', () => {}),
    timeout: 60_000,
  })

  await s.check('comps: the question shows once, and each frame takes the image’s shape', {
    assert: async () => {
      const { page, close } = await compsBoard()
      try {
        const times = await page.eval('document.body.innerText.split("Which header feels calm?").length - 1')
        // The fixtures are 1440×900: a frame within a pixel of 1.6 wide per tall, no letterbox.
        const shapes = await page.eval('[...document.querySelectorAll(".comp .pick")].map((p) => p.clientWidth / p.clientHeight)')
        const ok = times === 1 && shapes.length >= 1 && shapes.every((r) => Math.abs(r - 1.6) < 0.03)
        if (!ok) console.log(`        question shown ${times}×, frames ${shapes.map((r) => r.toFixed(2)).join(', ')}`)
        return ok
      } finally {
        await close()
      }
    },
    // The control: the first comps view, with the question again above the grid and portrait frames.
    breaks: pageBreak(`(() => {
      new MutationObserver(() => {
        const g = document.getElementById('grid')
        if (g && !document.getElementById('again')) g.insertAdjacentHTML('beforebegin', '<p id="again">Which header feels calm?</p>')
      }).observe(document.body, { childList: true, subtree: true })
      document.head.insertAdjacentHTML('beforeend', '<style>.comp .pick{height:300px!important}</style>')
    })()`),
    timeout: 60_000,
  })

  await s.check('comps on a phone: tapping a chip shows that comp, and the chip carries its rating', {
    assert: async () => {
      const { b, page, input, close } = await compsBoard()
      try {
        await press(page, input, '.chip[data-k="2"]', { touch: true })
        await frame(page) // a chip shows its comp in its own click
        const showsC = (await shownComp(page)) === b.round.comps[2].id
        if (showsC) {
          await press(page, input, '.rate[data-rating="4"]', { touch: true })
          await waitFor(async () => (await chipText(page, 2)) === 'C 4 / 5')
        }
        const chip = await chipText(page, 2)
        if (!showsC || chip !== 'C 4 / 5') console.log(`        shows C: ${showsC}; chip C reads "${chip}"`)
        return showsC && chip === 'C 4 / 5'
      } finally {
        await close()
      }
    },
    // The control: chips that take the tap and do nothing with it.
    breaks: pageBreak(`document.addEventListener('click', (e) => { if (e.target.closest('.chip')) e.stopImmediatePropagation() }, true)`),
    timeout: 60_000,
  })

  await s.check('comps on a phone: a swipe left shows the next comp, a swipe right the one before', {
    assert: async () => {
      const { b, page, input, close } = await compsBoard()
      try {
        const box = await page.eval(
          '(() => { const r = document.querySelector("#grid .comp .pick").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()',
        )
        // The board changes comp in the swipe's own touchend: one frame later it has, or it never will.
        const start = await shownComp(page)
        await input.swipe({ x: box.x + 100, y: box.y, dx: -200, dy: 0 })
        await frame(page)
        const next = await shownComp(page)
        await input.swipe({ x: box.x - 100, y: box.y, dx: 200, dy: 0 })
        await frame(page)
        const back = await shownComp(page)
        const ids = b.round.comps.map((c) => c.id)
        const ok = start === ids[0] && next === ids[1] && back === ids[0]
        if (!ok)
          console.log(
            `        start ${ids.indexOf(start)}, after left ${ids.indexOf(next)}, after right ${ids.indexOf(back)}; progress ${await progress(page)}; stage: ${(await page.eval('document.getElementById("stage").innerHTML')).slice(0, 200)}`,
          )
        return ok
      } finally {
        await close()
      }
    },
    // The control: a board deaf to swipes, its touch never reaching the comp.
    breaks: pageBreak(
      `document.addEventListener('touchend', (e) => { if (e.target.closest('#stage')) e.stopImmediatePropagation() }, true)`,
    ),
    timeout: 60_000,
  })

  // Found building 5.0.3: the swipe was also the browser's fling, and a tap within half a second of
  // it only stopped the fling. Swiping to comp B and tapping 4 at once saved nothing.
  //
  // The control leaves the swipe to the browser again, and is only a control where the browser's
  // fling eats the next tap. Nothing a page can see moves during that fling (no scroll, no viewport
  // change, nothing on the board scrolls sideways): Chrome spends the tap on its own gesture, and no
  // click comes of it. Linux's Chrome does that; the Mac's took the swipe and still clicked (QA at
  // 949e12b and c0b7a92: VOID at no load). So before scoring, the suite asks whether the broken board
  // ever swallows a tap here (up to 3 set-ups, read from the page's click counter, not the check's
  // own disk read); and a control run scores only when its tap really was swallowed.
  const SWIPE_BREAK = `window.addEventListener('touchmove', (e) => e.stopPropagation(), { capture: true })`
  const PLAIN = (keep) =>
    `data:text/html,${encodeURIComponent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;height:100vh"><button id="b" style="position:fixed;bottom:40px;left:40px;width:120px;height:60px">tap</button><div id="s" style="position:fixed;top:100px;left:0;right:0;height:400px;background:#ddd"></div>${keep ? "<script>document.getElementById('s').addEventListener('touchmove', (e) => e.preventDefault(), { passive: false })</script>" : ''}`)}`
  /** On a plain page, does a tap sent as a swipe ends come to no click? `keep`: the page holds the swipe itself. */
  let swallows = async ({ keep = false } = {}) => {
    const page = await browser.newPage(null, { width: 390, height: 844, dpr: 3, mobile: true })
    try {
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source: CLICK_COUNTER })
      await page.goto(PLAIN(keep))
      const input = countInput(page)
      await input.swipe({ x: 300, y: 300, dx: -200, dy: 0 })
      await input.tap(100, 774)
      return !(await waitFor(async () => (await clicks(page)) > 0))
    } finally {
      await page.close()
    }
  }
  const swipeTap = { inControl: false }

  // The calibration must never claim a swallowed tap that clicked: a page that holds the swipe itself
  // gets its tap on every platform.
  await s.check('the fling calibration: on a page that holds its swipe, the tap after it is never called swallowed', {
    assert: async () => !(await swallows({ keep: true })),
    // The control: a calibration that never looks at the click and calls every tap swallowed.
    breaks: () => {
      const real = swallows
      swallows = async () => true
      return () => {
        swallows = real
      }
    },
    timeout: 60_000,
  })

  let flingHere = false

  /** Swipe to comp B and tap 4 as the swipe ends: did a click come of the tap, and is B rated 4 on disk? */
  async function swipeThenTap() {
    const { b, page, input, close } = await compsBoard()
    const B = b.round.comps[1].id
    try {
      const at = (sel) =>
        page.eval(
          `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`,
        )
      const box = await at('#grid .comp .pick')
      const four = await at('.rate[data-rating="4"]') // the footer: the same place whichever comp shows
      const before = await clicks(page)
      await input.swipe({ x: box.x + 100, y: box.y, dx: -200, dy: 0 })
      await input.tap(four.x, four.y)
      await frame(page)
      const shown = await shownComp(page)
      // The bug this guards: the browser's fling ate the tap, so no click ever came of it.
      const landed = await waitFor(async () => (await clicks(page)) > before)
      const saved = landed && (await waitFor(() => newest(ratingsJson(b.root)).compRatings?.[B]?.rating === 4))
      return { landed, reachedB: shown === B, saved, onDisk: newest(ratingsJson(b.root)).compRatings?.[B]?.rating ?? 'nothing' }
    } finally {
      await close()
    }
  }

  pageBreaks.push(SWIPE_BREAK)
  try {
    for (let i = 0; i < 3 && !flingHere; i++) flingHere = !(await swipeThenTap()).landed
  } finally {
    pageBreaks.pop()
  }

  const swipeName = 'comps on a phone: a rating tapped straight after a swipe still counts'
  const swipeAssert = async () => {
    // In the control, a run whose tap still clicked never met the fling: set up again, and if it never
    // does, pass, so the result is VOID, never a red that proved nothing.
    for (let attempt = 1; attempt <= (swipeTap.inControl ? 3 : 1); attempt++) {
      const r = await swipeThenTap()
      if (swipeTap.inControl && r.landed) continue
      if (!r.reachedB) throw new Error('the swipe did not reach comp B')
      if (!r.saved)
        console.log(`        after the swipe B on disk: ${r.onDisk}${swipeTap.inControl ? ' (control: the fling ate the tap)' : ''}`)
      return r.saved
    }
    return true
  }
  if (flingHere)
    await s.check(swipeName, {
      assert: swipeAssert,
      // The control: the swipe left to the browser as well, as in 5.0.2.
      breaks: () => {
        swipeTap.inControl = true
        pageBreaks.push(SWIPE_BREAK)
        return () => {
          pageBreaks.pop()
          swipeTap.inControl = false
        }
      },
      timeout: 90_000,
    })
  else {
    console.log(
      `        ${swipeName}: no control on ${process.platform}: with the swipe left to the browser, the board's tap still clicked in 3 of 3 set-ups, so the fling this guards against cannot be made here`,
    )
    await s.check(swipeName, { assert: swipeAssert, timeout: 60_000 })
  }

  // ── full screen ──
  // 5.0.3: he rated four comps side by side on a 2560×1440 screen and could not see them ("the
  // pictures are too small for me to see"). Every picture now opens full screen with one click.

  /** A key with no text (Escape, the arrows), as a keyboard sends it. */
  const KEY_CODES = { Escape: 27, ArrowLeft: 37, ArrowRight: 39 }
  async function pressNamed(page, key) {
    const ev = { key, code: key, windowsVirtualKeyCode: KEY_CODES[key], nativeVirtualKeyCode: KEY_CODES[key] }
    await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...ev })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...ev })
  }

  /**
   * What the viewer shows: null when it is closed. `big` is decided by elementFromPoint alone: every
   * point on a line from 5% to 95% of the window's width (across the middle), or of its height (down
   * the middle), lands on the picture. The frame must be the picture's own shape, so a letterboxed
   * frame cannot pass for picture, and fully faded in, since a hit-test cannot see opacity.
   */
  const viewer = (page) =>
    page.eval(`(() => {
      const d = document.getElementById('viewer'), img = document.getElementById('vimg')
      if (!d || !d.open) return null
      const ready = img.complete && img.naturalWidth > 0 && getComputedStyle(img).opacity === '1'
      const ownShape = ready && Math.abs(img.clientWidth / img.clientHeight - img.naturalWidth / img.naturalHeight) < 0.02
      const on = (x, y) => document.elementFromPoint(x, y) === img
      const line = (f) => Array.from({ length: 19 }, (_, k) => 0.05 + (0.9 * k) / 18).every(f)
      const wide = line((t) => on(innerWidth * t, innerHeight * 0.45))
      const tall = line((t) => on(innerWidth * 0.5, innerHeight * t))
      return { id: d.dataset.id, src: img.getAttribute('src') || '', ready, ownShape, wide, tall, big: ownShape && (wide || tall) }
    })()`)
  /** True once the viewer shows card `id` (in `view`, when given), at full size unless `big` is false. */
  const shows = (page, id, { view = '', big = true } = {}) =>
    waitFor(async () => {
      const v = await viewer(page)
      return !!v && v.id === id && v.src.includes(`/img/${encodeURIComponent(id)}/${view}`) && v.ready && (!big || v.big)
    })

  await s.check('full screen: Enlarge opens a comp across 90% of the window, → steps to the next, a key rates it there, Esc closes', {
    assert: async () => {
      const { b, page, input, close } = await compsBoard('desktop')
      const [A, B, C] = b.round.comps.map((c) => c.id)
      try {
        await press(page, input, '#grid .comp:nth-child(1) .enlarge', { touch: false })
        const openA = await shows(page, A)
        await pressNamed(page, 'ArrowRight')
        const onB = await shows(page, B)
        await pressKey(page, '4')
        const saved = await waitFor(() => newest(ratingsJson(b.root)).compRatings?.[B]?.rating === 4)
        // Rated, it moves on to the next comp still unrated, as the board does.
        const onC = await shows(page, C)
        await pressNamed(page, 'Escape')
        const closed = await waitFor(async () => (await viewer(page)) === null)
        // The board is in reach again, and shows what was given in the viewer.
        const board = closed && !!(await pointOn(page, '.rate[data-rating="1"]'))
        const score = await page.eval(`document.querySelector('.comp[data-id="${B}"] .score')?.textContent`)
        const ok = openA && onB && saved && onC && closed && board && score === '4 / 5'
        if (!ok) console.log(`        ${JSON.stringify({ openA, onB, saved, onC, closed, board, score, viewer: await viewer(page) })}`)
        return ok
      } finally {
        await close()
      }
    },
    // The control: an Enlarge button that takes the click and does nothing with it.
    breaks: pageBreak(
      `document.addEventListener('click', (e) => { if (e.target.closest('.enlarge')) e.stopImmediatePropagation() }, true)`,
    ),
    timeout: 60_000,
  })

  await s.check(
    'full screen on a phone: a tap on a reference opens it, Phone shows its phone shot, a tap rates, a swipe goes back, Close returns',
    {
      assert: async () => {
        const b = await board()
        const page = await openBoard(browser, b.url, VIEWPORTS.phone)
        const input = countInput(page)
        const [r0, r1, r2] = b.round.refs.map((c) => c.id)
        try {
          await press(page, input, '#stage figure .shot', { touch: true })
          const open0 = await shows(page, r0, { view: 'desktop' })
          // A tall phone shot on a phone is height-bound under the controls: shown, not measured.
          await press(page, input, '.vview[data-view="phone"]', { touch: true })
          const phone0 = await shows(page, r0, { view: 'phone', big: false })
          await press(page, input, '#vnext', { touch: true })
          const on1 = await shows(page, r1, { view: 'phone', big: false })
          await press(page, input, '.vrate[data-rating="5"]', { touch: true })
          const saved = await waitFor(() => newest(ratingsJson(b.root)).ratings?.[r1]?.rating === 5)
          const on2 = await shows(page, r2, { view: 'phone', big: false })
          await input.swipe({ x: 100, y: 380, dx: 200, dy: 0 })
          const back1 = await shows(page, r1, { view: 'phone', big: false })
          await press(page, input, '#vclose', { touch: true })
          const closed = await waitFor(async () => (await viewer(page)) === null)
          // Closed on the second reference: the board is there, with its 5 shown.
          const where = await progress(page)
          const given = await page.eval('document.querySelector(".rate[aria-pressed=true]")?.dataset.rating')
          const ok = open0 && phone0 && on1 && saved && on2 && back1 && closed && where === '2 of 6' && given === '5'
          if (!ok)
            console.log(
              `        ${JSON.stringify({ open0, phone0, on1, saved, on2, back1, closed, where, given, viewer: await viewer(page) })}`,
            )
          return ok
        } finally {
          await page.close()
          await b.stop()
        }
      },
      // The control: a shot that takes the tap and does nothing with it.
      breaks: pageBreak(
        `document.addEventListener('click', (e) => { if (e.target.closest('#stage .shot')) e.stopImmediatePropagation() }, true)`,
      ),
      timeout: 60_000,
    },
  )

  /** Centre and mid-edges of `selector` land on it, inside the window (a rounded corner is not the button). */
  const inReach = (page, selector) =>
    page.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return false
      const r = el.getBoundingClientRect(), my = r.top + r.height / 2, mx = r.left + r.width / 2
      return [[r.left + 3, my], [r.right - 3, my], [mx, r.top + 3], [mx, r.bottom - 3], [mx, my]].every(([x, y]) => {
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false
        const hit = document.elementFromPoint(x, y)
        return !!hit && (hit === el || el.contains(hit))
      })
    })()`)
  const VIEWER_TARGETS = ['#vclose', '#vprev', '#vnext', '#vstar', ...[1, 2, 3, 4, 5].map((n) => `.vrate[data-rating="${n}"]`)]

  await s.check('full screen on a phone: a tap on the comp opens it, and every control in the viewer is 44 px and in reach', {
    assert: async () => {
      const { b, page, input, close } = await compsBoard()
      try {
        await press(page, input, '#grid .comp .pick', { touch: true })
        const opened = await shows(page, b.round.comps[0].id)
        const bad = []
        for (const t of VIEWER_TARGETS) if (!(await meetsTouchTarget(page, t)) || !(await inReach(page, t))) bad.push(t)
        if (!opened || bad.length) console.log(`        opened ${opened}; out of reach or under 44 px: ${bad.join(', ')}`)
        return opened && !bad.length
      } finally {
        await close()
      }
    },
    // The control: the controls kept on one row, as on a desktop: Next runs off a phone's edge.
    breaks: pageBreak(`document.head.insertAdjacentHTML('beforeend', '<style>.vctl{flex-wrap:nowrap!important}</style>')`),
    timeout: 60_000,
  })

  const TARGETS = [
    '.rate',
    '#note',
    '#done',
    '#back',
    '.comp .star',
    '.comp .pick',
    '.comp .enlarge',
    ...[0, 1, 2, 3].map((k) => `.chip[data-k="${k}"]`),
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

  // The control: a fixed 640 px column, the layout that runs off a phone's right edge.
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
    breaks: pageBreak(`document.head.insertAdjacentHTML('beforeend', '<style>.grid{grid-template-columns:640px!important}</style>')`),
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
        await press(page, input, '.comp .star', { touch: VIEWPORTS[vp].touch })
        await snap(page, `taste-comps-${vp}-${theme}`)
        // The viewer is dark in either theme: one shot of it per screen.
        if (!dark) {
          await press(page, input, '#grid .comp .enlarge', { touch: VIEWPORTS[vp].touch })
          await snap(page, `taste-viewer-${vp}`)
        }
        await close()
      }
  }
})

for (const b of boards) await b.stop()
await browser.close()
site.server.closeAllConnections?.()
site.server.close()
squatter.close()
for (const r of roots) rmSync(r, { recursive: true, force: true })
rmSync(work, { recursive: true, force: true })
