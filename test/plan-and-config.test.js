// Two bugs the rig had about itself, and the checks that would have caught them.
//
// Both were silent. Neither produced an error, a warning, or a wrong exit code — they produced
// confident output that was wrong, which is the failure mode this whole tool exists to argue
// against. So both checks here are written to go red at source: the negative control breaks the
// real mechanism, not a substitute for it.

import { suite } from '../harness/check.js'
import { mkdtempSync, writeFileSync, mkdirSync, renameSync, existsSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** A throwaway repo with a gitignored .rig/, one commit, and a linked worktree — the real shape. */
function scaffold() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rig-test-')))
  git(['init', '-q', '-b', 'main'], root)
  git(['config', 'user.email', 'test@example.invalid'], root)
  git(['config', 'user.name', 'Rig Test'], root)

  // .rig/ is gitignored in every repo `rig init` touches. That is the precondition for the bug:
  // a linked worktree is a fresh checkout, so it never receives one.
  writeFileSync(join(root, '.gitignore'), '.rig/\n.worktrees/\n')
  writeFileSync(join(root, 'PLAN.md'), PLAN)
  mkdirSync(join(root, '.rig'), { recursive: true })
  writeFileSync(
    join(root, '.rig', 'config.json'),
    JSON.stringify({
      plan: 'PLAN.md',
      worktreeDir: '.worktrees',
      portBase: 7777,
      qaPort: 7799,
      branchPrefix: 'slice/',
    }),
  )
  git(['add', '-A'], root)
  git(['commit', '-qm', 'base'], root)
  git(['worktree', 'add', '-q', join(root, '.worktrees', 'c1'), '-b', 'slice/c1'], root)
  return { root, worktree: join(root, '.worktrees', 'c1') }
}

const PLAN = `# Test build

## Agents

### c1 — The bundle
Owns:
- app/**

Report: docs/build-report-bundle.md

Task:
Make the bundle.

### c2 — The evidence
Owns:
- test/**

Task:
Prove it.
`

const { root, worktree } = scaffold()

await suite('rig, about itself', async (s) => {
  const { mainRoot, loadConfig, DEFAULTS } = await import('../src/config.js')
  const { loadPlan } = await import('../src/plan.js')
  const { reportPath, isOwnReport } = await import('../src/reports.js')

  // ----------------------------------------------------------------------------------------
  // Red when: config stops resolving to the main checkout from inside a worktree. Made red by
  // moving the only config that exists — which is exactly what a linked worktree looks like.
  await s.check('config read from inside a worktree is the main checkout’s, not DEFAULTS', {
    assert: async () => {
      const cfg = loadConfig(mainRoot(worktree))
      if (cfg.portBase === DEFAULTS.portBase) throw new Error('fell back to DEFAULTS — the worktree found no config')
      return cfg.portBase === 7777 && cfg.branchPrefix === 'slice/' && cfg.worktreeDir === '.worktrees'
    },
    breaks: async () => {
      const p = join(root, '.rig', 'config.json')
      renameSync(p, p + '.aside')
      return () => renameSync(p + '.aside', p)
    },
  })

  // The bug's actual signature: worktreeDir resolved against the wrong root, so the brief named
  // a directory that does not exist. Worth pinning separately from the config read.
  await s.check('a worktree path resolves under the main root, not under the worktree', {
    assert: async () => {
      const { worktreePath } = await import('../src/worktrees.js')
      const cfg = loadConfig(mainRoot(worktree))
      const p = worktreePath(mainRoot(worktree), cfg, 'c1')
      if (p.includes('.worktrees/c1/.worktrees')) throw new Error(`nested under itself: ${p}`)
      if (!existsSync(p)) throw new Error(`brief would name a directory that does not exist: ${p}`)
      return realpathSync(p) === realpathSync(worktree)
    },
    breaks: async () => {
      const p = join(root, '.rig', 'config.json')
      renameSync(p, p + '.aside') // DEFAULTS put worktreeDir at ../.rig-worktrees
      return () => renameSync(p + '.aside', p)
    },
  })

  // ----------------------------------------------------------------------------------------
  // Red when: a slice's declared report path stops being honoured and the id-derived one wins
  // again. Made red by deleting the Report: line from the plan the check reads.
  await s.check('a slice reports where the plan says, and the guard exempts that path', {
    assert: async () => {
      const plan = loadPlan(join(root, 'PLAN.md'))
      const c1 = plan.agents.find((a) => a.id === 'c1')
      const c2 = plan.agents.find((a) => a.id === 'c2')
      if (reportPath(c1) !== 'docs/build-report-bundle.md') throw new Error(`c1 -> ${reportPath(c1)}`)
      if (reportPath(c2) !== 'docs/build-report-c2.md') throw new Error(`c2 default lost: ${reportPath(c2)}`)
      // The guard has to agree, or the agent is refused for writing what the brief asked for.
      if (!isOwnReport('docs/build-report-bundle.md', c1)) throw new Error('guard would refuse c1 its own report')
      if (isOwnReport('docs/build-report-bundle.md', c2)) throw new Error('c2 can reach c1’s report')
      // The same parse must keep Report: out of the prose the agent is handed as its task.
      if (/Report:/i.test(c1.task)) throw new Error(`Report: leaked into the task: ${JSON.stringify(c1.task)}`)
      if (c1.task !== 'Make the bundle.') throw new Error(`task mangled: ${JSON.stringify(c1.task)}`)
      return true
    },
    breaks: async () => {
      const p = join(root, 'PLAN.md')
      writeFileSync(p, PLAN.replace('Report: docs/build-report-bundle.md\n\n', ''))
      return () => writeFileSync(p, PLAN)
    },
  })

  // ----------------------------------------------------------------------------------------
  // Red when: two slices are allowed to share one report path, so one silently overwrites the
  // other's reasoning and the loser never finds out.
  await s.check('two slices cannot report to the same file', {
    assert: async () => {
      const clash = PLAN.replace('Task:\nProve it.', 'Report: docs/build-report-bundle.md\n\nTask:\nProve it.')
      try {
        loadPlan.length
        parsePlanGuard(clash)
      } catch (e) {
        return /both report to/.test(e.message)
      }
      throw new Error('a plan with two slices sharing a report path was accepted')
    },
    breaks: async () => {
      // Break it by handing the same assertion a plan that does NOT clash: the error it looks
      // for can no longer be raised, so a check that "passes whenever something throws" fails.
      const original = globalThis.__rigTestPlanOverride
      globalThis.__rigTestPlanOverride = PLAN
      return () => {
        globalThis.__rigTestPlanOverride = original
      }
    },
  })

  function parsePlanGuard(text) {
    const src = globalThis.__rigTestPlanOverride ?? text
    const p = join(root, '.rig', 'clash-plan.md')
    writeFileSync(p, src)
    try {
      return loadPlan(p)
    } finally {
      rmSync(p, { force: true })
    }
  }
})

rmSync(root, { recursive: true, force: true })
