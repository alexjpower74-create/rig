// goto() must not call a browser error page a successful load.
//
// Chrome fires the load event on its own error page, and that page's document.title is the
// hostname — so a failed navigation is indistinguishable, to any naive check, from a successful
// one that rendered a short page. Found live: a live site answered curl with a 200 and gave
// Chrome ERR_EMPTY_RESPONSE, and the harness reported the navigation as fine.

import { suite } from '../harness/check.js'
import { launch } from '../harness/cdp.js'
import { createServer } from 'node:http'

/** Serves a real page on one path and hangs up without answering on the other. */
const server = createServer((req, res) => {
  if (req.url === '/dead') { req.socket.destroy(); return }   // -> ERR_EMPTY_RESPONSE
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end('<!doctype html><title>A Real Page</title><h1>Real</h1><p>This page exists.</p>')
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const browser = await launch({ headless: true, port: 9800 + Math.floor(Math.random() * 150) })

// The navigation budget must sit INSIDE the check's budget, not outside it.
//
// A check abandoned by the harness does not stop the work it started: the navigation carries on,
// in a page belonging to a browser every later check is still using. One slow check then fails
// the ones after it, which teaches people to re-run a suite instead of read it — and the next
// time it happens, a real defect gets dismissed as the known flake.
const NAV_TIMEOUT = 8_000
const CHECK_TIMEOUT = 20_000

/** Navigate and say only whether it threw. */
async function tryGoto (url) {
  const page = await browser.newPage(null)
  try {
    await page.goto(url, { timeout: NAV_TIMEOUT })
    return { threw: false, title: await page.eval('document.title') }
  } catch (e) {
    return { threw: true, why: e.message }
  } finally { await page.close() }
}

await suite('goto refuses to call an error page a load', async t => {

  let target = `${base}/dead`

  await t.check('a server that hangs up is reported as a failed navigation', {
    timeout: CHECK_TIMEOUT,
    assert: async () => {
      const r = await tryGoto(target)
      return r.threw && /ERR_|failed/.test(r.why)
    },
    // Point the same check at a page that genuinely works. It must stop throwing — otherwise
    // this passes because goto throws at everything, which is not the behaviour under test.
    breaks: () => { const was = target; target = `${base}/ok`; return () => { target = was } }
  })

  let good = `${base}/ok`

  await t.check('a real page still loads, with its real title', {
    timeout: CHECK_TIMEOUT,
    assert: async () => {
      const r = await tryGoto(good)
      return !r.threw && r.title === 'A Real Page'
    },
    // The success path is where a too-aggressive guard does its damage: a goto that rejects
    // working sites is worse than the bug it was added to fix.
    breaks: () => { const was = good; good = `${base}/dead`; return () => { good = was } }
  })
})

await browser.close()
server.close()

// A leaked browser is not a tidiness problem. Chrome does not reliably die with its parent, so a
// suite that throws before close() leaves one running; several suites back to back leave a crowd
// that starves each other, and that presents as unrelated tests failing intermittently and then
// passing when re-run alone. That is the most expensive shape a bug can take.
import { liveBrowsers } from '../harness/cdp.js'

await suite('browsers do not leak', async t => {
  await t.check('a closed browser is no longer tracked', {
    timeout: CHECK_TIMEOUT,
    // Absolute, not relative. A before/after delta stays true no matter how many browsers are
    // already leaking, which is exactly the state this check exists to notice — and it marked
    // itself VOID for saying so.
    assert: async () => {
      const b = await launch({ headless: true, port: 9860 + Math.floor(Math.random() * 60) })
      const during = liveBrowsers()
      await b.close()
      return during >= 1 && liveBrowsers() === 0
    },
    // If close() stopped untracking, the count would not come back down. Prove the counter moves
    // by leaving one open — and clean it up in the restore, because this suite must not be the
    // thing that leaks.
    breaks: async () => {
      const b = await launch({ headless: true, port: 9930 + Math.floor(Math.random() * 60) })
      return async () => { await b.close() }
    }
  })
})
