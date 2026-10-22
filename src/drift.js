// Drift: what the live base did since a branch was cut, known before a final round starts.
//
// Five stacked branches on an upstream that moved 30, then 11, then 3 times in one day: each time
// the move was found after a review round, and the round was spent on a tree that no longer merged.
// So `rig status`, `rig fold` and `rig finish` ask first: fetch, list the commits since the merge
// base, map the files they touched to the slices that own them, name the owned files they left
// alone, and ask `git merge-tree --write-tree` whether the head still merges. Nothing here throws:
// a check that cannot run says why in `error`, and the caller prints it.

import { matchesAny } from './plan.js'
import { tryGit, tryRun } from './sh.js'

/** How long a fetch may take before drift gives up on it and compares against the last known base. */
export const FETCH_TIMEOUT_MS = 30_000

/**
 * What the live base did since this branch was cut: fetch (unless `fetch: false`), then compare.
 *
 * When the fetch fails (offline, no such remote), `error` says so and `fetched` is false, but the
 * comparison still runs against the last fetched copy of the base when there is one: a stale answer
 * that says it is stale beats no answer. When the base itself cannot be resolved, nothing else runs.
 *
 * @param {string} root  the main checkout
 * @param {{ base?: string, remote?: string, head?: string, slices?: {id: string, owns: string[]}[], fetch?: boolean }} opts
 * @returns {{
 *   base: string,            // e.g. 'origin/main' (the live base that was compared)
 *   head: string,            // the ref whose stack is checked (default HEAD)
 *   moved: boolean,          // true when the live base has commits the head does not
 *   since: {sha: string, subject: string}[],   // those commits, newest first
 *   touched: {file: string, slices: string[]}[], // files those commits changed that a slice owns (or the head changed)
 *   safe: string[],          // owned files those commits did not touch
 *   merges: boolean | null,  // git merge-tree --write-tree verdict; null when it could not be computed
 *   conflicts: string[],     // files merge-tree reports as conflicting
 *   error: string | null,    // why the check could not run (no remote, fetch failed), never thrown
 * }}
 *   Also: `mergeBase` (sha or null), `fetched` (true when a fetch ran and succeeded), and on each
 *   touched entry `headChanged` (the head changed that file too: where a conflict would come from).
 */
export function drift(root, { base = 'origin/main', remote, head = 'HEAD', slices = [], fetch = true } = {}) {
  const out = {
    base,
    head,
    moved: false,
    since: [],
    touched: [],
    safe: [],
    merges: null,
    conflicts: [],
    error: null,
    mergeBase: null,
    fetched: false,
  }
  const errors = []

  if (fetch) {
    const f = fetchBase(root, base, remote)
    if (f.ok) out.fetched = true
    else if (f.why) errors.push(f.why)
  }

  const baseSha = resolve(root, base)
  const headSha = resolve(root, head)
  if (!baseSha || !headSha) {
    errors.push(`${!baseSha ? base : head} does not name a commit here`)
    out.error = errors.join('; ')
    return out
  }

  const mb = tryGit(['merge-base', headSha, baseSha], root)
  if (!mb.ok || !mb.out) {
    errors.push(`${head} and ${base} share no history`)
    out.error = errors.join('; ')
    return out
  }
  out.mergeBase = mb.out

  out.since = commits(root, `${out.mergeBase}..${baseSha}`)
  out.moved = out.since.length > 0

  const upstream = changedFiles(root, out.mergeBase, baseSha)
  const ours = new Set(changedFiles(root, out.mergeBase, headSha))
  const ownersOf = (file) => slices.filter((s) => matchesAny(file, s.owns || [])).map((s) => s.id)

  for (const file of upstream) {
    const owners = ownersOf(file)
    const headChanged = ours.has(file)
    if (owners.length || headChanged) out.touched.push({ file, slices: owners, headChanged })
  }

  // Owned files: every file at the head a slice owns, plus whatever the head changed (a head with no
  // slices given owns what it changed). Safe is the part upstream left alone.
  const hit = new Set(upstream)
  const owned = new Set(ours)
  if (slices.length) for (const f of listFiles(root, headSha)) if (ownersOf(f).length) owned.add(f)
  out.safe = [...owned].filter((f) => !hit.has(f)).sort()

  const m = mergeTree(root, baseSha, headSha)
  out.merges = m.merges
  out.conflicts = m.conflicts
  if (m.why) errors.push(m.why)

  out.error = errors.length ? errors.join('; ') : null
  return out
}

/**
 * The branch a slice is measured against. The upstream of `branch` (main → origin/main) when the
 * local branch has nothing upstream lacks; otherwise `branch` itself. Slices merge into the local
 * base: once the lead has merged one slice there and not pushed, comparing against origin/main
 * would miss exactly the move the next slice must rebuild on. A local base that is also behind its
 * upstream is the lead's to pull; `rig status` says so.
 */
export function liveBase(root, branch) {
  const up = tryGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{upstream}`], root)
  if (!up.ok || !up.out) return branch
  return tryGit(['merge-base', '--is-ancestor', branch, up.out], root).ok ? up.out : branch
}

/** `git merge-tree --write-tree` of head onto base: { merges, conflicts, why }. Never touches a work tree. */
export function mergeTree(root, base, head) {
  const r = tryGit(['merge-tree', '--write-tree', '--name-only', '--no-messages', base, head], root)
  // Exit 0 is a clean merge, exit 1 a conflicted one; both print the tree id first, then (with
  // --name-only) one conflicted path per line. Anything else is git refusing (too old, bad ref).
  const lines = (r.out || '').split('\n').filter(Boolean)
  if (r.ok) return { merges: true, conflicts: [], why: null }
  if (/^[0-9a-f]{40,64}$/.test(lines[0] || '')) return { merges: false, conflicts: [...new Set(lines.slice(1))], why: null }
  return { merges: null, conflicts: [], why: `merge-tree could not run: ${(r.err || 'unknown error').split('\n')[0]}` }
}

/**
 * Fetch the remote branch `base` names (origin/main → `git fetch origin main`): { ok, why }. A local
 * base needs none and answers { ok: false, why: null }. Exported so a caller checking several heads
 * against one base fetches once, then passes `fetch: false`. `say` is told what is being fetched
 * before the wait starts, so a slow network has a name on screen rather than silence.
 */
export function fetchBase(root, base, remote, { say } = {}) {
  const remotes = tryGit(['remote'], root)
  const names = remotes.ok ? remotes.out.split('\n').filter(Boolean) : []
  const from = remote || names.find((n) => base.startsWith(`${n}/`))
  if (!from) return { ok: false, why: null } // a local base: nothing to fetch, nothing wrong
  if (!names.includes(from)) return { ok: false, why: `no remote named ${from}` }
  const branch = base.startsWith(`${from}/`) ? base.slice(from.length + 1) : null
  const args = ['fetch', '--quiet', '--no-tags', from]
  if (branch) args.push(`+refs/heads/${branch}:refs/remotes/${from}/${branch}`)
  say?.(`fetching ${branch ? `${from}/${branch}` : from}…`)
  const r = tryRun('git', args, { cwd: root, timeout: FETCH_TIMEOUT_MS, env: fetchEnv(root) })
  if (r.ok) return { ok: true }
  return { ok: false, why: `fetch from ${from} failed: ${(r.err || 'no answer').split('\n')[0]}` }
}

/**
 * The environment a fetch runs in: it never waits on a password prompt or a host-key question (a
 * fetch that asks is a fetch that failed), and an unreachable host gives up in 10 s rather than at
 * the 30 s limit. The ssh command is the one the person configured (GIT_SSH_COMMAND, else the
 * repo's core.sshCommand, else plain ssh) with those two options added: GIT_SSH_COMMAND outranks
 * core.sshCommand, so setting a bare `ssh` here once threw away a repo's own key. Someone using
 * GIT_SSH (a program, not a command line) is left exactly as they are.
 */
export function fetchEnv(root, env = process.env) {
  const out = { ...env, GIT_TERMINAL_PROMPT: '0' }
  const configured = tryGit(['config', '--get', 'core.sshCommand'], root)
  const ssh = env.GIT_SSH_COMMAND || (configured.ok && configured.out) || (env.GIT_SSH ? null : 'ssh')
  if (ssh) out.GIT_SSH_COMMAND = `${ssh} -o BatchMode=yes -o ConnectTimeout=10`
  return out
}

function resolve(root, ref) {
  const r = tryGit(['rev-parse', '--verify', '-q', `${ref}^{commit}`], root)
  return r.ok && r.out ? r.out : null
}

function commits(root, range) {
  const r = tryGit(['log', '--format=%H%x09%s', range], root)
  if (!r.ok || !r.out) return []
  return r.out.split('\n').map((l) => {
    const tab = l.indexOf('\t')
    return { sha: l.slice(0, tab), subject: l.slice(tab + 1) }
  })
}

// --no-renames: a file moved away upstream is a file gone from where the slice owns it, and the
// new path is a file upstream added. Both are reported; neither is hidden inside a rename.
function changedFiles(root, from, to) {
  const r = tryGit(['diff', '--name-only', '--no-renames', '-z', from, to], root)
  return r.ok ? r.out.split('\0').filter(Boolean) : []
}

function listFiles(root, sha) {
  const r = tryGit(['ls-tree', '-r', '--name-only', '-z', sha], root)
  return r.ok ? r.out.split('\0').filter(Boolean) : []
}

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  grn: (s) => `\x1b[32m${s}\x1b[0m`,
  yel: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
}

/**
 * One drift result as the lines a person reads, for `rig status`, `rig fold` and `rig finish` alike:
 * whether the base moved, the owned files it touched (and whose), how many it left safe, and whether
 * the head still merges. `label` names the head (a slice id); `max` caps the file list.
 */
export function formatDrift(d, { label = d.head, max = 8 } = {}) {
  const lines = []
  const tag = label.padEnd(6)
  if (d.mergeBase === null) {
    lines.push(`${tag} ${C.yel('drift unknown:')} ${d.error || 'no comparison'}`)
    return lines
  }
  const verdict =
    d.merges === true
      ? C.grn('merges cleanly')
      : d.merges === false
        ? C.red(`DOES NOT MERGE: ${list(d.conflicts, max)}`)
        : C.yel('merge unknown')
  if (!d.moved) {
    lines.push(`${tag} ${C.dim(`${d.base} has not moved since this was cut`)} · ${verdict}`)
  } else {
    const touched = d.touched.length
      ? C.yel(`${d.touched.length} owned file(s) touched upstream: `) +
        list(
          d.touched.map((t) => `${t.file}${t.headChanged ? ' (changed here too)' : ''}`),
          max,
        )
      : C.grn('no owned file touched')
    lines.push(`${tag} ${C.yel(`${d.base} moved ${d.since.length} commit(s)`)} · ${touched} · ${d.safe.length} safe · ${verdict}`)
  }
  if (d.error) lines.push(`${' '.repeat(tag.length)} ${C.yel('note:')} ${d.error}`)
  return lines
}

const list = (xs, max) => (xs.length > max ? `${xs.slice(0, max).join(', ')} …+${xs.length - max}` : xs.join(', '))
