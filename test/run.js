#!/usr/bin/env node
// The test runner. Runs every test/*.test.js in name order as its own child process with stdio
// inherited: a harness suite and a node:test file both exit non-zero on failure, so the runner needs
// no knowledge of which is which. It stops at the first failure and exits with that status, so a new
// test file is picked up by `npm test` without editing package.json.
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const files = readdirSync(here)
  .filter((f) => f.endsWith('.test.js'))
  .sort()

console.log(`test/run.js: ${files.length} file(s)\n  ${files.join('\n  ')}\n`)

for (const f of files) {
  console.log(`\n── ${f} ──`)
  const r = spawnSync(process.execPath, [join(here, f)], { stdio: 'inherit' })
  const code = r.status ?? 128 + (r.signal ? 1 : 0)
  if (code !== 0) {
    if (r.error) console.error(`test/run.js: could not run ${f}: ${r.error.message}`)
    console.error(`\ntest/run.js: ${f} exited ${code}${r.signal ? ` (${r.signal})` : ''} — stopping here`)
    process.exit(code)
  }
}
console.log(`\ntest/run.js: ${files.length} file(s) green`)
