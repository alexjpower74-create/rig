// ROLL.md is the contract for a cross-repo crew: one brief, N tabs, each tab a list of repos, one
// procedure applied to every repo, one report per tab. It is the shape of a linter rollout across
// dozens of repos in three tabs, which the slice model (one repo, file ownership) could not express.
//
//   ## What it's for            purpose
//   ## What must not happen     hard rules, bullets
//   ## Procedure per repo       ordered steps, applied to every repo in turn
//   ## Commit subject           one line; every roll commit carries it (how `status` finds them)
//   ## Report                   where each tab writes; `{tab}` is replaced by the tab id
//   ## Repos                    optional `slug = ~/path` overrides
//   ## Lists
//   ### <tab id>                one line of comma-separated slugs, or one slug per bullet
//
// Everything here is pure apart from reading the registry and checking that a folder exists;
// nothing launches, nothing is written.

import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, isAbsolute, resolve, basename } from 'node:path'
import { parseSections } from './plan.js'
import { tryGit, gitRaw } from './sh.js'

const strip = s => s.replace(/`/g, '').trim()

export function parseRoll (text) {
  const lines = text.split('\n')
  const title = (lines.find(l => /^#\s+/.test(l)) || '# roll').replace(/^#\s+/, '').trim()
  const sections = parseSections(lines)
  const sec = (re) => sections.find(x => re.test(x.heading))?.body || ''
  const bulletsOf = (body) => body.split('\n').map(l => l.trim()).filter(l => /^[-*]\s+/.test(l)).map(l => l.replace(/^[-*]\s+/, '').trim())

  const purpose = sec(/^what it.?s for$/i).trim()
  const mustNot = bulletsOf(sec(/^what must not happen$/i))
  const procedure = sec(/^procedure per repo$/i).split('\n').map(l => l.trim()).filter(l => /^(\d+[.)]|[-*])\s+/.test(l)).map(l => l.replace(/^(\d+[.)]|[-*])\s+/, '').trim())
  const commitSubject = strip(firstLine(sec(/^commit subject$/i)))
  const report = strip(firstLine(sec(/^report$/i)))

  // `## Repos`: `slug = ~/path`, one per line (bulleted or not).
  const repos = {}
  for (const raw of sec(/^repos$/i).split('\n')) {
    const m = raw.replace(/^\s*[-*]\s+/, '').match(/^\s*`?([A-Za-z0-9._-]+)`?\s*=\s*(.+?)\s*$/)
    if (m) repos[m[1]] = strip(m[2])
  }

  // `## Lists` holds `### <tab id>` headings. parseSections keys ### under their own names, so
  // walk the raw lines from the Lists heading to the next ## instead.
  const lists = {}
  const start = lines.findIndex(l => /^##\s+Lists\s*$/i.test(l))
  if (start >= 0) {
    let tab = null
    for (const raw of lines.slice(start + 1)) {
      if (/^##\s+/.test(raw) && !/^###/.test(raw)) break
      const h = raw.match(/^###\s+(.+?)\s*$/)
      if (h) { tab = h[1].split(/\s+[—–-]\s+/)[0].trim(); lists[tab] ||= []; continue }
      if (!tab) continue
      const line = raw.replace(/^\s*[-*]\s+/, '').trim()
      if (!line || /^<.*>$/.test(line)) continue
      for (const slug of line.split(',').map(strip).filter(Boolean)) lists[tab].push(slug)
    }
  }

  // A slug in two lists is two agents editing one repo at once: exactly the collision slices
  // exist to prevent. Refused at parse time, before anything is resolved or launched.
  const seen = new Map()
  for (const [tab, slugs] of Object.entries(lists)) {
    for (const slug of slugs) {
      if (seen.has(slug) && seen.get(slug) !== tab) throw new Error(`slug "${slug}" is in two lists (${seen.get(slug)} and ${tab}); a repo belongs to one tab`)
      if (seen.has(slug)) throw new Error(`slug "${slug}" is listed twice under ${tab}`)
      seen.set(slug, tab)
    }
  }
  if (!Object.keys(lists).length) throw new Error('ROLL.md has no `## Lists` with `### <tab id>` headings; nothing to launch')
  for (const [tab, slugs] of Object.entries(lists)) if (!slugs.length) throw new Error(`list "${tab}" is empty`)

  return { title, purpose, mustNot, procedure, commitSubject, report, repos, lists }
}

function firstLine (body) { return body.split('\n').map(l => l.trim()).find(l => l && !/^<.*>$/.test(l)) || '' }

export function expandHome (p, home) { return p === '~' ? home : p.startsWith('~/') ? join(home, p.slice(2)) : p }

/** The `code:` field of a registry file's frontmatter, or null. */
export function registryCode (file) {
  if (!existsSync(file)) return null
  const text = readFileSync(file, 'utf8')
  const fm = text.match(/^---\n([\s\S]*?)\n---/)
  const m = (fm ? fm[1] : text).match(/^code:\s*(.+?)\s*$/m)
  if (!m) return null
  const v = strip(m[1])
  return !v || /^(none|null|-)$/i.test(v) ? null : v
}

/**
 * Where each slug lives, in order: an explicit `## Repos` line, the registry's `code:` field,
 * then `~/Projects/<slug>`. Every slug must resolve to an existing folder before anything is
 * launched: a tab that starts on a path that is not there wastes its first turn asking.
 */
export function resolveRepos (roll, { home, registryDir, projectsDir } = {}) {
  home ||= process.env.HOME
  registryDir ||= join(home, '.claude', 'apps')
  projectsDir ||= join(home, 'Projects')
  const tabs = {}
  const missing = []
  for (const [tab, slugs] of Object.entries(roll.lists)) {
    tabs[tab] = []
    for (const slug of slugs) {
      let path, via
      if (roll.repos[slug]) { path = expandHome(roll.repos[slug], home); via = 'Repos' }
      else {
        const code = registryCode(join(registryDir, slug + '.md'))
        if (code) { path = expandHome(code, home); via = 'registry' }
        else { path = join(projectsDir, slug); via = 'Projects' }
      }
      if (!isAbsolute(path)) path = resolve(home, path)
      if (!existsSync(path) || !statSync(path).isDirectory()) { missing.push(`${slug} (${via}: ${path})`); continue }
      tabs[tab].push({ slug, path, via })
    }
  }
  if (missing.length) throw new Error(`${missing.length} slug(s) resolve to no folder — fix the list, the registry code: field, or add \`slug = ~/path\` under ## Repos:\n  ${missing.join('\n  ')}`)
  return tabs
}

export function rollName (briefPath, date = new Date()) {
  const base = basename(briefPath).replace(/\.md$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'roll'
  // Local date, as `rig qa`'s history uses: the dir is what the lead types into `status` and `finish`.
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return `${base}-${d}`
}

export function reportPathFor (roll, rollDir, tab, home) {
  const raw = roll.report && !/^<.*>$/.test(roll.report) ? roll.report : ''
  if (!raw) return join(rollDir, tab, 'REPORT.md')
  const p = expandHome(raw.replace(/\{tab\}|<tab>/g, tab), home)
  return isAbsolute(p) ? p : join(rollDir, p)
}

/** The brief one tab reads: purpose, the rules, the procedure, its repos, and the commit discipline. */
export function tabBrief (roll, tab, repos, { rollDir, reportPath, briefPath }) {
  const rules = roll.mustNot.filter(r => !/^<.*>$/.test(r))
  return `# Brief — ${tab} · ${roll.title}

This is a ROLL: one procedure applied to a list of repos, one after the other. You own the repos
below for the length of this roll and nothing else. The brief you are reading is \`${briefPath}\`;
the roll's contract is \`${join(rollDir, 'ROLL.md')}\`.

## What it's for
${roll.purpose || '(not stated)'}

${rules.length ? `## What must not happen — hard rules, from the brief
${rules.map(r => '- ' + r).join('\n')}

If a step seems to need one of these to happen, stop on that repo, write SKIPPED with the reason in
your report, and move on. These outrank the procedure.

` : ''}## Your repos, in order
${repos.map((r, i) => `${i + 1}. \`${r.slug}\`  ${r.path}`).join('\n')}

Every one of them ends the roll in exactly one state in your report: done (with its commit sha) or
SKIPPED with a reason. No repo is left out and no repo is left half-done.

## Procedure, per repo
${roll.procedure.length ? roll.procedure.map((p, i) => `${i + 1}. ${p}`).join('\n') : '(none stated in the brief — ask before inventing one)'}

## Commit discipline, per repo
- \`cd\` into the repo. Check the tree is clean (\`git status --porcelain\` empty) and you are on the
  default branch. A dirty tree or another branch: SKIPPED with the reason. Never stash, reset or
  checkout over someone's work.
- Record the test result BEFORE touching anything (run the repo's test command and note the exit
  and the failing names). A repo that is red before you start is reported as such; you are not
  here to fix it, only to tell the truth about it.
- One commit per repo, on the default branch, only the files the procedure touched.
  Subject: \`${roll.commitSubject || '<the brief has no ## Commit subject; use the roll title>'}\`.
  A repo that needs a second commit needs a note in the report saying why.
- After the commit: run the tests again and record the exit. Push when the repo has a remote
  (\`git push\`); note "local only" when it has none.
- After each push: \`jot "[<slug>] <one line: what changed, tests before/after>"\` and
  \`apps touch <slug>\` when those commands exist on PATH. Skip silently when they do not.
- Never run \`wrap\` or \`sync\`: the lead does that once for the whole roll.
- Nothing leaves without the owner: no releases, deploys, posts, or pull requests to other people's
  repos.

## Report
Write \`${reportPath}\` as you go, not at the end: one line per repo, in list order, as
\`- <slug>: done <short sha> — <what changed; tests before → after>\` or
\`- <slug>: SKIPPED — <reason>\`, then anything the owner has to decide. Update it after every repo.
A usage pause lands mid-roll with no warning; the report is what survives it.

## House rules
- Nobody types into your pane. If you need something, put it in the report.
- Work only inside the repos listed above and \`${rollDir}\`. Reading or writing anywhere else
  triggers a permission prompt that stops you until a person notices.
- Stop only what you started: never kill a process by name or free a port you do not own.
- Dependencies: install, don't link (\`npm ci\` in the repo, never a symlink to another checkout).
`
}

// ------------------------------------------------------------------------------------------------
// Status, read from the repos themselves. The roll keeps no memory of what an agent did; the git
// tree and the report file are the only witnesses, and both are re-read every time.

const short = sha => sha.slice(0, 7)

/** The remote a roll pushes to: `origin` when there is one, else the first remote, else null. A
 *  remote named anything else used to read as "no remote", and an unpushed commit passed as local only. */
export function remoteName (repo) {
  const r = tryGit(['remote'], repo)
  if (!r.ok || !r.out.trim()) return null
  const names = r.out.split('\n').map(x => x.trim()).filter(Boolean)
  return names.includes('origin') ? 'origin' : names[0]
}

/** The remote's default branch as `<remote>/<name>`, or null when the repo has no remote. */
export function remoteHead (repo) {
  const remote = remoteName(repo)
  if (!remote) return null
  const sym = tryGit(['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`], repo)
  if (sym.ok && sym.out) return sym.out
  for (const b of [`${remote}/main`, `${remote}/master`]) if (tryGit(['rev-parse', '--verify', '-q', b], repo).ok) return b
  return `${remote}/main`
}

export function isDirty (repo) {
  const r = gitRaw(['-c', 'core.quotePath=false', 'status', '--porcelain', '-uall'], repo)
  return r.ok && r.out.trim().length > 0
}

/**
 * The newest commit on HEAD that belongs to this roll. When the brief has a commit subject, the
 * commit must carry it AND be dated on or after `startedAt`; without a subject, the date alone.
 * The scan stops at the first commit older than the roll, so last week's sweep with the same
 * subject, or the owner's unrelated commit during the roll, is never reported as the tab's work.
 */
export function rollCommit (repo, startedAt, commitSubject) {
  const since = Math.floor(new Date(startedAt).getTime() / 1000)
  const r = tryGit(['log', '-n', '500', '--format=%H%x09%at%x09%s'], repo)
  if (!r.ok || !r.out) return null
  for (const line of r.out.split('\n')) {
    const [sha, at, ...rest] = line.split('\t')
    if (Number(at) < since) return null
    const subject = rest.join('\t')
    if (!commitSubject || subject.includes(commitSubject)) return { sha, subject }
  }
  return null
}

/**
 * The report lines the brief asks for, and nothing looser:
 *   - <slug>: done <sha> — <what changed>
 *   - <slug>: SKIPPED — <reason>
 * A slug mentioned in prose, a heading, or a longer hyphenated slug is not "named"; a done line
 * with the word SKIPPED later in it is done. Returns Map slug -> { state: 'done' | 'skipped', sha, note }.
 */
export function reportLines (reportText) {
  const out = new Map()
  for (const line of (reportText || '').split('\n')) {
    const m = line.match(/^\s*[-*]\s*`?([A-Za-z0-9._-]+)`?\s*:\s*(done|SKIPPED)\b\s*(?:`?([0-9a-f]{7,40})`?)?\s*(.*)$/i)
    if (!m) continue
    const state = m[2].toUpperCase() === 'SKIPPED' ? 'skipped' : 'done'
    out.set(m[1], { state, sha: m[3] ? m[3].slice(0, 7) : null, note: m[4].replace(/^[—–-]\s*/, '').trim() })
  }
  return out
}

/** Slugs a report marks SKIPPED (`- <slug>: SKIPPED — <reason>` only). */
export function skippedIn (reportText) {
  return new Set([...reportLines(reportText)].filter(([, v]) => v.state === 'skipped').map(([k]) => k))
}

/** Slugs the report accounts for: a done or SKIPPED line of their own. */
export function namedIn (reportText, slugs) {
  const lines = reportLines(reportText)
  return new Set(slugs.filter(s => lines.has(s)))
}

/**
 * One repo's state: missing | skipped | in progress | committed | pushed | local only | untouched.
 * `fetch: true` refreshes origin first, so `pushed` is what the remote says, not what a stale
 * tracking ref remembers.
 */
export function repoState (entry, { startedAt, commitSubject, skipped, fetch = true }) {
  const { slug, path } = entry
  if (!existsSync(path)) return { slug, path, state: 'missing', sha: null }
  // A repo the tab SKIPped was never edited by the roll, so its dirt is not the roll's: the brief
  // tells the tab to SKIP a dirty tree rather than touch it, and the gate has to accept that answer.
  if (skipped.has(slug)) return { slug, path, state: 'skipped', sha: null }
  if (isDirty(path)) return { slug, path, state: 'in progress', sha: null }
  const c = rollCommit(path, startedAt, commitSubject)
  if (c) {
    const head = remoteHead(path)
    if (!head) return { slug, path, state: 'local only', sha: short(c.sha), subject: c.subject }
    if (fetch) tryGit(['fetch', '--quiet', 'origin'], path)
    const pushed = tryGit(['merge-base', '--is-ancestor', c.sha, head], path).ok
    return { slug, path, state: pushed ? 'pushed' : 'committed', sha: short(c.sha), subject: c.subject, remote: head }
  }
  return { slug, path, state: 'untouched', sha: null }
}

/** Every tab, every repo, from the roll record and the repos on disk. */
export function rollStatus (rollDir, { fetch = true } = {}) {
  const record = JSON.parse(readFileSync(join(rollDir, 'roll.json'), 'utf8'))
  const tabs = {}
  for (const [tab, repos] of Object.entries(record.tabs)) {
    const reportPath = record.reports?.[tab] || join(rollDir, tab, 'REPORT.md')
    const reportText = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : null
    const skipped = skippedIn(reportText)
    tabs[tab] = {
      reportPath,
      reportExists: reportText != null,
      named: namedIn(reportText, repos.map(r => r.slug)),
      repos: repos.map(r => repoState(r, { startedAt: record.startedAt, commitSubject: record.commitSubject, skipped, fetch }))
    }
  }
  return { record, tabs }
}
