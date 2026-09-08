import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { repoRoot, loadConfig, currentBranch } from '../config.js'
import { ensureDetachedWorktree } from '../worktrees.js'
import { git } from '../sh.js'

// Never grade the shared tree. Agents are mid-edit in theirs by definition, so a number taken
// there measures a half-finished checkout. QA gets its own worktree, detached at an exact commit,
// on its own port, so every number you report can be traced to a sha.

export default function qa (args) {
  const root = repoRoot()
  const cfg = loadConfig(root)
  const ref = argOf(args, '--ref') || argOf(args, '--branch') || currentBranch(root)
  const port = Number(argOf(args, '--port') || cfg.qaPort)

  const wt = ensureDetachedWorktree(root, cfg, 'qa', ref)
  const sha = git(['rev-parse', '--short', 'HEAD'], wt.path)
  const subject = git(['log', '-1', '--pretty=%s'], wt.path)

  console.log(`QA worktree pinned to ${ref} @ ${sha}`)
  console.log(`  ${subject}`)
  console.log(`  ${wt.path}`)
  console.log(`  port ${port}`)
  console.log(`\nEvery number you report from here belongs to ${sha}. Say the sha when you report it.`)

  const cmd = argOf(args, '--run') || cfg.devCommand
  if (!cmd) {
    console.log('\nNo dev command configured. Set "devCommand" in .rig/config.json or pass --run "<cmd>".')
    return
  }
  console.log(`\n$ ${cmd}   (PORT=${port})\n`)
  const child = spawn(cmd, { cwd: wt.path, shell: true, stdio: 'inherit', env: { ...process.env, PORT: String(port), RIG_QA_SHA: sha } })
  child.on('exit', code => process.exit(code ?? 0))
}

function argOf (args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
