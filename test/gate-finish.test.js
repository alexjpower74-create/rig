// Rig 5.5, r55g: the finish gate's new facts. Each is a fact with a sha beside it: a second-vendor
// pass on THIS sha, the second machine's tally on this sha, the repo's own CI on every machine it ran
// on, "0 new" against the base when it was computed, no decision of this round left open, and a stack
// that still merges with the live base. Every check is broken once, by changing the repository's
// state or by the flag that turns the guard into a warning: the same code must give the other answer.

import { suite } from '../harness/check.js'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync, readFileSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const RIG = join(here, '..')
const ENV = { ...process.env }
for (const k of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_DIR', 'GIT_WORK_TREE'])
  delete ENV[k]
const git = (args, cwd, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...ENV, ...env } }).trim()
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rig-gate-')))
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')

const { finishChecks, driftCheck } = await import('../src/commands/finish.js')
const { recordQa, qaLogPath } = await import('../src/qalog.js')
const { recordVerdict, reviewsPath } = await import('../src/vendor.js')
const { addDecision, setStatus } = await import('../src/decisions.js')
const { loadPlan } = await import('../src/plan.js')

const PLAN = `# Depot draw

## What it's for
Customers scan a QR at the counter and enter a monthly draw.

## Who uses it, on what
Depot customers, on their phones.

## What done looks like
A customer enters in under 30 seconds and sees "You're in".

## What must not happen
- Nothing is sent to a customer without the owner.

## Where it lives
New private project, local only.

## Agents

### c1 — Entry page
Owns:
- app/**

Task:
Build the entry page.
`

const cfg = { plan: 'PLAN.md', worktreeDir: '.worktrees', branchPrefix: 'rig/' }
const commit = (repo, msg, date) => {
  git(['add', '-A'], repo)
  git(['commit', '-qm', msg], repo, date ? { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } : {})
  return git(['rev-parse', 'HEAD'], repo)
}

/** c1 built app/, merged, reported, reviewed; QA green on HEAD; a second-vendor pass on HEAD. Every gate passes. */
function readyRepo(name, beforeCut = () => {}) {
  const repo = join(tmp, name)
  mkdirSync(join(repo, 'docs'), { recursive: true })
  git(['init', '-q', '-b', 'main'], repo)
  git(['config', 'user.email', 'test@example.invalid'], repo)
  git(['config', 'user.name', 'Rig Test'], repo)
  writeFileSync(join(repo, '.gitignore'), '.rig/\n.worktrees/\n')
  writeFileSync(join(repo, 'PLAN.md'), PLAN)
  writeFileSync(join(repo, 'README.md'), '# Depot draw\n')
  commit(repo, 'plan', '2026-09-15T08:00:00Z')
  beforeCut(repo)
  git(['checkout', '-qb', 'rig/c1'], repo)
  mkdirSync(join(repo, 'app'))
  writeFileSync(join(repo, 'app', 'entry.js'), 'export const entry = 1\n')
  writeFileSync(join(repo, 'docs', 'build-report-c1.md'), '# c1\nnegative control went red\n')
  commit(repo, 'c1: entry page', '2026-09-15T10:00:00Z')
  git(['checkout', '-q', 'main'], repo)
  git(['merge', '-q', '--ff-only', 'rig/c1'], repo)
  writeFileSync(join(repo, 'docs', 'review-c1.md'), '# Review c1\nno findings\n')
  const head = commit(repo, 'review c1', '2026-09-15T12:00:00Z')
  recordQa(repo, { kind: 'test', sha: head, exit: 0, cmd: 'npm test', dirtied: [] })
  recordVerdict(repo, { sha: head, vendor: 'openai', verdict: 'pass', what: 'npm test; read the diff' })
  return { repo, head }
}
const plan = (repo) => loadPlan(join(repo, 'PLAN.md'))
// A control may swap a guard off (the old behaviour) through these; each restores them.
let extraOpts = {}
let driftGate = driftCheck
const gate = (repo, c = cfg, opts = {}) => finishChecks(repo, c, plan(repo), 'main', { ...extraOpts, ...opts })
const stateOf = (r, re) => r.checks.find((c) => re.test(c.name))?.state
const fails = (r) =>
  r.checks
    .filter((c) => c.state === 'fail')
    .map((c) => `${c.name}: ${c.detail}`)
    .join('; ')
const resetVerdicts = (repo, entries) => {
  rmSync(reviewsPath(repo), { force: true })
  for (const e of entries) recordVerdict(repo, e)
}
const resetQa = (repo, entries) => {
  rmSync(qaLogPath(repo), { force: true })
  for (const e of entries) recordQa(repo, e)
}

/**
 * The pre-5.5 finish.js, swapped back in: a copy of src/ with the old file from the scaffold commit
 * (3ef17d0). Null when that commit is not in this clone (a shallow one); the control is then UNPROVEN.
 */
function oldSrc() {
  const old = spawnSync('git', ['show', '3ef17d0:src/commands/finish.js'], { cwd: RIG, encoding: 'utf8', env: ENV })
  if (old.status !== 0) return null
  const dir = join(tmp, 'old-src')
  rmSync(dir, { recursive: true, force: true })
  cpSync(join(RIG, 'src'), dir, { recursive: true })
  writeFileSync(join(dir, 'commands', 'finish.js'), old.stdout)
  return dir
}
let srcDir = join(RIG, 'src')

function rig(cmd, repo, args, env = {}) {
  const r = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import('${join(srcDir, 'commands', cmd + '.js')}').then(m => m.default(process.argv.slice(1)))`,
      '--',
      ...args,
    ],
    { cwd: repo, encoding: 'utf8', env: { ...ENV, ...env } },
  )
  return { status: r.status, out: plain(r.stdout + r.stderr) }
}

await suite('rig 5.5, the finish gate (r55g)', async (s) => {
  const { repo, head } = readyRepo('ready')
  const short = head.slice(0, 7)
  const pass = { sha: head, vendor: 'openai', verdict: 'pass', what: 'npm test; read the diff' }

  await s.check('the fixture passes every gate (the baseline the other checks break)', {
    assert: async () => {
      const r = gate(repo)
      if (r.failed) throw new Error(fails(r))
      return stateOf(r, /second-vendor pass/) === 'ok'
    },
    breaks: async () => {
      resetVerdicts(repo, [])
      return () => resetVerdicts(repo, [pass])
    },
  })

  // ---------------------------------------------------------------------------------------------
  // Item 1: a second-vendor pass on this sha.
  resetVerdicts(repo, [])
  await s.check('finish refuses without a second-vendor pass on this sha', {
    assert: async () => {
      const r = gate(repo)
      const c = r.checks.find((x) => /second-vendor pass/.test(x.name))
      return r.failed && c.state === 'fail' && /no second-vendor verdict on/.test(c.detail)
    },
    // The guard off (what --no-vendor does): the gate warns, and the finish passes.
    breaks: async () => {
      extraOpts = { noVendor: true }
      return () => {
        extraOpts = {}
      }
    },
  })

  const older = [{ ...pass, sha: git(['rev-parse', 'HEAD~1'], repo) }]
  resetVerdicts(repo, older)
  await s.check('a pass on an older sha does not answer for this one', {
    assert: async () => {
      const r = gate(repo)
      const c = r.checks.find((x) => /second-vendor pass/.test(x.name))
      return r.failed && /the last pass was on .* not this sha/.test(c.detail)
    },
    breaks: async () => {
      recordVerdict(repo, pass)
      return () => resetVerdicts(repo, older)
    },
  })

  const failed = [pass, { ...pass, verdict: 'fail', what: 'entry.js:1 accepts an empty name' }]
  resetVerdicts(repo, failed)
  await s.check('the newest verdict on the sha wins: a --fail after a pass fails the gate', {
    assert: async () => {
      const r = gate(repo)
      return r.failed && /failed it: entry\.js:1/.test(r.checks.find((x) => /second-vendor/.test(x.name)).detail)
    },
    breaks: async () => {
      recordVerdict(repo, pass)
      return () => resetVerdicts(repo, failed)
    },
  })

  resetVerdicts(repo, [])
  appendFileSync(reviewsPath(repo), JSON.stringify({ ...pass, vendor: 'anthropic' }) + '\n')
  await s.check('a same-vendor pass written straight into .rig/reviews.jsonl still does not pass', {
    assert: async () => {
      const r = gate(repo)
      return r.failed && /same vendor that built this round/.test(r.checks.find((x) => /second-vendor/.test(x.name)).detail)
    },
    breaks: async () => {
      // Builders on another vendor: the very same record is now a second-vendor pass.
      const real = cfg.vendor
      cfg.vendor = 'codex'
      return () => {
        cfg.vendor = real
      }
    },
  })
  resetVerdicts(repo, [])
  appendFileSync(reviewsPath(repo), JSON.stringify({ ...pass, vendor: 'me' }) + '\n')
  await s.check('a pass recorded under a made-up vendor name does not pass the gate', {
    assert: async () => {
      const r = gate(repo)
      return r.failed && /"me" is not a vendor the rig knows/.test(r.checks.find((x) => /second-vendor/.test(x.name)).detail)
    },
    breaks: async () => {
      cfg.vendors = ['me']
      return () => {
        delete cfg.vendors
      }
    },
  })
  resetVerdicts(repo, [pass])

  // ---------------------------------------------------------------------------------------------
  // Item 3: the second machine's tally, when one is configured.
  const withHost = { ...cfg, qaHost: 'lab-box' }
  await s.check('finish refuses without the qaHost tally when a host is configured', {
    assert: async () => {
      const r = gate(repo, withHost)
      const c = r.checks.find((x) => x.name === 'QA green on lab-box')
      return r.failed && c?.state === 'fail' && /--host lab-box/.test(c.detail)
    },
    breaks: async () => {
      recordQa(repo, { kind: 'test', sha: head, exit: 0, cmd: 'npm test', host: 'lab-box', passed: 412 })
      return () => resetQa(repo, [{ kind: 'test', sha: head, exit: 0, cmd: 'npm test', dirtied: [] }])
    },
  })

  const twoTallies = [
    { kind: 'test', sha: head, exit: 0, cmd: 'npm test', dirtied: [], passed: 412 },
    { kind: 'test', sha: head, exit: 1, cmd: 'npm test', host: 'lab-box', passed: 409, failed: 3 },
  ]
  resetQa(repo, twoTallies)
  await s.check('both tallies are shown side by side, and a red host run fails', {
    assert: async () => {
      const c = gate(repo, withHost).checks.find((x) => x.name === 'QA green on lab-box')
      return c.state === 'fail' && /exit 1, 409 passed, 3 failed beside exit 0, 412 passed here/.test(c.detail)
    },
    breaks: async () => {
      recordQa(repo, { kind: 'test', sha: head, exit: 0, cmd: 'npm test', host: 'lab-box', passed: 412 })
      return () => resetQa(repo, twoTallies)
    },
  })

  const hostOnly = [{ kind: 'test', sha: head, exit: 0, cmd: 'npm test', host: 'lab-box' }]
  resetQa(repo, hostOnly)
  await s.check('a run on the second machine never answers for this one', {
    assert: async () => {
      return stateOf(gate(repo, withHost), new RegExp(`^QA green on ${short}$`)) === 'fail'
    },
    breaks: async () => {
      recordQa(repo, { kind: 'test', sha: head, exit: 0, cmd: 'npm test', host: 'local', dirtied: [] })
      return () => resetQa(repo, hostOnly)
    },
  })
  resetQa(repo, [{ kind: 'test', sha: head, exit: 0, cmd: 'npm test', dirtied: [] }])

  // ---------------------------------------------------------------------------------------------
  // 3b: the repo's own CI command, on every machine.
  await s.check('a configured CI command with no run on this sha fails the gate', {
    assert: async () => {
      const r = gate(repo, { ...cfg, ciCommand: 'make ci' })
      return r.failed && stateOf(r, /^CI command green/) === 'fail'
    },
    breaks: async () => {
      recordQa(repo, { kind: 'ci', sha: head, exit: 0, cmd: 'make ci' })
      return () => resetQa(repo, [{ kind: 'test', sha: head, exit: 0, cmd: 'npm test', dirtied: [] }])
    },
  })

  const ciHere = [
    { kind: 'test', sha: head, exit: 0, cmd: 'npm test', dirtied: [] },
    { kind: 'test', sha: head, exit: 0, cmd: 'npm test', host: 'lab-box' },
    { kind: 'ci', sha: head, exit: 0, cmd: 'make ci' },
  ]
  resetQa(repo, ciHere)
  await s.check('CI that ran here has to have run on the second machine too', {
    assert: async () => {
      const r = gate(repo, withHost)
      return r.failed && r.checks.find((c) => c.name === `CI command green on ${short} (lab-box)`)?.state === 'fail'
    },
    breaks: async () => {
      recordQa(repo, { kind: 'ci', sha: head, exit: 0, cmd: 'make ci', host: 'lab-box' })
      return () => resetQa(repo, ciHere)
    },
  })
  resetQa(repo, [{ kind: 'test', sha: head, exit: 0, cmd: 'npm test', dirtied: [] }])

  // ---------------------------------------------------------------------------------------------
  // Item 4: "0 new" is computed, and shown when it was.
  const baseline = (newFailures) => ({
    base: 'origin/main',
    baseSha: 'b'.repeat(40),
    newFailures,
    known: [{ name: 'flaky clock', where: 'both' }],
  })
  const newOne = [{ kind: 'test', sha: head, exit: 0, cmd: 'npm test', dirtied: [], baseline: baseline(['entry rejects blank']) }]
  resetQa(repo, newOne)
  await s.check('a baseline with new failures fails the gate', {
    assert: async () => {
      const r = gate(repo)
      return r.failed && /1 new: entry rejects blank/.test(r.checks.find((c) => /0 new failures/.test(c.name)).detail)
    },
    breaks: async () => {
      resetQa(repo, [{ kind: 'test', sha: head, exit: 0, cmd: 'npm test', dirtied: [], baseline: baseline([]) }])
      return () => resetQa(repo, newOne)
    },
  })
  resetQa(repo, [{ kind: 'test', sha: head, exit: 0, cmd: 'npm test', dirtied: [], baseline: baseline([]) }])
  await s.check('"0 new" reads as a computed fact with the base sha and where each known failure fails', {
    assert: async () => {
      const c = gate(repo).checks.find((x) => /0 new failures/.test(x.name))
      return c?.state === 'ok' && /0 new, 1 known on bbbbbbb: flaky clock \(both\)/.test(c.detail)
    },
    // No baseline recorded: nothing to show, and "0 new" must not appear as if it were computed.
    breaks: async () => {
      resetQa(repo, [{ kind: 'test', sha: head, exit: 0, cmd: 'npm test', dirtied: [] }])
      return () => resetQa(repo, [{ kind: 'test', sha: head, exit: 0, cmd: 'npm test', dirtied: [], baseline: baseline([]) }])
    },
  })
  resetQa(repo, [{ kind: 'test', sha: head, exit: 0, cmd: 'npm test', dirtied: [] }])

  // ---------------------------------------------------------------------------------------------
  // Item 13: decisions made this round are closed.
  // The round starts at c1's branch point; an older decision committed before it only warns.
  const dRepo = readyRepo('decisions', (r) => {
    addDecision(r, { what: 'old: prizes are vouchers', source: 'thread: example.invalid/t/1' })
    commit(r, 'an older round decided D1', '2026-09-15T09:00:00Z')
  })
  addDecision(dRepo.repo, { what: 'entries close at midnight local time', source: 'transcript: meetings/2026-09-15.md' })
  const dHead = commit(dRepo.repo, 'decision D2', '2026-09-15T13:00:00Z')
  recordQa(dRepo.repo, { kind: 'test', sha: dHead, exit: 0, cmd: 'npm test', dirtied: [] })
  recordVerdict(dRepo.repo, { ...pass, sha: dHead })
  const reclose = (kind) => {
    setStatus(dRepo.repo, 'D2', kind, { round: kind === 'scheduled' ? '5.6' : null })
    return commit(dRepo.repo, `D2 ${kind}`)
  }
  const regate = (sha) => {
    recordQa(dRepo.repo, { kind: 'test', sha, exit: 0, cmd: 'npm test', dirtied: [] })
    recordVerdict(dRepo.repo, { ...pass, sha })
  }

  await s.check('finish refuses with a decision of this round still open, and lists it', {
    assert: async () => {
      const r = gate(dRepo.repo)
      const c = r.checks.find((x) => x.name === 'decisions closed')
      return r.failed && c.state === 'fail' && /1 open since .*: D2/.test(c.detail) && r.decisions.list.map((d) => d.id).join() === 'D2'
    },
    breaks: async () => {
      const sha = reclose('built')
      regate(sha)
      return () => {
        git(['reset', '-q', '--hard', 'HEAD~1'], dRepo.repo)
      }
    },
  })

  await s.check('an open decision from an earlier round warns but does not fail', {
    assert: async () => {
      regate(reclose('scheduled'))
      const r = gate(dRepo.repo)
      return !r.failed && stateOf(r, /older decisions/) === 'warn' && stateOf(r, /decisions closed/) === 'ok'
    },
    breaks: async () => {
      // --since the very first commit: the old decision is this round's, and open.
      extraOpts = { since: { ref: git(['rev-list', '--max-parents=0', 'HEAD'], dRepo.repo), from: '--since' } }
      return () => {
        extraOpts = {}
      }
    },
  })

  // ---------------------------------------------------------------------------------------------
  // Item 11: drift is a gate too.
  await s.check('a live base the stack no longer merges with fails the gate; a moved one warns', {
    assert: async () => {
      const bad = {
        base: 'origin/main',
        moved: true,
        since: [{}, {}],
        touched: [],
        safe: [],
        merges: false,
        conflicts: ['app/entry.js'],
        error: null,
      }
      const ok = { ...bad, merges: true }
      return driftGate(bad).state === 'fail' && driftGate(ok).state === 'warn' && gate(repo, cfg, { drift: bad }).failed
    },
    // The anti-reference: a drift check that only says whether the base moved.
    breaks: async () => {
      driftGate = (d) => ({ state: d.moved ? 'warn' : 'ok' })
      return () => {
        driftGate = driftCheck
      }
    },
  })
})

// The CLI end to end; its controls swap the pre-5.5 finish.js back in.
await suite('rig 5.5, rig finish on the command line (r55g)', async (s) => {
  const { repo, head } = readyRepo('cli')

  resetVerdicts(repo, [])
  await s.check('rig finish exits 1 without a vendor pass and names the command that records one', {
    assert: async () => {
      const r = rig('finish', repo, ['--no-desk'])
      return (
        r.status === 1 && /FAIL\s+second-vendor pass on \w+ {2}— no second-vendor verdict on \w+: `rig review --vendor <name>/.test(r.out)
      )
    },
    breaks: async () => {
      recordVerdict(repo, { sha: head, vendor: 'gemini', verdict: 'pass', what: 'ran npm test' })
      return () => resetVerdicts(repo, [])
    },
  })

  await s.check('--no-vendor passes with a warning, and FINISH.md says no second-vendor pass was required', {
    assert: async () => {
      const r = rig('finish', repo, ['--no-desk', '--no-vendor'])
      const md = readFileSync(join(repo, 'docs', 'FINISH.md'), 'utf8')
      return r.status === 0 && /warn\s+second-vendor pass/.test(r.out) && /\*\*no second-vendor pass was required\*\*/.test(md)
    },
    // The pre-5.5 finish has no vendor gate and no such line: FINISH.md cannot say it.
    breaks: async () => {
      const dir = oldSrc()
      if (dir) srcDir = dir
      return () => {
        srcDir = join(RIG, 'src')
      }
    },
  })

  await s.check('drift is printed before the gates', {
    assert: async () => {
      const out = rig('finish', repo, ['--no-desk', '--no-vendor']).out
      const d = out.search(/^drift/m)
      const g = out.indexOf('finish gate on')
      return d >= 0 && g > d
    },
    breaks: async () => {
      const dir = oldSrc()
      if (dir) srcDir = dir
      return () => {
        srcDir = join(RIG, 'src')
      }
    },
  })
})

rmSync(tmp, { recursive: true, force: true })
