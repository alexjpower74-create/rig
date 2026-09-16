// rig roll — a cross-repo crew from one brief. Every check is shown to go red: the parser by
// removing the heading it reads, resolution by removing the override it prefers, status by changing
// the one thing in the repo it reads, the launch by moving the rig to another workspace.
//
// The fixture is invented (orchard, millpond, kiln, beacon, lantern); no real repo list lives here.

import { suite } from '../harness/check.js'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync, readFileSync, existsSync, readdirSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rig-roll-')))
const home = join(tmp, 'home')
const OLD = { GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z' }
const git = (args, cwd, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }).trim()

const BRIEF = `# Lint sweep — one formatter across the fleet

## What it's for
Every repo gets the shared formatter config and one formatting commit, so the next diff is real.

## What must not happen
- Never commit over a dirty tree; SKIP it and say so.
- Nothing leaves without the owner.

## Procedure per repo
1. Record the test result before touching anything.
2. Add the formatter config and run it.
3. Run the tests again; if they went red, revert and SKIP with the reason.
4. One commit with the subject below; push where there is a remote.

## Commit subject
chore: adopt the shared formatter

## Report
{tab}/REPORT.md

## Repos
- kiln = ~/elsewhere/kiln

## Lists

### t1 — the libraries
orchard, millpond, kiln

### t2 — the apps
- beacon
- lantern
`

function bareOrigin (name) {
  const p = join(tmp, 'remotes', name + '.git')
  mkdirSync(p, { recursive: true })
  git(['init', '-q', '--bare', '-b', 'main'], p)
  return p
}

/** A repo with one old commit, optionally wired to a bare origin. */
function repoAt (path, { origin = null } = {}) {
  mkdirSync(path, { recursive: true })
  git(['init', '-q', '-b', 'main'], path)
  git(['config', 'user.email', 'test@example.invalid'], path)
  git(['config', 'user.name', 'Rig Test'], path)
  writeFileSync(join(path, 'README.md'), '# fixture\n')
  git(['add', '-A'], path); git(['commit', '-qm', 'initial'], path, OLD)
  if (origin) { git(['remote', 'add', 'origin', origin], path); git(['push', '-q', '-u', 'origin', 'main'], path) }
  return path
}
const commit = (repo, file, msg) => { writeFileSync(join(repo, file), msg + '\n'); git(['add', '-A'], repo); git(['commit', '-qm', msg], repo); return git(['rev-parse', 'HEAD'], repo) }

// The fixture fleet, laid out the way resolution expects: an override, a registry entry, the rest
// under ~/Projects.
mkdirSync(join(home, '.claude', 'apps'), { recursive: true })
writeFileSync(join(home, '.claude', 'apps', 'millpond.md'), '---\nname: Millpond\nslug: millpond\ncode: ~/code/millpond\n---\n## What it is\nA fixture.\n')
const paths = {
  orchard: join(home, 'Projects', 'orchard'),
  millpond: join(home, 'code', 'millpond'),
  kiln: join(home, 'elsewhere', 'kiln'),
  beacon: join(home, 'Projects', 'beacon'),
  lantern: join(home, 'Projects', 'lantern')
}
for (const [slug, p] of Object.entries(paths)) repoAt(p, { origin: slug === 'lantern' ? null : bareOrigin(slug) })

// A stub herdr on PATH that records every argv and answers just enough JSON.
const stubDir = join(tmp, 'bin')
mkdirSync(stubDir)
writeFileSync(join(stubDir, 'herdr'), `#!/bin/sh
echo "$@" >> "$HERDR_LOG"
case "$1 $2" in
  "--version ") echo "herdr stub" ;;
  "tab create") echo '{"result":{"root_pane":{"pane_id":"w7:p9"}}}' ;;
  "tab list") echo "{\\"result\\":{\\"tabs\\":\${HERDR_TABS:-[]}}}" ;;
  "pane list") echo "{\\"result\\":{\\"panes\\":\${HERDR_PANES:-[]}}}" ;;
  "pane wait-output") exit 1 ;;
  *) echo '{"result":{}}' ;;
esac
`)
writeFileSync(join(stubDir, 'jot'), '#!/bin/sh\necho "$@" >> "$JOT_LOG"\n')
for (const f of ['herdr', 'jot']) chmodSync(join(stubDir, f), 0o755)

await suite('rig roll', async s => {
  const { parseRoll, resolveRepos, rollStatus, skippedIn, tabBrief } = await import('../src/roll.js')
  const { finishChecks, finish, down } = await import('../src/commands/roll.js')

  // ---------------------------------------------------------------------------------------------
  // The brief.
  let text = BRIEF
  await s.check('a rollout brief parses: lists by tab, ordered procedure, commit subject, hard rules', {
    assert: async () => {
      const r = parseRoll(text)
      if (r.lists.t1.join(',') !== 'orchard,millpond,kiln') throw new Error('t1 = ' + r.lists.t1)
      if (r.lists.t2.join(',') !== 'beacon,lantern') throw new Error('t2 = ' + r.lists.t2)
      if (r.procedure.length !== 4 || !r.procedure[0].startsWith('Record the test result')) throw new Error('procedure = ' + JSON.stringify(r.procedure))
      if (r.commitSubject !== 'chore: adopt the shared formatter') throw new Error('subject = ' + r.commitSubject)
      if (r.mustNot.length !== 2 || r.repos.kiln !== '~/elsewhere/kiln') throw new Error('rules/repos wrong')
      return true
    },
    breaks: async () => { text = BRIEF.replace('## Lists', '## Lists of things'); return () => { text = BRIEF } }
  })

  let dup = 'kiln' // already in t1; adding it to t2 must be refused
  await s.check('a slug in two lists is refused at parse time', {
    assert: async () => { try { parseRoll(BRIEF.replace('- lantern', '- lantern\n- ' + dup)); return false } catch (e) { return /two lists/.test(e.message) && e.message.includes(dup) } },
    breaks: async () => { dup = 'ember'; mkdirSync(join(home, 'Projects', 'ember'), { recursive: true }); return () => { dup = 'kiln' } }
  })

  // ---------------------------------------------------------------------------------------------
  // Resolution order: Repos override, then registry code:, then ~/Projects/<slug>.
  const opts = { home, registryDir: join(home, '.claude', 'apps') }
  let roll = parseRoll(BRIEF)
  await s.check('an explicit `slug = ~/path` under ## Repos wins over the registry and ~/Projects', {
    assert: async () => resolveRepos(roll, opts).t1.find(r => r.slug === 'kiln').path === paths.kiln,
    breaks: async () => { roll = parseRoll(BRIEF.replace('- kiln = ~/elsewhere/kiln', '')); return () => { roll = parseRoll(BRIEF) } }
  })
  await s.check('the registry’s code: field is used when there is no override', {
    assert: async () => resolveRepos(roll, opts).t1.find(r => r.slug === 'millpond').path === paths.millpond,
    breaks: async () => { const f = join(opts.registryDir, 'millpond.md'); const t = readFileSync(f, 'utf8'); rmSync(f); return () => writeFileSync(f, t) }
  })
  await s.check('~/Projects/<slug> is the last resort, and every path is absolute', {
    assert: async () => { const t = resolveRepos(roll, opts); return t.t1[0].path === paths.orchard && t.t2.every(r => r.path.startsWith('/')) },
    breaks: async () => { const alt = { ...opts, projectsDir: join(home, 'nowhere') }; const real = resolveRepos; roll = parseRoll(BRIEF); const saved = opts.projectsDir; opts.projectsDir = alt.projectsDir; return () => { opts.projectsDir = saved; void real } }
  })
  await s.check('a slug that resolves nowhere is an error before anything is launched, naming the slug', {
    assert: async () => { try { resolveRepos(parseRoll(BRIEF.replace('- lantern', '- lantern\n- ghost')), opts); return false } catch (e) { return /ghost/.test(e.message) && /Projects\/ghost/.test(e.message) } },
    breaks: async () => { mkdirSync(join(home, 'Projects', 'ghost')); return () => rmSync(join(home, 'Projects', 'ghost'), { recursive: true }) }
  })

  // ---------------------------------------------------------------------------------------------
  // Status, read from the repos. A roll record with the fixture fleet, started after the old
  // commits; the states are then made in the repos themselves.
  const rollDir = join(tmp, 'rolls', 'lint-sweep-2026-01-02')
  mkdirSync(join(rollDir, 't1'), { recursive: true }); mkdirSync(join(rollDir, 't2'))
  const tabs = resolveRepos(parseRoll(BRIEF), opts)
  const record = {
    brief: join(tmp, 'ROLL.md'), name: 'lint-sweep-2026-01-02', title: 'Lint sweep', startedAt: '2021-01-01T00:00:00.000Z',
    commitSubject: 'chore: adopt the shared formatter',
    tabs: Object.fromEntries(Object.entries(tabs).map(([id, rs]) => [id, rs.map(r => ({ slug: r.slug, path: r.path }))])),
    reports: { t1: join(rollDir, 't1', 'REPORT.md'), t2: join(rollDir, 't2', 'REPORT.md') }
  }
  writeFileSync(join(rollDir, 'roll.json'), JSON.stringify(record))
  let fetchOff = false
  const kilnHead = () => git(['rev-parse', 'HEAD'], paths.kiln).slice(0, 7) // amends move it; read it live
  let ownerDates = { GIT_AUTHOR_DATE: OLD.GIT_AUTHOR_DATE }
  const stateOf = (slug) => { const st = rollStatus(rollDir, { fetch: !fetchOff }); for (const t of Object.values(st.tabs)) for (const r of t.repos) if (r.slug === slug) return r; return null }

  await s.check('a clean repo with no commit since the roll started is untouched', {
    assert: async () => stateOf('orchard').state === 'untouched',
    breaks: async () => { writeFileSync(join(paths.orchard, 'scratch.txt'), 'x'); return () => rmSync(join(paths.orchard, 'scratch.txt')) }
  })
  writeFileSync(join(paths.millpond, 'biome.json'), '{}\n')
  await s.check('a dirty tree is in progress', {
    assert: async () => stateOf('millpond').state === 'in progress',
    breaks: async () => { rmSync(join(paths.millpond, 'biome.json')); return () => writeFileSync(join(paths.millpond, 'biome.json'), '{}\n') }
  })
  const kilnSha = commit(paths.kiln, 'biome.json', 'chore: adopt the shared formatter')
  await s.check('a commit since start that is not on origin is committed <short>, read after a fetch', {
    assert: async () => { const r = stateOf('kiln'); return r.state === 'committed' && r.sha === kilnSha.slice(0, 7) },
    breaks: async () => { git(['push', '-q', 'origin', 'main'], paths.kiln); return () => { git(['push', '-q', '-f', 'origin', 'HEAD~1:main'], paths.kiln) } }
  })
  const beaconSha = commit(paths.beacon, 'biome.json', 'chore: adopt the shared formatter')
  git(['push', '-q', 'origin', 'main'], paths.beacon)
  await s.check('a commit that origin has is pushed; the remote is asked, not remembered', {
    assert: async () => { const r = stateOf('beacon'); return r.state === 'pushed' && r.sha === beaconSha.slice(0, 7) },
    // Move origin's main back one commit behind the rig's back: a stale tracking ref would still say pushed.
    breaks: async () => { const bare = join(tmp, 'remotes', 'beacon.git'); const old = git(['rev-parse', 'main~1'], bare); git(['update-ref', 'refs/heads/main', old], bare); return () => git(['update-ref', 'refs/heads/main', beaconSha], bare) }
  })
  // Second-round A: the fetch must refresh the remote the repo has, whatever its name. With the
  // remote called `github`, a rewind behind the rig's back must still turn `pushed` into `committed`.
  await s.check('pushed is re-read from a remote not named origin (fetch names the repo’s remote)', {
    assert: async () => {
      git(['remote', 'rename', 'origin', 'github'], paths.beacon)
      const bare = join(tmp, 'remotes', 'beacon.git'); const old = git(['rev-parse', 'main~1'], bare)
      git(['update-ref', 'refs/heads/main', old], bare)
      try { return stateOf('beacon').state === 'committed' } finally { git(['update-ref', 'refs/heads/main', beaconSha], bare); git(['remote', 'rename', 'github', 'origin'], paths.beacon); git(['fetch', '-q', 'origin'], paths.beacon) }
    },
    // Read without the fetch: the stale tracking ref still says pushed.
    breaks: async () => { const f = join(rollDir, 'roll.json'); void f; fetchOff = true; return () => { fetchOff = false } }
  })
  // Review finding 2: any commit since startedAt used to count as the roll's. Last week's sweep with
  // the same subject (dated before this roll) must not, and neither must the owner's unrelated commit
  // during the roll; and the sha reported is the tab's commit, not HEAD.
  await s.check('a commit with the roll subject but dated before the roll is not the roll’s (a re-run finds nothing)', {
    assert: async () => {
      git(['commit', '-q', '--amend', '--reset-author', '-m', 'chore: adopt the shared formatter'], paths.kiln, OLD)
      try { return stateOf('kiln').state === 'untouched' } finally { git(['commit', '-q', '--amend', '--reset-author', '-m', 'chore: adopt the shared formatter'], paths.kiln) }
    },
    breaks: async () => { const f = join(rollDir, 'roll.json'); const t = readFileSync(f, 'utf8'); writeFileSync(f, JSON.stringify({ ...record, startedAt: '2019-01-01T00:00:00.000Z' })); return () => writeFileSync(f, t) }
  })
  await s.check('an unrelated commit during the roll is not the roll’s, and the table names the tab’s sha, not HEAD', {
    assert: async () => {
      const tab = kilnHead()
      const owner = commit(paths.kiln, 'notes.txt', 'owner: unrelated change')
      try {
        const r = stateOf('kiln')
        if (r.state !== 'committed' || r.sha !== tab) throw new Error(JSON.stringify(r) + ' head=' + owner.slice(0, 7))
        git(['reset', '-q', '--hard', 'HEAD~1'], paths.kiln)
        writeFileSync(join(paths.orchard, 'x.txt'), 'x'); git(['add', '-A'], paths.orchard); git(['commit', '-qm', 'owner: unrelated change'], paths.orchard)
        try { return stateOf('orchard').state === 'untouched' } finally { git(['reset', '-q', '--hard', 'HEAD~1'], paths.orchard) }
      } finally { if (git(['log', '-1', '--format=%s'], paths.kiln) === 'owner: unrelated change') git(['reset', '-q', '--hard', 'HEAD~1'], paths.kiln) }
    },
    breaks: async () => { const f = join(rollDir, 'roll.json'); const t = readFileSync(f, 'utf8'); writeFileSync(f, JSON.stringify({ ...record, commitSubject: null })); return () => writeFileSync(f, t) }
  })
  await s.check('a repo with no remote and a commit is local only', {
    assert: async () => { commit(paths.lantern, 'biome.json', 'chore: adopt the shared formatter'); return stateOf('lantern').state === 'local only' },
    breaks: async () => { git(['remote', 'add', 'origin', join(tmp, 'remotes', 'beacon.git')], paths.lantern); return () => git(['remote', 'remove', 'origin'], paths.lantern) }
  })
  // Second-round C: a cherry-pick, rebase or `git am` on top keeps its old author date; the cutoff
  // is the committer date, so the tab's commit underneath is still found.
  await s.check('an owner commit on top with an old author date does not hide the tab’s commit', {
    assert: async () => {
      const tab = kilnHead()
      writeFileSync(join(paths.kiln, 'pick.txt'), 'x'); git(['add', '-A'], paths.kiln); git(['commit', '-qm', 'owner: cherry-picked from 2020'], paths.kiln, ownerDates)
      try { const r = stateOf('kiln'); if (r.state !== 'committed' || r.sha !== tab) throw new Error(JSON.stringify(r) + ' tab=' + tab); return true } finally { git(['reset', '-q', '--hard', 'HEAD~1'], paths.kiln) }
    },
    // A commit genuinely from before the roll (committer date old too) does stop the scan.
    breaks: async () => { ownerDates = OLD; return () => { ownerDates = { GIT_AUTHOR_DATE: OLD.GIT_AUTHOR_DATE } } }
  })
  await s.check('a remote not named origin is still a remote: an unpushed commit is committed, not local only', {
    assert: async () => {
      git(['remote', 'rename', 'origin', 'github'], paths.kiln)
      try { return stateOf('kiln').state === 'committed' } finally { git(['remote', 'rename', 'github', 'origin'], paths.kiln) }
    },
    breaks: async () => { const { remoteName } = await import('../src/roll.js'); void remoteName; git(['remote', 'remove', 'origin'], paths.kiln); return () => { git(['remote', 'add', 'origin', join(tmp, 'remotes', 'kiln.git')], paths.kiln); git(['fetch', '-q', 'origin'], paths.kiln) } }
  })
  writeFileSync(join(rollDir, 't1', 'REPORT.md'), '# t1\n- orchard: SKIPPED — no test suite, nothing to record\n')
  await s.check('a slug the tab’s report marks SKIPPED is skipped', {
    assert: async () => stateOf('orchard').state === 'skipped' && skippedIn('- `beacon`: SKIPPED — busy').has('beacon'),
    breaks: async () => { const f = join(rollDir, 't1', 'REPORT.md'); const t = readFileSync(f, 'utf8'); writeFileSync(f, '# t1\n- orchard: done later\n'); return () => writeFileSync(f, t) }
  })

  await s.check('a repo the tab SKIPped for a dirty tree is skipped, not in progress (the brief’s own rule)', {
    assert: async () => {
      writeFileSync(join(paths.orchard, 'wip.txt'), 'someone else’s work')
      try { return stateOf('orchard').state === 'skipped' } finally { rmSync(join(paths.orchard, 'wip.txt')) }
    },
    breaks: async () => { const f = join(rollDir, 't1', 'REPORT.md'); const t = readFileSync(f, 'utf8'); writeFileSync(f, '# t1\n'); return () => writeFileSync(f, t) }
  })
  // Review findings 4 and 5. The control is the loose parser that shipped in 28a3c1f, copied here:
  // any mention named a slug (and `-` before it let a longer slug match), and SKIPPED anywhere on a
  // line marked it skipped.
  // Second-round B: a SKIPPED line over a real roll commit is a contradiction the gate names, never
  // a pass. kiln has an unpushed roll commit; a SKIPPED line for it must not read as skipped.
  await s.check('a SKIPPED line over a repo that has a roll commit is a contradiction, not skipped', {
    assert: async () => {
      const f = join(rollDir, 't1', 'REPORT.md'); const t = readFileSync(f, 'utf8')
      writeFileSync(f, t + '- kiln: SKIPPED — changed my mind\n')
      try {
        const r = stateOf('kiln')
        if (r.state !== 'contradiction' || r.sha !== kilnHead()) throw new Error(JSON.stringify(r))
        const fc = finishChecks(rollDir, { fetch: false })
        return fc.checks.some(c => c.name.startsWith('kiln') && !c.ok && /SKIPPED but/.test(c.detail))
      } finally { writeFileSync(f, t) }
    },
    // Without the roll commit the same line is an honest SKIPPED.
    breaks: async () => { git(['commit', '-q', '--amend', '--reset-author', '-m', 'chore: unrelated'], paths.kiln); return () => git(['commit', '-q', '--amend', '--reset-author', '-m', 'chore: adopt the shared formatter'], paths.kiln) }
  })
  // Second-round D: `- Beacon: SKIPPED` means beacon.
  const { reportLines, namedIn } = await import('../src/roll.js')
  const legacyLines = (text) => { const out = new Map(); for (const line of (text || '').split('\n')) { const m = line.match(/^\s*[-*]\s*`?([A-Za-z0-9._-]+)`?\s*:\s*(done|SKIPPED)\b/i); if (m) out.set(m[1], { state: m[2].toUpperCase() === 'SKIPPED' ? 'skipped' : 'done' }) } return out }
  let linesFn = reportLines
  await s.check('a capitalised slug on a report line still names the lower-case slug', {
    assert: async () => { const l = linesFn('- Beacon: SKIPPED — busy\n- Lantern: done abc1234\n'); return l.get('beacon')?.state === 'skipped' && l.get('lantern')?.state === 'done' },
    breaks: async () => { linesFn = legacyLines; return () => { linesFn = reportLines } }
  })
  let capLine = '- Beacon: SKIPPED — busy\n'
  await s.check('namedIn and skippedIn see the capitalised line too', {
    assert: async () => namedIn(capLine, ['beacon']).has('beacon') && skippedIn(capLine).has('beacon'),
    breaks: async () => { capLine = '- Beacon SKIPPED — busy\n'; return () => { capLine = '- Beacon: SKIPPED — busy\n' } }
  })
  const legacyNamed = (text, slugs) => new Set(slugs.filter(s => new RegExp('(^|[\\s`*-])' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[\\s`:*,.)]|$)', 'm').test(text || '')))
  const legacySkipped = (text) => { const out = new Set(); for (const line of (text || '').split('\n')) { const m = line.match(/^\s*[-*]?\s*`?([A-Za-z0-9._-]+)`?\s*:\s*SKIPPED\b/i) || (/\bSKIPPED\b/.test(line) && line.match(/^\s*[-*]\s*`?([A-Za-z0-9._-]+)`?/)); if (m) out.add(m[1]) } return out }
  let named = namedIn, skippedFn = skippedIn
  await s.check('report lines are read strictly: `- <slug>: done|SKIPPED` only; prose, headings and longer slugs do not count', {
    assert: async () => {
      const text = '# t2 — beacon and lantern pending\n- home-care-visits: done abc1234 — formatted\n- beacon: not started yet\n- orchard: done def5678 — SKIPPED the lint step, tests were red\n- Note: nothing was SKIPPED\n- `kiln`: SKIPPED — dirty tree\n'
      const got = named(text, ['visits', 'care-visits', 'home-care-visits', 'beacon', 'lantern', 'orchard', 'Note', 'kiln'])
      if ([...got].sort().join(',') !== 'home-care-visits,kiln,orchard') throw new Error('named: ' + [...got])
      const lines = reportLines(text)
      if (lines.get('orchard').state !== 'done' || lines.get('orchard').sha !== 'def5678') throw new Error('orchard: ' + JSON.stringify(lines.get('orchard')))
      const sk = skippedFn(text)
      return sk.has('kiln') && !sk.has('orchard') && !sk.has('Note') && sk.size === 1
    },
    breaks: async () => { named = legacyNamed; skippedFn = legacySkipped; return () => { named = namedIn; skippedFn = skippedIn } }
  })

  // ---------------------------------------------------------------------------------------------
  // The finish gate: with millpond dirty and kiln unpushed it fails, naming both; once every repo
  // is clean, pushed or SKIPPED and every report names its slugs, it passes and jots once.
  await s.check('rig roll finish fails while a repo is dirty or unpushed, and names each', {
    assert: async () => {
      const r = finishChecks(rollDir)
      const bad = r.checks.filter(c => !c.ok).map(c => c.name)
      return !r.ok && bad.some(n => n.startsWith('millpond')) && bad.some(n => n.startsWith('kiln')) && bad.some(n => n.startsWith('t2 report'))
    },
    breaks: async () => {
      // Make everything pass, then the assertion (which expects failure) must go red.
      rmSync(join(paths.millpond, 'biome.json')); commit(paths.millpond, 'biome.json', 'chore: adopt the shared formatter'); git(['push', '-q', 'origin', 'main'], paths.millpond)
      git(['push', '-q', 'origin', 'main'], paths.kiln)
      writeFileSync(join(rollDir, 't1', 'REPORT.md'), '# t1\n- orchard: SKIPPED — no test suite\n- millpond: done — formatted\n- kiln: done — formatted\n')
      writeFileSync(join(rollDir, 't2', 'REPORT.md'), '# t2\n- beacon: done — formatted\n- lantern: done — formatted, local only\n')
      return () => {} // the passing state is what the next checks need
    }
  })
  process.env.JOT_LOG = join(tmp, 'jot.log')
  const savedPath = process.env.PATH
  process.env.PATH = stubDir + ':' + savedPath
  await s.check('a passing finish writes ROLL-FINISH.md and jots "[workflow] roll <name>: N pushed, M skipped, K local" once', {
    assert: async () => {
      rmSync(process.env.JOT_LOG, { force: true })
      const r = finish([rollDir], {})
      const log = existsSync(process.env.JOT_LOG) ? readFileSync(process.env.JOT_LOG, 'utf8') : ''
      if (!r.ok) throw new Error('gate failed: ' + JSON.stringify(r.rows))
      if (log.trim() !== '[workflow] roll lint-sweep-2026-01-02: 3 pushed, 1 skipped, 1 local') throw new Error('jot log: ' + JSON.stringify(log))
      return existsSync(join(rollDir, 'ROLL-FINISH.md')) && readFileSync(join(rollDir, 'ROLL-FINISH.md'), 'utf8').includes('| kiln')
    },
    // Drop lantern from t2's report: the gate fails and jot must not run.
    breaks: async () => { const f = join(rollDir, 't2', 'REPORT.md'); const t = readFileSync(f, 'utf8'); writeFileSync(f, '# t2\n- beacon: done — formatted\n'); rmSync(join(rollDir, 'ROLL-FINISH.md'), { force: true }); return () => { writeFileSync(f, t); process.exitCode = 0 } }
  })
  rmSync(process.env.JOT_LOG, { force: true })
  await s.check('a failing finish does not jot', {
    assert: async () => {
      const f = join(rollDir, 't2', 'REPORT.md'); const t = readFileSync(f, 'utf8'); writeFileSync(f, '# t2\n- beacon: done\n')
      try { finish([rollDir], {}) } finally { writeFileSync(f, t); process.exitCode = 0 }
      return !existsSync(process.env.JOT_LOG)
    },
    breaks: async () => { writeFileSync(process.env.JOT_LOG, 'stale\n'); return () => rmSync(process.env.JOT_LOG, { force: true }) }
  })
  process.env.PATH = savedPath

  // ---------------------------------------------------------------------------------------------
  // The launch: one tab per list, every one in the workspace the rig runs in, none anywhere else.
  const briefFile = join(tmp, 'lint-sweep.md')
  writeFileSync(briefFile, BRIEF)
  const rollsBase = join(tmp, 'rolls-launch')
  const log = join(tmp, 'herdr.log')
  const realRunUp = (pane, extra = [], clean = true, envExtra = {}) => {
    rmSync(log, { force: true }); if (clean) rmSync(rollsBase, { recursive: true, force: true })
    const script = `import('${join(here, '..', 'src', 'commands', 'roll.js')}').then(m => m.default(${JSON.stringify(['up', briefFile, '--dir', rollsBase, ...extra])})).catch(e => { console.error(e.message); process.exit(1) })`
    return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8', cwd: tmp,
      env: { ...process.env, HOME: home, PATH: stubDir + ':' + process.env.PATH, HERDR_ENV: '1', HERDR_PANE_ID: pane, HERDR_LOG: log, HERDR_TABS: '', ...envExtra }
    })
  }
  const runUpWith = (envExtra) => realRunUp('w7:p1', [], true, envExtra)
  let runUp = realRunUp
  const creates = () => (existsSync(log) ? readFileSync(log, 'utf8') : '').split('\n').filter(l => l.startsWith('tab create'))
  let pane = 'w7:p1'
  await s.check('rig roll up opens exactly one tab per list, each with --workspace <the rig’s own>, and none anywhere else', {
    assert: async () => {
      const out = runUp(pane)
      const all = creates()
      const home7 = all.filter(l => l.includes('--workspace w7'))
      if (all.length !== 2 || home7.length !== 2) throw new Error(`tab create lines: ${JSON.stringify(all)}`)
      if (!all[0].includes(`--cwd ${paths.orchard}`) || !all[0].includes('--label t1')) throw new Error('t1 tab: ' + all[0])
      if (!all[1].includes(`--cwd ${paths.beacon}`) || !all[1].includes('--label t2')) throw new Error('t2 tab: ' + all[1])
      if (readFileSync(log, 'utf8').includes('workspace create')) throw new Error('a workspace was created')
      const dirs = readdirSync(rollsBase)
      const rd = join(rollsBase, dirs[0])
      const rec = JSON.parse(readFileSync(join(rd, 'roll.json'), 'utf8'))
      if (!rec.startedAt || rec.tabs.t1.length !== 3 || rec.tabs.t2[1].slug !== 'lantern' || rec.tabs.t1[2].path !== paths.kiln) throw new Error('roll.json: ' + JSON.stringify(rec))
      const run = readFileSync(log, 'utf8').split('\n').filter(l => l.startsWith('pane run'))
      if (!run[0].includes(`Read ${join(rd, 't1', 'BRIEF.md')} and follow it.`)) throw new Error('launch command: ' + run[0])
      return /2 tab\(s\), 5 repo\(s\)/.test(out)
    },
    breaks: async () => { pane = 'w9:p1'; return () => { pane = 'w7:p1' } }
  })
  // Review finding 6: the tab is launched in the first repo; the rest of its list must be added as
  // working directories or every write there raises a permission prompt.
  await s.check('the launch adds every other repo in the list with --add-dir, in list order', {
    assert: async () => {
      runUp('w7:p1')
      const run = readFileSync(log, 'utf8').split('\n').filter(l => l.startsWith('pane run'))
      if (!run[0].includes(`--add-dir ${paths.millpond} --add-dir ${paths.kiln} "Read`)) throw new Error('t1 launch: ' + run[0])
      if (run[0].includes(`--add-dir ${paths.orchard}`)) throw new Error('the cwd repo was added twice')
      return run[1].includes(`--add-dir ${paths.lantern}`)
    },
    breaks: async () => { runUp = (pane, extra = []) => realRunUp(pane, [...extra, '--launch', 'codex --model x']); return () => { runUp = realRunUp } }
  })
  // Second-round E: the launch line is typed into a shell; a path with a space must be quoted.
  const { addDirs } = await import('../src/commands/roll.js')
  const legacyAddDirs = (cmd, repos) => /^\s*claude(\s|$)/.test(cmd) ? repos.slice(1).map(r => ` --add-dir ${r.path}`).join('') : ''
  let add = addDirs
  await s.check('--add-dir paths are shell-quoted, so a repo path with a space stays one argument', {
    assert: async () => add('claude --effort low', [{ path: '/a/first' }, { path: '/a/mill house' }, { path: '/a/plain' }]) === " --add-dir '/a/mill house' --add-dir /a/plain",
    breaks: async () => { add = legacyAddDirs; return () => { add = addDirs } }
  })
  // Review finding 3: a tab with one of the roll's ids already open belongs to someone else; a
  // second set of same-named tabs would let `down` on either roll close both.
  let openTabs = JSON.stringify([{ tab_id: 'w7:t5', label: 't1' }])
  await s.check('rig roll up refuses when a tab with one of its ids is already open, and creates nothing', {
    assert: async () => {
      let err = ''
      try { runUpWith({ HERDR_TABS: openTabs, HERDR_PANES: JSON.stringify([{ pane_id: 'w7:p5', tab_id: 'w7:t5' }]) }) } catch (e) { err = e.stderr + e.stdout }
      const noCreates = !(existsSync(log) && readFileSync(log, 'utf8').includes('tab create'))
      if (!/already open .* t1/.test(err)) throw new Error('did not refuse: ' + err.slice(-300))
      return noCreates && !existsSync(rollsBase)
    },
    breaks: async () => { openTabs = JSON.stringify([{ tab_id: 'w7:t5', label: 'c1' }]); return () => { openTabs = JSON.stringify([{ tab_id: 'w7:t5', label: 't1' }]) } }
  })
  await s.check('each tab’s brief carries its resolved repos, the procedure, the hard rules, the report path and the commit discipline', {
    assert: async () => {
      const rd = join(rollsBase, readdirSync(rollsBase)[0])
      const b = readFileSync(join(rd, 't1', 'BRIEF.md'), 'utf8')
      return ['`kiln`  ' + paths.kiln, '1. Record the test result', '- Never commit over a dirty tree', join(rd, 't1', 'REPORT.md'), 'Never run `wrap` or `sync`', 'apps touch <slug>', 'chore: adopt the shared formatter'].every(x => b.includes(x)) && !b.includes('beacon')
    },
    breaks: async () => {
      const rd = join(rollsBase, readdirSync(rollsBase)[0]); const f = join(rd, 't1', 'BRIEF.md'); const t = readFileSync(f, 'utf8')
      writeFileSync(f, tabBrief({ ...parseRoll(BRIEF), procedure: [] }, 't1', [], { rollDir: rd, reportPath: 'x', briefPath: f }))
      return () => writeFileSync(f, t)
    }
  })
  await s.check('--dry-run and --help create nothing and launch nothing', {
    assert: async () => {
      rmSync(rollsBase, { recursive: true, force: true })
      runUp('w7:p1', ['--dry-run'], false)
      const a = !existsSync(rollsBase) && creates().length === 0
      const script = `import('${join(here, '..', 'src', 'commands', 'roll.js')}').then(m => m.default(['up', '--help']))`
      const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, HOME: home, RIG_ROLLS_DIR: rollsBase } })
      return a && /rig roll up <brief.md>/.test(out) && !existsSync(rollsBase)
    },
    breaks: async () => { runUp = (pane, extra) => realRunUp(pane, extra.filter(a => a !== '--dry-run'), false); return () => { runUp = realRunUp } }
  })

  // ---------------------------------------------------------------------------------------------
  // Down closes only this roll's tab ids, never another crew's tabs in the same workspace.
  await s.check('rig roll down closes the roll’s tabs by id and leaves another crew’s tab alone', {
    assert: async () => {
      rmSync(log, { force: true })
      Object.assign(process.env, { HERDR_ENV: '1', HERDR_PANE_ID: 'w7:p1', HERDR_LOG: log, PATH: stubDir + ':' + savedPath, HERDR_TABS: JSON.stringify([{ tab_id: 'w7:t1', label: 't1' }, { tab_id: 'w7:t2', label: 't2' }, { tab_id: 'w7:t3', label: 'c1' }]) })
      try { down([rollDir], { terminal: 'herdr' }) } finally { delete process.env.HERDR_ENV; delete process.env.HERDR_PANE_ID; process.env.PATH = savedPath }
      const closes = readFileSync(log, 'utf8').split('\n').filter(l => l.startsWith('tab close')).sort()
      if (closes.join('|') !== 'tab close w7:t1|tab close w7:t2') throw new Error('closed: ' + JSON.stringify(closes))
      return true
    },
    breaks: async () => { const f = join(rollDir, 'roll.json'); const t = readFileSync(f, 'utf8'); writeFileSync(f, JSON.stringify({ ...record, tabs: { t1: record.tabs.t1 } })); return () => writeFileSync(f, t) }
  })
  let downArgs = [rollDir]
  await s.check('rig roll down refuses over a dirty repo unless --force', {
    assert: async () => {
      writeFileSync(join(paths.beacon, 'wip.txt'), 'x')
      rmSync(log, { force: true })
      Object.assign(process.env, { HERDR_ENV: '1', HERDR_PANE_ID: 'w7:p1', HERDR_LOG: log, PATH: stubDir + ':' + savedPath, HERDR_TABS: JSON.stringify([{ tab_id: 'w7:t1', label: 't1' }]) })
      try { down(downArgs, { terminal: 'herdr' }) } finally { delete process.env.HERDR_ENV; delete process.env.HERDR_PANE_ID; process.env.PATH = savedPath; rmSync(join(paths.beacon, 'wip.txt')) }
      const refused = process.exitCode === 1; process.exitCode = 0
      return refused && !(existsSync(log) && readFileSync(log, 'utf8').includes('tab close'))
    },
    breaks: async () => { downArgs = [rollDir, '--force']; return () => { downArgs = [rollDir] } }
  })
})

rmSync(tmp, { recursive: true, force: true })
