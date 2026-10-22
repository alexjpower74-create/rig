// Snapshots that hold on any machine.
//
// A second OS caught 34 failures the first machine never showed, and most were the snapshot, not
// the app: a user agent that said Mac on one machine and Linux on the other, so the shortcut hint
// read "⌘K" here and "Ctrl K" there; a centred column whose `margin: 0 auto` was recorded as 120px
// at one window width and 0px at another; a locale that formatted 1,234.5 as 1.234,5; and a
// snapshot taken at first paint, before the app had loaded its data, that recorded "Loading…".
//
// So: pin() fixes the user agent, platform, locale, time zone and modifier key before the page
// loads. capture() records the page as structure, text and the styles that do not depend on fonts
// or window size, with auto (and percentage) margins recorded as written. snapshot() waits for the
// app to say it is ready (a selector, a global or a function) instead of first paint, and retakes
// when it is not, a bounded number of times. Baselines carry RECORDED_FROM: <sha>, so `rig qa` can
// say when the base has moved past the commit a baseline was recorded from.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** What every snapshot is taken as, unless a test says otherwise: one machine, whichever it runs on. */
export const DEFAULT_PIN = Object.freeze({
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 RigSnapshot/1',
  locale: 'en-US',
  timezone: 'UTC',
  // Control or Meta: what the app is told the shortcut key is, and what modifierKey() presses.
  modifier: 'Control',
})

const PLATFORM = {
  Control: { platform: 'Linux x86_64', uaPlatform: 'Linux' },
  Meta: { platform: 'MacIntel', uaPlatform: 'macOS' },
}

/**
 * Pin the page's user agent, platform, locale, time zone and modifier key. Call it before goto():
 * an app reads navigator.platform once, when it boots. Returns the pin it applied.
 *
 * `modifier: 'Meta'` reports a Mac (navigator.platform 'MacIntel'), so an app that shows "⌘K" on a
 * Mac shows it on every machine; 'Control' reports Linux. The page also gets window.__RIG_PIN__.
 */
export async function pin(page, opts = {}) {
  const p = { ...DEFAULT_PIN, ...opts }
  const plat = PLATFORM[p.modifier]
  if (!plat) throw new Error(`pin: modifier must be 'Control' or 'Meta', got ${JSON.stringify(p.modifier)}`)
  await page.send('Emulation.setUserAgentOverride', {
    userAgent: p.userAgent,
    acceptLanguage: p.locale,
    platform: plat.platform,
    userAgentMetadata: {
      brands: [{ brand: 'RigSnapshot', version: '1' }],
      fullVersion: '1.0.0',
      platform: plat.uaPlatform,
      platformVersion: '',
      architecture: '',
      model: '',
      mobile: false,
    },
  })
  await page.send('Emulation.setLocaleOverride', { locale: p.locale })
  await page.send('Emulation.setTimezoneOverride', { timezoneId: p.timezone })
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(window, '__RIG_PIN__', { value: Object.freeze(${JSON.stringify({ ...p, platform: plat.platform })}) })`,
  })
  return { ...p, platform: plat.platform }
}

/**
 * The modifier a pinned page expects, as Input.dispatchKeyEvent wants it: { key, code, bit }.
 * A test that presses "the shortcut" presses the same key on every machine.
 */
export function modifierKey(pinned = DEFAULT_PIN) {
  return pinned.modifier === 'Meta' ? { key: 'Meta', code: 'MetaLeft', bit: 4 } : { key: 'Control', code: 'ControlLeft', bit: 2 }
}

/**
 * The page-side expression for a ready signal:
 *   a string                → a CSS selector that must match
 *   { selector }            → the same
 *   { global: 'app.ready' } → a dotted path on window that must be truthy
 *   a function / { fn }     → run in the page; truthy (or a promise of truthy) means ready
 */
export function readyExpression(ready) {
  if (!ready) throw new Error('snapshot: say what "ready" means: a selector, { global }, or a function. First paint is not ready.')
  if (typeof ready === 'string') return `!!document.querySelector(${JSON.stringify(ready)})`
  if (typeof ready === 'function') return `Promise.resolve((${ready.toString()})()).then((v) => !!v)`
  if (ready.selector) return readyExpression(ready.selector)
  if (ready.global) return `!!${JSON.stringify(ready.global)}.split('.').reduce((o, k) => (o == null ? o : o[k]), window)`
  if (ready.fn) return readyExpression(ready.fn)
  throw new Error(`snapshot: unknown ready signal ${JSON.stringify(ready)}`)
}

/** Poll the ready signal until it holds or `timeout` ms pass. Resolves true or false; never throws for "not yet". */
export async function waitForReady(page, ready, { timeout = 5000, interval = 50 } = {}) {
  const expr = readyExpression(ready)
  const until = Date.now() + timeout
  for (;;) {
    let ok = false
    try {
      ok = await page.eval(expr)
    } catch {
      ok = false // a page mid-navigation has no context to ask
    }
    if (ok) return true
    if (Date.now() >= until) return false
    await new Promise((r) => setTimeout(r, interval))
  }
}

/** Styles recorded per element. None depends on fonts or window size once margins are read as written. */
export const SNAPSHOT_STYLES = [
  'display',
  'position',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-align',
  'text-transform',
  'flex-direction',
  'justify-content',
  'align-items',
  'gap',
]

/**
 * The page under `selector` as data: one entry per element, in document order, with its path, its
 * own text and the styles in `styles` that are not at their usual default. Margins are recorded as
 * written: `margin: 0 auto` is "auto", not the pixels this window happened to give it (`margins:
 * 'used'` records the pixels instead, for a test about one layout). `boxes: true` adds each
 * element's rounded box, which does depend on the machine's fonts.
 */
export async function capture(page, { selector = 'body', styles = SNAPSHOT_STYLES, boxes = false, margins = 'written' } = {}) {
  if (margins !== 'written' && margins !== 'used')
    throw new Error(`capture: margins is 'written' or 'used', got ${JSON.stringify(margins)}`)
  const fn = (sel, props, withBoxes, asWritten) => {
    const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META'])
    const DEFAULTS = {
      position: 'static',
      'font-style': 'normal',
      'text-transform': 'none',
      'background-color': 'rgba(0, 0, 0, 0)',
      gap: 'normal',
      'justify-content': 'normal',
      'align-items': 'normal',
      'flex-direction': 'row',
      'text-align': 'start',
    }
    const MARGINS = ['margin-top', 'margin-right', 'margin-bottom', 'margin-left']
    const root = document.querySelector(sel)
    if (!root) return { error: `no element matches ${sel}` }
    // The margin as written. A rendered element answers getComputedStyle with the used value (auto
    // becomes pixels); one that is not rendered answers with the computed value, which keeps auto
    // and percentages. So the element is hidden for the read, and put back exactly as it was.
    const written = (el) => {
      const was = el.style.getPropertyValue('display')
      const prio = el.style.getPropertyPriority('display')
      el.style.setProperty('display', 'none', 'important')
      const cs = getComputedStyle(el)
      const out = Object.fromEntries(MARGINS.map((m) => [m, cs.getPropertyValue(m)]))
      if (was) el.style.setProperty('display', was, prio)
      else el.style.removeProperty('display')
      return out
    }
    const name = (el) => {
      let n = el.tagName.toLowerCase()
      if (el.id) return `${n}#${el.id}`
      const cls = [...el.classList].slice(0, 2)
      if (cls.length) n += `.${cls.join('.')}`
      const same = el.parentElement ? [...el.parentElement.children].filter((c) => c.tagName === el.tagName) : []
      if (same.length > 1) n += `:nth-of-type(${same.indexOf(el) + 1})`
      return n
    }
    const nodes = []
    const walk = (el, path) => {
      if (SKIP.has(el.tagName)) return
      const here = path ? `${path} > ${name(el)}` : name(el)
      // Every element, whatever its used margin: a centred column on a phone has a used margin of
      // 0px and is still `auto`, and skipping zeros first made phone and desktop disagree.
      const w = asWritten && MARGINS.some((m) => props.includes(m)) ? written(el) : {}
      const cs = getComputedStyle(el)
      const style = {}
      for (const p of props) {
        const v = w[p] ?? cs.getPropertyValue(p)
        if (v === '' || DEFAULTS[p] === v || ((p.startsWith('margin') || p.startsWith('padding')) && v === '0px')) continue
        style[p] = v
      }
      const text = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      const node = { path: here }
      if (text) node.text = text
      if (Object.keys(style).length) node.style = style
      if (withBoxes) {
        const r = el.getBoundingClientRect()
        node.box = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]
      }
      nodes.push(node)
      for (const c of el.children) walk(c, here)
    }
    walk(root, '')
    return { nodes }
  }
  const r = await page.eval(
    `(${fn.toString()})(${JSON.stringify(selector)}, ${JSON.stringify(styles)}, ${!!boxes}, ${margins === 'written'})`,
  )
  if (r.error) throw new Error(`capture: ${r.error}`)
  return r
}

/**
 * Wait for app-ready, capture, and make sure the app was still ready after the capture; when it was
 * not ready (or stopped being ready mid-capture), take it again, up to `tries` times. With
 * `reload: true` each retake reloads the page first. Resolves { snapshot, tries }; throws, naming
 * the ready signal and the number of tries, when the page never became ready. Never resolves with a
 * snapshot of a page that was not ready.
 */
export async function snapshot(page, { ready, tries = 3, readyTimeout = 5000, reload = false, onRetake, ...opts } = {}) {
  if (!(Number.isInteger(tries) && tries >= 1)) throw new Error(`snapshot: tries must be a whole number of at least 1, got ${tries}`)
  readyExpression(ready) // refuse a missing signal before waiting on anything
  for (let attempt = 1; attempt <= tries; attempt++) {
    if (attempt > 1) {
      onRetake?.(attempt)
      if (reload) await reloadPage(page)
    }
    if (!(await waitForReady(page, ready, { timeout: readyTimeout }))) continue
    const snap = await capture(page, opts)
    if (await waitForReady(page, ready, { timeout: 0 })) return { snapshot: snap, tries: attempt }
  }
  throw new Error(`snapshot: the page was not ready (${describeReady(ready)}) after ${tries} tr${tries === 1 ? 'y' : 'ies'}`)
}

async function reloadPage(page) {
  const loaded = new Promise((res) => page.on('Page.loadEventFired', res))
  await page.send('Page.reload', { ignoreCache: true })
  let timer
  await Promise.race([loaded, new Promise((r) => (timer = setTimeout(r, 30_000)))]).finally(() => clearTimeout(timer))
}

const describeReady = (r) =>
  typeof r === 'string'
    ? `selector ${r}`
    : typeof r === 'function'
      ? 'ready function'
      : r.global
        ? `window.${r.global}`
        : r.selector
          ? `selector ${r.selector}`
          : 'ready function'

// ── Baselines ─────────────────────────────────────────────────────────────────────────────────────

/** The commit a baseline is recorded from: RIG_RECORDED_FROM, else HEAD of the repo at `cwd`. */
export function currentSha(cwd = process.cwd()) {
  if (process.env.RIG_RECORDED_FROM) return process.env.RIG_RECORDED_FROM
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

/** Write a baseline: `RECORDED_FROM: <sha>` on the first line, the snapshot as JSON after it. */
export function writeBaseline(file, snap, { sha = currentSha(dirname(file)) } = {}) {
  if (!/^[0-9a-f]{7,64}$/.test(sha || '')) throw new Error(`writeBaseline: RECORDED_FROM must be a commit sha, got ${JSON.stringify(sha)}`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `RECORDED_FROM: ${sha}\n${JSON.stringify(snap, null, 2)}\n`)
  return { file, recordedFrom: sha }
}

/** Read a baseline back: { recordedFrom, snapshot }, or null when there is none. */
export function readBaseline(file) {
  if (!existsSync(file)) return null
  const text = readFileSync(file, 'utf8')
  const m = text.match(/^RECORDED_FROM:\s*([0-9a-f]{7,64})\s*\n/)
  if (!m) throw new Error(`${file} has no RECORDED_FROM line: re-record it so it knows which commit it came from`)
  return { recordedFrom: m[1], snapshot: JSON.parse(text.slice(m[0].length)) }
}

/**
 * Compare a snapshot with its baseline. No baseline yet (or `update`, or RIG_UPDATE_SNAPSHOTS=1)
 * records one. Returns { ok, created, recordedFrom, diff }: diff names each element that changed,
 * was added or went missing, first `max` of them.
 */
export function matchBaseline(file, snap, { sha, update = process.env.RIG_UPDATE_SNAPSHOTS === '1', max = 20 } = {}) {
  const was = update ? null : readBaseline(file)
  if (!was) {
    const w = writeBaseline(file, snap, sha ? { sha } : undefined)
    return { ok: true, created: true, recordedFrom: w.recordedFrom, diff: [] }
  }
  const diff = diffSnapshots(was.snapshot, snap).slice(0, max)
  return { ok: diff.length === 0, created: false, recordedFrom: was.recordedFrom, diff }
}

/** Element-by-element differences between two captures, by path. */
export function diffSnapshots(a, b) {
  const index = (s) => new Map((s?.nodes || []).map((n) => [n.path, n]))
  const A = index(a)
  const B = index(b)
  const out = []
  for (const [path, n] of A) {
    const m = B.get(path)
    if (!m) out.push(`missing: ${path}`)
    else if (JSON.stringify(n) !== JSON.stringify(m)) {
      for (const k of new Set([...Object.keys(n.style || {}), ...Object.keys(m.style || {})]))
        if (n.style?.[k] !== m.style?.[k]) out.push(`${path} ${k}: ${n.style?.[k] ?? '(none)'} → ${m.style?.[k] ?? '(none)'}`)
      if (n.text !== m.text) out.push(`${path} text: ${JSON.stringify(n.text ?? '')} → ${JSON.stringify(m.text ?? '')}`)
      if (JSON.stringify(n.box) !== JSON.stringify(m.box)) out.push(`${path} box: ${n.box} → ${m.box}`)
    }
  }
  for (const path of B.keys()) if (!A.has(path)) out.push(`added: ${path}`)
  return out
}
