// Real input. Every function here goes through Input.dispatch*, the same path a physical mouse,
// wheel or finger takes. Nothing in this file sets scrollTop or dispatches a synthetic Event.

/** A wheel gesture delivered as discrete ticks, at a speed a hand can actually produce. */
export async function wheel (page, { x = 400, y = 400, dy = 1000, dx = 0, ticks = 20, ms = 16 } = {}) {
  const stepY = dy / ticks
  const stepX = dx / ticks
  for (let i = 0; i < ticks; i++) {
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x, y, deltaX: stepX, deltaY: stepY, pointerType: 'mouse'
    })
    await sleep(ms)
  }
}

/** A flick: touch down, drag, release — with the momentum a real finger imparts. */
export async function swipe (page, { x = 200, y = 600, dx = 0, dy = -400, steps = 12, ms = 12 } = {}) {
  const pt = (px, py) => [{ x: px, y: py, radiusX: 12, radiusY: 12, force: 1 }]
  await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x, y) })
  for (let i = 1; i <= steps; i++) {
    await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x + (dx * i) / steps, y + (dy * i) / steps) })
    await sleep(ms)
  }
  await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

export async function click (page, x, y, { button = 'left', clickCount = 1 } = {}) {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount })
}

export async function tap (page, x, y) {
  const pt = [{ x, y, radiusX: 12, radiusY: 12, force: 1 }]
  await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt })
  await sleep(40)
  await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

/**
 * Keys go in one at a time as rawKeyDown/char/keyUp. Injected keystrokes can report success while
 * landing nowhere, so anything that matters should be confirmed by reading the field back — never
 * by trusting the return value of this function.
 */
export async function type (page, text, { ms = 20 } = {}) {
  for (const ch of text) {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', text: ch, unmodifiedText: ch })
    await sleep(ms)
  }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms))
