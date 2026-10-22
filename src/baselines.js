// Baselines that know their sha. A snapshot baseline records the commit it was taken from
// (`RECORDED_FROM: <sha>`, written by harness/snapshot.js); when the base has moved past that commit,
// the baseline may describe a page that no longer exists, and a green match against it proves
// nothing new. staleBaselines() finds every baseline and says how far the base moved past each, so
// `rig qa` can warn before the numbers are read.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { currentBranchOrNull, loadConfig } from './config.js'
import { liveBase } from './drift.js'
import { globToRegExp } from './plan.js'
import { tryGit } from './sh.js'

/** Where baselines live when the config names no `snapshotDirs`: any folder with one of these names. */
export const DEFAULT_SNAPSHOT_DIR = /(^|\/)(__snapshots__|snapshots?|baselines?)\//
/** A RECORDED_FROM line within the first few lines, in any comment style (`// RECORDED_FROM: …`, `# …`). */
const RECORDED = /RECORDED_FROM:\s*([0-9a-f]{7,64})\b/
const HEAD_LINES = 5

/**
 * Snapshot baselines whose RECORDED_FROM sha the base has moved past.
 *
 * Baselines are the tracked files under `dirs` (else `snapshotDirs` in the config, each a folder or a
 * glob; else any `__snapshots__`, `snapshot(s)` or `baseline(s)` folder, plus `*.snap` files) whose
 * first lines carry RECORDED_FROM. `behind` is the number of commits on `base` since that sha that
 * changed more than baselines (committing a fresh baseline does not make it stale); a sha
 * this clone does not have (recorded on a branch since rewritten) is reported with `behind: null`
 * and `unknown: true`, since nothing can say how stale it is. When `base` does not resolve here
 * (no origin), the live base of the current branch is used instead.
 *
 * @returns {{ file: string, recordedFrom: string, behind: number }[]}
 */
export function staleBaselines(root, { base = 'origin/main', dirs } = {}) {
  const at = resolveBase(root, base)
  if (!at) return []
  const want = dirs ?? loadConfig(root).snapshotDirs ?? null
  const files = baselineFiles(root, want)
  const tracked = new Set(files)
  const isBaseline = (f) => tracked.has(f) || (!want && (DEFAULT_SNAPSHOT_DIR.test(f) || f.endsWith('.snap')))
  const out = []
  for (const file of files) {
    const recordedFrom = recordedFromOf(join(root, file))
    if (!recordedFrom) continue
    const known = tryGit(['rev-parse', '--verify', '-q', `${recordedFrom}^{commit}`], root)
    if (!known.ok) {
      out.push({ file, recordedFrom, behind: null, unknown: true })
      continue
    }
    const behind = movedSince(root, known.out, at, isBaseline)
    if (behind > 0) out.push({ file, recordedFrom, behind })
  }
  return out.sort((a, b) => (b.behind ?? Number.POSITIVE_INFINITY) - (a.behind ?? Number.POSITIVE_INFINITY) || a.file.localeCompare(b.file))
}

/** One line per stale baseline, for `rig qa` to print. Empty when none is stale. */
export function formatStale(stale, { base = 'the base', max = 6 } = {}) {
  if (!stale.length) return []
  const lines = [`${stale.length} snapshot baseline(s) recorded before ${base} moved on: re-record them or say why not`]
  for (const s of stale.slice(0, max))
    lines.push(
      `  ${s.file}  ${s.unknown ? `recorded from ${s.recordedFrom.slice(0, 9)}, a commit this clone does not have` : `${s.behind} commit(s) behind (from ${s.recordedFrom.slice(0, 9)})`}`,
    )
  if (stale.length > max) lines.push(`  …+${stale.length - max} more`)
  return lines
}

/**
 * Commits on `to` since `from` that changed something other than baselines. Recording a baseline
 * and committing it is not the base moving: counted plainly, every baseline read "1 behind" the
 * moment it was committed.
 */
function movedSince(root, from, to, isBaseline) {
  const r = tryGit(['log', '--format=%x00%H', '--name-only', '--no-renames', `${from}..${to}`], root)
  if (!r.ok || !r.out) return 0
  return r.out
    .split('\0')
    .filter(Boolean)
    .filter((block) => {
      const files = block.split('\n').slice(1).filter(Boolean)
      return files.length === 0 || files.some((f) => !isBaseline(f))
    }).length
}

function resolveBase(root, base) {
  const r = tryGit(['rev-parse', '--verify', '-q', `${base}^{commit}`], root)
  if (r.ok && r.out) return r.out
  const branch = currentBranchOrNull(root)
  if (!branch) return null
  const live = tryGit(['rev-parse', '--verify', '-q', `${liveBase(root, branch)}^{commit}`], root)
  return live.ok && live.out ? live.out : null
}

function baselineFiles(root, dirs) {
  const ls = tryGit(['ls-files', '-z'], root)
  const files = ls.ok ? ls.out.split('\0').filter(Boolean) : []
  if (!dirs) return files.filter((f) => DEFAULT_SNAPSHOT_DIR.test(f) || f.endsWith('.snap'))
  const list = Array.isArray(dirs) ? dirs : [dirs]
  const res = list.map((d) => (/[*?]/.test(d) ? globToRegExp(d) : globToRegExp(`${d.replace(/\/+$/, '')}/**`)))
  return files.filter((f) => res.some((re) => re.test(f)))
}

function recordedFromOf(path) {
  if (!existsSync(path)) return null
  let head
  try {
    head = readFileSync(path, 'utf8').slice(0, 4096).split('\n').slice(0, HEAD_LINES).join('\n')
  } catch {
    return null
  }
  return head.match(RECORDED)?.[1] ?? null
}
