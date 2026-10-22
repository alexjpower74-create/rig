// Measured time. Every estimate the lead gives a person has to be computed from stage times this
// machine recorded, never guessed: "about twenty minutes" said from memory is how a lead ends up
// being the human's alarm clock, checking back on a wait nobody could size.
//
// `rig qa`, `rig fold` and `rig review` append one line per stage to .rig/timings.jsonl (through
// rigDir, so git ignores it). `rig status --eta` asks estimate() for the median of past runs per
// stage, and a stage with no runs says "no data" instead of borrowing a number from somewhere.

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { rigDir } from './rigdir.js'

const FILE = 'timings.jsonl'

/** Append one stage's wall time to .rig/timings.jsonl (through rigDir). stage: 'qa:test', 'qa:negative', 'qa:ci', 'qa:host', 'fold', 'review', … */
export function recordTiming(root, { stage, ms, sha = null, host = 'local', ok = true } = {}) {
  if (typeof stage !== 'string' || !stage) throw new TypeError('recordTiming: stage must be a non-empty string')
  if (!Number.isFinite(ms) || ms < 0) throw new TypeError(`recordTiming: ms must be a finite number ≥ 0, got ${ms}`)
  const rec = { at: new Date().toISOString(), stage, ms: Math.round(ms), sha, host, ok: ok !== false }
  appendFileSync(join(rigDir(root), FILE), `${JSON.stringify(rec)}\n`)
  return rec
}

/** Every recorded timing, oldest first. */
export function readTimings(root) {
  const p = join(root, '.rig', FILE)
  if (!existsSync(p)) return []
  const out = []
  // A line cut short by a crash mid-append is skipped, not fatal: one torn write must not take the
  // whole record (and every estimate) down with it.
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line)
      if (r && typeof r.stage === 'string' && Number.isFinite(r.ms)) out.push(r)
    } catch {
      /* torn line */
    }
  }
  return out
}

/** The median of a list of numbers; the mean of the middle two for an even count. */
export function median(xs) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * The estimate `rig status --eta` prints: the median of past runs per stage.
 * @returns {{ stages: {stage: string, medianMs: number|null, n: number}[], totalMs: number|null, note: string|null }}
 *   totalMs is null, and note says so, when a stage has no data.
 *
 * Only runs that finished (ok) count: a run killed at its first failure says nothing about how long
 * a green one takes. `host` narrows to one machine ('local' or an ssh host); omitted, all count.
 * With no `stages`, every stage that has a record is estimated, in the order first seen.
 */
export function estimate(root, stages = [], { host } = {}) {
  const runs = readTimings(root).filter((r) => r.ok !== false && (host === undefined || r.host === host))
  const wanted = stages.length ? stages : [...new Set(runs.map((r) => r.stage))]
  if (!wanted.length) return { stages: [], totalMs: null, note: 'no timings recorded yet' }
  const rows = wanted.map((stage) => {
    const ms = runs.filter((r) => r.stage === stage).map((r) => r.ms)
    return { stage, medianMs: median(ms), n: ms.length }
  })
  const missing = rows.filter((r) => r.medianMs === null).map((r) => r.stage)
  if (missing.length) return { stages: rows, totalMs: null, note: `no data for ${missing.join(', ')}` }
  return { stages: rows, totalMs: rows.reduce((t, r) => t + r.medianMs, 0), note: null }
}
