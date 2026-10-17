// A small Chrome DevTools Protocol client.
//
// Why not synthetic events: dispatching a JS `wheel` event, or setting scrollTop, produces motion
// no user could make — instant, or eased by your own code. Input-speed bugs are precisely the ones
// that outrun eased motion, which is how a suite goes green against a visibly broken page.
// `Input.dispatchMouseEvent` goes in at the browser's input layer, the same door a real wheel uses.

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { existsSync } from 'node:fs'

// Where Chrome lives, per platform. RIG_CHROME wins; otherwise the first path that exists.
// Linux (and GitHub Actions' ubuntu runners) ship google-chrome on PATH; macOS keeps the app bundle.
const CHROME_CANDIDATES = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ],
  win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'],
}
const CHROME =
  process.env.RIG_CHROME || (CHROME_CANDIDATES[process.platform] || []).find((p) => existsSync(p)) || CHROME_CANDIDATES.darwin[0]

/**
 * Every browser this process launched and has not closed.
 *
 * Chrome does not reliably die with its parent, and a suite that throws before reaching close()
 * leaks one. Run several suites back to back and the survivors pile up until they starve each
 * other — which presents as unrelated tests failing intermittently, then passing when re-run
 * alone, which is the single most expensive shape a bug can have.
 */
const live = new Set()
let reaperInstalled = false

function installReaper() {
  if (reaperInstalled) return
  reaperInstalled = true
  const reap = () => {
    for (const b of live) {
      try {
        b.proc.kill('SIGKILL')
      } catch {}
    }
    live.clear()
  }
  process.on('exit', reap)
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      reap()
      process.exit(130)
    })
  }
  process.on('uncaughtException', (err) => {
    reap()
    throw err
  })
}

/** How many browsers this process still has open. Exported so a suite can assert it cleaned up. */
export const liveBrowsers = () => live.size

/**
 * Start a Chrome of this process's own and wait until it can be driven.
 *
 * `port` defaults to 0: Chrome picks a free one. A fixed port is a resource shared with everything
 * else on the machine. When two suites asked for the same one at once (`rig qa` beside a slice's own
 * run), the second Chrome found 127.0.0.1 taken, opened DevTools on [::1] instead, and this client,
 * which talks to 127.0.0.1, drove the first suite's browser until that suite closed it. Every check
 * after that failed with "fetch failed". Chrome prints where it really listens; that line, not the
 * port asked for, is the endpoint, and a browser that answers there with another id is refused.
 */
export async function launch({ headless = true, port = 0, width = 1440, height = 900, args: extraArgs = [] } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'rig-chrome-'))
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    // A backgrounded or occluded tab renders nothing; a screenshot of one is a picture of a lie.
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    `--window-size=${width},${height}`,
  ]
  if (headless) args.push('--headless=new')
  // Caller-supplied flags. Needed for things only the caller knows it wants — retrying a site
  // whose server speaks broken HTTP/2 with `--disable-http2`, for instance, which turns a
  // graceful non-answer into a real measurement.
  args.push(...extraArgs)
  args.push('about:blank')

  const proc = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'], detached: false })
  const fail = (err) => {
    try {
      proc.kill('SIGKILL')
    } catch {}
    proc.stderr.destroy()
    rmSync(profile, { recursive: true, force: true })
    throw err
  }
  // Own the endpoint: read where this Chrome listens, then make sure 127.0.0.1 answers as this Chrome.
  // Two guards. The address check gives the plain reason when the port is taken; the id check is the
  // backstop for any other way a stranger ends up answering on the port this Chrome reported.
  const endpoint = await listeningOn(proc, { profile, port, ms: 10_000 }).catch(fail)
  const where = new URL(endpoint)
  if (where.hostname !== '127.0.0.1')
    fail(
      new Error(
        `Port ${where.port} is already in use on 127.0.0.1, so Chrome opened it on ${where.hostname}. Leave out \`port\` and Chrome picks a free one.`,
      ),
    )
  const bound = Number(where.port)
  const version = await waitForEndpoint(`http://127.0.0.1:${bound}/json/version`, 10_000).catch(fail)
  if (version.webSocketDebuggerUrl !== endpoint)
    fail(
      new Error(`Another browser answers on 127.0.0.1:${bound}, not the one just started. Leave out \`port\` and Chrome picks a free one.`),
    )

  installReaper()
  const browser = {
    proc,
    port: bound,
    profile,
    version,
    async newPage(url, opts = {}) {
      return newPage(bound, url, { width, height, ...opts })
    },
    async close() {
      live.delete(browser)
      try {
        proc.kill('SIGTERM')
      } catch {}
      // Chrome does not always go quietly; make sure of it, then take the profile with it.
      await new Promise((r) => setTimeout(r, 300))
      try {
        proc.kill('SIGKILL')
      } catch {}
      // A helper Chrome started may hold the pipe's write end; don't let it keep this process alive.
      proc.stderr.destroy()
      try {
        rmSync(profile, { recursive: true, force: true })
      } catch {}
    },
  }
  live.add(browser)
  return browser
}

/**
 * The DevTools URL this Chrome listens on (ws://host:port/devtools/browser/<id>).
 *
 * Chrome prints it on stderr. If no line has come after a second (a RIG_CHROME wrapper that swallows
 * stderr), the DevToolsActivePort file Chrome writes into the profile (port, then path) answers
 * instead; the id check in launch() still refuses a stranger. A port taken on 127.0.0.1 AND ::1 (a
 * runner without IPv6) prints "Cannot start http server for devtools" and no URL: that is refused at
 * once, by name, not after the full wait.
 */
function listeningOn(proc, { profile, port, ms }) {
  return new Promise((resolve, reject) => {
    let seen = ''
    const onData = (d) => {
      seen += d
      const m = seen.match(/DevTools listening on (ws:\/\/\S+)/)
      if (m) settle(null, m[1])
      else if (/Cannot start http server for devtools/.test(seen))
        settle(
          new Error(`Port ${port} is already in use, so Chrome could not open DevTools. Leave out \`port\` and Chrome picks a free one.`),
        )
    }
    const onExit = (code, signal) =>
      settle(new Error(`Chrome exited (${signal || code}) before it opened DevTools. Is it installed at ${CHROME}?`))
    const onError = (e) => settle(new Error(`Could not start Chrome at ${CHROME}: ${e.message}`))
    const timer = setTimeout(() => settle(new Error(`Chrome never opened DevTools within ${ms} ms. Is it installed at ${CHROME}?`)), ms)
    const started = Date.now()
    const poll = setInterval(() => {
      if (Date.now() - started < 1000) return
      try {
        const [p, path] = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')
        if (Number(p) > 0 && path?.startsWith('/devtools/browser/')) settle(null, `ws://127.0.0.1:${p}${path.trim()}`)
      } catch {}
    }, 100)
    function settle(err, url) {
      clearTimeout(timer)
      clearInterval(poll)
      proc.off('exit', onExit)
      proc.off('error', onError)
      proc.stderr.off('data', onData)
      // Keep draining stderr: a full pipe stalls Chrome mid-run.
      proc.stderr.resume()
      if (err) reject(err)
      else resolve(url)
    }
    proc.stderr.on('data', onData)
    proc.once('exit', onExit)
    proc.once('error', onError)
  })
}

async function waitForEndpoint(url, ms) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try {
      const r = await fetch(url)
      if (r.ok) return await r.json()
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Chrome never opened a debugging endpoint at ${url}. Is it installed at ${CHROME}?`)
}

async function newPage(port, url, { width, height, dpr = 2, mobile = false, emulate = true }) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('could not attach to the page'))
  })

  let id = 0
  const pending = new Map()
  const listeners = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
    } else if (msg.method) {
      ;(listeners.get(msg.method) || []).forEach((f) => {
        f(msg.params)
      })
    }
  }
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id
      pending.set(mid, { res, rej })
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
  const on = (method, fn) => {
    listeners.set(method, [...(listeners.get(method) || []), fn])
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('DOM.enable')
  // Headless lays out at a ~500px floor no matter what --window-size says. Pin the viewport
  // explicitly or every mobile measurement you take is measuring the wrong page.
  //
  // In a window someone is actually watching, do the opposite: an override forces a layout
  // viewport that does not match the visible window, so anything pinned to the bottom of the
  // screen lands below the part you can see. `emulate: false` keeps the real window size.
  if (emulate) await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile })

  const page = {
    send,
    on,
    ws,
    target,
    /**
     * Navigate, and refuse to call a browser error page a successful load.
     *
     * Chrome fires the load event on its OWN error page, and that page's document.title is the
     * hostname — so a failed navigation looks, to every naive check, exactly like a successful
     * one that happened to render a short page. A harness that trusts the load event here is
     * measuring "This page isn't working" and reporting it as the site.
     *
     * Observed live: a live site returned ERR_EMPTY_RESPONSE to Chrome while answering curl
     * with a 200. goto() reported success, document.title read "a live site", and the audit
     * would have scored Chrome's error page as the business's home page.
     */
    async goto(u, { waitUntil = 'load', timeout = 30_000 } = {}) {
      const done = new Promise((res) => on(waitUntil === 'load' ? 'Page.loadEventFired' : 'Page.domContentEventFired', res))
      const nav = await send('Page.navigate', { url: u })
      if (nav.errorText) throw new Error(`navigation to ${u} failed: ${nav.errorText}`)
      // Clear the deadline once the load wins: an uncleared 30 s timer kept every suite that called
      // goto() alive for 30 s after its last check.
      let timer
      const deadline = new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error(`navigation to ${u} timed out`)), timeout)
      })
      await Promise.race([done, deadline]).finally(() => clearTimeout(timer))

      // The load event is not proof. Ask where we actually ended up.
      const landed = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true })
      const href = landed.result?.value || ''
      if (/^chrome-error:\/\//.test(href)) {
        const why = await send('Runtime.evaluate', {
          expression: '(document.body ? document.body.innerText : "").match(/ERR_[A-Z0-9_]+/)?.[0] || "unknown"',
          returnByValue: true,
        })
        throw new Error(`navigation to ${u} landed on a browser error page: ${why.result?.value || 'unknown'}`)
      }
    },
    async eval(expression, { awaitPromise = true } = {}) {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
      return r.result.value
    },
    async close() {
      try {
        ws.close()
      } catch {}
      await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {})
    },
  }

  if (url && url !== 'about:blank') await page.goto(url)
  return page
}
