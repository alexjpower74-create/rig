// Rig 5.5, r55g: the last two facts of the finish gate.
//  (a) Item 2: after a fold, the stamped commits may be rewritten only in their messages: every
//      counterpart's tree must equal the stamped one, or finish fails naming the commit.
//  (b) Item 3b: when the repo has a CI command, configured or detected by r55q's detectCi in the
//      commit itself, finish needs a ci record on the sha and names the command when none ran.
// Controls swap the previous finish.js (a25b59f) back in, or change the repository's state.

import { suite } from '../harness/check.js'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
  const folded = (name) => {
    const repo = repoAt(name)
    writeFileSync(join(repo, 'app', 'entry.js'), 'export const entry = 1\n')
    commitAll(repo, 'c1: entry')
    writeFileSync(join(repo, 'app', 'admin.js'), 'export const admin = 1\n')
    commitAll(repo, 'c1: admin')
    writeFileSync(join(repo, 'app', 'entry.js'), 'export const entry = 2\n')
    commitAll(repo, 'fixup! c1: entry')
    const r = fold(repo, { base: 'round', root: repo, cfg })
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

  const a = folded('content')
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

  const b = folded('message-only')
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

  const c = folded('unchanged')
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

rmSync(tmp, { recursive: true, force: true })
