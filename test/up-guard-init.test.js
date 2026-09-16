// rg2 (Rig 3.0): per-repo worktrees, the guard on an unborn HEAD and on main, one issue per slice,
// the registry at init, the plan's Issue:/Negative controls lines, and the herdr tabs staying in
// the current workspace.
//
// Every external tool the rig shells out to here (gh, apps, herdr, and rig itself for the hook) is
// a stub on a PATH the test owns, recording its argv, so nothing reaches GitHub, the registry or a
// terminal. HOME is a temp directory: the registry file and Claude's trust file live there.

import { suite } from '../harness/check.js'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync, realpathSync, readFileSync, chmodSync, symlinkSync, appendFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const rigBin = join(here, '..', 'bin', 'rig.js')
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rig-rg2-')))
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const rig = (args, cwd, env = {}) => spawnSync('node', [rigBin, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } })
const which = cmd => execFileSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).trim()

// ---------------------------------------------------------------------------------------------
// Stubs. `bin` has every tool; `binNoGh` has only what git and node need, so `gh` is absent.
const bin = join(tmp, 'bin'); mkdirSync(bin)
const binNoGh = join(tmp, 'bin-nogh'); mkdirSync(binNoGh)
const home = join(tmp, 'home'); mkdirSync(join(home, '.claude', 'apps'), { recursive: true })
writeFileSync(join(home, '.claude.json'), '{}\n')
const logs = { gh: join(tmp, 'gh.log'), apps: join(tmp, 'apps.log'), herdr: join(tmp, 'herdr.log') }
const ghState = { list: join(tmp, 'gh-list.json'), next: join(tmp, 'gh-next') }
writeFileSync(ghState.list, '[]'); writeFileSync(ghState.next, '11')

const stub = (dir, name, body) => { const p = join(dir, name); writeFileSync(p, '#!/bin/sh\n' + body); chmodSync(p, 0o755) }
stub(bin, 'rig', `exec "${which('node')}" "${rigBin}" "$@"\n`)
stub(bin, 'gh', `echo "$@" >> "${logs.gh}"
case "$1 $2" in
  "--version ") echo "gh 0.0 (stub)";;
  "auth status") exit \${GH_AUTH_EXIT:-0};;
  "issue list") if [ -n "$GH_FULL" ]; then "${which('node')}" -e '
      const a=process.argv.slice(1); const st=a[a.indexOf("--state")+1]||"open"; const li=a.includes("--limit")?Number(a[a.indexOf("--limit")+1]):30;
      const all=JSON.parse(require("fs").readFileSync(process.env.GH_FULL,"utf8")).sort((x,y)=>y.number-x.number);
      console.log(JSON.stringify(all.filter(i=>st==="all"||i.state.toLowerCase()===st).slice(0,li)))' -- "$@"; else cat "${ghState.list}"; fi;;
  "issue view") echo "{\\"number\\": $3, \\"url\\": \\"https://example.invalid/o/r/issues/$3\\"}";;
  "issue create") n=$(cat "${ghState.next}"); echo "https://example.invalid/o/r/issues/$n"; echo $((n+1)) > "${ghState.next}";;
  *) exit 1;;
esac
`)
stub(bin, 'apps', `echo "$@" >> "${logs.apps}"
case "$1" in
  new) f="$HOME/.claude/apps/$2.md"; [ -e "$f" ] && { echo "$f exists" >&2; exit 1; }; printf -- "---\\nname: %s\\n---\\n" "$3" > "$f"; echo "$f";;
  *) exit 2;;
esac
`)
stub(bin, 'herdr', `echo "$@" >> "${logs.herdr}"
case "$1 $2" in
  "--version ") echo "herdr 0.0 (stub)";;
  "tab create") echo '{"result":{"root_pane":{"pane_id":"p9"}}}';;
  "pane run") echo '{"result":{}}';;
  "pane wait-output") exit 1;;
  "pane list") echo '{"result":{"panes":[]}}';;
  "tab list") echo '{"result":{"tabs":[]}}';;
  *) echo '{"result":{}}';;
esac
`)
for (const t of ['git', 'node', 'sh']) symlinkSync(which(t), join(binNoGh, t))
// git's own helpers (git-remote-https, …) live under its exec path; keep them reachable.
const gitExec = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim()

const saved = { PATH: process.env.PATH, HOME: process.env.HOME, HERDR_ENV: process.env.HERDR_ENV, HERDR_PANE_ID: process.env.HERDR_PANE_ID }
const restoreEnv = () => { for (const [k, v] of Object.entries(saved)) { if (v == null) delete process.env[k]; else process.env[k] = v } }
// The stub dir first; the real PATH only when gh is meant to be found (binNoGh stands alone).
const setPath = dir => { process.env.PATH = dir === binNoGh ? `${dir}:${gitExec}` : `${dir}:${gitExec}:${saved.PATH}` }
setPath(bin)
process.env.HOME = home

const PLAN = (extra = '') => `# Depot draw

## What it's for
A prize draw at the depot.

## Who uses it, on what
Staff, on a tablet.

## What done looks like
A winner on screen.

## What must not happen
- Never announce a winner twice.

## Where it lives
Local, private.

## Checks
- npm test
Negative controls: \`npm run demo\`

## Agents

### c1 — The entry page
Owns:
- app/**

Task:
Build the entry page.

### c2 — The draw
Owns:
- draw/**
${extra}
Task:
Run the draw.

### c3 — The third
Owns:
- third/**

Task:
Third thing.
`

function repoAt (name, planText, opts = {}) {
  const repo = join(tmp, name)
  mkdirSync(repo, { recursive: true })
  git(['init', '-q', '-b', 'main'], repo)
  git(['config', 'user.email', 'test@example.invalid'], repo)
  git(['config', 'user.name', 'Rig Test'], repo)
  if (planText) writeFileSync(join(repo, 'PLAN.md'), planText)
  writeFileSync(join(repo, 'README.md'), `# ${name}\n`)
  if (opts.commit !== false) { git(['add', '-A'], repo); git(['commit', '-qm', 'base'], repo) }
  return repo
}

await suite('rig 3.0: up, guard, init', async s0 => {
  // The harness records a thrown assertion's message but does not print it; RIG_TEST_DEBUG=1 does.
  const s = { check: (name, o) => s0.check(name, { ...o, assert: async () => { try { return await o.assert() } catch (e) { if (process.env.RIG_TEST_DEBUG) console.error('      ' + e.message); throw e } } }) }
  const { loadConfig, currentBranchOrNull, headState, DEFAULTS } = await import('../src/config.js')
  const { worktreeBase } = await import('../src/worktrees.js')
  const { parsePlan, loadPlan } = await import('../src/plan.js')
  const { briefFor } = await import('../src/brief.js')
  const { openSliceIssues, loadIssues, issuesPath } = await import('../src/issues.js')
  const { slugFor } = await import('../src/commands/init.js')
  const { terminal } = await import('../src/terminal.js')

  // -------------------------------------------------------------------------------------------
  // Per-project worktrees. Two repos side by side used to share ../.rig-worktrees and collide on
  // `qa`. Red when: both configs name the same base explicitly (the 2.0 default written out).
  const alpha = repoAt('side/alpha', null)
  const beta = repoAt('side/beta', null)
  await s.check('two repos side by side get different default worktree bases, each named for its repo', {
    assert: async () => {
      const a = worktreeBase(alpha, loadConfig(alpha)); const b = worktreeBase(beta, loadConfig(beta))
      if (a === b) throw new Error(`both resolve to ${a}`)
      if (!a.endsWith('/.rig-worktrees/alpha') || !b.endsWith('/.rig-worktrees/beta')) throw new Error(`${a} / ${b}`)
      return dirname(a) === dirname(b) && DEFAULTS.worktreeDir === '../.rig-worktrees'
    },
    breaks: async () => {
      // One explicit shared directory in both configs (the literal 2.0 default now reads as unset).
      for (const r of [alpha, beta]) { mkdirSync(join(r, '.rig')); writeFileSync(join(r, '.rig', 'config.json'), JSON.stringify({ worktreeDir: '../.shared-trees' })) }
      return () => { for (const r of [alpha, beta]) rmSync(join(r, '.rig'), { recursive: true }) }
    }
  })

  // `rig init` writes the resolved value into the config and ignores .rig/ only. Red when: a config
  // written beforehand names another directory — which is also the proof that an explicit value wins.
  const spaced = repoAt('My Repo', null)
  await s.check('rig init writes the resolved worktreeDir and the slug, and gitignores .rig/ only', {
    assert: async () => {
      const r = rig(['init', '--no-registry'], spaced)
      if (r.status !== 0) throw new Error(r.stderr || r.stdout)
      const cfg = JSON.parse(readFileSync(join(spaced, '.rig', 'config.json'), 'utf8'))
      if (cfg.worktreeDir !== '../.rig-worktrees/My Repo') throw new Error(`worktreeDir ${cfg.worktreeDir}`)
      if (cfg.slug !== 'my-repo') throw new Error(`slug ${cfg.slug}`)
      const ignore = readFileSync(join(spaced, '.gitignore'), 'utf8').split('\n')
      return ignore.includes('.rig/') && !ignore.includes('.worktrees/')
    },
    breaks: async () => {
      rmSync(join(spaced, '.rig'), { recursive: true, force: true })
      mkdirSync(join(spaced, '.rig')); writeFileSync(join(spaced, '.rig', 'config.json'), JSON.stringify({ worktreeDir: '/elsewhere/trees' }))
      return () => rmSync(join(spaced, '.rig'), { recursive: true, force: true })
    }
  })

  // -------------------------------------------------------------------------------------------
  // The guard on an unborn branch. Red when: the hook is made to fail — proving the commit went
  // through the hook, not around it.
  const fresh = repoAt('fresh', null, { commit: false })
  const hookPath = () => join(fresh, git(['rev-parse', '--git-path', 'hooks'], fresh), 'pre-commit')
  await s.check('a fresh repo with the guard hook installed makes its first commit', {
    assert: async () => {
      if (currentBranchOrNull(fresh) !== null) throw new Error('HEAD should be unborn before the first commit')
      const init = rig(['init', '--hook', '--no-registry'], fresh)
      if (init.status !== 0) throw new Error(init.stderr || init.stdout)
      git(['add', '-A'], fresh)
      const c = spawnSync('git', ['commit', '-qm', 'first'], { cwd: fresh, encoding: 'utf8', env: process.env })
      if (c.status !== 0) throw new Error(`commit refused: ${c.stderr} ${c.stdout}`)
      if (!/unborn branch: nothing to enforce yet/.test(c.stdout + c.stderr)) throw new Error(`hook said: ${c.stdout} ${c.stderr}`)
      if (currentBranchOrNull(fresh) !== 'main') throw new Error('after the commit, the branch should be main')
      // Reset for the negative control and any re-run: back to an unborn HEAD with the hook in place.
      git(['update-ref', '-d', 'refs/heads/main'], fresh)
      return true
    },
    breaks: async () => {
      const before = existsSync(hookPath()) ? readFileSync(hookPath(), 'utf8') : null
      // `rig init --hook` rewrites the hook, so the broken one has to survive that: wrap rig itself.
      const brokenRig = join(tmp, 'bin-broken'); mkdirSync(brokenRig, { recursive: true })
      stub(brokenRig, 'rig', `case "$1" in guard) exit 1;; *) exec "${which('node')}" "${rigBin}" "$@";; esac\n`)
      const path = process.env.PATH; process.env.PATH = `${brokenRig}:${path}`
      return () => { process.env.PATH = path; if (before != null) writeFileSync(hookPath(), before) }
    }
  })

  // `--staged` off a slice branch: the lead on main, with another slice's worktree dirty. Red when:
  // the same call is made without --staged, which is the sweep, which sees c1's stray edit.
  const lead = repoAt('lead', PLAN())
  mkdirSync(join(lead, '.rig')); writeFileSync(join(lead, '.rig', 'config.json'), JSON.stringify({ worktreeDir: '.worktrees' }))
  writeFileSync(join(lead, '.gitignore'), '.rig/\n.worktrees/\n'); git(['add', '.gitignore'], lead); git(['commit', '-qm', 'ignore'], lead)
  git(['worktree', 'add', '-q', join(lead, '.worktrees', 'c1'), '-b', 'rig/c1'], lead)
  mkdirSync(join(lead, '.worktrees', 'c1', 'node_modules')); writeFileSync(join(lead, '.worktrees', 'c1', 'node_modules', 'x.js'), '1')
  writeFileSync(join(lead, '.worktrees', 'c1', 'README.md'), '# edited outside the slice\n')
  mkdirSync(join(lead, 'docs')); writeFileSync(join(lead, 'docs', 'review-c1.md'), '# review\n'); git(['add', 'docs/review-c1.md'], lead)
  const guardFlags = ['--staged']
  await s.check('--staged on main passes without sweeping other worktrees (a review-file commit is not refused)', {
    assert: async () => {
      const r = rig(['guard', ...guardFlags], lead)
      if (r.status !== 0) throw new Error(`exit ${r.status}: ${r.stderr}`)
      return /not a slice branch \(main\); guard enforces slices only/.test(r.stdout)
    },
    breaks: async () => { guardFlags.length = 0; return () => { guardFlags.push('--staged') } }
  })

  // …and the guard still refuses a slice that stages a file outside its slice. Red when: the staged
  // file is inside the slice.
  const c1wt = join(lead, '.worktrees', 'c1')
  let strayFile = 'README.md'
  await s.check('--staged in a slice worktree still refuses a file outside the slice', {
    assert: async () => {
      git(['reset', '-q'], c1wt)
      mkdirSync(join(c1wt, 'app'), { recursive: true }); writeFileSync(join(c1wt, 'app', 'x.js'), '1\n')
      git(['add', strayFile], c1wt)
      const r = rig(['guard', '--staged'], c1wt)
      git(['reset', '-q'], c1wt)
      return r.status === 1 && /REFUSED/.test(r.stderr) && r.stderr.includes(strayFile)
    },
    breaks: async () => { strayFile = 'app/x.js'; return () => { strayFile = 'README.md' } }
  })

  // -------------------------------------------------------------------------------------------
  // Issues per slice. gh is the stub: c1 has only a CLOSED issue (so a new one is created), c2 is
  // pinned by the plan's Issue: line, c3 has an OPEN one to reuse. Red when: origin is removed.
  const iss = repoAt('iss', PLAN('\nIssue: #7\n'))
  git(['remote', 'add', 'origin', 'https://example.invalid/o/r.git'], iss)
  writeFileSync(ghState.list, JSON.stringify([
    { number: 2, title: 'c1 The entry page', state: 'CLOSED', url: 'https://example.invalid/o/r/issues/2' },
    { number: 3, title: 'c3 The third', state: 'OPEN', url: 'https://example.invalid/o/r/issues/3' },
    { number: 4, title: 'c30 not ours', state: 'OPEN', url: 'https://example.invalid/o/r/issues/4' }
  ]))
  const ghCalls = re => (existsSync(logs.gh) ? readFileSync(logs.gh, 'utf8') : '').split('\n').filter(l => re.test(l))
  await s.check('rig up opens one issue per slice: create when none is open, reuse an open one, honour the plan’s Issue: line', {
    assert: async () => {
      rmSync(issuesPath(iss), { force: true }); rmSync(logs.gh, { force: true }); writeFileSync(ghState.next, '11')
      const plan = loadPlan(join(iss, 'PLAN.md'))
      const r = openSliceIssues(iss, plan, loadConfig(iss))
      if (!r.ran) throw new Error(`did not run: ${r.why} ${JSON.stringify(r.lines)}`)
      const rec = loadIssues(iss)
      if (rec.c1?.number !== 11 || !rec.c1.url.endsWith('/issues/11')) throw new Error(`c1: ${JSON.stringify(rec.c1)}`)
      if (rec.c2?.number !== 7 || !rec.c2.url.endsWith('/issues/7')) throw new Error(`c2: ${JSON.stringify(rec.c2)}`)
      if (rec.c3?.number !== 3) throw new Error(`c3: ${JSON.stringify(rec.c3)}`)
      const creates = ghCalls(/^issue create/)
      if (creates.length !== 1 || !creates[0].includes('--title c1 The entry page')) throw new Error(`creates: ${creates.join(' | ')}`)
      return r.lines.length === 3 && r.lines.some(l => /c1\s+issue #11 \(opened\)/.test(l)) && r.lines.some(l => /c3\s+issue #3 \(reused/.test(l))
    },
    breaks: async () => { git(['remote', 'remove', 'origin'], iss); return () => git(['remote', 'add', 'origin', 'https://example.invalid/o/r.git'], iss) }
  })

  // A second `rig up` opens nothing new. Red when: the record is deleted between runs.
  let loseRecord = false
  await s.check('a second rig up reuses the recorded issues and calls gh issue create for none', {
    assert: async () => {
      const plan = loadPlan(join(iss, 'PLAN.md'))
      rmSync(issuesPath(iss), { force: true }); writeFileSync(ghState.next, '11')
      openSliceIssues(iss, plan, loadConfig(iss)) // first rig up: records c1=#11, c2=#7, c3=#3
      if (loseRecord) rmSync(issuesPath(iss), { force: true })
      rmSync(logs.gh, { force: true })
      const r = openSliceIssues(iss, plan, loadConfig(iss)) // second rig up
      return r.ran && ghCalls(/^issue create/).length === 0 && loadIssues(iss).c1.number === 11
    },
    breaks: async () => { loseRecord = true; return () => { loseRecord = false } }
  })

  // No gh on PATH: said once, not fatal. Red when: gh is back on PATH.
  await s.check('without gh, rig up says "no gh/remote: issues not opened" and carries on', {
    assert: async () => {
      const plan = loadPlan(join(iss, 'PLAN.md'))
      const r = openSliceIssues(join(tmp, 'side', 'alpha'), plan, loadConfig(alpha))
      return r.ran === false && r.lines.some(l => /^no gh\/remote: issues not opened/.test(l))
    },
    breaks: async () => {
      // With gh present the only thing missing is origin; give alpha one so gh is consulted.
      git(['remote', 'add', 'origin', 'https://example.invalid/o/a.git'], alpha)
      return () => { git(['remote', 'remove', 'origin'], alpha); setPath(bin) }
    }
  })
  // The assertion above ran with gh on PATH but no remote; run the PATH half too, with gh absent.
  setPath(binNoGh)
  await s.check('the gh check reads PATH: with no gh binary, nothing is asked of GitHub', {
    assert: async () => {
      rmSync(logs.gh, { force: true })
      const plan = loadPlan(join(iss, 'PLAN.md'))
      const r = openSliceIssues(iss, plan, loadConfig(iss))
      return r.ran === false && /no gh on PATH/.test(r.why) && !existsSync(logs.gh)
    },
    breaks: async () => { setPath(bin); return () => setPath(binNoGh) }
  })
  setPath(bin)

  // `--no-issues`. Red when: the flag is not honoured (issues: true).
  let issuesFlag = false
  await s.check('rig up --no-issues asks GitHub nothing', {
    assert: async () => {
      rmSync(logs.gh, { force: true })
      const plan = loadPlan(join(iss, 'PLAN.md'))
      const r = openSliceIssues(iss, plan, { ...loadConfig(iss), issues: issuesFlag })
      return r.ran === false && /--no-issues/.test(r.why) && !existsSync(logs.gh)
    },
    breaks: async () => { issuesFlag = true; return () => { issuesFlag = false } }
  })

  // The brief names the issue. Red when: ctx has none.
  let issueCtx = { number: 11, url: 'https://example.invalid/o/r/issues/11' }
  await s.check('an agent’s brief carries "Your issue: #N <url>" and who closes it', {
    assert: async () => {
      const plan = parsePlan(PLAN())
      const text = briefFor(plan, plan.agents[0], { branch: 'rig/c1', path: '/x', planPath: 'PLAN.md', reportPath: 'docs/build-report-c1.md', issue: issueCtx })
      return text.includes('Your issue: #11 https://example.invalid/o/r/issues/11 — the lead closes it at `rig finish`; put what is waiting on a person there')
    },
    breaks: async () => { issueCtx = null; return () => { issueCtx = { number: 11, url: 'https://example.invalid/o/r/issues/11' } } }
  })

  // End to end: `rig up --no-launch` makes the worktrees under the per-repo base and each brief
  // carries its issue. Red when: --no-issues with no record → no issue line in the brief.
  const upFlags = []
  await s.check('rig up --no-launch: worktrees under ../.rig-worktrees/<repo>, briefs with their issue numbers', {
    assert: async () => {
      if (!upFlags.length) { rmSync(issuesPath(iss), { force: true }); writeFileSync(ghState.next, '11') }
      const r = rig(['up', '--no-launch', ...upFlags], iss)
      if (r.status !== 0) throw new Error(r.stderr || r.stdout)
      const wt = join(tmp, '.rig-worktrees', 'iss', 'c1')
      if (!existsSync(join(wt, '.rig', 'BRIEF.md'))) throw new Error(`no brief at ${wt}: ${r.stdout}`)
      const brief = readFileSync(join(wt, '.rig', 'BRIEF.md'), 'utf8')
      const c3 = readFileSync(join(tmp, '.rig-worktrees', 'iss', 'c3', '.rig', 'BRIEF.md'), 'utf8')
      if (!/Your issue: #11 /.test(brief)) throw new Error('c1 brief has no issue line: ' + brief.split('\n').slice(0, 6).join(' / '))
      if (!/Your issue: #3 /.test(c3)) throw new Error('c3 brief has no issue line')
      if (!/c1\s+issue #11/.test(r.stdout)) throw new Error('up did not say c1 #11: ' + r.stdout)
      return true
    },
    breaks: async () => { rmSync(issuesPath(iss), { force: true }); upFlags.push('--no-issues'); return () => { upFlags.length = 0 } }
  })

  // -------------------------------------------------------------------------------------------
  // The registry at init. Red when: the file already exists — then `apps` must not be called.
  const appsCalls = () => (existsSync(logs.apps) ? readFileSync(logs.apps, 'utf8') : '').split('\n').filter(Boolean)
  const regFile = join(home, '.claude', 'apps', 'depot-draw.md')
  const reg = repoAt('reg', null)
  let betweenRuns = () => {}
  await s.check('rig init --slug --name creates the registry file with `apps new` once, and never when it exists', {
    assert: async () => {
      rmSync(regFile, { force: true }); rmSync(logs.apps, { force: true }); rmSync(join(reg, '.rig'), { recursive: true, force: true })
      const r = rig(['init', '--slug', 'depot-draw', '--name', 'Depot Draw'], reg)
      if (r.status !== 0) throw new Error(r.stderr || r.stdout)
      if (appsCalls().join('|') !== 'new depot-draw Depot Draw') throw new Error(`apps was called: ${appsCalls().join(' | ')}`)
      if (!existsSync(regFile)) throw new Error('registry file not created')
      if (!r.stdout.includes(regFile) || !/fill in What it is \/ Where it stands \/ Next/.test(r.stdout)) throw new Error(r.stdout)
      if (JSON.parse(readFileSync(join(reg, '.rig', 'config.json'), 'utf8')).slug !== 'depot-draw') throw new Error('slug not written to config')
      betweenRuns()
      const again = rig(['init'], reg)
      if (again.status !== 0) throw new Error(again.stderr)
      if (appsCalls().length !== 1) throw new Error(`apps called again: ${appsCalls().join(' | ')}`)
      return /exists; left alone/.test(again.stdout)
    },
    // Red when: the file is gone before the second run, so `apps new` legitimately runs twice. That
    // is the "never when it exists" half failing on its own terms (the stub is untouched).
    breaks: async () => { betweenRuns = () => rmSync(regFile, { force: true }); return () => { betweenRuns = () => {} } }
  })
  const initFlags = ['--no-registry']
  await s.check('rig init --no-registry skips apps; a bare rig init derives the slug from the repo dir', {
    assert: async () => {
      rmSync(logs.apps, { force: true }); rmSync(join(spaced, '.rig'), { recursive: true, force: true })
      rmSync(join(home, '.claude', 'apps', 'my-repo.md'), { force: true })
      const r = rig(['init', ...initFlags], spaced)
      if (r.status !== 0) throw new Error(r.stderr)
      if (existsSync(logs.apps)) throw new Error(`apps was called: ${appsCalls().join(' | ')}`)
      return /registry: skipped/.test(r.stdout) && slugFor('My Repo') === 'my-repo' && JSON.parse(readFileSync(join(spaced, '.rig', 'config.json'), 'utf8')).slug === 'my-repo'
    },
    // Without the flag, and with no registry file for my-repo, `apps new` runs: the log appears.
    breaks: async () => { initFlags.length = 0; return () => { initFlags.push('--no-registry'); rmSync(join(home, '.claude', 'apps', 'my-repo.md'), { force: true }) } }
  })

  // -------------------------------------------------------------------------------------------
  // Plan parser: Negative controls under Checks, Issue: per slice, and the brief fields intact.
  let planText = PLAN('\nIssue: 7\n')
  await s.check('the plan’s "Negative controls:" line and a slice’s "Issue:" line are parsed, and stay out of the task text', {
    assert: async () => {
      const p = parsePlan(planText)
      if (p.negativeCommand !== 'npm run demo') throw new Error(`negativeCommand ${p.negativeCommand}`)
      const c2 = p.agents.find(a => a.id === 'c2')
      if (c2.issue !== 7) throw new Error(`issue ${c2.issue}`)
      if (c2.task !== 'Run the draw.') throw new Error(`task ${JSON.stringify(c2.task)}`)
      if (p.agents.find(a => a.id === 'c1').issue !== null) throw new Error('c1 has no Issue: line')
      // briefFields still find every heading (workflow.test.js is the contract; this is the spot check).
      return p.purpose.startsWith('A prize draw') && p.mustNotRules.length === 1 && /npm test/.test(p.checks)
    },
    breaks: async () => { planText = PLAN('\nIssue: 7\n').replace('Negative controls: `npm run demo`\n', ''); return () => { planText = PLAN('\nIssue: 7\n') } }
  })
  const template = readFileSync(join(here, '..', 'templates', 'PLAN.md'), 'utf8')
  let tpl = template
  await s.check('the plan template carries the review rule, a Negative controls line and an Issue: line, and its placeholders parse as empty', {
    assert: async () => {
      const p = parsePlan(tpl)
      return /rig review <id> --by <other>/.test(tpl) && /^Negative controls:/m.test(tpl) && /^Issue:/m.test(tpl) &&
        p.negativeCommand === null && p.agents.every(a => a.issue === null) && !/Issue:/.test(p.agents[0].task)
    },
    breaks: async () => { tpl = template.replace(/^Negative controls:.*\n/m, ''); return () => { tpl = template } }
  })
  let agentsTpl = readFileSync(join(here, '..', 'templates', 'AGENTS.md'), 'utf8')
  const agentsOriginal = agentsTpl
  await s.check('the AGENTS.md template says review before merge and a clean tree after npm test', {
    assert: async () => /Review before merge:.*no slice merges without a review file on base/.test(agentsTpl) && /After `npm test`, the tree is clean/.test(agentsTpl),
    breaks: async () => { agentsTpl = agentsTpl.replace(/^- \*\*Review before merge.*\n/m, ''); return () => { agentsTpl = agentsOriginal } }
  })

  // -------------------------------------------------------------------------------------------
  // Review findings (docs/review-rg2.md, 2026-09-16), one check each.

  // 1. A repo 2.0 initialised carries the literal shared default in its config. Red when: the config
  //    holds some other explicit value, which must be honoured as is.
  let legacyValue = '../.rig-worktrees'
  await s.check('review 1: the 2.0 literal "../.rig-worktrees" in a config reads as unset and gets the per-repo path', {
    assert: async () => {
      mkdirSync(join(alpha, '.rig'), { recursive: true }); writeFileSync(join(alpha, '.rig', 'config.json'), JSON.stringify({ worktreeDir: legacyValue }))
      try { return loadConfig(alpha).worktreeDir === '../.rig-worktrees/alpha' } finally { rmSync(join(alpha, '.rig'), { recursive: true, force: true }) }
    },
    breaks: async () => { legacyValue = '../.trees'; return () => { legacyValue = '../.rig-worktrees' } }
  })

  // 2. The wording this repo's PLAN.md uses, and a trailing note after the backticked span.
  //    Red when: the span is removed from the prose form (no command left to take).
  let prose = 'Negative-control command for this repo: `npm run demo` must still print exactly one VOID and one FAIL'
  const { negativeCommand } = await import('../src/plan.js')
  await s.check('review 2: "Negative-control command for this repo: `cmd` …" and "Negative controls: `cmd` (note)" both yield cmd', {
    assert: async () =>
      negativeCommand(prose) === 'npm run demo' &&
      negativeCommand('Negative controls: `npm run demo` (one VOID and one FAIL)') === 'npm run demo' &&
      negativeCommand('Negative controls: npm run demo') === 'npm run demo' &&
      negativeCommand(readFileSync(join(here, '..', 'PLAN.md'), 'utf8').split('## Checks')[1].split('## Rules')[0]) === 'npm run demo',
    breaks: async () => { prose = 'Negative-control command for this repo: npm run demo must still print one VOID'; return () => { prose = 'Negative-control command for this repo: `npm run demo` must still print exactly one VOID and one FAIL' } }
  })

  // 3. Detached HEAD is not unborn: with --agent the slice is enforced. Red when: the staged file is
  //    inside the slice.
  const det = repoAt('detached', PLAN())
  git(['checkout', '-q', '--detach'], det)
  mkdirSync(join(det, 'app')); writeFileSync(join(det, 'app', 'x.js'), '1\n')
  let detStray = 'README.md'
  await s.check('review 3: on a detached HEAD, --staged --agent c1 still refuses a file outside c1; headState tells detached from unborn', {
    assert: async () => {
      if (headState(det) !== 'detached') throw new Error(`headState ${headState(det)}`)
      if (headState(fresh) !== 'unborn') throw new Error(`fresh: ${headState(fresh)}`)
      writeFileSync(join(det, 'README.md'), 'edited\n'); git(['add', detStray], det)
      const r = rig(['guard', '--staged', '--agent', 'c1'], det)
      const bare = rig(['guard', '--staged'], det)
      git(['reset', '-q'], det)
      if (bare.status !== 0 || !/detached HEAD/.test(bare.stdout)) throw new Error(`without --agent: ${bare.status} ${bare.stdout} ${bare.stderr}`)
      if (/unborn/.test(r.stdout + bare.stdout)) throw new Error('detached reported as unborn')
      return r.status === 1 && /REFUSED/.test(r.stderr)
    },
    breaks: async () => { detStray = 'app/x.js'; return () => { detStray = 'README.md' } }
  })

  // 4. Reuse survives gh's page of 30: 31 closed `c1 …` issues newer than the one open one. The stub
  //    models gh (newest first, --state honoured, --limit default 30) and is checked on its own first.
  //    Red when: the open issue's title no longer starts with "c1 ".
  const full = join(tmp, 'gh-full.json')
  const busy = (openTitle) => JSON.stringify([
    { number: 1, title: openTitle, state: 'OPEN', url: 'https://example.invalid/o/r/issues/1' },
    ...Array.from({ length: 31 }, (_, i) => ({ number: 100 + i, title: 'c1 old build', state: 'CLOSED', url: `https://example.invalid/o/r/issues/${100 + i}` }))
  ])
  let openTitle = 'c1 The entry page'
  await s.check('review 4: with 31 closed "c1 …" issues on the first page, the one open one is still reused (no duplicate created)', {
    assert: async () => {
      writeFileSync(full, busy(openTitle))
      const env = { ...process.env, GH_FULL: full }
      const page = JSON.parse(execFileSync('gh', ['issue', 'list', '--state', 'all', '--search', 'c1 in:title', '--json', 'x'], { encoding: 'utf8', env }))
      if (page.length !== 30 || page.some(i => i.state === 'OPEN')) throw new Error('stub does not page like gh: ' + page.length)
      process.env.GH_FULL = full
      try {
        rmSync(issuesPath(iss), { force: true }); rmSync(logs.gh, { force: true })
        const plan = loadPlan(join(iss, 'PLAN.md'))
        openSliceIssues(iss, plan, loadConfig(iss))
        const creates = ghCalls(/^issue create/)
        if (creates.some(l => /--title c1 /.test(l))) throw new Error('c1 was created again: ' + creates.join(' | '))
        return loadIssues(iss).c1?.number === 1
      } finally { delete process.env.GH_FULL }
    },
    breaks: async () => { openTitle = 'c1x not this slice'; return () => { openTitle = 'c1 The entry page' } }
  })

  // 5. An Issue: line inside Task keeps the rest of the task. Red when: the line is moved to before
  //    Task: — then nothing follows it and the check's "More." expectation… still holds; so the control
  //    instead drops the Issue: line, which must make `issue` null.
  let issueLine = 'Issue: 5\n'
  await s.check('review 5: "Task:\\nDo it.\\nIssue: 5\\nMore." keeps "More." in the task and reads issue 5', {
    assert: async () => {
      const a = parsePlan(`# t\n## Agents\n### c1 — x\nOwns:\n- a/**\n\nTask:\nDo it.\n${issueLine}More.\n`).agents[0]
      return a.task === 'Do it.\nMore.' && a.issue === 5
    },
    breaks: async () => { issueLine = ''; return () => { issueLine = 'Issue: 5\n' } }
  })

  // -------------------------------------------------------------------------------------------
  // Tabs stay in the current workspace. herdr is the stub; HERDR_PANE_ID names workspace w7.
  process.env.HERDR_ENV = '1'; process.env.HERDR_PANE_ID = 'w7:p0'
  const herdrCalls = () => (existsSync(logs.herdr) ? readFileSync(logs.herdr, 'utf8') : '').split('\n').filter(Boolean)
  await s.check('herdr: attachHint says "this workspace" and a new slice tab is created with --workspace <our workspace>', {
    assert: async () => {
      rmSync(logs.herdr, { force: true })
      const term = terminal({ terminal: 'herdr' })
      if (!/this workspace/.test(term.attachHint('x'))) throw new Error(term.attachHint('x'))
      term.newWindow('rig-x', 'c1', tmp, 'echo hi')
      const create = herdrCalls().find(l => /^tab create/.test(l))
      if (!create) throw new Error(`no tab create: ${herdrCalls().join(' | ')}`)
      if (!/--workspace w7\b/.test(create)) throw new Error(create)
      if (!/--label c1\b/.test(create) || !/--no-focus/.test(create)) throw new Error(create)
      if (herdrCalls().some(l => /^workspace create/.test(l) || /^pane split/.test(l))) throw new Error('opened a workspace or split a pane')
      return true
    },
    breaks: async () => { process.env.HERDR_PANE_ID = 'w8:p0'; return () => { process.env.HERDR_PANE_ID = 'w7:p0' } }
  })
})

restoreEnv()
rmSync(tmp, { recursive: true, force: true })
