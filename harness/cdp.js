// A small Chrome DevTools Protocol client.
//
// Why not synthetic events: dispatching a JS `wheel` event, or setting scrollTop, produces motion
// no user could make — instant, or eased by your own code. Input-speed bugs are precisely the ones
// that outrun eased motion, which is how a suite goes green against a visibly broken page.
// `Input.dispatchMouseEvent` goes in at the browser's input layer, the same door a real wheel uses.

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.RIG_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

export async function launch ({ headless = true, port = 9333, width = 1440, height = 900 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'rig-chrome-'))
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling',
    // A backgrounded or occluded tab renders nothing; a screenshot of one is a picture of a lie.
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    `--window-size=${width},${height}`
  ]
  if (headless) args.push('--headless=new')
  args.push('about:blank')

  const proc = spawn(CHROME, args, { stdio: 'ignore', detached: false })
  const version = await waitForEndpoint(`http://127.0.0.1:${port}/json/version`, 10_000)

  const browser = {
    proc, port, profile, version,
    async newPage (url, opts = {}) { return newPage(port, url, { width, height, ...opts }) },
    async close () {
      try { proc.kill('SIGTERM') } catch {}
      // Chrome does not always go quietly; make sure of it, then take the profile with it.
      await new Promise(r => setTimeout(r, 300))
      try { proc.kill('SIGKILL') } catch {}
      try { rmSync(profile, { recursive: true, force: true }) } catch {}
    }
  }
  return browser
}

async function waitForEndpoint (url, ms) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try { const r = await fetch(url); if (r.ok) return await r.json() } catch {}
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`Chrome never opened a debugging endpoint at ${url}. Is it installed at ${CHROME}?`)
}

async function newPage (port, url, { width, height, dpr = 2, mobile = false }) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('could not attach to the page')) })

  let id = 0
  const pending = new Map()
  const listeners = new Map()
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id); pending.delete(msg.id)
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
    } else if (msg.method) {
      (listeners.get(msg.method) || []).forEach(f => f(msg.params))
    }
  }
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id
    pending.set(mid, { res, rej })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  const on = (method, fn) => { listeners.set(method, [...(listeners.get(method) || []), fn]) }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('DOM.enable')
  // Headless lays out at a ~500px floor no matter what --window-size says. Pin the viewport
  // explicitly or every mobile measurement you take is measuring the wrong page.
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile })

  const page = { send, on, ws, target,
    async goto (u, { waitUntil = 'load', timeout = 30_000 } = {}) {
      const done = new Promise(res => on(waitUntil === 'load' ? 'Page.loadEventFired' : 'Page.domContentEventFired', res))
      await send('Page.navigate', { url: u })
      await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error(`navigation to ${u} timed out`)), timeout))])
    },
    async eval (expression, { awaitPromise = true } = {}) {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
      return r.result.value
    },
    async close () { try { ws.close() } catch {}; await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {}) }
  }

  if (url && url !== 'about:blank') await page.goto(url)
  return page
}
