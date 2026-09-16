import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mainRoot, loadConfig, sessionName } from '../config.js'
import { loadPlan } from '../plan.js'
import { worktreePath, worktreeBase, dirtyFiles, qaSlots } from '../worktrees.js'
import { tryGit, git } from '../sh.js'
import { terminal } from '../terminal.js'
import { processesIn, stopProcesses, insideDir } from '../procs.js'
import { realpathSync } from 'node:fs'

const real = p => { try { return realpathSync(p) } catch { return p } }

export default async function down (args) {
  const root = mainRoot()
  const cfg = loadConfig(root)
  const plan = loadPlan(join(root, cfg.plan))
  const force = args.includes('--force')
  const sliceIds = plan.agents.map(a => a.id)
  // 3.0: QA worktrees are per run (qa, qa-2, ...). Remove every slot, but never one whose lock holds a
  // live `rig qa`: tearing it down mid-run would record a dead exit as a real result.
  const slots = qaSlots(root, cfg)
  const live = slots.filter(s => s.lock && s.lock.live)
  if (live.length) {
    console.error('\x1b[31mrefusing to tear down\x1b[0m — a QA run is still using:')
    for (const s of live) console.error(`  ${s.id}: pid ${s.lock.pid}  ${s.path}`)
    console.error('\nWait for it to finish (or stop that `rig qa`), then re-run.')
    process.exit(1)
  }
  const qaIds = slots.map(s => s.id)
  const ids = [...sliceIds, ...qaIds]

  // Run from inside a worktree it is about to remove, `rig down` would stop its own shell and the
  // agent that called it, then fail to remove the (busy) directory, leaving it half torn down.
  const here = real(process.cwd())
  for (const id of ids) {
    const p = worktreePath(root, cfg, id)
    if (existsSync(p) && insideDir(here, real(p))) {
      throw new Error(`rig down is running inside the ${id} worktree it would remove. Run it from the main checkout: ${root}`)
    }
  }

  // Refuse to tear down over uncommitted work. Branches are always kept — the rig removes
  // checkouts, never commits.
  const blocked = []
  const reports = []
  for (const id of ids) {
    const path = worktreePath(root, cfg, id)
    if (!existsSync(path)) continue
    const dirty = dirtyFiles(path)
    if (dirty.length && !qaIds.includes(id)) blocked.push({ id, path, dirty })

    // An agent's report lives in .rig/, which is gitignored by design — so it is never "dirty",
    // never committed, and teardown would take the only copy of its reasoning with it. The work
    // is protected by the commit check above; the account of the work was not protected by
    // anything. On this project those reports ran to 500 lines and were the most detailed record
    // of how the thing was built.
    // Belt and braces behind the real fix, which is briefs pointing reports at a tracked path.
    // Older builds wrote them here, and an agent can always ignore where it was told to write.
    const dir = join(path, '.rig')
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        if (/^report-.*\.md$/.test(f)) reports.push({ id, file: join(dir, f) })
      }
    }
  }

  if (reports.length && !args.includes('--discard-reports')) {
    console.error(`\x1b[33m${reports.length} agent report(s) live only inside the worktrees:\x1b[0m`)
    for (const r of reports) console.error(`  ${r.file}`)
    console.error('\nThese are gitignored, so they were never committed and removing the worktrees deletes them.')
    console.error('Copy them somewhere first, then re-run — or pass --discard-reports if you genuinely do not want them.')
    process.exit(1)
  }

  if (blocked.length && !force) {
    console.error('\x1b[31mrefusing to tear down\x1b[0m — uncommitted work in:')
    for (const b of blocked) console.error(`  ${b.id}: ${b.dirty.length} file(s)  ${b.path}`)
    console.error('\nCommit it (`git commit -- <paths>`) or re-run with --force to discard the checkout.')
    process.exit(1)
  }

  // Close the agents first (so they stop writing), then anything they left running.
  const term = terminal(cfg)
  if (term.available() && term.sessionExists(sessionName(root))) {
    const closed = term.killSession(sessionName(root), [...sliceIds, ...sliceIds.map(i => 'rv-' + i)])
    if (Array.isArray(closed)) console.log(closed.length ? `closed slice tabs: ${closed.join(', ')}` : 'no slice tabs of this plan were open')
    else console.log(`closed ${term.name} session ${sessionName(root)}`)
  }

  // A dev server started inside a worktree outlives the worktree and keeps its port. Stop only
  // processes whose working directory is inside a worktree being removed — never by name.
  const base = real(worktreeBase(root, cfg))
  for (const id of ids) {
    const path = worktreePath(root, cfg, id)
    if (!existsSync(path)) continue
    // Only ever a directory strictly inside the worktree base: never the base, never above it.
    const rp = real(path)
    if (rp === base || !insideDir(rp, base)) { console.log(`skipped stopping processes for ${id}: ${rp} is not inside ${base}`); continue }
    const stopped = stopProcesses(processesIn(rp))
    if (stopped.length) console.log(`stopped ${stopped.length} process(es) still running inside ${id}: ${stopped.join(' ')}`)
  }
  await new Promise(resolve => setTimeout(resolve, 500))

  for (const id of ids) {
    const path = worktreePath(root, cfg, id)
    if (!existsSync(path)) continue
    const r = tryGit(['worktree', 'remove', force ? '--force' : '', path].filter(Boolean), root)
    console.log(r.ok ? `removed worktree ${id}` : `could not remove ${id}: ${r.err}`)
  }
  git(['worktree', 'prune'], root)
  console.log('\nbranches kept. `git branch --list "' + cfg.branchPrefix + '*"` to see them.')
}
