// .rig/ is machine state: the QA record (which carries this machine's paths), slice issue numbers,
// review briefs, finish stamps. It must never be committed.
//
// `rig init` puts `.rig/` in .gitignore, but a repo set up before init did that, or never init'ed,
// has no such line, and nothing else noticed. Any repo-wide `git add -A` then published the lot:
// on 2026-10-09 a nightly sync committed a finished build's qa-history.jsonl, home-folder paths and
// all, and the public repo's hygiene check went red. The same gap made every slice's BRIEF.md look
// like uncommitted work, so `rig down` needed --force.
//
// So every write into .rig/ goes through rigDir(), which makes git ignore it first. It uses the
// clone's own exclude file: shared by every linked worktree, and never a dirty file to commit.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { tryGit } from './sh.js'

/** Create `<root>/.rig` if needed, make sure git ignores it, and return its path. */
export function rigDir(root) {
  const dir = join(root, '.rig')
  mkdirSync(dir, { recursive: true })
  ensureRigIgnored(root)
  return dir
}

const warned = new Set()

/**
 * Make git ignore `.rig/` in the repo at `root` (a main checkout or a linked worktree). Returns what
 * it did: 'ignored' (already), 'excluded' (added to info/exclude), or 'no-repo'. Warns once per
 * process about state files that are already tracked, since ignoring does not untrack them.
 */
export function ensureRigIgnored(root) {
  // --no-index asks the ignore rules alone: a tracked file is otherwise reported as not ignored.
  const probe = tryGit(['check-ignore', '-q', '--no-index', '.rig/qa-history.jsonl'], root)
  let did = 'ignored'
  if (!probe.ok) {
    // check-ignore exits 1 for "not ignored" and 128 for "not a repo"; only the first is ours to fix.
    const at = tryGit(['rev-parse', '--git-path', 'info/exclude'], root)
    if (!at.ok) return 'no-repo'
    const exclude = isAbsolute(at.out) ? at.out : join(root, at.out)
    const text = existsSync(exclude) ? readFileSync(exclude, 'utf8') : ''
    if (!text.split('\n').some((l) => l.trim() === '.rig/')) {
      mkdirSync(dirname(exclude), { recursive: true })
      const lead = text === '' || text.endsWith('\n') ? '' : '\n'
      appendFileSync(exclude, `${lead}# rig: machine state (QA record, issues, briefs), never committed\n.rig/\n`)
      console.error(`rig: .rig/ was not ignored in this repo; added it to ${exclude}`)
    }
    did = 'excluded'
  }
  warnTracked(root)
  return did
}

/** Name state files that are already committed (config.json excepted) and how to untrack them. */
function warnTracked(root) {
  const ls = tryGit(['ls-files', '--', '.rig'], root)
  if (!ls.ok || !ls.out) return
  const tracked = ls.out.split('\n').filter((f) => f && f !== '.rig/config.json')
  const key = `${root}\0${tracked.join('\0')}`
  if (!tracked.length || warned.has(key)) return
  warned.add(key)
  console.error(`\x1b[33mrig: machine state is committed in this repo:\x1b[0m ${tracked.join(', ')}`)
  console.error(`  untrack it (the files stay on disk): git rm --cached -- ${tracked.join(' ')} && git commit -m "Untrack rig state"`)
  console.error('  a plain `git commit`: `git commit -- <paths>` commits the files as they are on disk and keeps them tracked')
}
