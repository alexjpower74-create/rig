// .rig/ is machine state and must never be committed, even in a repo whose .gitignore never got the
// `.rig/` line (set up before `rig init` added it, or never init'ed).
//
// On 2026-10-09 a nightly `git add -A` sync committed a finished build's .rig/qa-history.jsonl, home
// paths and all, and the public repo's hygiene check went red. The same gap made every slice's
// BRIEF.md read as uncommitted work, so `rig down` refused without --force. Each check below is red
// with the old implementation swapped back in: a bare mkdirSync of .rig/ and nothing else.

import { suite } from '../harness/check.js'
import { appendFileSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const made = []

/** A repo in the old shape: .gitignore without `.rig/`, one commit. Extra files are committed too. */
function oldShapeRepo(files = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rig-state-')))
  made.push(root)
  git(['init', '-q', '-b', 'main'], root)
  git(['config', 'user.email', 'test@example.invalid'], root)
  git(['config', 'user.name', 'test'], root)
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n.worktrees/\n')
  writeFileSync(join(root, 'README.md'), 'x\n')
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(join(root, p, '..'), { recursive: true })
    writeFileSync(join(root, p), body)
  }
  git(['add', '-A'], root)
  git(['commit', '-qm', 'first'], root)
  return root
}

/** Run fn with console.error captured; returns what it printed. */
function captureErr(fn) {
  const was = console.error
  let out = ''
  console.error = (...a) => {
    out += a.join(' ') + '\n'
  }
  try {
    fn()
  } finally {
    console.error = was
  }
  return out
}

const oldRigDir = (root) => {
  mkdirSync(join(root, '.rig'), { recursive: true })
  return join(root, '.rig')
}

await suite(
  'rig state stays out of git',
  async (s) => {
    const { rigDir } = await import('../src/rigdir.js')
    const { recordQa, qaLogPath } = await import('../src/qalog.js')
    const { saveIssues } = await import('../src/issues.js')

    // The real writers, as `rig qa` and `rig up` call them.
    let writeState = (root) => {
      recordQa(root, { kind: 'test', sha: 'abc1234', code: 0, cmd: `cd ${root} && npm test` })
      saveIssues(root, { c1: { number: 1, url: 'https://example.invalid/1' } })
    }
    await s.check('in a repo whose .gitignore lacks .rig/, the QA record and issues are never staged, and nothing tracked changes', {
      assert: async () => {
        const root = oldShapeRepo()
        captureErr(() => {
          writeState(root)
          writeState(root) // twice: the exclude line must be written once
        })
        git(['add', '-A'], root)
        const staged = git(['diff', '--cached', '--name-only'], root)
        if (staged) throw new Error(`a repo-wide add staged: ${staged.replaceAll('\n', ', ')}`)
        if (git(['status', '--porcelain'], root)) throw new Error(`tree not clean: ${git(['status', '--porcelain'], root)}`)
        const exclude = readFileSync(join(root, '.git', 'info', 'exclude'), 'utf8')
        const lines = exclude.split('\n').filter((l) => l.trim() === '.rig/').length
        if (lines !== 1) throw new Error(`.rig/ appears ${lines} times in info/exclude`)
        return readFileSync(join(root, '.gitignore'), 'utf8') === 'node_modules/\n.worktrees/\n'
      },
      breaks: async () => {
        const real = writeState
        writeState = (root) => {
          oldRigDir(root)
          appendFileSync(qaLogPath(root), '{"kind":"test"}\n')
        }
        return () => {
          writeState = real
        }
      },
    })

    // `rig up` writes BRIEF.md into each slice worktree's .rig/. The exclude file lives in the
    // common git dir, so one entry covers every linked worktree.
    let makeDir = rigDir
    await s.check("a slice worktree's .rig/BRIEF.md is not uncommitted work", {
      assert: async () => {
        const root = oldShapeRepo()
        const wt = join(root, '..', `${root.split('/').pop()}-wt`)
        made.push(wt)
        git(['worktree', 'add', '-q', '-b', 'rig/c1', wt], root)
        captureErr(() => writeFileSync(join(makeDir(wt), 'BRIEF.md'), '# brief\n'))
        const dirty = git(['status', '--porcelain'], wt)
        if (dirty) throw new Error(`worktree shows: ${dirty}`)
        return true
      },
      breaks: async () => {
        makeDir = oldRigDir
        return () => {
          makeDir = rigDir
        }
      },
    })

    // Ignoring does not untrack. A repo that already committed its state is told which files and
    // how; config.json is left out (some older repos track it on purpose, and it holds no paths).
    let makeDir2 = rigDir
    await s.check('state already committed is named, with the untrack command; config.json is not', {
      assert: async () => {
        const root = oldShapeRepo({ '.rig/qa-history.jsonl': '{}\n', '.rig/config.json': '{}\n' })
        const said = captureErr(() => makeDir2(root))
        if (!said.includes('.rig/qa-history.jsonl')) throw new Error(`did not name the QA record: ${JSON.stringify(said)}`)
        if (!said.includes('git rm --cached')) throw new Error('no untrack command')
        if (said.includes('config.json')) throw new Error('named config.json')
        return true
      },
      breaks: async () => {
        makeDir2 = oldRigDir
        return () => {
          makeDir2 = rigDir
        }
      },
    })

    // Every writer goes through rigDir: a command that makes .rig/ itself skips the ignore. Red when
    // a source file with the old bare mkdir is added to the scan.
    const srcDir = join(import.meta.dirname, '..', 'src')
    const sources = () =>
      readdirSync(srcDir, { recursive: true })
        .filter((f) => f.endsWith('.js') && f !== 'rigdir.js')
        .map((f) => ({ f, text: readFileSync(join(srcDir, f), 'utf8') }))
    let extra = []
    await s.check('no source file creates .rig/ except through rigDir', {
      assert: async () => {
        const bare = [...sources(), ...extra].filter(({ text }) => /mkdirSync\([^)]*['"]\.rig['"]/.test(text)).map(({ f }) => f)
        if (bare.length) throw new Error(`bare .rig mkdir in: ${bare.join(', ')}`)
        return sources().length > 10
      },
      breaks: async () => {
        extra = [{ f: 'planted.js', text: "  mkdirSync(join(root, '.rig'), { recursive: true })\n" }]
        return () => {
          extra = []
        }
      },
    })
  },
  { requireNegativeControl: true },
)

for (const d of made) rmSync(d, { recursive: true, force: true })
