#!/usr/bin/env node
// The test runner. Runs every test/*.test.js in name order as its own child process with stdio
// inherited: a harness suite and a node:test file both exit non-zero on failure, so the runner needs
// no knowledge of which is which. It stops at the first failure and exits with that status, so a new
// test file is picked up by `npm test` without editing package.json.
//
// Each file gets a time limit (RIG_TEST_TIMEOUT_MS, default 20 minutes). A suite that leaves a server
// listening after a failed check never exits; on 2026-10-16 one sat for three hours inside `rig qa`
// with nothing on screen. Past the limit the file is stopped and named, and the run fails.
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const LIMIT = Number(process.env.RIG_TEST_TIMEOUT_MS) || 20 * 60_000
// Never let the suite drive the person's Herdr app: see test/clean-env.js.
const env = { ...process.env }
for (const k of ['HC_TERMINAL_ID', 'HC_TERMINAL_SOCKET', 'HC_SESSION']) delete env[k]
const files = readdirSync(here)
  .filter((f) => f.endsWith('.test.js'))
  .sort()

console.log(`test/run.js: ${files.length} file(s)\n  ${files.join('\n  ')}\n`)

for (const f of files) {
  console.log(`\n── ${f} ──`)
  const r = spawnSync(process.execPath, [join(here, f)], { stdio: 'inherit', env, timeout: LIMIT, killSignal: 'SIGTERM' })
  const code = r.status ?? 128 + (r.signal ? 1 : 0)
  if (code !== 0) {
    if (r.error?.code === 'ETIMEDOUT')
      console.error(`test/run.js: ${f} was still running after ${Math.round(LIMIT / 1000)} s and was stopped`)
    else if (r.error) console.error(`test/run.js: could not run ${f}: ${r.error.message}`)
    console.error(`\ntest/run.js: ${f} exited ${code}${r.signal ? ` (${r.signal})` : ''} — stopping here`)
    process.exit(code)
  }
}
console.log(`\ntest/run.js: ${files.length} file(s) green`)
