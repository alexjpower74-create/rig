// The QA record: every `rig qa --run` appends what it ran, on which commit, and how it exited.
//
// "Done" is a claim about a commit. Without a record, the only evidence that the finished code
// passed is someone's memory of a scrollback — and on a long night that memory attaches green to
// the wrong sha. `rig finish` reads this file and refuses to call a build done unless the tests ran,
// and exited 0, on the commit being called done.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const qaLogPath = root => join(root, '.rig', 'qa-history.jsonl')

export function recordQa (root, entry) {
  mkdirSync(join(root, '.rig'), { recursive: true })
  appendFileSync(qaLogPath(root), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n')
}

export function readQa (root) {
  const p = qaLogPath(root)
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

/** The newest QA run on exactly this commit (full sha), or null. */
export function lastQaOn (root, sha) {
  return readQa(root).filter(e => e.sha === sha).pop() || null
}
