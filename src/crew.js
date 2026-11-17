// The crew's own record: which terminal each member runs in. `rig up` knows the terminal of every
// slice tab it opens, `rig review --launch` knows its reviewer's, and the lead is whoever ran
// `rig up`. Writing that down here is how `rig tell <name>` finds a member's terminal: by the name
// the crew itself uses (slice id, lead name, `rv-*`), never by matching a tab label against a
// pattern (rule 2026-09-15: two projects both using c1 once collided).
//
// The record is `.rig/crew.json` in the main checkout, so every worktree of the build reads the
// same file: { "members": { "<name>": { "terminal", "tab", "space", "role", "backend", "at" } } }.
// `role` is "lead", "slice" or "reviewer". `backend` is the terminal driver that opened it ("hc",
// "herdr", "tmux"); only an hc terminal can be woken today.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { rigDir } from './rigdir.js'

export const CREW_FILE = 'crew.json'
const ROLES = new Set(['lead', 'slice', 'reviewer'])

export const crewPath = (root) => join(root, '.rig', CREW_FILE)

/** The whole record: { members: { name: entry } }. An absent or unreadable file is an empty crew. */
export function readCrew(root) {
  const p = crewPath(root)
  if (!existsSync(p)) return { members: {} }
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'))
    return { members: j && typeof j.members === 'object' && j.members ? j.members : {} }
  } catch {
    return { members: {} }
  }
}

/**
 * Record (or replace) one member. `terminal` is required (an hc address like t14, a herdr pane
 * id, a tmux target); the rest is optional. Written to a temp name and renamed, so a reader never
 * sees half a file. Returns the stored entry.
 */
export function recordMember(root, name, { terminal, tab = null, space = null, role = 'slice', backend = null } = {}, now = new Date()) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name || '') || name.includes('..')) throw new Error(`"${name}" is not a crew member name`)
  if (!terminal) throw new Error(`no terminal for crew member ${name}`)
  if (!ROLES.has(role)) throw new Error(`crew role must be lead, slice or reviewer, not "${role}"`)
  const dir = rigDir(root)
  const crew = readCrew(root)
  const entry = { terminal: String(terminal), tab, space, role, backend, at: now.toISOString() }
  crew.members[name] = entry
  const tmp = join(dir, `.${CREW_FILE}.${process.pid}.tmp`)
  writeFileSync(tmp, JSON.stringify(crew, null, 2) + '\n')
  renameSync(tmp, crewPath(root))
  return entry
}

/** Forget one member (its tab closed). Returns true when it was there. */
export function forgetMember(root, name) {
  const crew = readCrew(root)
  if (!(name in crew.members)) return false
  delete crew.members[name]
  const dir = rigDir(root)
  const tmp = join(dir, `.${CREW_FILE}.${process.pid}.tmp`)
  writeFileSync(tmp, JSON.stringify(crew, null, 2) + '\n')
  renameSync(tmp, crewPath(root))
  return true
}

/** One member's entry by its exact name, or null. No pattern, no prefix match. */
export function resolveMember(root, name) {
  if (!root || !name) return null
  return readCrew(root).members[name] ?? null
}
