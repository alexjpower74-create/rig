// rig taste: a rating round he answers by tapping, not by describing what he wants.
//
// People know great when they see it and cannot say it in advance, so the round shows real
// references one at a time and asks for 1 to 5. Every tap is on disk before the page moves on, and
// Done writes docs/TASTE.md, which every slice brief then tells its agent to read before designing.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, repoRoot } from '../config.js'
import { captureAll } from '../taste/capture.js'
import { startServer } from '../taste/server.js'
import { imageCards, planUrls, readPlan, urlId, urlName } from '../taste/sources.js'
import { boardPath, currentRound, loadState, openRound, sameRound, saveState, shotsDir, writeTasteMd } from '../taste/store.js'

export const DEFAULT_PORT = 5391

/** How a new round is opened over the saved ones. An object so a test can swap in an older rule. */
export const policy = { openRound }

export function parseArgs(args) {
  const o = { from: [], urls: [], comps: null, ask: null, port: null, open: true, done: false, lan: false }
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
    else if (a === '--lan') o.lan = true
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

/**
 * Ask the board still running in this repo (its port and token are in .rig/taste/board.json) to
 * finish. Returns the TASTE.md path it wrote, or null when no board answered.
 */
async function finishRunning(root) {
  const p = boardPath(root)
  if (!existsSync(p)) return null
  try {
    const { port, token } = JSON.parse(readFileSync(p, 'utf8'))
    const r = await fetch(`http://127.0.0.1:${port}/api/done`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-taste-token': token },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    })
    return r.ok ? join(root, (await r.json()).path) : null
  } catch {
    return null
  }
}

/**
 * Build the round and start the board. Returns { url, finished, server, state, round } without
 * waiting; `finished` resolves to the TASTE.md path once Done is pressed. The CLI awaits it; tests
 * drive it.
 */
export async function runTaste(args, { root = repoRoot(), log = console.log, warn = console.error } = {}) {
  const o = parseArgs(args)
  const cfg = loadConfig(root)
  const port = o.port ?? cfg.tastePort ?? DEFAULT_PORT
  const prev = loadState(root)

  if (o.done) {
    if (!prev) throw new Error('No taste round in this repo yet: run `rig taste --from <dir>` (or --url) first.')
    const path = (await finishRunning(root)) || writeTasteMd(root, prev)
    return { done: true, path }
  }

  const files = []
  for (const dir of o.from) files.push(...imageCards(dir, 'f'))
  const fromPlan = planUrls(readPlan(join(root, cfg.plan)))
  const urls = [...new Set([...o.urls, ...fromPlan])]
  const urlCards = urls.map((u) => ({ id: urlId(u), name: urlName(u), url: u, source: 'url', shots: {} }))

  let comps = []
  if (o.comps) {
    comps = imageCards(o.comps, 'c')
    if (comps.length < 2) throw new Error(`A comps round needs 2 to 4 images in ${o.comps}; found ${comps.length}.`)
    if (comps.length > 4) {
      warn(`\x1b[33mA comps round compares 3 or 4 side by side; using the first 4 of ${comps.length}.\x1b[0m`)
      comps = comps.slice(0, 4)
    }
  }

  // Running the same round again resumes it, shots and all; a new round captures every URL fresh.
  const resuming = sameRound(currentRound(prev), { refs: [...files, ...urlCards], comps, question: o.ask })
  const refs = [...files]
  if (urlCards.length) {
    log(
      `${resuming ? 'Resuming with the shots already taken of' : 'Capturing'} ${urls.length} URL${urls.length === 1 ? '' : 's'} at 1440×900 and 390×844${fromPlan.length ? ` (${fromPlan.length} from ${cfg.plan})` : ''}`,
    )
    const { ok, failed } = await captureAll(urlCards, shotsDir(root), { log: warn, reuse: resuming })
    const order = new Map(urlCards.map((c, i) => [c.id, i]))
    refs.push(...ok.sort((a, b) => order.get(a.id) - order.get(b.id)))
    if (failed.length)
      warn(
        `\x1b[33mSkipped ${failed.length} URL${failed.length === 1 ? '' : 's'} that did not load: ${failed.map((f) => f.card.url).join(', ')}\x1b[0m`,
      )
  }

  let opened
  if (!refs.length && !comps.length) {
    const last = currentRound(prev)
    if (!last || (!last.refs.length && !last.comps.length))
      throw new Error(
        'Nothing to rate. Pass --from <folder of images>, --url <url>, or list URLs under "## The best at this job" in the plan.',
      )
    log(`Resuming round ${last.n}: every rating so far is kept.`)
    opened = { state: prev, round: last, resumed: true }
  } else {
    opened = policy.openRound(prev, { refs, comps, question: o.ask })
  }
  const { state, round } = opened
  saveState(root, state)

  const board = await startServer({ root, state, round, port, lan: o.lan })
  const answered = Object.keys(round.ratings).length + Object.keys(round.compRatings).length
  log(`\nTaste board, round ${round.n}${opened.resumed ? ' (resumed)' : ''}: ${board.url}`)
  for (const u of board.lanUrls) log(`  on a phone on this network: ${u}`)
  if (o.lan && !board.lanUrls.length) warn('  --lan: this machine has no network address a phone could reach.')
  log(
    `  ${round.refs.length} reference${round.refs.length === 1 ? '' : 's'}${round.comps.length ? `, ${round.comps.length} comps` : ''}${answered ? `, ${answered} already answered` : ''}. Tap 1–5 or press the number keys.`,
  )
  log('  Every tap is saved to .rig/taste/ratings.json at once, and every earlier round is kept.')
  log('  Done writes docs/TASTE.md; if you close the tab instead, `rig taste --done` writes it later.')
  if (o.open) openInBrowser(board.url, warn)
  return { ...board, state, round }
}

export default async function taste(args) {
  const r = await runTaste(args)
  const path = r.done ? r.path : await r.finished
  console.log(`${r.done ? '' : '\n'}Wrote ${path}`)
  console.log('  rig taste does not commit it: review it, fill in "## Principles", then commit docs/TASTE.md.')
  console.log('  Slice briefs point every agent at this file.')
}
