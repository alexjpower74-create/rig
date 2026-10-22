// harness/snapshot.js against a real headless Chrome and examples/snapshot-fixture.html.
//
// The fixture paints "Loading…" first and becomes ready later (?readyAfter=<ms>), centres its column
// with margin: 0 auto, and shows a shortcut, a number and a time zone taken from whatever the
// browser reports. Each check is made red once by swapping the old behaviour back in: a capture at
// first paint, margins read as used pixels, no pin, a diff that sees nothing.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { suite } from '../harness/check.js'
import { capture, diffSnapshots, launch, matchBaseline, modifierKey, pin, readBaseline, snapshot, writeBaseline } from '../harness/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = pathToFileURL(join(here, '..', 'examples', 'snapshot-fixture.html')).href
const scratch = mkdtempSync(join(tmpdir(), 'rig-snapshot-'))

const browser = await launch({ headless: true, width: 1440, height: 900 })
const pages = []
/** A fresh page (overrides are per page), pinned unless `pinWith` is false, loaded at `query`. */
async function open(query = '', { pinWith = {}, width = 1440, height = 900 } = {}) {
  const page = await browser.newPage('about:blank', { width, height })
  pages.push(page)
  if (pinWith) await pin(page, pinWith)
  await page.goto(`${FIXTURE}${query}`)
  return page
}
// An element by the last step of its path, ignoring an :nth-of-type suffix.
const node = (snap, name) =>
  snap.nodes.find(
    (n) =>
      n.path
        .split(' > ')
        .pop()
        .replace(/:nth-of-type\(\d+\)$/, '') === name,
  )
const allText = (snap) => snap.nodes.map((n) => n.text || '').join(' | ')

try {
  await suite('snapshot helpers hold on any machine', async (s) => {
    let take = (page, opts) => snapshot(page, opts)

    await s.check('a page that is not ready yet is retaken until it is, and the snapshot is of the ready page', {
      assert: async () => {
        const page = await open('?readyAfter=900')
        const retakes = []
        const r = await take(page, { ready: { global: 'appReady' }, readyTimeout: 300, tries: 6, onRetake: (n) => retakes.push(n) })
        if (r.tries < 2 || retakes.length !== r.tries - 1) throw new Error(`tries ${r.tries}, retakes ${retakes}`)
        if (/Loading/.test(allText(r.snapshot)) || !/Ready: 3 orders/.test(allText(r.snapshot))) throw new Error(allText(r.snapshot))
        return !!node(r.snapshot, 'ul#items')
      },
      // The old way: snapshot at first paint, whatever the app has done by then.
      breaks: () => {
        take = async (page) => ({ snapshot: await capture(page), tries: 1 })
        return () => {
          take = (page, opts) => snapshot(page, opts)
        }
      },
      timeout: 20_000,
    })

    let tries = 3
    await s.check('a page that never gets ready is refused after the bounded tries, in bounded time, naming the signal', {
      assert: async () => {
        const page = await open('?never=1')
        const t0 = Date.now()
        try {
          await snapshot(page, { ready: '#items', readyTimeout: 200, tries })
        } catch (e) {
          const ms = Date.now() - t0
          return /not ready \(selector #items\) after 3 tries/.test(e.message) && ms < 3 * 200 + 1500
        }
        return false
      },
      // Unbounded in practice: a try count the check's own clock runs out on.
      breaks: () => {
        tries = 1000
        return () => {
          tries = 3
        }
      },
      timeout: 4_000,
    })

    let sig = (r) => r
    await s.check('ready can be a selector, a global or a function; first paint is never "ready"', {
      assert: async () => {
        const a = await snapshot(await open('?readyAfter=300'), { ready: sig('body[data-ready]') })
        const b = await snapshot(await open('?readyAfter=300'), { ready: sig(() => document.querySelectorAll('#items li').length === 3) })
        const c = await snapshot(await open('?readyAfter=300'), { ready: sig({ global: 'appReady' }) })
        let refused = false
        try {
          await snapshot(await open(''), {})
        } catch (e) {
          refused = /First paint is not ready/.test(e.message)
        }
        return refused && [a, b, c].every((r) => /Ready: 3 orders/.test(allText(r.snapshot)))
      },
      // Every signal swapped for one that holds at first paint.
      breaks: () => {
        sig = () => 'body'
        return () => {
          sig = (r) => r
        }
      },
      timeout: 15_000,
    })

    let margins = 'written'
    await s.check('margin: 0 auto is recorded as "auto", so a phone and a desktop window record the same column', {
      assert: async () => {
        const wide = await open('', { width: 1440 })
        const narrow = await open('', { width: 390, height: 844 })
        const a = await snapshot(wide, { ready: '#items', margins })
        const b = await snapshot(narrow, { ready: '#items', margins })
        const col = node(a.snapshot, 'main.column').style
        const card = node(a.snapshot, 'p.card').style
        return (
          col['margin-left'] === 'auto' &&
          col['margin-right'] === 'auto' &&
          card['margin-left'] === '5%' &&
          card['margin-top'] === '16px' &&
          diffSnapshots(a.snapshot, b.snapshot).length === 0
        )
      },
      // Read margins as the used pixels, as getComputedStyle answers for a rendered element.
      breaks: () => {
        margins = 'used'
        return () => {
          margins = 'written'
        }
      },
      timeout: 15_000,
    })

    let pinned = true
    await s.check('pin: Meta shows the Mac shortcut, Control the other one, and locale and zone are fixed', {
      assert: async () => {
        const mac = await open('', { pinWith: pinned && { modifier: 'Meta', locale: 'de-DE', timezone: 'Asia/Tokyo' } })
        const pc = await open('', { pinWith: pinned && {} })
        const m = allText((await snapshot(mac, { ready: '#items' })).snapshot)
        const p = allText((await snapshot(pc, { ready: '#items' })).snapshot)
        const ua = await pc.eval('navigator.userAgent')
        return (
          m.includes('⌘K') &&
          m.includes('1.234,5') &&
          /GMT\+9|JST/.test(m) &&
          p.includes('Ctrl K') &&
          p.includes('1,234.5') &&
          p.includes('UTC') &&
          /RigSnapshot/.test(ua)
        )
      },
      // No pin: the machine's own platform, locale and zone.
      breaks: () => {
        pinned = false
        return () => {
          pinned = true
        }
      },
      timeout: 15_000,
    })

    let mod = modifierKey
    await s.check('modifierKey follows the pin: Meta is bit 4, Control bit 2', {
      assert: () => mod({ modifier: 'Meta' }).bit === 4 && mod().key === 'Control' && mod().bit === 2,
      // The machine's own key, whatever the pin says.
      breaks: () => {
        mod = () => ({ key: 'Control', code: 'ControlLeft', bit: 2 })
        return () => {
          mod = modifierKey
        }
      },
    })

    let diff = diffSnapshots
    await s.check('a baseline carries RECORDED_FROM, reads back, and a changed page is named in the diff', {
      assert: async () => {
        const page = await open('')
        const { snapshot: snap } = await snapshot(page, { ready: '#items' })
        const file = join(scratch, 'orders.snap')
        writeBaseline(file, snap, { sha: 'abc1234def' })
        if (!readFileSync(file, 'utf8').startsWith('RECORDED_FROM: abc1234def\n')) throw new Error('no RECORDED_FROM line first')
        const back = readBaseline(file)
        if (back.recordedFrom !== 'abc1234def' || diff(back.snapshot, snap).length) throw new Error('did not read back the same')
        const changed = structuredClone(snap)
        node(changed, 'p#status').text = 'Ready: 4 orders'
        const d = diff(snap, changed)
        const m = matchBaseline(file, changed)
        return (
          d.length === 1 && /#status text: "Ready: 3 orders" → "Ready: 4 orders"/.test(d[0]) && !m.ok && m.recordedFrom === 'abc1234def'
        )
      },
      breaks: () => {
        diff = () => []
        return () => {
          diff = diffSnapshots
        }
      },
      timeout: 15_000,
    })

    let read = readBaseline
    await s.check('a baseline without RECORDED_FROM is refused, and a non-sha is never written', {
      assert: () => {
        const file = join(scratch, 'bare.snap')
        writeFileSync(file, '{"nodes":[]}\n')
        let refusedRead = false
        let refusedWrite = false
        try {
          read(file)
        } catch (e) {
          refusedRead = /no RECORDED_FROM line/.test(e.message)
        }
        try {
          writeBaseline(file, { nodes: [] }, { sha: 'HEAD' })
        } catch (e) {
          refusedWrite = /must be a commit sha/.test(e.message)
        }
        return refusedRead && refusedWrite
      },
      // A reader that takes any JSON as a baseline, sha or not.
      breaks: () => {
        read = (f) => ({ recordedFrom: null, snapshot: JSON.parse(readFileSync(f, 'utf8')) })
        return () => {
          read = readBaseline
        }
      },
    })
  })
} finally {
  for (const p of pages) await p.close()
  await browser.close()
  rmSync(scratch, { recursive: true, force: true })
}
