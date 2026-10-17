// Two suites running at once must never share a browser.
//
// On 2026-10-16 `rig qa` ran the taste suite while a slice was running its own copy, and both asked
// for debugging port 9352. The second Chrome found 127.0.0.1:9352 taken and opened DevTools on
// [::1]:9352 instead. launch() checked 127.0.0.1 only, so it took the first suite's browser for its
// own. When the first suite finished and closed that browser, every check left in the second failed
// with "fetch failed". launch() now reads where its own Chrome listens, and it refuses a port where
// some other browser answers.
//
// The control runs both checks against a copy of the harness with the old launch() put back.

import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { suite } from '../harness/check.js'

const here = dirname(fileURLToPath(import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const harness = join(here, '..', 'harness')
const tmp = mkdtempSync(join(tmpdir(), 'rig-launch-port-'))

// A copy of the harness whose launch() is the old one: port 9333 by default, and "something answers
// on 127.0.0.1:<port>" taken as proof that the browser is ours.
const old = join(tmp, 'old')
mkdirSync(old)
for (const f of readdirSync(harness)) copyFileSync(join(harness, f), join(old, f))
const src = readFileSync(join(old, 'cdp.js'), 'utf8')
const ownEndpoint = / {2}const proc = spawn\(CHROME[\s\S]*?\n\n {2}installReaper\(\)/
if (!ownEndpoint.test(src) || !src.includes('port = 0, width'))
  throw new Error('launch-port.test.js: could not find launch() in harness/cdp.js to put the old one back')
const oldLaunch = [
  "  const proc = spawn(CHROME, args, { stdio: 'ignore', detached: false })",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the old source line, copied as text
  '  const version = await waitForEndpoint(`http://127.0.0.1:${port}/json/version`, 10_000)',
  '  const bound = port',
  '',
  '  installReaper()',
].join('\n')
writeFileSync(join(old, 'cdp.js'), src.replace('port = 0, width', 'port = 9333, width').replace(ownEndpoint, oldLaunch))

const fixed = await import(pathToFileURL(join(harness, 'cdp.js')).href)
const before = await import(pathToFileURL(join(old, 'cdp.js')).href)
let cdp = fixed
const putOldBack = () => {
  cdp = before
  return () => {
    cdp = fixed
  }
}

/** A port nothing listens on right now. */
const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer()
    s.once('error', rej)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => res(port))
    })
  })

/**
 * Two suites launch with the same options. The second opens a page, then the first finishes and
 * closes its browser while the second is mid-run, as on 2026-10-16. True when the second's page
 * lives on (it was in a browser of its own), or when it asked for a fixed port and was told plainly
 * at launch that the port was taken.
 */
async function secondOutlivesFirst(opts) {
  const a = await cdp.launch({ headless: true, ...opts })
  let b
  let page
  try {
    try {
      b = await cdp.launch({ headless: true, ...opts })
    } catch (e) {
      return 'port' in opts && /already in use|Another browser answers/.test(e.message)
    }
    page = await b.newPage('data:text/html,<p>mine')
    await a.close()
    // A page that went down with the other suite's browser never answers; don't wait 30 s to see it.
    const text = await Promise.race([page.eval('document.body.textContent'), sleep(5000).then(() => 'no answer')])
    return text === 'mine'
  } finally {
    await page?.close().catch(() => {})
    await a.close()
    await b?.close()
  }
}

await suite('launch() owns its browser', async (s) => {
  await s.check('with no port given, two suites at once each keep a browser of their own', {
    assert: () => secondOutlivesFirst({}),
    breaks: putOldBack,
    timeout: 30_000,
  })
  await s.check("two suites asking for one port: the second is refused plainly, never handed the first one's browser", {
    assert: async () => secondOutlivesFirst({ port: await freePort() }),
    breaks: putOldBack,
    timeout: 30_000,
  })
})

rmSync(tmp, { recursive: true, force: true })
