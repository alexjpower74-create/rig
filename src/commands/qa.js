import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mainRoot, loadConfig, currentBranch } from '../config.js'
import { ensureDetachedWorktree } from '../worktrees.js'
import { git } from '../sh.js'
import { recordQa } from '../qalog.js'

// Never grade the shared tree. Agents are mid-edit in theirs by definition, so a number taken
// there measures a half-finished checkout. QA gets its own worktree, detached at an exact commit,
// on its own port, so every number you report can be traced to a sha.

export default async function qa (args) {
  const root = mainRoot()
  const cfg = loadConfig(root)
  const ref = resolveRef(args, currentBranch(root))
  const port = Number(argOf(args, '--port') || cfg.qaPort)

  const wt = ensureDetachedWorktree(root, cfg, 'qa', ref)
  const sha = git(['rev-parse', '--short', 'HEAD'], wt.path)
  const subject = git(['log', '-1', '--pretty=%s'], wt.path)

  console.log(`QA worktree pinned to ${ref} @ ${sha}`)
  console.log(`  ${subject}`)
  console.log(`  ${wt.path}`)
  console.log(`  port ${port}`)
  console.log(`\nEvery number you report from here belongs to ${sha}. Say the sha when you report it.`)

  if (args.includes('--run') && !argOf(args, '--run')) {
    console.error('rig qa: --run needs a command, e.g. --run "npm test". Nothing was run.')
    process.exit(2)
  }
  const cmd = argOf(args, '--run') || cfg.devCommand
  if (!cmd) {
    console.log('\nNo dev command configured. Set "devCommand" in .rig/config.json or pass --run "<cmd>".')
    return
  }
  console.log(`\n$ ${cmd}   (PORT=${port})\n`)
  const code = await runShell(cmd, { cwd: wt.path, env: { ...process.env, PORT: String(port), RIG_QA_SHA: sha } })
  recordQa(root, { ref, sha: git(['rev-parse', 'HEAD'], wt.path), short: sha, cmd, exit: code })
  console.log(`\nrig qa: exit ${code} at ${sha}${code === 0 ? '' : '  (NOT green)'}  — recorded in .rig/qa-history.jsonl`)
  process.exit(code)
}

const VALUE_FLAGS = new Set(['--ref', '--branch', '--port', '--run'])

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
    child.on('exit', (code, signal) => resolve(mapExit(code, signal)))
    child.on('error', () => resolve(127))
  })
}

/** bash from /bin, or anywhere on PATH (NixOS and some containers have no /bin/bash). */
function findBash () {
  if (existsSync('/bin/bash')) return '/bin/bash'
  return spawnSync('bash', ['-c', 'exit 0']).status === 0 ? 'bash' : null
}

function argOf (args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
