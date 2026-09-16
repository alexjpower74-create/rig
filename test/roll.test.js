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
const git = (args, cwd, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } }).trim()

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
  "pane list") echo '{"result":{"panes":[]}}' ;;
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
  const stateOf = (slug) => { const st = rollStatus(rollDir); for (const t of Object.values(st.tabs)) for (const r of t.repos) if (r.slug === slug) return r; return null }

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
  // Re-date the kiln commit to before the roll: only its subject can identify it now.
  git(['commit', '-q', '--amend', '--reset-author', '-m', 'chore: adopt the shared formatter'], paths.kiln, OLD)
  await s.check('a commit dated before the roll but carrying the commit subject is found by the subject alone', {
    assert: async () => stateOf('kiln').state === 'committed',
    breaks: async () => { git(['commit', '-q', '--amend', '--reset-author', '-m', 'chore: unrelated'], paths.kiln, OLD); return () => git(['commit', '-q', '--amend', '--reset-author', '-m', 'chore: adopt the shared formatter'], paths.kiln, OLD) }
  })
  await s.check('a repo with no remote and a commit is local only', {
    assert: async () => { commit(paths.lantern, 'biome.json', 'chore: adopt the shared formatter'); return stateOf('lantern').state === 'local only' },
    breaks: async () => { git(['remote', 'add', 'origin', join(tmp, 'remotes', 'beacon.git')], paths.lantern); return () => git(['remote', 'remove', 'origin'], paths.lantern) }
  })
  writeFileSync(join(rollDir, 't1', 'REPORT.md'), '# t1\n- orchard: SKIPPED — no test suite, nothing to record\n')
  await s.check('a slug the tab’s report marks SKIPPED is skipped', {
    assert: async () => stateOf('orchard').state === 'skipped' && skippedIn('- `beacon`: SKIPPED — busy').has('beacon'),
    breaks: async () => { const f = join(rollDir, 't1', 'REPORT.md'); const t = readFileSync(f, 'utf8'); writeFileSync(f, '# t1\n- orchard: done later\n'); return () => writeFileSync(f, t) }
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
  const realRunUp = (pane, extra = [], clean = true) => {
    rmSync(log, { force: true }); if (clean) rmSync(rollsBase, { recursive: true, force: true })
    const script = `import('${join(here, '..', 'src', 'commands', 'roll.js')}').then(m => m.default(${JSON.stringify(['up', briefFile, '--dir', rollsBase, ...extra])}))`
    return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8', cwd: tmp,
      env: { ...process.env, HOME: home, PATH: stubDir + ':' + process.env.PATH, HERDR_ENV: '1', HERDR_PANE_ID: pane, HERDR_LOG: log, HERDR_TABS: '' }
    })
  }
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
