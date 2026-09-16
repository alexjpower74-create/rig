// The same demo as demo.test.js, but in a window you can watch.
//
// Headless proves the point to a machine. This one proves it to a person: the page scrolls slowly
// and the nav gets out of the way, then it scrolls fast and the nav sits on top of the button,
// and the hit-test says so out loud while you are looking straight at it.

import { launch } from '../harness/cdp.js'
import { wheel, sleep } from '../harness/input.js'
import { isHittable, whatIsAt } from '../harness/hittest.js'
import { pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const url = pathToFileURL(join(here, 'fixture.html')).href
const PACE = Number(process.env.PACE || 1)
const beat = (ms) => sleep(ms * PACE)

const browser = await launch({ headless: false, width: 1180, height: 900, port: 9444 })
const page = await browser.newPage(url, { emulate: false })

// An on-page caption, so the window explains itself without anyone narrating.
await page.eval(`(() => {
  const c = document.createElement('div'); c.id = '__cap'
  Object.assign(c.style, { position:'fixed', left:'0', right:'0', bottom:'0', zIndex:'99999',
    font:'500 17px/1.5 ui-sans-serif,system-ui,sans-serif', background:'rgba(8,10,13,.96)',
    color:'#e7ecf3', padding:'18px 26px', borderTop:'2px solid #3A8F8F', transition:'opacity .2s' })
  document.body.appendChild(c)
  window.__say = (t, colour) => { c.innerHTML = t; c.style.borderTopColor = colour || '#3A8F8F' }
})()`)

const say = (t, colour) => page.eval(`window.__say(${JSON.stringify(t)}, ${JSON.stringify(colour || null)})`)
const mark = (sel, colour) =>
  page.eval(`(() => { const e=document.querySelector(${JSON.stringify(sel)});
  if(e){ e.style.outline='3px solid ${colour}'; e.style.outlineOffset='3px' } })()`)
const unmark = (sel) => page.eval(`(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(e) e.style.outline='none' })()`)
const reset = async () => {
  await page.eval('scrollTo(0,0); document.getElementById("nav").classList.remove("hidden")')
  await beat(500)
}

await say('A sticky nav that hides when you scroll down, so it stops covering the page. Watch what happens at two different scroll speeds.')
await beat(3800)

// ---- slow ------------------------------------------------------------------------------------
await reset()
await say('<b>SLOW SCROLL</b> — a careful, unhurried wheel. 60 small ticks.')
await beat(2200)
await wheel(page, { x: 590, y: 400, dy: 1500, ticks: 60, ms: 26 })
await beat(700)
await mark('#cta', '#4ec9a0')
const slowOk = await isHittable(page, '#cta')
await say(
  `The nav got out of the way. The button is reachable — hit-test says <b style="color:#4ec9a0">${slowOk ? 'PASS' : 'FAIL'}</b>. This is the test most suites would stop at.`,
  '#4ec9a0',
)
await beat(4200)
await unmark('#cta')

// ---- fast ------------------------------------------------------------------------------------
await reset()
await say('<b>FAST SCROLL</b> — the same 1500 pixels, but at the speed a real hand flicks. 6 big ticks.', '#d6a75a')
await beat(2600)
await wheel(page, { x: 590, y: 400, dy: 1500, ticks: 6, ms: 16 })
await beat(900)
await mark('#cta', '#e5645e')
const fastOk = await isHittable(page, '#cta')
const lands = await whatIsAt(page, 134, 65)
await say(
  `Same page, same distance. The nav never hid, and it is sitting on the button.<br>Hit-test: <b style="color:#e5645e">${fastOk ? 'PASS' : 'FAIL'}</b> — a tap at the button's centre lands on <b>${lands}</b>.`,
  '#e5645e',
)
await beat(5200)

// ---- the point -------------------------------------------------------------------------------
await say(
  'The button still <i>measures</i> 220&times;40 and is perfectly visible on screen. A test that checks its size passes here — which is why that test is marked <b style="color:#c07ad6">VOID</b>, not green.',
  '#c07ad6',
)
await beat(6000)
await say(
  'Programmatic scrolling eases. Easing is exactly what this bug outruns. It only appears under real input, at real speed, hit-tested.',
  '#3A8F8F',
)
await beat(5500)

console.log(`slow scroll -> CTA hittable: ${slowOk}`)
console.log(`fast scroll -> CTA hittable: ${fastOk}   (a tap at its centre lands on ${lands})`)
console.log('\nclosing…')
await page.close()
await browser.close()
