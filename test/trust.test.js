// preTrust must write hasTrustDialogAccepted for the worktree path into ~/.claude.json — and
// must be able to fail: with no config file it returns false and writes nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

async function withHome(setup, fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-trust-'))
  const prev = process.env.HOME
  process.env.HOME = home
  try {
    setup(home)
    const { preTrust } = await import('../src/trust.js?' + Date.now())
    return await fn(preTrust, home)
  } finally {
    process.env.HOME = prev
    fs.rmSync(home, { recursive: true, force: true })
  }
}

test('preTrust marks the worktree trusted in ~/.claude.json', async () => {
  await withHome(
    (h) => fs.writeFileSync(path.join(h, '.claude.json'), JSON.stringify({ projects: {} })),
    (preTrust, h) => {
      const wt = path.join(h, 'proj', '.worktrees', 'c1')
      assert.equal(preTrust(wt), true)
      const cfg = JSON.parse(fs.readFileSync(path.join(h, '.claude.json'), 'utf8'))
      assert.equal(cfg.projects[wt].hasTrustDialogAccepted, true)
      // negative control: a different path is NOT trusted by this call
      assert.equal(cfg.projects[path.join(h, 'other')], undefined)
    },
  )
})

test('preTrust leaves a missing config alone', async () => {
  await withHome(
    () => {},
    (preTrust, h) => {
      assert.equal(preTrust(path.join(h, 'x')), false)
      assert.equal(fs.existsSync(path.join(h, '.claude.json')), false)
    },
  )
})
