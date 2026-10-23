// Rig 5.5, r55g: the last two facts of the finish gate.
//  (a) Item 2: after a fold, the stamped commits may be rewritten only in their messages: every
//      counterpart's tree must equal the stamped one, or finish fails naming the commit.
//  (b) Item 3b: when the repo has a CI command, configured or detected by r55q's detectCi in the
//      commit itself, finish needs a ci record on the sha and names the command when none ran.
//  (c) The second-vendor review of 949e12b: a baseline waives only the runs it compared (#2), the
//      fold walk runs under pipefail with its limit and group stop (#3), and a CI record counts
//      only when it ran today's CI command (#4).
// Controls swap the previous finish.js (a25b59f, or 949e12b for (c)) back in, or change the
// repository's state.

import { suite } from '../harness/check.js'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const RIG = join(here, '..')
const ENV = { ...process.env }
for (const k of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_DIR', 'GIT_WORK_TREE'])
  delete ENV[k]
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', env: ENV }).trim()
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rig-final-')))

/** A copy of src/ with files replaced by their text at a commit; null when one is missing (a shallow clone). */
function srcWith(name, files) {
  const dir = join(tmp, `src-${name}`)
  cpSync(join(RIG, 'src'), dir, { recursive: true })
  for (const [path, sha] of Object.entries(files)) {
    const r = spawnSync('git', ['show', `${sha}:src/${path}`], { cwd: RIG, encoding: 'utf8' })
    if (r.status !== 0) return null
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), r.stdout)
  }
  return dir
}
let n = 0
const finishFrom = async (dir) => import(`${pathToFileURL(join(dir, 'commands', 'finish.js')).href}?v=${n++}`)

const { recordQa, qaLogPath } = await import('../src/qalog.js')
const { recordVerdict } = await import('../src/vendor.js')
const { fold, stampFold } = await import('../src/fold.js')
const { loadPlan } = await import('../src/plan.js')

const PLAN = `# Depot draw

## What it's for
A monthly draw.

## What done looks like
A customer enters in under 30 seconds.

## Agents

### c1 — Entry page
Owns:
- app/**

Task:
Build it.
`
const cfg = { plan: 'PLAN.md', worktreeDir: '.worktrees', branchPrefix: 'rig/' }

function repoAt(name) {
  const repo = join(tmp, name)
  mkdirSync(join(repo, 'app'), { recursive: true })
  mkdirSync(join(repo, 'docs'), { recursive: true })
  git(['init', '-q', '-b', 'main'], repo)
  git(['config', 'user.email', 'test@example.invalid'], repo)
  git(['config', 'user.name', 'Rig Test'], repo)
  writeFileSync(join(repo, '.gitignore'), '.rig/\n.worktrees/\n')
  writeFileSync(join(repo, 'PLAN.md'), PLAN)
  git(['add', '-A'], repo)
  git(['commit', '-qm', 'plan'], repo)
  git(['tag', 'round'], repo)
  return repo
}
const commitAll = (repo, msg) => {
  git(['add', '-A'], repo)
  git(['commit', '-qm', msg], repo)
  return git(['rev-parse', 'HEAD'], repo)
}
/** QA and a second-vendor pass on HEAD, so only the gate under test can fail. */
const greenOn = (repo) => {
  const sha = git(['rev-parse', 'HEAD'], repo)
  rmSync(qaLogPath(repo), { force: true })
  recordQa(repo, { kind: 'test', sha, exit: 0, cmd: 'npm test', dirtied: [] })
  recordVerdict(repo, { sha, vendor: 'openai', verdict: 'pass', what: 'npm test' })
  return sha
}
const gateOf = async (src, repo, name, c = cfg) =>
  (await finishFrom(src)).finishChecks(repo, c, loadPlan(join(repo, 'PLAN.md')), 'main', {}).checks.find((x) => name.test(x.name))

const NOW = join(RIG, 'src')
const OLD = srcWith('old', { 'commands/finish.js': 'a25b59f' })
// r55q's detectCi, as on rig/r55q (5d001c2), dropped into src/qa/ci.js: the merged state.
const MERGED = srcWith('merged', { 'qa/ci.js': '5d001c2' })

await suite('rig 5.5, after the fold: message-only rewrites (r55g)', async (s) => {
  /** main: plan; then "c1: entry", "c1: admin", "fixup! c1: entry"; folded onto the round tag and stamped. */
  const folded = async (name) => {
    const repo = repoAt(name)
    writeFileSync(join(repo, 'app', 'entry.js'), 'export const entry = 1\n')
    commitAll(repo, 'c1: entry')
    writeFileSync(join(repo, 'app', 'admin.js'), 'export const admin = 1\n')
    commitAll(repo, 'c1: admin')
    writeFileSync(join(repo, 'app', 'entry.js'), 'export const entry = 2\n')
    commitAll(repo, 'fixup! c1: entry')
    const r = await fold(repo, { base: 'round', root: repo, cfg })
    if (r.state !== 'folded') throw new Error(`fixture did not fold: ${r.why}`)
    stampFold(repo, r)
    return { repo, stamp: r }
  }
  /** Rewrite the first folded commit (message, and optionally content), replaying the rest on top. */
  const rewriteFirst = (repo, stamp, { message, content = null }) => {
    git(['checkout', '-q', '--detach', stamp.map[0].new], repo)
    if (content) writeFileSync(join(repo, 'app', 'entry.js'), content)
    git(['add', '-A'], repo)
    git(['commit', '-q', '--amend', '--allow-empty', '-m', message], repo)
    git(['cherry-pick', stamp.map[1].new], repo)
    git(['branch', '-f', 'main', 'HEAD'], repo)
    git(['checkout', '-q', 'main'], repo)
    return greenOn(repo)
  }
  const FOLD = /^fold on main holds$/

  const a = await folded('content')
  rewriteFirst(a.repo, a.stamp, { message: 'c1: entry, reworded', content: 'export const entry = 3\n' })
  const rewritten = git(['rev-parse', '--short', 'HEAD~1'], a.repo)
  let src = NOW
  await s.check('a content change to a stamped commit after the fold fails, naming the commit', {
    assert: async () => {
      const c = await gateOf(src, a.repo, FOLD)
      return (
        c?.state === 'fail' &&
        c.detail.startsWith(
          `${rewritten} "c1: entry, reworded" stands where the fold stamped ${a.stamp.map[0].new.slice(0, 7)} and its tree differs`,
        )
      )
    },
    // The previous finish.js has no such gate: the rewrite goes through.
    breaks: async () => {
      if (OLD) src = OLD
      return () => {
        src = NOW
      }
    },
  })

  const b = await folded('message-only')
  rewriteFirst(b.repo, b.stamp, { message: 'c1: entry (clearer message)' })
  let contentToo = null
  await s.check('a message-only rewrite of the stamped commits passes: every tree identical', {
    assert: async () => {
      const c = await gateOf(NOW, b.repo, FOLD)
      return (
        c?.state === 'ok' && /2 commit\(s\) rewritten after the fold, every tree identical to the stamp \(message-only\)/.test(c.detail)
      )
    },
    breaks: async () => {
      contentToo = git(['rev-parse', 'HEAD'], b.repo)
      rewriteFirst(b.repo, b.stamp, { message: 'c1: entry (clearer message)', content: 'export const entry = 9\n' })
      return () => {
        git(['reset', '-q', '--hard', contentToo], b.repo)
        greenOn(b.repo)
      }
    },
  })

  const c = await folded('unchanged')
  greenOn(c.repo)
  await s.check('the stamped shas unchanged on main pass; rebasing them onto another base after the fold fails', {
    assert: async () => {
      const ok = await gateOf(NOW, c.repo, FOLD)
      return ok?.state === 'ok' && /the 2 folded commit\(s\) are on .* unchanged/.test(ok.detail)
    },
    breaks: async () => {
      const tip = git(['rev-parse', 'HEAD'], c.repo)
      // Upstream moved and the stack was rebased onto it: same messages, a different base.
      git(['checkout', '-q', '-b', 'up', 'round'], c.repo)
      writeFileSync(join(c.repo, 'README.md'), '# upstream\n')
      commitAll(c.repo, 'upstream: readme')
      git(['checkout', '-q', 'main'], c.repo)
      git(['rebase', '-q', 'up'], c.repo)
      greenOn(c.repo)
      return () => {
        git(['reset', '-q', '--hard', tip], c.repo)
        git(['branch', '-q', '-D', 'up'], c.repo)
        greenOn(c.repo)
      }
    },
  })
  // The same stack rebased onto a moved base after the fold: the first commit out of place is named.
  const tipBefore = git(['rev-parse', 'HEAD'], c.repo)
  git(['checkout', '-q', '-b', 'up2', 'round'], c.repo)
  writeFileSync(join(c.repo, 'README.md'), '# upstream\n')
  commitAll(c.repo, 'upstream: readme')
  git(['checkout', '-q', 'main'], c.repo)
  git(['rebase', '-q', 'up2'], c.repo)
  const rebased = git(['rev-parse', 'HEAD'], c.repo)
  greenOn(c.repo)
  await s.check('a stack rebased onto a moved base after the fold fails, naming the first commit out of place', {
    assert: async () => {
      const g = await gateOf(NOW, c.repo, FOLD)
      return g?.state === 'fail' && /^\w+ "upstream: readme" stands where the fold stamped \w+ .*rebased onto a moved base/.test(g.detail)
    },
    breaks: async () => {
      git(['reset', '-q', '--hard', tipBefore], c.repo)
      greenOn(c.repo)
      return () => {
        git(['reset', '-q', '--hard', rebased], c.repo)
        greenOn(c.repo)
      }
    },
  })
})

await suite('rig 5.5, the repo’s own CI, configured or detected (r55g)', async (s) => {
  const CI = /^CI command green/
  const repo = repoAt('ci-detected')
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'depot', scripts: { test: 'node --test', ci: 'npm test && npm run lint' } }),
  )
  commitAll(repo, 'scripts.ci')
  const sha = greenOn(repo)
  let src = MERGED
  await s.check('a CI command detected in the commit (scripts.ci) with no ci run on the sha fails, naming the command', {
    assert: async () => {
      if (!src) return false
      const c = await gateOf(src, repo, CI)
      return (
        c?.state === 'fail' &&
        /^"npm run ci" \(scripts\.ci in package\.json\) has no run recorded on this commit: `rig qa \w+`/.test(c.detail)
      )
    },
    // The previous finish.js required CI only when ciCommand was configured: nothing ran, nothing failed.
    breaks: async () => {
      if (OLD) src = OLD
      return () => {
        src = MERGED
      }
    },
  })

  recordQa(repo, { kind: 'ci', sha, exit: 0, cmd: 'npm run ci' })
  await s.check('a ci run on the sha satisfies the detected command', {
    assert: async () => (await gateOf(MERGED, repo, CI))?.state === 'ok',
    breaks: async () => {
      greenOn(repo) // the QA log again, without the ci run
      return () => recordQa(repo, { kind: 'ci', sha, exit: 0, cmd: 'npm run ci' })
    },
  })

  // An executable bin/ci is detected by its mode as committed, not by the checkout on disk.
  const exe = repoAt('ci-exe')
  mkdirSync(join(exe, 'bin'))
  writeFileSync(join(exe, 'bin', 'ci'), '#!/bin/sh\nnpm test\n')
  chmodSync(join(exe, 'bin', 'ci'), 0o755)
  commitAll(exe, 'bin/ci')
  greenOn(exe)
  await s.check('an executable bin/ci in the commit is the CI command', {
    assert: async () => /^"\.\/bin\/ci" \(executable bin\/ci\)/.test((await gateOf(MERGED, exe, CI))?.detail || ''),
    breaks: async () => {
      git(['update-index', '--chmod=-x', 'bin/ci'], exe)
      git(['commit', '-qm', 'bin/ci not executable'], exe)
      greenOn(exe)
      return () => {
        git(['reset', '-q', '--hard', 'HEAD~1'], exe)
        greenOn(exe)
      }
    },
  })

  let off = { ...cfg, ciCommand: null }
  await s.check('ciCommand: null in the config says the repo has none: detection is off', {
    assert: async () => (await gateOf(MERGED, repo, CI, off)) === undefined || (await gateOf(MERGED, repo, CI, off)).state === 'ok',
    breaks: async () => {
      rmSync(qaLogPath(repo), { force: true })
      greenOn(repo)
      off = cfg
      return () => {
        off = { ...cfg, ciCommand: null }
        recordQa(repo, { kind: 'ci', sha, exit: 0, cmd: 'npm run ci' })
      }
    },
  })
})

await suite('rig 5.5, the second-vendor findings on 949e12b (r55g)', async (s) => {
  const PRE = srcWith('pre-949', { 'commands/finish.js': '949e12b' })
  const PRE_FOLD = srcWith('pre-949-fold', { 'fold.js': '949e12b' })
  const hostCfg = { ...cfg, qaHost: 'fake' }
  const HOST = /^QA green on fake$/
  const repo = repoAt('waiver')
  writeFileSync(join(repo, 'app', 'entry.js'), 'export const entry = 1\n')
  commitAll(repo, 'c1: entry')
  const sha = git(['rev-parse', 'HEAD'], repo)
  const at = (sec) => `2026-10-23T10:00:${String(sec).padStart(2, '0')}.000Z`
  const hostRun = { kind: 'test', sha, host: 'fake', exit: 1, cmd: 'npm test', failures: ['remote regression'], at: at(1) }
  const records = (baseline) => {
    rmSync(qaLogPath(repo), { force: true })
    recordQa(repo, { kind: 'test', sha, host: 'local', exit: 0, cmd: 'npm test', dirtied: [], at: at(0) })
    recordQa(repo, hostRun)
    recordVerdict(repo, { sha, vendor: 'openai', verdict: 'pass', what: 'npm test' })
    recordQa(repo, { kind: 'baseline', sha, host: 'local', cmd: 'true', at: at(2), baseline })
  }
  const localOnly = {
    base: sha,
    baseSha: sha,
    newFailures: [],
    known: [],
    fixed: [],
    complete: true,
    why: null,
    compared: [{ host: 'local', cmd: 'npm test', at: at(0) }],
  }
  // Zyro's repro: the host failed; a later local-only `--baseline --run true` compared nothing of it.
  let src = NOW
  records(localOnly)
  await s.check('a local-only baseline does not waive a failing host run it never compared', {
    assert: async () => {
      if (!src) return false
      const g = await gateOf(src, repo, HOST, hostCfg)
      return g?.state === 'fail' && /not waived: the baseline on this sha did not compare this run \(fake, npm test\)/.test(g.detail)
    },
    // 949e12b's finish.js: the newest baseline answered for every run, and the host read green.
    breaks: async () => {
      if (PRE) src = PRE
      return () => {
        src = NOW
      }
    },
  })

  // The waiver still works for the run the comparison did read, by host, command and record time.
  const named = (atOf) => ({
    ...localOnly,
    known: [{ name: 'remote regression', where: 'there' }],
    compared: [
      { host: 'local', cmd: 'npm test', at: at(0) },
      { host: 'fake', cmd: 'npm test', at: atOf },
    ],
  })
  records(named(at(1)))
  await s.check('a baseline that compared the host run, by host, command and record, waives its known failure', {
    assert: async () => {
      const g = await gateOf(NOW, repo, HOST, hostCfg)
      return g?.state === 'ok' && /every failure is known on the base/.test(g.detail)
    },
    // The same comparison, of an earlier host run: this one was never read.
    breaks: async () => {
      records(named(at(0)))
      return () => records(named(at(1)))
    },
  })

  // r55w's review of 2615858: a baseline record with no `compared` (the legacy path) waived any local
  // run of its command recorded before it, though another tab's run, never compared, can land there
  // while the base runs; that run's new VOID check then read as "every failure is known".
  const LOCAL = new RegExp(`^QA green on ${git(['rev-parse', '--short', 'HEAD'], repo)}$`)
  const legacy = () => {
    rmSync(qaLogPath(repo), { force: true })
    recordQa(repo, { kind: 'test', sha, host: 'local', exit: 1, cmd: 'npm test', failures: ['flaky clock'], void: ['new void'], at: at(3) })
    recordVerdict(repo, { sha, vendor: 'openai', verdict: 'pass', what: 'npm test' })
    recordQa(repo, {
      kind: 'baseline',
      sha,
      host: 'local',
      cmd: 'npm test',
      at: at(4),
      baseline: {
        base: sha,
        baseSha: sha,
        newFailures: [],
        known: [{ name: 'flaky clock', where: 'here' }],
        fixed: [],
        complete: true,
        why: null,
      },
    })
  }
  const PRE_LEGACY = srcWith('pre-legacy', { 'commands/finish.js': '2615858' })
  let legacySrc = NOW
  legacy()
  await s.check('a baseline with no compared list waives no run, and the gate says so', {
    assert: async () => {
      const g = await gateOf(legacySrc, repo, LOCAL)
      return g?.state === 'fail' && /not waived: the baseline on this sha names no compared run, so it waives none/.test(g.detail)
    },
    // 2615858's finish.js: the legacy guess waived the uncompared run.
    breaks: async () => {
      if (PRE_LEGACY) legacySrc = PRE_LEGACY
      return () => {
        legacySrc = NOW
      }
    },
  })

  // #4: the CI record must be of today's command, per host.
  const CIG = /^CI command green/
  rmSync(qaLogPath(repo), { force: true })
  greenOn(repo)
  recordQa(repo, { kind: 'ci', sha, exit: 0, cmd: 'true' })
  let ciSrc = NOW
  await s.check('a CI pass of another command is stale: today’s ciCommand must be the one that ran', {
    assert: async () => {
      if (!ciSrc) return false
      const g = await gateOf(ciSrc, repo, CIG, { ...cfg, ciCommand: 'false' })
      return g?.state === 'fail' && /^stale: the run recorded is of "true", today's CI command is "false"/.test(g.detail)
    },
    // 949e12b's finish.js checked only the record's sha, host and exit.
    breaks: async () => {
      if (PRE) ciSrc = PRE
      return () => {
        ciSrc = NOW
      }
    },
  })
  await s.check('the same record passes when it is of today’s command', {
    assert: async () => (await gateOf(NOW, repo, CIG, { ...cfg, ciCommand: 'true' }))?.state === 'ok',
    breaks: async () => {
      recordQa(repo, { kind: 'ci', sha, exit: 0, cmd: 'false' })
      return () => recordQa(repo, { kind: 'ci', sha, exit: 0, cmd: 'true' })
    },
  })

  // #3: the fold walk, under rig qa's runner.
  let foldSrc = NOW
  const walkFrom = async (dir) => (await import(`${pathToFileURL(join(dir, 'fold.js')).href}?v=${n++}`)).walkCommits
  const walk = async (cmd, ms) => (await (await walkFrom(foldSrc))(repo, cfg, [{ sha, subject: 'c1: entry' }], cmd, ms))[0]
  const oldFold = async () => {
    if (PRE_FOLD) foldSrc = PRE_FOLD
    return () => {
      foldSrc = NOW
    }
  }
  await s.check('a fold walk whose test fails inside a pipe is red (pipefail)', {
    assert: async () => (await walk('false | cat', 60_000)).exit !== 0,
    // 949e12b's walk ran `sh -c` and took the last command's status: exit 0.
    breaks: oldFold,
  })
  const late = join(tmp, 'walk-late')
  await s.check('a fold walk past its limit is stopped with everything it started (exit 124, nothing left running)', {
    assert: async () => {
      rmSync(late, { force: true })
      const w = await walk(`(sleep 1; touch '${late}') & wait`, 300)
      await new Promise((r) => setTimeout(r, 1500))
      return w.exit === 124 && w.ms < 1000 && !existsSync(late)
    },
    // 949e12b's spawnSync killed only the shell: the subshell it started lived on and wrote the file.
    breaks: oldFold,
  })
})

rmSync(tmp, { recursive: true, force: true })
