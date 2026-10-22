// rig rebase <id> [--base <ref>] [--share <0..1>] [--covered "<what upstream covers>"] [--drop <sha>]... [--no-fetch] [--force]
//
// Rebase a slice's branch onto the live base, the way a maintainer of a long-lived fork does it:
// before resolving anything, look at what upstream did to the files the slice changed. Upstream once
// replaced most of one PR; resolving it hunk by hand would have kept code upstream no longer needed,
// and dropping the superseded commits made the PR smaller and correct. So when upstream deleted,
// renamed, also created, or rewrote at least `share` of the lines of a file the slice changed, the
// rebase stops before it starts, writes `.rig/rebase-<id>.md` asking the slice owner what upstream
// now covers, prints it and exits 3. The owner answers with --covered (recorded in the same file)
// and names superseded commits with --drop; then the rebase runs.
//
// A rebase that conflicts is aborted, never left half-done: the branch is exactly as it was, the
// conflicting files are named, and resolving them is the owner's (exit 1). Commits upstream already
// carries are dropped by git itself (patch-id), as the stable queue drops patches upstream took.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { loadConfig, mainRoot, currentBranch, sessionName } from '../config.js'
import { drift, fetchBase, formatDrift, liveBase } from '../drift.js'
import { loadPlan } from '../plan.js'
import { rigDir } from '../rigdir.js'
import { tryGit, tryRun } from '../sh.js'
import { terminal } from '../terminal.js'
import { listWorktrees, worktreeBase, dirtyFiles } from '../worktrees.js'

const RED = (s) => `\x1b[31m${s}\x1b[0m`
const GRN = (s) => `\x1b[32m${s}\x1b[0m`
const YEL = (s) => `\x1b[33m${s}\x1b[0m`
const DIM = (s) => `\x1b[2m${s}\x1b[0m`

/** The share of a file's lines upstream must replace before the rebase stops and asks. */
export const DEFAULT_SHARE = 0.5
/** Exit code for "stopped: the owner has to say what upstream now covers". */
export const ASK = 3

export default function rebase(args) {
  const id = args.find((a, i) => !a.startsWith('--') && !VALUED.has(args[i - 1]))
  if (!id) throw new Error('usage: rig rebase <id> [--base <ref>] [--share <0..1>] [--covered "<what upstream covers>"] [--drop <sha>]...')
  const root = mainRoot()
  const cfg = loadConfig(root)
  const plan = loadPlan(join(root, cfg.plan))
  const agent = plan.agents.find((a) => a.id === id)
  if (!agent) throw new Error(`no slice "${id}" in ${cfg.plan} (slices: ${plan.agents.map((a) => a.id).join(', ')})`)
  const branch = `${cfg.branchPrefix}${id}`
  if (!tryGit(['rev-parse', '--verify', '-q', `refs/heads/${branch}`], root).ok) throw new Error(`no branch ${branch}: nothing to rebase`)

  const share = numberOr(argOf(args, '--share') ?? cfg.rebaseRewriteShare, DEFAULT_SHARE)
  if (!(share > 0 && share <= 1)) throw new Error(`--share must be a fraction above 0 and at most 1 (got ${argOf(args, '--share')})`)
  const covered = argOf(args, '--covered')
  const drops = valuesOf(args, '--drop')
  if (drops.length && !covered)
    throw new Error('--drop needs --covered "<what upstream now covers>": a dropped commit needs its reason on record')

  // A rebase is the one command where a stale base is the whole failure: it would land the slice on
  // yesterday's base and say "rebased". So a fetch that fails stops it; --no-fetch says, on purpose,
  // that the last fetched base will do.
  const noFetch = args.includes('--no-fetch')
  let base = argOf(args, '--base')
  let fetchTarget = base
  if (!base) {
    const local = currentBranch(root)
    const up = tryGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${local}@{upstream}`], root)
    fetchTarget = up.ok && up.out ? up.out : local
  }
  if (!noFetch) {
    const f = fetchBase(root, fetchTarget, undefined, { say: (m) => console.log(DIM(m)) })
    if (f.why) {
      console.log(RED(`${f.why}`))
      console.log(`  ${branch} was not touched. Rebasing onto the last fetched copy would land it on a stale base;`)
      console.log(`  fix the fetch, or say the last fetch will do: rig rebase ${id} --no-fetch`)
      process.exitCode = 1
      return
    }
  } else console.log(DIM(`not fetched (--no-fetch): rebasing onto the last fetched ${fetchTarget}`))
  if (!base) base = liveBase(root, currentBranch(root))

  const d = drift(root, { base, head: `refs/heads/${branch}`, slices: [agent], fetch: false })
  for (const line of formatDrift(d, { label: id })) console.log(line)
  if (d.mergeBase === null) throw new Error(`cannot rebase ${branch} onto ${base}: ${d.error}`)

  const baseSha = sha(root, base)
  const oldTip = sha(root, `refs/heads/${branch}`)
  if (!d.moved) {
    console.log(GRN(`${branch} is already on ${base}: nothing to rebase`))
    return
  }

  const found = supersededFiles(root, { mergeBase: d.mergeBase, base: baseSha, head: oldTip, share })
  const notePath = join(rigDir(root), `rebase-${id}.md`)
  if (found.length && !covered) {
    const note = askNote({ id, base, baseSha, mergeBase: d.mergeBase, branch, oldTip, share, found })
    writeFileSync(notePath, note)
    console.log(`\n${YEL(`STOPPED before resolving anything: upstream changed ${found.length} file(s) this slice changed.`)}`)
    console.log(DIM(`written to ${relative(process.cwd(), notePath) || notePath}`) + '\n')
    console.log(note)
    process.exitCode = ASK
    return
  }

  // Every --drop must be a commit of this slice since the merge base, and is named in full.
  const own = commitsIn(root, `${d.mergeBase}..${oldTip}`)
  const dropped = drops.map((ref) => {
    const full = sha(root, ref)
    const c = full && own.find((x) => x.sha === full)
    if (!c) throw new Error(`--drop ${ref}: not a commit of ${branch} since it was cut from ${base}`)
    return c
  })

  const wt = checkoutFor(root, cfg, branch, id)
  try {
    const dirty = dirtyFiles(wt.path)
    if (dirty.length) throw new Error(`${branch} has uncommitted work in ${wt.path}: ${dirty.slice(0, 6).join(', ')}. Commit it first.`)
    // The branch's checkout is the slice agent's own tree. A clean tree is not an idle agent: one
    // between a commit and its next edit would find its files rewritten and commit on top unawares.
    const state = wt.temp ? null : paneState(cfg, root, id)
    if ((state === 'working' || state === 'blocked') && !args.includes('--force')) {
      console.log(RED(`${id}'s agent is ${state} in ${wt.path}: a rebase now rewrites its tree mid-task.`))
      console.log(`  ${branch} was not touched. Rebase when it is idle (rig status shows it), or pass --force.`)
      process.exitCode = 1
      return
    }
    const r = runRebase(root, wt.path, { onto: baseSha, upstream: d.mergeBase, dropped })
    if (!r.ok) {
      console.log(RED(`rebase of ${branch} onto ${base} stopped on conflicts and was aborted; the branch is as it was.`))
      if (r.conflicts.length) console.log(`  conflicting: ${r.conflicts.join(', ')}`)
      else if (r.why) console.log(`  ${r.why}`)
      console.log(DIM(`  resolving them is the owner's: cd ${wt.temp ? root : wt.path} && git rebase ${base}`))
      process.exitCode = 1
      return
    }
    const newTip = sha(root, `refs/heads/${branch}`)
    const result = `rebased ${branch} onto ${base} (${baseSha.slice(0, 9)}): ${oldTip.slice(0, 9)} → ${newTip.slice(0, 9)}`
    if (covered) appendAnswer(notePath, { covered, dropped, result })
    console.log(GRN(result))
    if (dropped.length) for (const c of dropped) console.log(`  dropped ${c.sha.slice(0, 9)} ${c.subject}`)
    const rd = tryGit(['range-diff', '--no-color', '-s', `${d.mergeBase}..${oldTip}`, `${baseSha}..${newTip}`], root)
    if (rd.ok && rd.out) console.log(DIM('range-diff (old → new):\n') + rd.out.replace(/^/gm, '  '))
    if (covered) console.log(DIM(`answer recorded in ${relative(process.cwd(), notePath) || notePath}`))
    if (!wt.temp)
      console.log(
        YEL(`${id}'s tree moved: ${wt.path} is now on ${base} at ${baseSha.slice(0, 9)} (tip ${newTip.slice(0, 9)}).`) +
          ` Tell the owner before its next commit${state ? ` (its agent is ${state})` : ''}.`,
      )
  } finally {
    if (wt.temp) {
      tryGit(['worktree', 'remove', '--force', wt.path], root)
      rmSync(wt.path, { recursive: true, force: true })
    }
  }
}

/**
 * Files the head changed since `mergeBase` that upstream (`base`) superseded: deleted, renamed away,
 * also created, or rewrote at least `share` of the old lines of. Each with the upstream commits that
 * did it and the head's commits that touched it (the candidates to drop).
 * @returns {{ file: string, what: 'deleted'|'renamed'|'added'|'rewrote', share: number|null, to: string|null,
 *   upstream: {sha: string, subject: string}[], ours: {sha: string, subject: string}[] }[]}
 */
export function supersededFiles(root, { mergeBase, base, head, share = DEFAULT_SHARE }) {
  const ours = nameStatus(root, ['--no-renames', mergeBase, head])
  const theirs = nameStatus(root, ['-M', mergeBase, base])
  const out = []
  for (const [file, status] of ours) {
    let hit = null
    const t = theirs.find((e) => e.from === file || e.path === file)
    if (!t) continue
    if (t.status === 'D') hit = { what: 'deleted', share: 1, to: null }
    else if (t.status.startsWith('R') && t.from === file) hit = { what: 'renamed', share: null, to: t.path }
    else if (t.status === 'A' && status === 'A') hit = { what: 'added', share: null, to: null }
    else if (t.status === 'M' || t.status.startsWith('R')) {
      const s = rewrittenShare(root, mergeBase, base, t.from || file, t.path)
      if (s >= share) hit = { what: 'rewrote', share: s, to: t.path !== file ? t.path : null }
    }
    if (!hit) continue
    const paths = [...new Set([file, t.path])]
    out.push({
      file,
      ...hit,
      upstream: commitsIn(root, `${mergeBase}..${base}`, paths),
      ours: commitsIn(root, `${mergeBase}..${head}`, [file]),
    })
  }
  return out.sort((a, b) => a.file.localeCompare(b.file))
}

/** The share of the old version's lines upstream removed or replaced: deleted lines / old line count. */
function rewrittenShare(root, from, to, oldPath, newPath) {
  const ns = tryGit(['diff', '--numstat', '-M', from, to, '--', oldPath, newPath], root)
  const row = (ns.out || '').split('\n').find(Boolean)
  if (!row) return 0
  const [, del] = row.split('\t')
  if (del === '-') return 1 // binary: any change is the whole file
  const old = tryGit(['show', `${from}:${oldPath}`], root)
  const lines = old.ok ? old.out.split('\n').length : 0
  return lines ? Math.min(1, Number(del) / lines) : 1
}

function nameStatus(root, range) {
  const r = tryGit(['diff', '--name-status', '-z', ...range], root)
  const parts = (r.out || '').split('\0').filter((x) => x !== '')
  if (range[0] === '--no-renames') {
    const m = new Map()
    for (let i = 0; i + 1 < parts.length; i += 2) m.set(parts[i + 1], parts[i])
    return m
  }
  const out = []
  for (let i = 0; i < parts.length; ) {
    const status = parts[i]
    if (status.startsWith('R') || status.startsWith('C')) {
      out.push({ status, from: parts[i + 1], path: parts[i + 2] })
      i += 3
    } else {
      out.push({ status, from: null, path: parts[i + 1] })
      i += 2
    }
  }
  return out
}

function askNote({ id, base, baseSha, mergeBase, branch, oldTip, share, found }) {
  const pct = (x) => `${Math.round(x * 100)}%`
  const c = (x) => `\`${x.sha.slice(0, 9)}\` ${x.subject}`
  const lines = [
    `# rig rebase ${id}: upstream changed what this slice changed`,
    '',
    `Base \`${base}\` at \`${baseSha.slice(0, 9)}\` · cut from \`${mergeBase.slice(0, 9)}\` · \`${branch}\` at \`${oldTip.slice(0, 9)}\``,
    `Asked ${new Date().toISOString()}. Rewrite threshold: ${pct(share)} of a file's lines.`,
    '',
    'Nothing has been resolved or rebased. Before anything is, the slice owner says what upstream now',
    'covers, and which of the slice commits below it supersedes.',
    '',
  ]
  for (const f of found) {
    const what =
      f.what === 'deleted'
        ? 'upstream **deleted** it'
        : f.what === 'renamed'
          ? `upstream **moved** it to \`${f.to}\``
          : f.what === 'added'
            ? 'upstream **created it too**'
            : `upstream **rewrote ${pct(f.share)}** of its lines${f.to ? ` (now \`${f.to}\`)` : ''}`
    lines.push(`## \`${f.file}\`: ${what}`, '')
    lines.push('Upstream:')
    for (const x of f.upstream) lines.push(`- ${c(x)}`)
    lines.push('', 'This slice:')
    for (const x of f.ours) lines.push(`- ${c(x)}`)
    lines.push('')
  }
  lines.push(
    '## Answer',
    '',
    'Say what upstream now covers, and drop each slice commit it supersedes:',
    '',
    `    rig rebase ${id} --covered "<what upstream now covers>" --drop <sha>`,
    '',
    'If every slice commit still stands, say so and keep them all:',
    '',
    `    rig rebase ${id} --covered "<what upstream covers; the slice still adds what>"`,
    '',
  )
  return lines.join('\n')
}

function appendAnswer(path, { covered, dropped, result }) {
  const was = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const lines = [
    was ? '' : '# rig rebase: answer',
    `### Answered ${new Date().toISOString()}`,
    '',
    `Covered: ${covered}`,
    `Dropped: ${dropped.length ? dropped.map((c) => `\`${c.sha.slice(0, 9)}\` ${c.subject}`).join('; ') : 'nothing'}`,
    `Result: ${result}`,
    '',
  ]
  writeFileSync(path, `${was.replace(/\n*$/, was ? '\n' : '')}${lines.join('\n')}`)
}

/**
 * Rebase the branch checked out at `cwd` onto `onto`, replaying what came after `upstream`.
 * Dropped commits go through a sequence editor that turns their `pick` into `drop`. --no-autosquash
 * keeps fix commits plain: folding them is `rig fold`'s, once, at the end.
 */
function runRebase(root, cwd, { onto, upstream, dropped }) {
  const env = { ...process.env, GIT_EDITOR: 'true' }
  const args = ['rebase', '--no-autosquash', '--onto', onto, upstream]
  if (dropped.length) {
    const editor = join(rigDir(root), 'rebase-drop-editor.mjs')
    writeFileSync(editor, DROP_EDITOR)
    env.RIG_REBASE_DROP = dropped.map((c) => c.sha).join(' ')
    env.GIT_SEQUENCE_EDITOR = `"${process.execPath}" "${editor}"`
    args.splice(1, 0, '-i')
  }
  const r = tryRun('git', args, { cwd, env })
  if (r.ok) return { ok: true }
  const u = tryGit(['diff', '--name-only', '--diff-filter=U'], cwd)
  const conflicts = u.ok ? u.out.split('\n').filter(Boolean) : []
  tryGit(['rebase', '--abort'], cwd)
  return { ok: false, conflicts, why: (r.err || r.out).split('\n').find(Boolean) }
}

// Turns `pick <abbrev> …` into `drop <abbrev> …` for each sha in RIG_REBASE_DROP.
const DROP_EDITOR = `import { readFileSync, writeFileSync } from 'node:fs'
const file = process.argv[2]
const drop = (process.env.RIG_REBASE_DROP || '').split(' ').filter(Boolean)
const todo = readFileSync(file, 'utf8').split('\\n').map((l) => {
  const m = l.match(/^(?:p|pick)\\s+([0-9a-f]{4,})(\\s.*)?$/)
  return m && drop.some((s) => s.startsWith(m[1])) ? 'drop ' + m[1] + (m[2] || '') : l
})
writeFileSync(file, todo.join('\\n'))
`

/** What the slice's agent is doing, from the terminal (herdr reports it; tmux cannot): a state or null. */
function paneState(cfg, root, id) {
  try {
    const term = terminal(cfg)
    const session = sessionName(root)
    if (!term.available() || !term.sessionExists(session)) return null
    return term.slicePanes(session, [id]).find((p) => p.name === id)?.agentStatus ?? null
  } catch {
    return null
  }
}

/** Where the branch is checked out, or a temporary worktree for it when it is checked out nowhere. */
function checkoutFor(root, cfg, branch, id) {
  const at = listWorktrees(root).find((w) => w.branch === branch)
  if (at) return { path: at.path, temp: false }
  const path = join(worktreeBase(root, cfg), `rebase-${id}`)
  const r = tryGit(['worktree', 'add', '-q', path, branch], root)
  if (!r.ok) throw new Error(`could not check out ${branch} to rebase it: ${r.err.split('\n')[0]}`)
  return { path, temp: true }
}

function commitsIn(root, range, paths = []) {
  const r = tryGit(['log', '--format=%H%x09%s', range, ...(paths.length ? ['--', ...paths] : [])], root)
  if (!r.ok || !r.out) return []
  return r.out.split('\n').map((l) => ({ sha: l.slice(0, l.indexOf('\t')), subject: l.slice(l.indexOf('\t') + 1) }))
}

function sha(root, ref) {
  const r = tryGit(['rev-parse', '--verify', '-q', `${ref}^{commit}`], root)
  return r.ok && r.out ? r.out : null
}

const VALUED = new Set(['--base', '--share', '--covered', '--drop'])

function argOf(args, name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}

function valuesOf(args, name) {
  return args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []))
}

function numberOr(v, d) {
  const n = Number(v)
  return v === null || v === undefined || v === '' || Number.isNaN(n) ? d : n
}
