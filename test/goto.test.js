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

/** Navigate and say only whether it threw. */
async function tryGoto (url) {
  const page = await browser.newPage(null)
  try {
    await page.goto(url, { timeout: 15_000 })
    return { threw: false, title: await page.eval('document.title') }
  } catch (e) {
    return { threw: true, why: e.message }
  } finally { await page.close() }
}

await suite('goto refuses to call an error page a load', async t => {

  let target = `${base}/dead`

  await t.check('a server that hangs up is reported as a failed navigation', {
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
