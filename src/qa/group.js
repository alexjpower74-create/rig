// The process group a QA command runs in, and how to stop all of it.
//
// Moved out of src/commands/qa.js so the stall watchdog (src/qa/watch.js) stops a stalled run the
// same way a timeout or a ctrl-c does. `groups` is still re-exported from qa.js, and it is one
// object, so a test that swaps `groups.left` changes what every caller uses.

import { existsSync, readdirSync, readFileSync } from 'node:fs'

/** Commands currently running in a QA worktree, so a signal to rig qa can reach each of them. */
export const running = new Set()

/**
 * The processes still in the group led by `pgid`, as [pid, state], zombies left out: a zombie has
 * finished and only waits for its parent's wait(). Under PID 1 (a container started as `node
 * bin/rig.js qa …` without an init) the orphans of the group are reparented to rig qa itself, which
 * never reaps what it did not spawn, so kill(-pgid, 0) kept answering "alive" for ever: the
 * three-hour hang again, in the shape CI uses (fv2's verification of c238a03). On Linux this reads
 * /proc; elsewhere it falls back to kill(-pgid, 0), and the ceiling in stop() bounds the wait.
 */
function groupLeft(pgid) {
  if (process.platform === 'linux' && existsSync('/proc/self/stat')) {
    const left = []
    for (const d of readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue
      try {
        const stat = readFileSync(`/proc/${d}/stat`, 'utf8')
        // "pid (comm) state ppid pgrp …": comm may hold spaces and parentheses, so split after the last ")".
        const [state, , pgrp] = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
        if (Number(pgrp) === pgid && state !== 'Z' && state !== 'X') left.push([Number(d), state])
      } catch {}
    }
    return left
  }
  try {
    process.kill(-pgid, 0)
    return [[pgid, '?']]
  } catch (e) {
    return e.code === 'EPERM' ? [[pgid, '?']] : []
  }
}

/**
 * Stop everything in the child's process group: `sig` now, SIGKILL after `graceMs`, and resolve once
 * none of it is left, or at the latest `graceMs` + 5 s, naming whatever is still listed.
 *
 * bash dies on SIGTERM, but a command behind a pipe that ignores SIGTERM (`node x | cat`, the shape of
 * `npm test | tail`) lives on. Resolving on bash's exit released the lock with that command still
 * running in the worktree, and the SIGKILL meant for it was on an unref'd timer that never fired
 * because rig qa exited first. Found by fv2's review of 8ac8712. Exported so a test can put the old
 * behaviour back.
 */
export const groups = {
  left: groupLeft,
  stop(child, sig, graceMs = 5000) {
    if (process.platform === 'win32') {
      try {
        child.kill(sig)
      } catch {}
      return child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise((r) => child.once('exit', r))
    }
    signalGroup(child, sig)
    return new Promise((resolve) => {
      const started = Date.now()
      const kill = setTimeout(() => signalGroup(child, 'SIGKILL'), graceMs)
      const poll = setInterval(() => {
        const left = groups.left(child.pid)
        const out = Date.now() - started >= graceMs + 5000
        if (left.length && !out) return
        if (left.length)
          console.error(
            `rig qa: still listed in the command's group after SIGKILL, not waited on any longer: ${left.map(([p, st]) => `${p} (${st})`).join(', ')}`,
          )
        clearTimeout(kill)
        clearInterval(poll)
        resolve()
      }, 100)
    })
  },
}

/** Signal the child's process group (it is spawned as a group leader); fall back to the pid. */
function signalGroup(child, sig) {
  try {
    process.kill(-child.pid, sig)
  } catch {
    try {
      child.kill(sig)
    } catch {}
  }
}
