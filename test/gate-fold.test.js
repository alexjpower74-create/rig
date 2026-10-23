// Rig 5.5, r55g, item 2: one organized fold. Fix commits fold into their owners with a real,
// non-interactive `git rebase -i`; the folded tip's tree must equal the old tip's (which already held
// every fix) or the fold is refused and the branch put back; every new commit is walked on its own;
// the new shas are stamped old → new. The tree check's control is the defect it exists to catch: a
// fold whose todo drops one fix, run with the check switched off, "succeeds" and loses the hunk.

import { suite } from '../harness/check.js'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const RIG = join(here, '..')
const ENV = { ...process.env }
for (const k of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_DIR', 'GIT_WORK_TREE'])
  delete ENV[k]
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', env: ENV }).trim()
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rig-fold-')))
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')

const { fold, planFold, stackCommits, readFolds } = await import('../src/fold.js')

/**
 * main: base. Branch rig/c1: "c1: entry" (app/entry.js), "c1: admin" (app/admin.js), then two fix
 * commits: a fixup! of the entry commit, and a plain commit to admin.js passed with --fix.
 */
function stackRepo(name) {
  const repo = join(tmp, name)
  mkdirSync(join(repo, 'app'), { recursive: true })
  git(['init', '-q', '-b', 'main'], repo)
  git(['config', 'user.email', 'test@example.invalid'], repo)
  git(['config', 'user.name', 'Rig Test'], repo)
  writeFileSync(join(repo, '.gitignore'), '.rig/\n.worktrees/\n')
  writeFileSync(join(repo, 'README.md'), '# x\n')
  writeFileSync(join(repo, 'check.sh'), 'test -f app/entry.js || exit 0\ngrep -q "export" app/entry.js\n')
  git(['add', '-A'], repo)
  git(['commit', '-qm', 'base'], repo)
  git(['checkout', '-qb', 'rig/c1'], repo)
  const c = (file, text, msg) => {
    writeFileSync(join(repo, file), text)
    git(['add', '-A'], repo)
    git(['commit', '-qm', msg], repo)
    return git(['rev-parse', 'HEAD'], repo)
  }
  const entry = c('app/entry.js', 'export const entry = 1\nexport const name = (s) => s\n', 'c1: entry')
  const admin = c('app/admin.js', 'export const admin = 1\n', 'c1: admin')
  const fixEntry = c('app/entry.js', 'export const entry = 1\nexport const name = (s) => s.trim()\n', 'fixup! c1: entry')
  const fixAdmin = c('app/admin.js', 'export const admin = 2\n', 'review: admin starts at 2')
  return { repo, entry, admin, fixEntry, fixAdmin, tip: fixAdmin }
}
const cfg = { worktreeDir: '.worktrees', branchPrefix: 'rig/' }
const subjects = (repo) => git(['log', '--format=%s', 'main..HEAD'], repo).split('\n').reverse()

function rig(cmd, repo, args) {
  const r = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import('${join(RIG, 'src', 'commands', cmd + '.js')}').then(m => m.default(process.argv.slice(1)))`,
      '--',
      ...args,
    ],
    { cwd: repo, encoding: 'utf8', env: ENV },
  )
  return { status: r.status, out: plain(r.stdout + r.stderr) }
}

await suite('rig 5.5, rig fold (r55g)', async (s) => {
  // ---------------------------------------------------------------------------------------------
  const a = stackRepo('plan')
  let fixes = [a.fixAdmin.slice(0, 7)]
  await s.check('fixup! subjects and --fix commits find their owners (absorb’s rule: the newest earlier commit on the same files)', {
    assert: async () => {
      const p = planFold(a.repo, stackCommits(a.repo, git(['merge-base', 'main', 'HEAD'], a.repo)), fixes)
      const own = Object.fromEntries(p.owners.map((o) => [o.subject, o.fixes.map((f) => f.sha)]))
      return (
        p.errors.length === 0 &&
        p.fixCount === 2 &&
        own['c1: entry'].join() === a.fixEntry &&
        own['c1: admin'].join() === a.fixAdmin &&
        p.todo.join('\n') ===
          [
            `pick ${a.entry} c1: entry`,
            `fixup ${a.fixEntry} fixup! c1: entry`,
            `pick ${a.admin} c1: admin`,
            `fixup ${a.fixAdmin} review: admin starts at 2`,
          ].join('\n')
      )
    },
    breaks: async () => {
      fixes = []
      return () => {
        fixes = [a.fixAdmin.slice(0, 7)]
      }
    },
  })

  let orphanSubject = 'fixup! c1: nothing like this'
  await s.check('a fixup! whose subject matches nothing is refused before anything moves', {
    assert: async () => {
      const r = stackRepo(`orphan-${Date.now()}`)
      writeFileSync(join(r.repo, 'app', 'entry.js'), 'export const entry = 9\n')
      git(['commit', '-qam', orphanSubject], r.repo)
      const tip = git(['rev-parse', 'HEAD'], r.repo)
      const out = await fold(r.repo, { base: 'main', root: r.repo, cfg })
      return (
        out.state === 'refused' &&
        /no earlier commit on this stack has that subject/.test(out.why) &&
        git(['rev-parse', 'HEAD'], r.repo) === tip
      )
    },
    breaks: async () => {
      orphanSubject = 'fixup! c1: entry'
      return () => {
        orphanSubject = 'fixup! c1: nothing like this'
      }
    },
  })

  // ---------------------------------------------------------------------------------------------
  // The tree check. Its control: the same fold with the check off lets the dropped hunk through.
  const dropFix = (todo) => todo.filter((l) => !l.includes('fixup!'))
  let hooks = { todo: dropFix }
  await s.check('a fold that drops a hunk is refused by the tree check, and the branch is put back', {
    assert: async () => {
      const r = stackRepo(`drop-${Date.now()}`)
      const out = await fold(r.repo, { base: 'main', fixes: [r.fixAdmin.slice(0, 7)], root: r.repo, cfg }, hooks)
      return (
        out.state === 'refused' &&
        /the folded tree differs from the old tip's tree/.test(out.why) &&
        /app\/entry\.js/.test(out.why) &&
        git(['rev-parse', 'HEAD'], r.repo) === r.tip &&
        git(['status', '--porcelain'], r.repo) === '' &&
        !existsSync(join(r.repo, '.git', 'rebase-merge'))
      )
    },
    breaks: async () => {
      hooks = { todo: dropFix, treeCheck: false }
      return () => {
        hooks = { todo: dropFix }
      }
    },
  })

  // ---------------------------------------------------------------------------------------------
  const b = stackRepo('real')
  let walkCmd = 'sh check.sh'
  let result
  await s.check('a real fold: two commits, the same tree, every commit walked, shas stamped old → new', {
    assert: async () => {
      git(['reset', '-q', '--hard', b.tip], b.repo)
      result = await fold(b.repo, { base: 'main', fixes: [b.fixAdmin.slice(0, 7)], each: walkCmd, root: b.repo, cfg })
      return (
        result.state === 'folded' &&
        subjects(b.repo).join(' | ') === 'c1: entry | c1: admin' &&
        git(['rev-parse', 'HEAD^{tree}'], b.repo) === git(['rev-parse', `${b.tip}^{tree}`], b.repo) &&
        result.map.length === 2 &&
        result.map[0].old.join() === [b.entry, b.fixEntry].join() &&
        result.map[1].old.join() === [b.admin, b.fixAdmin].join() &&
        result.walk.length === 2 &&
        result.walk.every((w) => w.exit === 0)
      )
    },
    // A walk command that fails on the first folded commit: "every commit passes alone" must notice.
    breaks: async () => {
      walkCmd = 'test -f app/admin.js'
      return () => {
        walkCmd = 'sh check.sh'
      }
    },
  })

  await s.check('the folded commits keep the identity from git config, not the session’s environment', {
    assert: async () => {
      const r = stackRepo('identity')
      // A session whose environment carries another address.
      process.env.GIT_COMMITTER_EMAIL = 'session@example.invalid'
      process.env.GIT_AUTHOR_EMAIL = 'session@example.invalid'
      let out
      try {
        out = await fold(r.repo, { base: 'main', fixes: [r.fixAdmin.slice(0, 7)], root: r.repo, cfg })
      } finally {
        delete process.env.GIT_COMMITTER_EMAIL
        delete process.env.GIT_AUTHOR_EMAIL
      }
      const who = git(['log', '-1', '--format=%an %ae / %cn %ce'], r.repo)
      return out.state === 'folded' && who === 'Rig Test test@example.invalid / Rig Test test@example.invalid'
    },
  })

  // ---------------------------------------------------------------------------------------------
  // The command, end to end.
  let n = 0
  let eachArgs = ['--each', 'sh check.sh']
  await s.check('rig fold prints drift first, folds, stamps .rig/fold.json, and says what to rerun', {
    assert: async () => {
      const c = stackRepo(`cli-${n++}`)
      const r = rig('fold', c.repo, ['--base', 'main', '--fix', c.fixAdmin.slice(0, 7), ...eachArgs])
      const stamp = readFolds(c.repo).folds.at(-1)
      const d = r.out.search(/^drift/m)
      return (
        r.status === 0 &&
        d >= 0 &&
        d < r.out.indexOf('folded ') &&
        stamp.oldTip === c.tip &&
        stamp.newTip === git(['rev-parse', 'HEAD'], c.repo) &&
        stamp.walk.length === 2 &&
        /every final check reruns on the new shas/.test(r.out)
      )
    },
    // --no-each: a fold that walked nothing must not read as walked.
    breaks: async () => {
      eachArgs = ['--no-each']
      return () => {
        eachArgs = ['--each', 'sh check.sh']
      }
    },
  })

  let walkRed = 'test -f app/admin.js'
  await s.check('a walked commit that fails exits 1 and keeps the fold (its tree is identical)', {
    assert: async () => {
      const r2 = stackRepo(`walk-red-${n++}`)
      const out = rig('fold', r2.repo, ['--base', 'main', '--fix', r2.fixAdmin.slice(0, 7), '--each', walkRed])
      return out.status === 1 && /1 commit\(s\) do not pass on their own/.test(out.out) && subjects(r2.repo).length === 2
    },
    breaks: async () => {
      walkRed = 'true'
      return () => {
        walkRed = 'test -f app/admin.js'
      }
    },
  })

  let dirtyText = 'dirty\n'
  await s.check('a dirty tree, a missing --fix value and nothing to fold are told apart', {
    assert: async () => {
      const r3 = stackRepo(`edges-${n++}`)
      writeFileSync(join(r3.repo, 'app', 'entry.js'), dirtyText)
      const dirty = rig('fold', r3.repo, ['--base', 'main'])
      git(['checkout', '-q', '--', '.'], r3.repo)
      const noValue = rig('fold', r3.repo, ['--fix'])
      const r4 = stackRepo(`nothing-${n++}`)
      git(['reset', '-q', '--hard', r4.admin], r4.repo)
      const nothing = rig('fold', r4.repo, ['--base', 'main'])
      return (
        dirty.status === 1 &&
        /uncommitted changes/.test(dirty.out) &&
        noValue.status === 2 &&
        nothing.status === 0 &&
        /nothing to fold/.test(nothing.out) &&
        !existsSync(join(r4.repo, '.rig', 'fold.json'))
      )
    },
    // The same bytes as committed: a clean tree, and the fold goes ahead.
    breaks: async () => {
      dirtyText = 'export const entry = 1\nexport const name = (s) => s.trim()\n'
      return () => {
        dirtyText = 'dirty\n'
      }
    },
  })
})

rmSync(tmp, { recursive: true, force: true })
