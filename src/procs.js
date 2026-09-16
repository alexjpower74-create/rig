// Processes running inside a directory.
//
// `rig down` removes worktrees. A dev server started from inside one keeps running after its
// directory is deleted — its working directory becomes "(deleted)" — and it keeps its port. The
// next person to run the project's "open it" command gets a 404 or an address-in-use error from a
// server nobody can see. One night of fifteen crews left one of these holding a demo port and 29
// more from a QA worktree.
//
// The fix must be narrow. The tempting version is `pkill wrangler`, and on a machine running a
// dozen other projects' demos that is how you stop all of them. So this finds only processes whose
// working directory is inside the given directory, and nothing else.

import { readdirSync, readlinkSync, realpathSync } from 'node:fs'
import { sep } from 'node:path'
import { tryRun } from './sh.js'

/** Is `cwd` the directory `dir` or below it? A deleted working directory still counts. */
export function insideDir(cwd, dir) {
  const clean = cwd.replace(/ \(deleted\)$/, '')
  return clean === dir || clean.startsWith(dir.endsWith(sep) ? dir : dir + sep)
}
const inside = insideDir

/**
 * PIDs (other than this process) whose current working directory is `dir` or below it.
 * `dir` is resolved through symlinks first: the kernel reports canonical working directories, so a
 * worktree reached through a symlinked home or /tmp would otherwise match nothing.
 */
export function processesIn(dir, { resolve = true } = {}) {
  if (resolve) {
    try {
      dir = realpathSync(dir)
    } catch {
      /* gone already: compare as given */
    }
  }
  const found = []
  if (process.platform === 'linux') {
    let entries = []
    try {
      entries = readdirSync('/proc')
    } catch {
      return found
    }
    for (const name of entries) {
      if (!/^\d+$/.test(name)) continue
      const pid = Number(name)
      if (pid === process.pid) continue
      let cwd
      try {
        cwd = readlinkSync(`/proc/${pid}/cwd`)
      } catch {
        continue
      } // another user's, or gone
      if (inside(cwd, dir)) found.push(pid)
    }
    return found
  }
  // macOS and other Unixes: lsof reports each process's cwd as an `n` field after its `p` field.
  const r = tryRun('lsof', ['-a', '-d', 'cwd', '-Fpn', '-u', String(process.getuid?.() ?? '')])
  if (!r.ok && !r.out) return found
  let pid = null
  for (const line of r.out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    else if (line.startsWith('n') && pid && pid !== process.pid && inside(line.slice(1), dir)) found.push(pid)
  }
  return found
}

/** SIGTERM each pid; returns the ones that were signalled. */
export function stopProcesses(pids) {
  const stopped = []
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM')
      stopped.push(pid)
    } catch {
      /* already gone */
    }
  }
  return stopped
}
