// Two suites running at once must never share a browser.
//
// On 2026-10-16 `rig qa` ran the taste suite while a slice was running its own copy, and both asked
// for debugging port 9352. The second Chrome found 127.0.0.1:9352 taken and opened DevTools on
// [::1]:9352 instead. launch() checked 127.0.0.1 only, so it took the first suite's browser for its
// own. When the first suite finished and closed that browser, every check left in the second failed
// with "fetch failed". launch() now reads where its own Chrome listens, and it refuses a port where
// some other browser answers.
//
// Each guard has its own control: a copy of the harness with just that guard taken out (or, for the
// default port, the old launch() put back) must turn its check red.

import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { suite } from '../harness/check.js'

const here = dirname(fileURLToPath(import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const harness = join(here, '..', 'harness')
const tmp = mkdtempSync(join(tmpdir(), 'rig-launch-port-'))

/** A copy of the harness with `edits` ([pattern, replacement]) applied to cdp.js, imported. */
async function variant(name, edits) {
  const dir = join(tmp, name)
  mkdirSync(dir)
  for (const f of readdirSync(harness)) copyFileSync(join(harness, f), join(dir, f))
  let src = readFileSync(join(dir, 'cdp.js'), 'utf8')
  for (const [from, to] of edits) {
    if (!(typeof from === 'string' ? src.includes(from) : from.test(src)))
      throw new Error(`launch-port.test.js: could not find ${from} in harness/cdp.js for the "${name}" control`)
    src = src.replace(from, to)
  }
  writeFileSync(join(dir, 'cdp.js'), src)
  return import(pathToFileURL(join(dir, 'cdp.js')).href)
}

// The old launch(): port 9333 by default, and "something answers on 127.0.0.1:<port>" taken as proof
// that the browser is ours.
const oldLaunch = [
  "  const proc = spawn(CHROME, args, { stdio: 'ignore', detached: false })",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the old source line, copied as text
  '  const version = await waitForEndpoint(`http://127.0.0.1:${port}/json/version`, 10_000)',
  '  const bound = port',
  '',
  '  installReaper()',
].join('\n')
const before = await variant('old', [
  ['port = 0, width', 'port = 9333, width'],
  [/ {2}const proc = spawn\(CHROME[\s\S]*?\n\n {2}installReaper\(\)/, oldLaunch],
])
const addressGuard = /\n {2}if \(where\.hostname !== '127\.0\.0\.1'\)\n[\s\S]*?\n {4}\)\n/
const idGuard = /\n {2}if \(version\.webSocketDebuggerUrl !== endpoint\)\n[\s\S]*?\n {4}\)\n/
const noAddressGuard = await variant('no-address-guard', [[addressGuard, '\n']])
const noGuards = await variant('no-guards', [
  [addressGuard, '\n'],
  [idGuard, '\n'],
])
const noTakenLine = await variant('no-taken-line', [[/\n {6}else if \(\/Cannot start http server for devtools\/[\s\S]*?\n {8}\)\n/, '\n']])
// Only written to disk: the check below runs it in a child process.
await variant('keeps-ref', [['  proc.unref()\n  proc.stderr?.unref?.()\n', '']])

const fixed = await import(pathToFileURL(join(harness, 'cdp.js')).href)
let cdp = fixed
/** A `breaks` that runs the check against another copy of the harness, and a restore that puts it back. */
const use = (other) => () => {
  const was = cdp
  cdp = other
  return () => {
    cdp = was
  }
}

/** Hold a port on 127.0.0.1 (and ::1 where the machine has it); resolves { port, release }. */
async function holdPort() {
  const v4 = createServer()
  await new Promise((r, j) => v4.once('error', j).listen(0, '127.0.0.1', r))
  const { port } = v4.address()
  const v6 = createServer()
  const held = [v4]
  await new Promise((r) => v6.once('error', r).listen(port, '::1', () => r(held.push(v6))))
  return { port, release: () => Promise.all(held.map((s) => new Promise((r) => s.close(r)))) }
}

/** A port nothing listens on right now. */
const freePort = async () => {
  const h = await holdPort()
  await h.release()
  return h.port
}

/**
 * Two suites launch with the same options. The second opens a page, then the first finishes and
 * closes its browser while the second is mid-run, as on 2026-10-16. True when the second's page
 * lives on (it was in a browser of its own), or when its launch was refused with a reason matching
 * `refusal`.
 */
async function secondOutlivesFirst(opts, refusal = null) {
  const a = await cdp.launch({ headless: true, ...opts })
  let b
  let page
  try {
    try {
      b = await cdp.launch({ headless: true, ...opts })
    } catch (e) {
      return refusal ? refusal.test(e.message) : false
    }
    page = await b.newPage('data:text/html,<p>mine')
    await a.close()
    // A page that went down with the other suite's browser never answers; don't wait 30 s to see it.
    const text = await Promise.race([page.eval('document.body.textContent'), sleep(5000).then(() => 'no answer')])
    return text === 'mine'
  } finally {
    await page?.close().catch(() => {})
    // Each on its own: one close() that throws must not leave the other browser running.
    await Promise.allSettled([a.close(), b?.close()])
  }
}

await suite('launch() owns its browser', async (s) => {
  await s.check('with no port given, two suites at once each keep a browser of their own', {
    assert: () => secondOutlivesFirst({}),
    breaks: use(before),
    timeout: 30_000,
  })

  // The address guard: Chrome said [::1], so the port is taken on 127.0.0.1. Without the guard the
  // id check still refuses, but with a reason that names a stranger instead of the port.
  await s.check('two suites asking for one port: the second is told plainly that the port is taken', {
    assert: async () => secondOutlivesFirst({ port: await freePort() }, /already in use on 127\.0\.0\.1/),
    breaks: use(noAddressGuard),
    timeout: 30_000,
  })

  // The id guard, on its own: with the address guard taken out it must still refuse the stranger.
  // With both taken out, the second suite borrows the first one's browser and its page dies with it.
  let idOnly = noAddressGuard
  await s.check("the id check alone refuses another browser on the port, so a page never dies with someone else's", {
    assert: async () => {
      const was = cdp
      cdp = idOnly
      try {
        return await secondOutlivesFirst({ port: await freePort() }, /Another browser answers/)
      } finally {
        cdp = was
      }
    },
    breaks: () => {
      idOnly = noGuards
      return () => {
        idOnly = noAddressGuard
      }
    },
    timeout: 30_000,
  })

  // A runner without IPv6 has no [::1] to fall back to: Chrome prints "Cannot start http server for
  // devtools" and no URL. That is a refusal by name at once, not a 10 s wait blamed on the install.
  await s.check('a port taken on every address is refused by name within 5 s', {
    assert: async () => {
      const held = await holdPort()
      const t = Date.now()
      try {
        const b = await cdp.launch({ headless: true, port: held.port })
        await b.close()
        return false
      } catch (e) {
        return /already in use/.test(e.message) && Date.now() - t < 5000
      } finally {
        await held.release()
      }
    },
    breaks: use(noTakenLine),
    timeout: 20_000,
  })

  // A suite that never closes its browser still ends, and takes its Chrome with it.
  let lib = join(harness, 'cdp.js')
  await s.check('a browser left open does not keep the suite alive; it is gone when the suite ends', {
    assert: async () => {
      const script = join(tmp, 'left-open.mjs')
      writeFileSync(
        script,
        `const { launch } = await import(${JSON.stringify(pathToFileURL(lib).href)})\nconst b = await launch({ headless: true })\nconsole.log('pid ' + b.proc.pid)\n`,
      )
      const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'inherit'] })
      let out = ''
      child.stdout.on('data', (d) => {
        out += d
      })
      const exited = await Promise.race([new Promise((r) => child.on('exit', () => r(true))), sleep(4000).then(() => false)])
      const pid = Number(out.match(/pid (\d+)/)?.[1])
      if (!exited) child.kill('SIGKILL')
      await sleep(200)
      let chromeGone = true
      try {
        process.kill(pid, 0)
        chromeGone = false
        process.kill(pid, 'SIGKILL')
      } catch {}
      return exited && pid > 0 && chromeGone
    },
    breaks: () => {
      lib = join(tmp, 'keeps-ref', 'cdp.js')
      return () => {
        lib = join(harness, 'cdp.js')
      }
    },
    timeout: 15_000,
  })
})

rmSync(tmp, { recursive: true, force: true })
