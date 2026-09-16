// What this file demonstrates, in one run:
//
//   1. A check with no negative control is UNPROVEN — it has never been shown to fail.
//   2. A check built on getBoundingClientRect is VOID — it passes against a page you have broken
//      on purpose, so it is not evidence of anything.
//   3. A hit-test driven by REAL wheel input catches a bug that both of the above sail past.
//
// The fixture is a sticky nav that hides on scroll-down. A guard meant to ignore anchor-link jumps
// also swallows every delta a fast wheel produces, so at speed the nav never hides and it covers
// the call-to-action. Slow or programmatic scrolling never reproduces it. That is the whole point:
// a suite that eases its own input is testing a page no user will ever visit.

import { suite, launch, wheel, isHittable, whatIsAt, isRendering, sleep } from '../harness/index.js'
import { pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const url = pathToFileURL(join(here, 'fixture.html')).href

const browser = await launch({ headless: true, width: 1280, height: 800 })
const page = await browser.newPage(url)

/** Put the page back to the top, then scroll 1500px using `ticks` wheel events. */
async function scrollTo1500(ticks) {
  await page.eval('scrollTo(0, 0); document.getElementById("nav").classList.remove("hidden")')
  await sleep(150)
  await wheel(page, { x: 640, y: 400, dy: 1500, ticks, ms: 16 })
  await sleep(400)
}

/** The negative control used throughout: drop an overlay over the CTA and take it away again. */
async function coverTheCta() {
  await page.eval(`(() => {
    const o = document.createElement('div'); o.id = '__control'
    const r = document.getElementById('cta').getBoundingClientRect()
    Object.assign(o.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px',
      width: r.width + 'px', height: r.height + 'px', zIndex: 9999, background: 'transparent' })
    document.body.appendChild(o)
  })()`)
  return () => page.eval('document.getElementById("__control")?.remove()')
}

await suite('sticky nav vs the CTA', async (t) => {
  await t.check('the page is actually rendering', {
    assert: () => isRendering(page),
    // No negative control on purpose. A hidden tab cannot be forced from in here, and faking one
    // would be worse than admitting the check is unproven. UNPROVEN is an honest result.
  })

  await scrollTo1500(60)
  await t.check('[hit-test] CTA is clickable after a SLOW scroll', {
    assert: () => isHittable(page, '#cta'),
    breaks: coverTheCta,
  })

  await scrollTo1500(6)
  await t.check('[rect] CTA has a real box after a FAST scroll', {
    assert: () =>
      page.eval('(() => { const r = document.getElementById("cta").getBoundingClientRect(); return r.width > 0 && r.height > 0 })()'),
    breaks: coverTheCta,
  })

  await t.check('[hit-test] CTA is clickable after a FAST scroll', {
    assert: () => isHittable(page, '#cta'),
    breaks: coverTheCta,
  })
})

await scrollTo1500(6)
const nav = await page.eval('document.getElementById("nav").classList.contains("hidden") ? "hidden" : "still covering the page"')
console.log(`\nafter a fast scroll the nav is ${nav}; a tap at the CTA's centre lands on: ${await whatIsAt(page, 134, 65)}`)

await page.close()
await browser.close()
