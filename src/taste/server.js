// The taste board's server: node:http on 127.0.0.1 and nothing else. It serves one self-contained
// page, the images the round names (and no other file), and four small JSON endpoints. Every answer
// is written to ratings.json before the reply goes back, so the page only shows a tap as saved once
// it is on disk.

import { createReadStream, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname } from 'node:path'
import { pageHtml } from './page.js'
import { IMAGE_TYPES } from './sources.js'
import { publicState, saveState, writeTasteMd } from './store.js'

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readJson(req, limit = 64 * 1024) {
  let size = 0
  const chunks = []
  for await (const c of req) {
    size += c.length
    if (size > limit) throw Object.assign(new Error('request too large'), { code: 413 })
    chunks.push(c)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    throw Object.assign(new Error('not JSON'), { code: 400 })
  }
}

const NOTE_MAX = 2000
const validRating = (r) => r === null || (Number.isInteger(r) && r >= 1 && r <= 5)

/**
 * The answers the page can send. Exported as an object so a test can swap one out for a broken
 * version and watch its assertion go red.
 */
export const handlers = {
  /** { kind: 'ref'|'comp', id, rating?: 1..5|null, note?: string } */
  answer(state, body) {
    const list = body.kind === 'comp' ? state.comps : state.refs
    const map = body.kind === 'comp' ? state.compRatings : state.ratings
    if (!list.some((c) => c.id === body.id))
      throw Object.assign(new Error(`no ${body.kind || 'ref'} "${body.id}" in this round`), { code: 404 })
    const prev = map[body.id] || {}
    const next = { ...prev, at: new Date().toISOString() }
    if ('rating' in body) {
      if (!validRating(body.rating)) throw Object.assign(new Error('rating must be 1 to 5'), { code: 400 })
      next.rating = body.rating
    }
    if ('note' in body) next.note = String(body.note ?? '').slice(0, NOTE_MAX)
    if (!next.rating && !next.note) delete map[body.id]
    else map[body.id] = next
  },
  /** { id: compId | null } — the starred favourite. */
  pick(state, body) {
    if (body.id !== null && !state.comps.some((c) => c.id === body.id))
      throw Object.assign(new Error(`no comp "${body.id}"`), { code: 404 })
    state.pick = body.id
  },
}

/**
 * Start the board. Resolves once listening with { url, server, finished }, where `finished` resolves
 * to the TASTE.md path when Done is pressed (and the server has closed).
 */
export function startServer({ root, state, port, host = '127.0.0.1', now = () => new Date() }) {
  let finish
  const finished = new Promise((r) => {
    finish = r
  })
  const images = new Map()
  for (const c of [...state.refs, ...state.comps])
    for (const [view, path] of Object.entries(c.shots)) images.set(`/img/${c.id}/${view}`, path)

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        return res.end(pageHtml(state))
      }
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, publicState(state))
      if (req.method === 'GET' && images.has(url.pathname)) {
        const path = images.get(url.pathname)
        if (!existsSync(path)) return json(res, 404, { error: 'image gone' })
        res.writeHead(200, {
          'content-type': IMAGE_TYPES[extname(path).toLowerCase()] || 'application/octet-stream',
          'cache-control': 'max-age=3600',
        })
        return createReadStream(path).pipe(res)
      }
      if (req.method === 'POST' && url.pathname === '/api/answer') {
        handlers.answer(state, await readJson(req))
        saveState(root, state)
        return json(res, 200, { ok: true, saved: publicState(state) })
      }
      if (req.method === 'POST' && url.pathname === '/api/pick') {
        handlers.pick(state, await readJson(req))
        saveState(root, state)
        return json(res, 200, { ok: true, saved: publicState(state) })
      }
      if (req.method === 'POST' && url.pathname === '/api/done') {
        saveState(root, state)
        const path = writeTasteMd(root, state, { date: now() })
        json(res, 200, { ok: true, path: 'docs/TASTE.md' })
        // Let the reply reach the page before the socket goes.
        res.on('finish', () => {
          server.close(() => finish(path))
          server.closeAllConnections?.()
        })
        return
      }
      json(res, 404, { error: 'not found' })
    } catch (e) {
      json(res, e.code >= 400 && e.code < 600 ? e.code : 500, { error: e.message })
    }
  })

  return new Promise((res, rej) => {
    server.once('error', (e) => {
      rej(e.code === 'EADDRINUSE' ? new Error(`Port ${port} is in use. Pass --port <n>, or set tastePort in .rig/config.json.`) : e)
    })
    server.listen(port, host, () => {
      res({ url: `http://${host}:${server.address().port}/`, server, finished, port: server.address().port })
    })
  })
}
