// Run a QA command and watch it: a hard limit, and a stall watchdog that looks at output, not at
// whether a process is alive.
//
// A hung suite is alive. On 2026-10-16 one sat silent for three hours with every process present
// and accounted for; later runs went unnoticed for 20 to 100 minutes. What a hung run stops doing is
// writing. So the watchdog measures growth: the command's own output, and each per-worker log when
// the repo names them (`qaWorkerLogs`, a glob). When nothing has grown for the window it names the
// worker and the last spec it mentioned, stops the whole process group and says both. A run that
// keeps writing is never stopped by it, however long it takes: that is what --timeout is for.
//
// Output still reaches the terminal as it arrives. It is also kept, line by line with the time it
// came, because the failure names and the needs-a-stub check are read from it.

import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, openSync, readdirSync, readlinkSync, readSync, realpathSync, statSync, writeSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { lastSpecIn } from './failures.js'
import { groups, running } from './group.js'

/**
 * The exit status to report for a finished command.
 *
 * Node gives `code === null` when the child was killed by a signal. `code ?? 0` turned that into
 * success: an out-of-memory kill or a timeout in the middle of a test run read as a green QA.
 * Shells report a signal death as 128 + the signal number, so do the same.
 */
const SIGNALS = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGSEGV: 11, SIGPIPE: 13, SIGALRM: 14, SIGTERM: 15 }
export function exitCodeFor(code, signal) {
  if (code !== null && code !== undefined) return code
  if (signal) return 128 + (SIGNALS[signal] ?? 0)
  return 1
}

/** bash from /bin, or anywhere on PATH (NixOS and some containers have no /bin/bash). */
export function findBash() {
  if (existsSync('/bin/bash')) return '/bin/bash'
  return spawnSync('bash', ['-c', 'exit 0']).status === 0 ? 'bash' : null
}

export const fmtMs = (ms) =>
  ms >= 60_000 ? `${+(ms / 60_000).toFixed(ms % 60_000 ? 1 : 0)} min` : ms >= 1000 ? `${+(ms / 1000).toFixed(1)} s` : `${ms} ms`

const TAIL = 16 * 1024

/**
 * Run `cmd` under bash -o pipefail in its own process group, echo its output live, and resolve with
 * what happened:
 *   { exit, ms, stalled: { worker, spec, quietMs } | null, timedOut, lines: [{ t, text }], text }
 *
 * `limitMs` stops a command still running past it (exit 124, as GNU timeout). `stallMs` stops one
 * that has written nothing anywhere for that long (exit 124, and `stalled` says who). `workerLogs`
 * is a glob relative to `cwd`. `log` is a file descriptor every byte is also written to. `echo:
 * false` keeps the output off the terminal (still kept and logged); `prefix` marks each echoed line.
 */
export function runWatched(
  cmd,
  {
    cwd,
    env,
    shell,
    mapExit = exitCodeFor,
    limitMs = 0,
    stallMs = 0,
    workerLogs = null,
    log = null,
    echo = true,
    prefix = '',
    pollMs,
  } = {},
) {
  const bash = shell ?? findBash()
  if (!bash) console.error('rig qa: bash not found — running under sh without pipefail; a failure inside a pipe can read as exit 0.')
  const [file, argv] = bash ? [bash, bash.endsWith('bash') ? ['-o', 'pipefail', '-c', cmd] : ['-c', cmd]] : ['/bin/sh', ['-c', cmd]]
  const started = Date.now()
  return new Promise((resolve) => {
    // Its own process group, so a signal can reach everything the command started, not just bash.
    // stdin is closed: a QA run has nobody to answer a prompt, and a spec waiting on one is a hang.
    const child = spawn(file, argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
    running.add(child)
    const lines = []
    const main = { name: 'output', last: started, tail: '' }
    const partial = { stdout: '', stderr: '' }
    const onData = (stream) => (chunk) => {
      const now = Date.now()
      main.last = now
      if (log !== null)
        try {
          writeSync(log, chunk)
        } catch {}
      const text = chunk.toString('utf8')
      if (echo) {
        const out = stream === 'stdout' ? process.stdout : process.stderr
        out.write(prefix ? text.replace(/(^|\n)(?=.)/g, `$1${prefix}`) : text)
      }
      main.tail = (main.tail + text).slice(-TAIL)
      const parts = (partial[stream] + text).split('\n')
      partial[stream] = parts.pop()
      for (const p of parts) lines.push({ t: now, text: p })
    }
    child.stdout.on('data', onData('stdout'))
    child.stderr.on('data', onData('stderr'))

    let stopped = null
    let stalled = null
    let timedOut = false
    const limit =
      limitMs > 0 &&
      setTimeout(() => {
        timedOut = true
        console.error(`\n${prefix}rig qa: still running after ${fmtMs(limitMs)}; stopping it (exit 124). Raise it with --timeout <min>.`)
        stopped ??= groups.stop(child, 'SIGTERM')
      }, limitMs)

    const workers = new Map()
    const poll =
      stallMs > 0 &&
      setInterval(
        () => {
          if (stopped) return
          const now = Date.now()
          if (workerLogs) scanWorkers(cwd, workerLogs, workers, now)
          const lastAny = Math.max(main.last, ...[...workers.values()].map((w) => w.last))
          if (now - lastAny < stallMs) return
          const who = blame(child, main, workers)
          stalled = { worker: who.name, spec: lastSpecIn(who.tail) ?? lastSpecIn(main.tail), quietMs: now - who.last }
          console.error(
            `\n${prefix}rig qa: STALLED — nothing written for ${fmtMs(now - lastAny)} (window ${fmtMs(stallMs)}). ` +
              `Worker: ${stalled.worker}; last spec: ${stalled.spec ?? 'none named'}. Stopping the run (exit 124). ` +
              `The window is --stall <min> or qaStallMinutes.`,
          )
          stopped = groups.stop(child, 'SIGTERM')
        },
        pollMs ?? Math.max(50, Math.min(1000, Math.floor(stallMs / 10))),
      )

    let done = false
    const finish = (exit) => {
      if (done) return
      done = true
      clearTimeout(limit)
      clearInterval(poll)
      running.delete(child)
      for (const s of ['stdout', 'stderr']) if (partial[s]) lines.push({ t: Date.now(), text: partial[s] })
      resolve({ exit, ms: Date.now() - started, stalled, timedOut, lines, text: lines.map((l) => l.text).join('\n') })
    }
    child.on('exit', (code, signal) => {
      const settle = (exit) => {
        // Let the pipes drain; a daemon the command left behind may hold them open, so not for ever.
        const pipes = [child.stdout, child.stderr].filter((p) => !p.closed)
        let open = pipes.length
        if (!open) return finish(exit)
        const drained = setTimeout(() => {
          for (const p of pipes) p.destroy()
          finish(exit)
        }, 500)
        for (const p of pipes)
          p.once('close', () => {
            if (--open > 0) return
            clearTimeout(drained)
            finish(exit)
          })
      }
      clearInterval(poll)
      if (!stopped) return settle(mapExit(code, signal))
      // bash is gone; the command behind it may not be. 124 only once the whole group is.
      stopped.then(() => settle(124))
    })
    child.on('error', () => finish(127))
  })
}

/**
 * Who to name for a stall. With worker logs: a log a process in the group still has open (Linux),
 * else any log that grew during the run; of those, the one quiet longest, because the worker that
 * hung stopped first and the others wrote on until they ran out of work. Without: the output itself.
 */
function blame(child, main, workers) {
  const grew = [...workers.values()].filter((w) => w.grew)
  if (!grew.length) return main
  const open = openFiles(child)
  const held = grew.filter((w) => open.has(w.real))
  const pool = held.length ? held : grew
  return pool.reduce((a, b) => (b.last < a.last ? b : a))
}

/** Real paths of files the command's process group has open, on Linux; an empty set elsewhere. */
function openFiles(child) {
  const out = new Set()
  if (process.platform !== 'linux') return out
  for (const [pid] of groups.left(child.pid)) {
    try {
      for (const fd of readdirSync(`/proc/${pid}/fd`))
        try {
          out.add(readlinkSync(`/proc/${pid}/fd/${fd}`))
        } catch {}
    } catch {}
  }
  return out
}

/** Find the files matching `glob` under `cwd` and note which grew since the last look. */
function scanWorkers(cwd, glob, workers, now) {
  for (const path of globFiles(cwd, glob)) {
    let size
    try {
      size = statSync(path).size
    } catch {
      continue
    }
    let w = workers.get(path)
    if (!w) {
      let real = path
      try {
        real = realpathSync(path)
      } catch {}
      // A log already there when the run began is not progress; one that appears is.
      w = { name: relative(cwd, path), real, size: 0, last: now, tail: '', grew: false }
      workers.set(path, w)
    }
    if (size > w.size) {
      w.tail = (w.tail + readRange(path, Math.max(w.size, size - TAIL), size)).slice(-TAIL)
      w.size = size
      w.last = now
      w.grew = true
    } else if (size < w.size) w.size = size // truncated: start again from here
  }
}

function readRange(path, from, to) {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(to - from)
    const n = readSync(fd, buf, 0, buf.length, from)
    return buf.subarray(0, n).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/** A glob as a regex over '/'-separated relative paths: `**` any depth, `*` and `?` within a name. */
export function globToRe(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      i++
      if (glob[i + 1] === '/') {
        i++
        re += '(?:.*/)?'
      } else re += '.*'
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

/** Files under `cwd` matching `glob`, walking only below its fixed leading directories. */
export function globFiles(cwd, glob) {
  const segs = glob.split('/')
  const fixed = []
  while (segs.length > 1 && !/[*?]/.test(segs[0])) fixed.push(segs.shift())
  const re = globToRe(glob)
  const out = []
  const walk = (dir, depth) => {
    let ents
    try {
      ents = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      const p = join(dir, e.name)
      if (e.isDirectory()) depth < 12 && walk(p, depth + 1)
      else if (re.test(relative(cwd, p).split(sep).join('/'))) out.push(p)
    }
  }
  walk(join(cwd, ...fixed), 0)
  return out
}
