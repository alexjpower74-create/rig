import { execFileSync } from 'node:child_process'

export function run (cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()
}

/** Run and return { ok, out, err } instead of throwing. */
export function tryRun (cmd, args, opts = {}) {
  try { return { ok: true, out: run(cmd, args, opts), err: '' } }
  catch (e) { return { ok: false, out: (e.stdout || '').trim(), err: (e.stderr || e.message || '').trim() } }
}

/** Like run, but preserves leading whitespace. Porcelain output is column-significant:
 *  `git status --porcelain` emits " M path" and trimming shifts every path by one character. */
export function runRaw (cmd, args, opts = {}) {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
    return { ok: true, out: out.replace(/\n$/, ''), err: '' }
  } catch (e) { return { ok: false, out: (e.stdout || '').replace(/\n$/, ''), err: (e.stderr || e.message || '').trim() } }
}

export const git = (args, cwd) => run('git', args, cwd ? { cwd } : {})
export const gitRaw = (args, cwd) => runRaw('git', args, cwd ? { cwd } : {})
export const tryGit = (args, cwd) => tryRun('git', args, cwd ? { cwd } : {})
