// A suite that called goto() stayed alive for the whole navigation timeout after its last check.
//
// goto() raced the load event against a setTimeout it never cleared, so with the default 30 s
// budget every suite using it sat idle for 30 s before Node could exit. Found by the fv2 slice on
// the Rig 5 build. The bar: once the browser is closed, the process is gone within a second.
//
// The control runs the same walk against a copy of the harness with Rig 4's race line put back, with a
// 4 s navigation budget so the old timer's linger is measurable without slowing the suite by 30 s.

import { suite } from '../harness/check.js'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const harness = join(here, '..', 'harness')
const tmp = mkdtempSync(join(tmpdir(), 'rig-goto-timer-'))

// The walk: open a page with goto(), close the browser, print the time, then fall off the end.
// Whatever keeps the event loop alive after that line is what the bar measures.
const walk = (dir) => `
import { launch } from ${JSON.stringify(pathToFileURL(join(dir, 'cdp.js')).href)}
const b = await launch({ headless: true })
const p = await b.newPage(null)
await p.goto('data:text/html,<title>t</title><p>hi', { timeout: 4000 })
await p.close()
await b.close()
console.log('closed ' + Date.now())
`

/** Milliseconds between "browser closed" and the process exiting. */
function linger(dir) {
  const script = join(dir, 'walk.mjs')
  writeFileSync(script, walk(dir))
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'inherit'] })
    let out = ''
    child.stdout.on('data', (d) => {
      out += d
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      const m = out.match(/closed (\d+)/)
      if (code !== 0 || !m) return reject(new Error(`walk exited ${code} without closing: ${out.trim()}`))
      resolve(Date.now() - Number(m[1]))
    })
  })
}

// The fixed harness, and a copy of it with Rig 4's goto() (the uncleared timer) put back.
const fixed = join(tmp, 'fixed')
const old = join(tmp, 'old')
for (const d of [fixed, old]) {
  mkdirSync(d)
  for (const f of readdirSync(harness)) copyFileSync(join(harness, f), join(d, f))
}
const oldGoto =
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Rig 4's source line, copied as text
  'await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error(`navigation to ${u} timed out`)), timeout))])'
const src = readFileSync(join(old, 'cdp.js'), 'utf8')
const fixedRace = /\s*\/\/ Clear the deadline[\s\S]*?\.finally\(\(\) => clearTimeout\(timer\)\)/
if (!fixedRace.test(src)) throw new Error('goto-timer.test.js: could not find the fixed race in harness/cdp.js to swap out')
writeFileSync(join(old, 'cdp.js'), src.replace(fixedRace, '\n      ' + oldGoto))

let dir = fixed
await suite('goto() leaves nothing behind', async (s) => {
  await s.target('process exits after the browser closes', {
    measure: () => linger(dir),
    atMost: 1000,
    unit: 'ms',
    timeout: 20_000,
    breaks: () => {
      dir = old
      return () => {
        dir = fixed
      }
    },
  })
})

rmSync(tmp, { recursive: true, force: true })
