import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { mainRoot, loadConfig, currentBranch } from '../config.js'
import { acquireQaWorktree, porcelainLines } from '../worktrees.js'
import { loadPlan } from '../plan.js'
import { git } from '../sh.js'
import { recordQa } from '../qalog.js'

// Never grade the shared tree. Agents are mid-edit in theirs by definition, so a number taken
// there measures a half-finished checkout. QA gets its own worktree, detached at an exact commit,
// on its own port, so every number you report can be traced to a sha.
//
// And `rig qa` never refuses. A QA worktree holds nobody's work, so it is reset and cleaned before
// every pin, and each run takes a worktree no other run is using. What the clean touched, and what
// the tests left behind, is printed by path and recorded: a tree that is not clean right after
// `npm test` is a defect, and `rig finish` will say so.

export const USAGE = `rig qa [<ref>] [--run "<cmd>"] [--negative "<cmd>"] [--port <n>] [--fresh]

  <ref>              the commit to pin (a sha, a branch, a tag); defaults to the current branch of
                     the MAIN checkout. Give the sha: "rig qa" alone grades main, not your slice.
  --run "<cmd>"      the test command (default: devCommand in .rig/config.json); recorded as kind
                     "test". rig qa exits with the first non-zero of the test run, then the negative
  --negative "<cmd>" the negative-control command (default: negativeCommand in the config or the
                     plan's "Negative controls:" line); recorded as kind "negative" on the same sha
  --port <n>         PORT for the command (default: qaPort, +1 per extra QA worktree in use)
  --fresh            clean ignored files too (git clean -fdx): node_modules is reinstalled
  --help, -h         this text

The worktree is <worktreeDir>/qa when free, else qa-2, qa-3…; a run holds it with <worktreeDir>/<id>.lock.
Tracked files the clean reset and files the run dirtied are printed by path and recorded in
.rig/qa-history.jsonl, which \`rig finish\` reads.
`

export default async function qa (args) {
  if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); return }
  for (const flag of ['--run', '--negative']) {
    if (args.includes(flag) && !argOf(args, flag)) {
      console.error(`rig qa: ${flag} needs a command, e.g. ${flag} "npm test". Nothing was run.`)
      process.exit(2)
    }
  }
  const root = mainRoot()
  const cfg = loadConfig(root)
  const ref = resolveRef(args, currentBranch(root))
  const fresh = args.includes('--fresh')

  const wt = acquireQaWorktree(root, cfg, ref, { fresh })
  const port = Number(argOf(args, '--port') || (Number(cfg.qaPort) + wt.index))
  holdLock(wt)
  const full = git(['rev-parse', 'HEAD'], wt.path)
  const sha = git(['rev-parse', '--short', 'HEAD'], wt.path)
  const subject = git(['log', '-1', '--pretty=%s'], wt.path)

  for (const n of wt.notes) console.log(`note: ${n}`)
  console.log(`QA worktree ${wt.id} pinned to ${ref} @ ${sha}`)
  console.log(`  ${subject}`)
  console.log(`  ${wt.path}`)
  console.log(`  port ${port}`)
  if (wt.reset.length) console.log(`  reset ${wt.reset.length} tracked file${wt.reset.length === 1 ? '' : 's'}: ${wt.reset.join(', ')} (a test wrote it)`)
  if (wt.removed.length) console.log(`  removed ${wt.removed.length} untracked path${wt.removed.length === 1 ? '' : 's'}: ${wt.removed.join(', ')}${fresh ? ' (--fresh: ignored files too)' : ''}`)
  console.log(`\nEvery number you report from here belongs to ${sha}. Say the sha when you report it.`)

  const cmd = argOf(args, '--run') || cfg.devCommand
  const negative = argOf(args, '--negative') || cfg.negativeCommand || planNegative(root, cfg)
  if (!cmd && !negative) {
    console.log('\nNo dev command configured. Set "devCommand" in .rig/config.json or pass --run "<cmd>".')
    return
  }

  const env = { ...process.env, PORT: String(port), RIG_QA_SHA: sha }
  let exit = 0
  const seen = new Set()
  const runs = [['test', cmd], ['negative', negative]].filter(([, c]) => c)
  for (const [kind, c] of runs) {
    console.log(`\n$ ${c}   (PORT=${port}${kind === 'negative' ? ', negative control' : ''})\n`)
    const code = await runShell(c, { cwd: wt.path, env })
    const left = dirtiedBy(wt.path)
    const dirtied = left.tracked.filter(p => !seen.has(p))
    const untracked = left.untracked.filter(p => !seen.has(p))
    ;[...dirtied, ...untracked].forEach(p => seen.add(p))
    recordQa(root, { kind, ref, sha: full, short: sha, cmd: c, exit: code, dirtied, untracked, worktree: wt.id })
    console.log(`\nrig qa: ${kind} exit ${code} at ${sha}${code === 0 ? '' : '  (NOT green)'}  — recorded in .rig/qa-history.jsonl`)
    if (dirtied.length || untracked.length) console.log(dirtyMessage(dirtied, untracked))
    if (exit === 0) exit = code
  }
  process.exit(exit)
}

/**
 * What a run left behind, by path: `tracked` files it modified or deleted and `untracked` files
 * it created. The lock and the run's own `.rig/` are not the tests' doing.
 */
export function dirtiedBy (path) {
  const lines = porcelainLines(path).filter(l => !l.slice(3).startsWith('.rig/'))
  const pathOf = l => { const p = l.slice(3); return p.includes(' -> ') ? p.split(' -> ')[1] : p }
  return {
    tracked: lines.filter(l => !l.startsWith('??')).map(pathOf),
    untracked: lines.filter(l => l.startsWith('??')).map(pathOf)
  }
}

export function dirtyMessage (tracked, untracked = []) {
  const n = (k, w) => `${k.length} ${w}${k.length === 1 ? '' : 's'}`
  const parts = []
  if (tracked.length) parts.push(`dirtied ${n(tracked, 'tracked file')}: ${tracked.join(', ')}`)
  if (untracked.length) parts.push(`left ${n(untracked, 'untracked file')}: ${untracked.join(', ')}`)
  return `the tests ${parts.join(' and ')} — untrack it (git rm --cached) or have the test restore it; check-no-personal-data and \`rig finish\` see a dirty tree`
}

/** The plan's negative-control command, if rg2's parser found one; null without a plan. */
function planNegative (root, cfg) {
  try { return loadPlan(join(root, cfg.plan)).negativeCommand || null } catch { return null }
}

/**
 * Release the run lock however this process ends: normal exit, ctrl-c, or a kill.
 *
 * A signal is passed on to the command still running in the worktree, and the lock is released only
 * once that child has exited. Releasing first said "free" while `npm test` was still writing into
 * the tree, and the next `rig qa` reset and re-pinned it under the running suite: the one thing the
 * lock exists to stop. The child is ours, running in the worktree we hold, so stopping it keeps the
 * rule that a process is only ever stopped by the working directory it is in.
 */
function holdLock (wt) {
  process.on('exit', wt.release)
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    process.on(sig, () => {
      const child = running
      if (!child || child.exitCode !== null || child.signalCode !== null) { wt.release(); process.exit(code) }
      child.once('exit', () => { wt.release(); process.exit(code) })
      child.kill(sig)
      setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 5000).unref()
    })
  }
}

/** The command currently running in the QA worktree, so a signal can reach it. */
let running = null

const VALUE_FLAGS = new Set(['--ref', '--branch', '--port', '--run', '--negative'])

/**
 * The commit to pin. `--ref` and `--branch` win; otherwise the first bare argument; otherwise the
 * current branch.
 *
 * The bare argument used to be ignored. `rig qa 3f2a1b9` pinned the worktree to the current branch
 * instead, printed that branch's sha, and exited cleanly — so every lead following a rulebook that
 * said "rig qa <sha>" graded main while believing it had graded the slice. It was right only when
 * main happened to be at that sha.
 */
export function resolveRef (args, fallback) {
  const flagged = argOf(args, '--ref') || argOf(args, '--branch')
  if (flagged) return flagged
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i])) { i++; continue }
    if (!args[i].startsWith('-')) return args[i]
  }
  return fallback
}

/**
 * The exit status to report for a finished command.
 *
 * Node gives `code === null` when the child was killed by a signal. `code ?? 0` turned that into
 * success: an out-of-memory kill or a timeout in the middle of a test run read as a green QA.
 * Shells report a signal death as 128 + the signal number, so do the same.
 */
const SIGNALS = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGSEGV: 11, SIGPIPE: 13, SIGALRM: 14, SIGTERM: 15 }
export function exitCodeFor (code, signal) {
  if (code !== null && code !== undefined) return code
  if (signal) return 128 + (SIGNALS[signal] ?? 0)
  return 1
}

/**
 * Run a command line and resolve with its exit status. Uses bash with `pipefail` when bash exists,
 * so `npm test | tail -20` fails when the tests fail instead of reporting tail's success — the
 * other way a red QA run came back 0.
 */
export function runShell (cmd, { cwd, env, shell, mapExit = exitCodeFor } = {}) {
  const bash = shell ?? findBash()
  if (!bash) console.error('rig qa: bash not found — running under sh without pipefail; a failure inside a pipe can read as exit 0.')
  const [file, argv] = bash
    ? [bash, bash.endsWith('bash') ? ['-o', 'pipefail', '-c', cmd] : ['-c', cmd]]
    : ['/bin/sh', ['-c', cmd]]
  return new Promise(resolve => {
    const child = spawn(file, argv, { cwd, env, stdio: 'inherit' })
    running = child
    child.on('exit', (code, signal) => { running = null; resolve(mapExit(code, signal)) })
    child.on('error', () => resolve(127))
  })
}

/** bash from /bin, or anywhere on PATH (NixOS and some containers have no /bin/bash). */
function findBash () {
  if (existsSync('/bin/bash')) return '/bin/bash'
  return spawnSync('bash', ['-c', 'exit 0']).status === 0 ? 'bash' : null
}

function argOf (args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
