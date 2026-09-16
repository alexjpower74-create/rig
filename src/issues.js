// One GitHub issue per slice, opened at `rig up` and closed at `rig finish`.
//
// The issue is where a slice says what it is waiting on a person for, and the registry file's
// `waiting_on` points at it (the workflow adopted 2026-09-15). Numbers are recorded in
// `.rig/issues.json` as `{ "<id>": { number, url } }`; `rig finish` (rg1's desk.js) reads that file
// to close them. Everything here is best effort: no gh, no auth or no remote means no issues, said
// once, and the build goes on. Nothing here ever closes or edits an issue.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tryRun, tryGit } from './sh.js'

export const issuesPath = root => join(root, '.rig', 'issues.json')

export function loadIssues (root) {
  const p = issuesPath(root)
  if (!existsSync(p)) return {}
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return {} }
}

export function saveIssues (root, issues) {
  mkdirSync(join(root, '.rig'), { recursive: true })
  writeFileSync(issuesPath(root), JSON.stringify(issues, null, 2) + '\n')
}

/** gh on PATH, logged in, and an `origin` to open issues against. `{ ok, why }`. */
export function ghAvailable (root) {
  if (!tryRun('gh', ['--version']).ok) return { ok: false, why: 'no gh on PATH' }
  if (!tryRun('gh', ['auth', 'status'], { cwd: root }).ok) return { ok: false, why: 'gh is not logged in (gh auth status failed)' }
  if (!tryGit(['remote', 'get-url', 'origin'], root).ok) return { ok: false, why: 'no origin remote' }
  return { ok: true, why: null }
}

const json = (args, cwd) => {
  const r = tryRun('gh', args, { cwd })
  if (!r.ok) return null
  try { return JSON.parse(r.out) } catch { return null }
}

/** An OPEN issue whose title starts with `<id> ` — the one an earlier `rig up` or a person opened. */
export function findOpenIssue (root, id) {
  const list = json(['issue', 'list', '--state', 'all', '--search', `${id} in:title`, '--json', 'number,title,state,url'], root) || []
  return list.find(i => i.state === 'OPEN' && typeof i.title === 'string' && i.title.startsWith(`${id} `)) || null
}

function issueBody (agent) {
  return [
    `Slice \`${agent.id}\`${agent.title ? ' — ' + agent.title : ''}. Opened by \`rig up\`; \`rig finish\` closes it with the QA line.`,
    '', 'Put what is waiting on a person here.', '',
    '## Task', agent.task || '(none stated in the plan)', '',
    '## Owns', ...agent.owns.map(o => `- \`${o}\``)
  ].join('\n')
}

/**
 * Make sure every slice in the plan has an issue on record. Returns
 * `{ ran, why, issues, lines }`: `issues` is the full `.rig/issues.json` map and `lines` is what
 * was said per slice. `cfg.issues === false` skips (so does `rig up --no-issues`).
 *
 * Order per slice: already recorded → the plan's own `Issue:` line → an open issue titled
 * `<id> …` → a new one. Reuse comes before create so a `rig up` re-run after `rig down` does not
 * open a second issue per slice.
 */
export function openSliceIssues (root, plan, cfg = {}) {
  const issues = loadIssues(root)
  const lines = []
  if (cfg.issues === false) return { ran: false, why: 'issues off (--no-issues)', issues, lines }

  const avail = ghAvailable(root)
  // A plan-declared number is a fact we can record without gh; the url is filled in when gh is here.
  for (const agent of plan.agents) {
    if (issues[agent.id] || !agent.issue) continue
    const view = avail.ok ? json(['issue', 'view', String(agent.issue), '--json', 'number,url'], root) : null
    issues[agent.id] = { number: agent.issue, url: view?.url ?? null }
    lines.push(`  ${agent.id}  issue #${agent.issue} (from the plan)${view?.url ? '  ' + view.url : ''}`)
  }
  if (!avail.ok) {
    if (lines.length) saveIssues(root, issues)
    lines.push(`no gh/remote: issues not opened (${avail.why})`)
    return { ran: false, why: avail.why, issues, lines }
  }

  for (const agent of plan.agents) {
    if (issues[agent.id]) { lines.push(`  ${agent.id}  issue #${issues[agent.id].number} (recorded)${issues[agent.id].url ? '  ' + issues[agent.id].url : ''}`); continue }
    const open = findOpenIssue(root, agent.id)
    if (open) {
      issues[agent.id] = { number: open.number, url: open.url ?? null }
      lines.push(`  ${agent.id}  issue #${open.number} (reused, open)${open.url ? '  ' + open.url : ''}`)
      continue
    }
    const title = `${agent.id} ${agent.title || 'slice'}`
    const r = tryRun('gh', ['issue', 'create', '--title', title, '--body', issueBody(agent)], { cwd: root })
    if (!r.ok) { lines.push(`  ${agent.id}  could not open an issue: ${r.err.split('\n')[0]}`); continue }
    // `gh issue create` prints the new issue's url; the number is its last path segment.
    const url = (r.out.split('\n').find(l => /https?:\/\//.test(l)) || '').trim()
    const number = Number(url.split('/').pop())
    if (!url || !Number.isInteger(number)) { lines.push(`  ${agent.id}  gh issue create answered without a url: ${r.out}`); continue }
    issues[agent.id] = { number, url }
    lines.push(`  ${agent.id}  issue #${number} (opened)  ${url}`)
  }
  saveIssues(root, issues)
  return { ran: true, why: null, issues, lines }
}
