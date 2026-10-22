// Rig 5.5, r55g: every review brief asks the three questions a same-vendor review once skipped (what
// changes between the check and its use, time edges, a state that flips off and back on), and ends
// with r55w's tell line. The controls swap the older review.js back in, and r55w's brief.js out.

import { suite } from '../harness/check.js'
import { cpSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const RIG = join(here, '..')
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rig-rvbrief-')))
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** A copy of src/ with some files replaced by their text at a commit; null when a commit is missing (shallow clone). */
function srcWith(name, files) {
  const dir = join(tmp, name)
  cpSync(join(RIG, 'src'), dir, { recursive: true })
  for (const [path, sha] of Object.entries(files)) {
    const r = spawnSync('git', ['show', `${sha}:src/${path}`], { cwd: RIG, encoding: 'utf8' })
    if (r.status !== 0) return null
    writeFileSync(join(dir, path), r.stdout)
  }
  return dir
}
let n = 0
const load = async (dir) => import(`${pathToFileURL(join(dir, 'commands', 'review.js')).href}?v=${n++}`)

const repo = join(tmp, 'repo')
execFileSync('mkdir', ['-p', repo])
git(['init', '-q', '-b', 'main'], repo)
git(['-c', 'user.email=t@example.invalid', '-c', 'user.name=T', 'commit', '-q', '--allow-empty', '-m', 'base'], repo)
const sha = git(['rev-parse', 'HEAD'], repo)
const plan = {
  title: 'Depot draw',
  bar: '',
  mustNotRules: ['Nothing is sent to a customer without the owner.'],
  agents: [{ id: 'c1', title: 'Entry', owns: ['app/**'] }],
}
const briefs = (m) => ({
  slice: m.reviewBrief(plan, plan.agents[0], { root: repo, base: 'main', branch: 'main', by: 'c2', lead: 'rig55' }).text,
  vendor: m.vendorBrief(plan, { root: repo, sha, since: null, vendor: 'openai', builder: { vendor: 'anthropic' }, lead: 'rig55' }).text,
})
const asks = (t) =>
  /## Ask these/.test(t) &&
  /What changes between the check and its use or delivery, and is it checked again\?/.test(t) &&
  /Time edges\.\*\* A daylight-saving night, another time zone/.test(t) &&
  /exactly at\s+the boundary/.test(t) &&
  /A state that flips off and back on\./.test(t) &&
  /Every feature flag off\.\*\* Is each new endpoint, action, prop and job unreachable on every surface/.test(t) &&
  /\(UI, API, CLI, tool servers, background jobs\), and does the old behaviour hold exactly\?/.test(t) &&
  /Does the change override one \(theme, locale, notifications\)/.test(t)

await suite('rig 5.5, what every review brief asks (r55g)', async (s) => {
  // The control: 24ce390's review.js, which asks the first three only (and 0ed0253's, which asks none,
  // fails the same way).
  let src = join(RIG, 'src')
  const swapOld = async () => {
    const dir = srcWith('old', { 'commands/review.js': '24ce390' })
    if (dir) src = dir
    return () => {
      src = join(RIG, 'src')
    }
  }
  await s.check('the slice review brief asks all five questions', {
    assert: async () => asks(briefs(await load(src)).slice),
    breaks: swapOld,
  })
  await s.check('the second-vendor brief asks all five too', {
    assert: async () => asks(briefs(await load(src)).vendor),
    breaks: swapOld,
  })

  // r55w's export (rig/r55w at 5acc1e1) merged in: both briefs end with its tell line.
  const merged = srcWith('merged', { 'brief.js': '5acc1e1', 'plan.js': '5acc1e1' })
  let withTell = merged
  await s.check('with r55w’s tellLine, every brief ends with it, naming the reviewer', {
    assert: async () => {
      if (!withTell) return false
      const b = briefs(await load(withTell))
      const last = (t) => t.trimEnd().split('\n').pop()
      return (
        last(b.slice) ===
          'When you finish, get blocked or have a question, tell the lead, never the human: `rig tell rig55 "c2: done|blocked|question — <one line>"`' &&
        /rig tell rig55 "rv-openai: done/.test(last(b.vendor))
      )
    },
    // brief.js from before r55w (the scaffold, 3ef17d0), which has no tellLine: no tell line at all.
    breaks: async () => {
      withTell = srcWith('no-tell', { 'brief.js': '3ef17d0' })
      return () => {
        withTell = merged
      }
    },
  })
})

rmSync(tmp, { recursive: true, force: true })
