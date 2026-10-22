import { join } from 'node:path'
import { loadConfig, mainRoot, repoRoot } from '../config.js'
import { loadPlan } from '../plan.js'
import { tryGit } from '../sh.js'
import { fold, stampFold } from '../fold.js'
import { printDrift, liveBaseOf } from './finish.js'
import { recordTiming } from '../timings.js'

export const USAGE = `rig fold [--base <ref>] [--fix <sha>[=<owner>]]... [--each "<cmd>"] [--no-each] [--no-fetch]

  --base <ref>        what the stack sits on (default: the configured base, else main); the fold
                      rewrites only the commits since the merge base and never pulls the base in
  --fix <sha>         fold a commit whose subject is not fixup!/squash! too; its owner is the newest
                      earlier commit touching the same files, or the one named after "="
  --each "<cmd>"      run in a scratch worktree on every folded commit (default: the config's
                      testCommand, else devCommand); --no-each skips the walk
  --timeout <min>     per-commit limit for the walk (default 20)
  --no-fetch          print drift without fetching the live base

Drift is printed first. The folded tip's tree must equal the old tip's, or the branch is put back
and the fold refused (exit 1). New shas are stamped old → new in .rig/fold.json. Exit 1 also when a
walked commit fails (the fold stays: its tree is identical); 2 for a usage error.`

const VALUE_FLAGS = new Set(['--base', '--fix', '--each', '--timeout'])

/**
 * What the stack sits on when --base is not given: the config's base; on the base branch itself (the
 * lead folding the merged round), its upstream; else main, else master.
 */
export function defaultBase(cwd, cfg = {}) {
  if (cfg.base) return cfg.base
  const has = (ref) => tryGit(['rev-parse', '--verify', '-q', ref], cwd).ok
  const cur = tryGit(['symbolic-ref', '--short', '-q', 'HEAD'], cwd).out
  const trunk = has('refs/heads/main') ? 'main' : 'master'
  if (cur === trunk) {
    const up = tryGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], cwd)
    if (up.ok && up.out) return up.out
  }
  return trunk
}

export default function foldCommand(args) {
  if (args.includes('--help') || args.includes('-h')) return console.log(USAGE)
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i]) && (args[i + 1] == null || args[i + 1].startsWith('--'))) {
      console.error(`rig fold: ${args[i]} needs a value. Nothing was folded.`)
      process.exitCode = 2
      return
    }
    if (VALUE_FLAGS.has(args[i])) i++
  }
  const cwd = repoRoot()
  const root = mainRoot()
  const cfg = loadConfig(root)
  const all = (name) => args.flatMap((a, i) => (a === name && args[i + 1] != null ? [args[i + 1]] : []))
  const one = (name) => all(name)[0] ?? null
  const base = one('--base') || defaultBase(cwd, cfg)
  const each = args.includes('--no-each') ? null : one('--each') || cfg.testCommand || cfg.devCommand || null
  const minutes = Number(one('--timeout') || 20)

  let plan = null
  try {
    plan = loadPlan(join(root, cfg.plan))
  } catch {
    plan = null
  }
  // Drift first: a fold is the start of the final round, and a base that moved means rebuild before it.
  printDrift(root, { base: liveBaseOf(root, cfg, base), slices: plan?.agents || [], fetch: !args.includes('--no-fetch') })

  const t0 = Date.now()
  const r = fold(cwd, { base, fixes: all('--fix'), each, timeoutMs: minutes * 60_000, root, cfg })
  if (r.state === 'refused') {
    console.error(`\x1b[31mrig fold: refused.\x1b[0m ${r.why}`)
    process.exitCode = 1
    return r
  }
  if (r.state === 'nothing') {
    console.log(`nothing to fold: no fixup!/squash! commits (or --fix) on ${base.replace(/^refs\/heads\//, '')}..HEAD`)
    return r
  }
  const stamp = stampFold(root, r)
  recordTiming(root, { stage: 'fold', ms: Date.now() - t0, sha: r.newTip, ok: r.walk.every((w) => w.exit === 0) })

  console.log(`folded ${r.oldTip.slice(0, 7)} → ${r.newTip.slice(0, 7)} on ${r.branch}; tree identical (${r.tree.slice(0, 7)})`)
  for (const m of r.map) console.log(`  ${m.old.map((s) => s.slice(0, 7)).join('+') || '?'} → ${m.new.slice(0, 7)}  ${m.subject}`)
  console.log('stamped .rig/fold.json')
  if (!each) console.log('\x1b[33mno walk: pass --each "<cmd>" (or set testCommand) to check every commit on its own\x1b[0m')
  else {
    console.log(`\nwalked ${r.walk.length} commit(s) with: ${each}`)
    for (const w of r.walk)
      console.log(
        `  ${w.exit === 0 ? '\x1b[32m  ok\x1b[0m' : `\x1b[31mexit ${w.exit}\x1b[0m`}  ${w.sha.slice(0, 7)}  ${w.subject}  (${Math.round(w.ms / 1000)} s)`,
      )
    const bad = r.walk.filter((w) => w.exit !== 0)
    if (bad.length) {
      for (const w of bad) console.log(`\n${w.sha.slice(0, 7)}:\n${w.tail}`)
      console.error(
        `\n\x1b[31m${bad.length} commit(s) do not pass on their own.\x1b[0m The fold stays (its tree is identical); fix and fold again.`,
      )
      process.exitCode = 1
    }
  }
  console.log('\nevery final check reruns on the new shas: rig qa, rig review --vendor, then rig finish')
  return { ...r, stamp }
}
