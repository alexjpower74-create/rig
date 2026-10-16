// The taste board's server: node:http and nothing else. It serves one self-contained page, the
// images the round names (and no other file), and a few small JSON endpoints. Every answer is
// written to ratings.json before the reply goes back, so the page shows a tap as saved only once it
// is on disk.
//
// Only the page it served can talk to it. Every request carries the round's random token (in the
// URL, or the x-taste-token header), the Host must be one this board listens as (no DNS
// rebinding), a POST with an Origin must come from the board's own origin, and a POST must be
// application/json, which a page on another site cannot send without a preflight this server never
// answers. Without these, any web page open in the same browser could rate, or end the round.

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { extname } from 'node:path'
import { pageHtml } from './page.js'
import { IMAGE_TYPES } from './sources.js'
import { boardPath, publicState, saveState, stamp, writeTasteMd } from './store.js'

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}
const fail = (message, code) => Object.assign(new Error(message), { code })

async function readJson(req, limit = 64 * 1024) {
  if (!guards.json(req)) throw fail('answers are JSON (content-type: application/json)', 415)
  let size = 0
  const chunks = []
  for await (const c of req) {
    size += c.length
    if (size > limit) throw fail('request too large', 413)
    chunks.push(c)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    throw fail('not JSON', 400)
  }
}

const NOTE_MAX = 2000
const validRating = (r) => r === null || (Number.isInteger(r) && r >= 1 && r <= 5)

/**
 * The answers the page can send, applied to the open round. Exported as an object so a test can
 * swap one for a broken version and watch its assertion go red.
 */
export const handlers = {
  /** { kind: 'ref'|'comp', id, rating?: 1..5|null, note?: string } */
  answer(round, body) {
    const list = body.kind === 'comp' ? round.comps : round.refs
    const map = body.kind === 'comp' ? round.compRatings : round.ratings
    if (!list.some((c) => c.id === body.id)) throw fail(`no ${body.kind || 'ref'} "${body.id}" in this round`, 404)
    const next = { ...(map[body.id] || {}), at: new Date().toISOString() }
    if ('rating' in body) {
      if (!validRating(body.rating)) throw fail('rating must be 1 to 5', 400)
      next.rating = body.rating
    }
    if ('note' in body) next.note = String(body.note ?? '').slice(0, NOTE_MAX)
    if (!next.rating && !next.note) delete map[body.id]
    else map[body.id] = next
  },
  /** { id: compId | null } — the starred favourite. */
  pick(round, body) {
    if (body.id !== null && !round.comps.some((c) => c.id === body.id)) throw fail(`no comp "${body.id}"`, 404)
    round.pick = body.id
  },
}

/** This machine's IPv4 addresses on the local network, for the phone link `--lan` prints. */
export function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address)
}

const sameToken = (a, b) => {
  if (typeof a !== 'string' || a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/**
 * The four checks every request passes. An object, like `handlers`, so a test can put the
 * unguarded server back and watch its assertion go red.
 */
export const guards = {
  /** The Host is an address this board listens as: a DNS-rebinding name never matches. */
  host: (req, hosts) => hosts.has(String(req.headers.host || '').toLowerCase()),
  /** A POST that names an Origin comes from the board's own. */
  origin: (req) => req.method !== 'POST' || !req.headers.origin || req.headers.origin === `http://${req.headers.host}`,
  /** The round's token, from the URL or the x-taste-token header. */
  token: (req, url, token) => sameToken(url.searchParams.get('t') ?? req.headers['x-taste-token'], token),
  /** A JSON body: a page on another site cannot send one without a preflight, and none is answered. */
  json: (req) => /^application\/json\b/i.test(req.headers['content-type'] || ''),
}

/**
 * Start the board on `port`. 127.0.0.1 only, unless `lan` (then every interface, for a phone on the
 * same network). Resolves once listening with { url, lanUrls, token, server, finished, stop };
 * `finished` resolves to the TASTE.md path when Done is pressed and the server has closed.
 */
export function startServer({
  root,
  state,
  round,
  port,
  lan = false,
  token = randomBytes(18).toString('base64url'),
  now = () => new Date(),
}) {
  let finish
  const finished = new Promise((r) => {
    finish = r
  })
  const images = new Map()
  for (const c of [...round.refs, ...round.comps])
    for (const [view, path] of Object.entries(c.shots)) images.set(`/img/${c.id}/${view}`, path)

  let hosts = new Set()
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://board')
    try {
      // The Host must be an address this board answers on: a rebinding name never matches.
      if (!guards.host(req, hosts)) throw fail('unknown host', 421)
      if (!guards.origin(req)) throw fail('cross-origin request refused', 403)
      if (!guards.token(req, url, token)) {
        if (req.method === 'GET' && url.pathname === '/') {
          res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
          return res.end('This taste board opens from the link `rig taste` printed: it carries the round’s token.\n')
        }
        throw fail('this board needs the token from the link rig taste printed', 403)
      }
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
        return res.end(pageHtml(publicState(round, token)))
      }
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, publicState(round, token))
      if (req.method === 'GET' && images.has(url.pathname)) {
        const path = images.get(url.pathname)
        if (!existsSync(path)) return json(res, 404, { error: 'image gone' })
        // Revalidate every time: a comp reworked under the same name must never show stale.
        const etag = `"${stamp(path)}"`
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304, { etag, 'cache-control': 'no-cache' })
          return res.end()
        }
        res.writeHead(200, {
          'content-type': IMAGE_TYPES[extname(path).toLowerCase()] || 'application/octet-stream',
          'cache-control': 'no-cache',
          etag,
        })
        return createReadStream(path).pipe(res)
      }
      if (req.method === 'POST' && url.pathname === '/api/answer') {
        handlers.answer(round, await readJson(req))
        saveState(root, state)
        return json(res, 200, { ok: true })
      }
      if (req.method === 'POST' && url.pathname === '/api/pick') {
        handlers.pick(round, await readJson(req))
        saveState(root, state)
        return json(res, 200, { ok: true })
      }
      if (req.method === 'POST' && url.pathname === '/api/done') {
        await readJson(req)
        round.finished = now().toISOString()
        saveState(root, state)
        const path = writeTasteMd(root, state, { date: now() })
        json(res, 200, { ok: true, path: 'docs/TASTE.md' })
        // Let the reply reach the page before the socket goes.
        res.on('finish', () => stop().then(() => finish(path)))
        return
      }
      json(res, 404, { error: 'not found' })
    } catch (e) {
      json(res, e.code >= 400 && e.code < 600 ? e.code : 500, { error: e.message })
    }
  })

  let stopping = null
  const stop = () => {
    stopping ||= new Promise((r) => {
      rmSync(boardPath(root), { force: true })
      server.close(() => r())
      server.closeAllConnections?.()
    })
    return stopping
  }

  return new Promise((res, rej) => {
    server.once('error', (e) => {
      rej(e.code === 'EADDRINUSE' ? new Error(`Port ${port} is in use. Pass --port <n>, or set tastePort in .rig/config.json.`) : e)
    })
    server.listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
      const p = server.address().port
      const lans = lan ? lanAddresses() : []
      hosts = new Set([`127.0.0.1:${p}`, `localhost:${p}`, ...lans.map((a) => `${a}:${p}`)])
      const url = `http://127.0.0.1:${p}/?t=${token}`
      // Where `rig taste --done` finds a board still running in this repo, and its token.
      writeFileSync(boardPath(root), JSON.stringify({ port: p, token, pid: process.pid, round: round.n }) + '\n')
      res({ url, lanUrls: lans.map((a) => `http://${a}:${p}/?t=${token}`), token, port: p, server, finished, stop })
    })
  })
}
