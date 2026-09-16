// Hit-test, don't measure rectangles.
//
// getBoundingClientRect tells you where a box would be if nothing were in the way. It will happily
// report a healthy 44x44 button that is covered by a sticky header, clipped by an overflow parent,
// sitting under a full-screen overlay, or painted at opacity 0. document.elementFromPoint answers
// the only question that matters: if a finger lands here, what does it hit?

/** True when the centre of `selector` actually receives the hit. */
export async function isHittable(page, selector) {
  return page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return false
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return false
    const x = r.left + r.width / 2, y = r.top + r.height / 2
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false
    const hit = document.elementFromPoint(x, y)
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el))
  })()`)
}

/** What is actually at this point — for when isHittable says no and you need to know who stole it. */
export async function whatIsAt(page, x, y) {
  return page.eval(`(() => {
    const el = document.elementFromPoint(${x}, ${y})
    if (!el) return null
    const id = el.id ? '#' + el.id : ''
    const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : ''
    return el.tagName.toLowerCase() + id + cls
  })()`)
}

/** Every corner and the centre must land on the element — catches partial clipping. */
export async function isFullyHittable(page, selector, inset = 2) {
  return page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return false
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return false
    const i = ${inset}
    const pts = [
      [r.left + i, r.top + i], [r.right - i, r.top + i],
      [r.left + i, r.bottom - i], [r.right - i, r.bottom - i],
      [r.left + r.width / 2, r.top + r.height / 2]
    ]
    return pts.every(([x, y]) => {
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false
      const hit = document.elementFromPoint(x, y)
      return !!hit && (hit === el || el.contains(hit) || hit.contains(el))
    })
  })()`)
}

/** Minimum touch target. 44x44 CSS px is the WCAG 2.5.5 / Apple HIG floor. */
export async function meetsTouchTarget(page, selector, min = 44) {
  return page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return false
    const r = el.getBoundingClientRect()
    return r.width >= ${min} && r.height >= ${min}
  })()`)
}

/**
 * A backgrounded or occluded tab renders nothing, so anything measured there is a picture of a lie.
 * Call this before you trust a single render check.
 */
export async function isRendering(page) {
  return page.eval('!document.hidden && document.visibilityState === "visible"')
}
