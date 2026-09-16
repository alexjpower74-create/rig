// The desk: the small shell-outs `rig finish` makes to the tools that hold what exists and what
// state it is in — the decision log (`jot`), the app registry (`apps`) and GitHub issues (`gh`).
//
// Every one of them is optional. A public repo's user has none of them; a crew's peer may have
// `gh` but no registry. So nothing here throws on absence: each call answers `{ ran: false, why }`
// and the caller says so in the report. And nothing here runs unless every finish gate passed;
// that rule is the caller's, and it is the one that matters.

import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join, delimiter } from 'node:path'

/** The first executable named `name` on PATH, or null. */
export function findOnPath (name, env = process.env) {
  for (const dir of (env.PATH || '').split(delimiter).filter(Boolean)) {
    const p = join(dir, name)
    try { if (existsSync(p) && statSync(p).isFile()) return p } catch {}
  }
  return null
}

/** Run a tool if it is on PATH: { ran, ok, out, err, why }. Never throws. */
export function runTool (name, args, opts = {}) {
  const exe = findOnPath(name)
  if (!exe) return { ran: false, why: `${name} is not on PATH` }
  const r = spawnSync(exe, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
  if (r.error) return { ran: false, why: `${name}: ${r.error.message}` }
  return { ran: true, ok: r.status === 0, status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }
}

/** `jot "<text>"`: one line in the decision log. */
export const jot = text => runTool('jot', [text])

/** `apps touch <slug>`: mark the registry entry as worked on today. */
export const appsTouch = slug => runTool('apps', ['touch', slug])

/** `apps new <slug> "<Name>"`: create the registry file. */
export const appsNew = (slug, name) => runTool('apps', ['new', slug, name])

/** `wrap <slug> "<message>"`: the end-of-session ritual. Only ever run on `--wrap`. */
export const wrap = (slug, message) => runTool('wrap', [slug, message])

/** gh on PATH, logged in, and this repo has an `origin` remote. */
export function ghAvailable (root) {
  if (!findOnPath('gh')) return { ok: false, why: 'gh is not on PATH' }
  const auth = runTool('gh', ['auth', 'status'], { cwd: root })
  if (!auth.ran || !auth.ok) return { ok: false, why: 'gh is not logged in (`gh auth status` failed)' }
  const remote = runTool('git', ['remote', 'get-url', 'origin'], { cwd: root })
  if (!remote.ran || !remote.ok) return { ok: false, why: 'no origin remote' }
  return { ok: true }
}

/**
 * Close one issue with a comment. Skips, and says so, when the issue is already closed: a second
 * `rig finish` on the same build must not comment twice.
 */
export function ghIssueClose (root, number, comment) {
  const avail = ghAvailable(root)
  if (!avail.ok) return { ran: false, why: avail.why }
  const view = runTool('gh', ['issue', 'view', String(number), '--json', 'state'], { cwd: root })
  if (view.ran && view.ok) {
    let state = null
    try { state = JSON.parse(view.out).state } catch {}
    if (state && state !== 'OPEN') return { ran: false, why: `#${number} is already ${state.toLowerCase()}` }
  }
  const r = runTool('gh', ['issue', 'close', String(number), '--comment', comment], { cwd: root })
  if (!r.ran) return r
  return r.ok ? { ran: true, ok: true } : { ran: true, ok: false, why: r.err || r.out || `gh exited ${r.status}` }
}
