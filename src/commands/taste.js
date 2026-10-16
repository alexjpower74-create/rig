// rig taste: a rating round he answers by tapping, not by describing what he wants.
//
// People know great when they see it and cannot say it in advance, so the round shows real
// references one at a time and asks for 1 to 5. Every tap is on disk before the page moves on, and
// Done writes docs/TASTE.md, which every slice brief then tells its agent to read before designing.

import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { loadConfig, repoRoot } from '../config.js'
import { captureAll } from '../taste/capture.js'
import { startServer } from '../taste/server.js'
import { imageCards, planUrls, readPlan, urlId, urlName } from '../taste/sources.js'
import { loadState, newRound, publicState, saveState, shotsDir, writeTasteMd } from '../taste/store.js'

export const DEFAULT_PORT = 5391

export function parseArgs(args) {
  const o = { from: [], urls: [], comps: null, ask: null, port: null, open: true, done: false }
  const val = (i, flag) => {
    const v = args[i + 1]
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`)
    return v
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--from') o.from.push(val(i++, a))
    else if (a === '--url') o.urls.push(val(i++, a))
    else if (a === '--comps') o.comps = val(i++, a)
    else if (a === '--ask') o.ask = val(i++, a)
    else if (a === '--port') {
      o.port = Number(val(i++, a))
      if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) throw new Error(`--port must be a port number, not "${args[i]}"`)
    } else if (a === '--no-open') o.open = false
    else if (a === '--done') o.done = true
    else throw new Error(`rig taste: unknown argument "${a}". See rig taste --help.`)
  }
  if (o.comps && !o.ask) throw new Error('--comps needs --ask "<the one question>": a comps round asks one thing.')
  if (o.ask && !o.comps) throw new Error('--ask goes with --comps <dir>: the question is about those comps.')
  for (const u of o.urls) if (!/^https?:\/\//i.test(u)) throw new Error(`--url takes an http(s) URL, not "${u}"`)
  return o
}

/** Open a URL in the default browser, detached. Never called from a test: every test passes --no-open. */
function openInBrowser(url, log) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  try {
    const p = spawn(cmd, [url], { detached: true, stdio: 'ignore' })
    p.on('error', () => log(`  could not run ${cmd}; open ${url} yourself`))
    p.unref()
  } catch {
    log(`  open ${url} yourself`)
  }
}

/** Ask a board already running on `port` for this repo to finish. Returns the path, or null. */
async function finishRunning(port, state) {
  try {
    const base = `http://127.0.0.1:${port}`
    const live = await (await fetch(`${base}/api/state`, { signal: AbortSignal.timeout(1500) })).json()
    const same = JSON.stringify(live.refs.map((r) => r.id)) === JSON.stringify(state.refs.map((r) => r.id))
    if (!same) return null
    const r = await fetch(`${base}/api/done`, { method: 'POST', signal: AbortSignal.timeout(5000) })
    return r.ok ? (await r.json()).path : null
  } catch {
    return null
  }
}

/**
 * Build the round and start the board. Returns { url, finished, server, state } without waiting;
 * `finished` resolves to the TASTE.md path once Done is pressed. The CLI awaits it; tests drive it.
 */
export async function runTaste(args, { root = repoRoot(), log = console.log, warn = console.error } = {}) {
  const o = parseArgs(args)
  const cfg = loadConfig(root)
  const port = o.port ?? cfg.tastePort ?? DEFAULT_PORT
  const prev = loadState(root)

  if (o.done) {
    if (!prev) throw new Error('No taste round in this repo yet: run `rig taste --from <dir>` (or --url) first.')
    const viaServer = await finishRunning(port, prev)
    const path = viaServer ? join(root, viaServer) : writeTasteMd(root, prev)
    return { done: true, path }
  }

  const refs = []
  for (const dir of o.from) refs.push(...imageCards(dir, 'f'))
  const fromPlan = planUrls(readPlan(join(root, cfg.plan)))
  const urls = [...new Set([...o.urls, ...fromPlan])]
  if (urls.length) {
    log(
      `Capturing ${urls.length} URL${urls.length === 1 ? '' : 's'} at 1440×900 and 390×844${fromPlan.length ? ` (${fromPlan.length} from ${cfg.plan})` : ''}`,
    )
    const cards = urls.map((u) => ({ id: urlId(u), name: urlName(u), url: u, source: 'url', shots: {} }))
    const { ok, failed } = await captureAll(cards, shotsDir(root), { log: warn })
    const order = new Map(cards.map((c, i) => [c.id, i]))
    refs.push(...ok.sort((a, b) => order.get(a.id) - order.get(b.id)))
    if (failed.length)
      warn(
        `\x1b[33mSkipped ${failed.length} URL${failed.length === 1 ? '' : 's'} that did not load: ${failed.map((f) => f.card.url).join(', ')}\x1b[0m`,
      )
  }

  let comps = []
  if (o.comps) {
    comps = imageCards(o.comps, 'c')
    if (comps.length < 2) throw new Error(`A comps round needs 2 to 4 images in ${o.comps}; found ${comps.length}.`)
    if (comps.length > 4) {
      warn(`\x1b[33mA comps round compares 3 or 4 side by side; using the first 4 of ${comps.length}.\x1b[0m`)
      comps = comps.slice(0, 4)
    }
  }

  let state
  if (!refs.length && !comps.length) {
    if (!prev || (!prev.refs.length && !prev.comps.length))
      throw new Error(
        'Nothing to rate. Pass --from <folder of images>, --url <url>, or list URLs under "## The best at this job" in the plan.',
      )
    log('Resuming the last round: every rating so far is kept.')
    state = prev
  } else {
    state = newRound(prev, { refs, comps, question: o.ask })
  }
  saveState(root, state)

  const board = await startServer({ root, state, port })
  const pub = publicState(state)
  const answered = Object.keys(state.ratings).length
  log(`\nTaste board: ${board.url}`)
  log(
    `  ${pub.refs.length} reference${pub.refs.length === 1 ? '' : 's'}${comps.length ? `, ${comps.length} comps` : ''}${answered ? `, ${answered} already rated` : ''}. Tap 1–5 or press the number keys.`,
  )
  log('  Every tap is saved to .rig/taste/ratings.json at once. Done writes docs/TASTE.md;')
  log('  if you close the tab instead, `rig taste --done` writes it later.')
  if (o.open) openInBrowser(board.url, warn)
  return { ...board, state }
}

export default async function taste(args) {
  const r = await runTaste(args)
  if (r.done) {
    console.log(`Wrote ${r.path}`)
    return
  }
  const path = await r.finished
  console.log(`\nWrote ${path}`)
  console.log('  Next: fill in "## Principles" before any design starts. Slice briefs point every agent at this file.')
  // The round is over. Anything the URL capture left behind (a keep-alive socket, Chrome's handle)
  // must not keep the command running after it has said it is done.
  process.exit(0)
}
