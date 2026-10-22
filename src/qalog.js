// The QA record: every `rig qa --run` appends what it ran, on which commit, and how it exited.
//
// "Done" is a claim about a commit. Without a record, the only evidence that the finished code
// passed is someone's memory of a scrollback — and on a long night that memory attaches green to
// the wrong sha. `rig finish` reads this file and refuses to call a build done unless the tests ran,
// and exited 0, on the commit being called done.

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { rigDir } from './rigdir.js'

export const qaLogPath = (root) => join(root, '.rig', 'qa-history.jsonl')

export function recordQa(root, entry) {
  rigDir(root)
  appendFileSync(qaLogPath(root), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n')
}

export function readQa(root) {
  const p = qaLogPath(root)
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

/**
 * The newest run of this `kind` on exactly this commit (full sha), on this `host`, or null. Entries
 * written before kinds existed are test runs; entries written before hosts existed ran here
 * ('local'). A green run on any other sha does not count: formatting moves the strings a
 * source-patching control anchors on, the sha changes, and so must the record. Nor does a run on
 * another machine: the second machine's pass is its own fact, asked for by its host name.
 */
export function lastQaOn(root, sha, kind = 'test', { host = 'local' } = {}) {
  return (
    readQa(root)
      .filter((e) => e.sha === sha && (e.kind || 'test') === kind && (e.host || 'local') === host)
      .pop() || null
  )
}

/** The newest baseline comparison recorded for this commit, or null. */
export const lastBaselineOn = (root, sha) => lastQaOn(root, sha, 'baseline')

/** The newest negative-control run on this commit, or null. */
export const lastNegativeOn = (root, sha) => lastQaOn(root, sha, 'negative')
