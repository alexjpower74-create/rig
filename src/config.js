import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { git, tryGit } from './sh.js'
import { rigDir } from './rigdir.js'

export const DEFAULTS = {
  plan: 'PLAN.md',
  branchPrefix: 'rig/',
  worktreeDir: '../.rig-worktrees',
  portBase: 5180,
  qaPort: 5199,
  launch: 'claude --model opus --effort medium',
  terminal: 'auto', // auto | hc (the Herdr app; also "herdr-app") | herdr | tmux
  // What `npm start` would run: a server. Never graded as the test (see testCommandFor).
  devCommand: null,
  // The command `rig qa` grades as the test when --run is not given. Must exit, and mean it.
  testCommand: null,
  // What the negative-control command's exit means: "pass" (it exits 0 after every control went red,
  // the older `... || true` shape) or "fail" (it exits non-zero when the break is caught).
  negativeExpect: null,
  // The app registry slug (`~/.claude/apps/<slug>.md`); `rig init` fills it in, `rig finish` jots under it.
  slug: null,
  // Open one GitHub issue per slice at `rig up` (when gh and a remote exist); `--no-issues` skips.
  issues: true,
}

export function repoRoot(cwd = process.cwd()) {
  const r = tryGit(['rev-parse', '--show-toplevel'], cwd)
  if (!r.ok) throw new Error('Not inside a git repository. The rig slices a repo; there has to be one.')
  return r.out
}

/**
 * The MAIN checkout, even when called from inside a linked worktree.
 *
 * Everything the rig configures lives with the main repo: `.rig/config.json` is gitignored so a
 * worktree never has one, `worktreeDir` is a path relative to the main root, and PLAN.md is the
 * contract as it stands now rather than as it stood when a branch was cut.
 *
 * Without this, every rig command run from inside a worktree found no config, silently fell back
 * to DEFAULTS, and reported a worktree path, a port base and a branch prefix that were not the
 * ones in use — with no indication anything had gone wrong. An agent following that brief looks
 * for its own worktree in a directory that does not exist.
 *
 * `--git-common-dir` is the main repo's `.git` from anywhere inside it, linked worktrees included.
 */
export function mainRoot(cwd = process.cwd()) {
  const r = tryGit(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd)
  if (!r.ok) return repoRoot(cwd)
  const common = r.out
  // A bare-ish or unusual layout can answer something that is not `<root>/.git`; fall back rather
  // than confidently returning a wrong directory.
  return common.endsWith('/.git') || common.endsWith('\\.git') ? dirname(common) : repoRoot(cwd)
}

export function configPath(root) {
  return join(root, '.rig', 'config.json')
}

export function loadConfig(root) {
  const p = configPath(root)
  if (existsSync(p)) return withWorktreeDir(root, JSON.parse(readFileSync(p, 'utf8')))
  // Called from inside a linked worktree, which has no .rig/ of its own.
  const shared = configPath(mainRoot(root))
  if (shared !== p && existsSync(shared)) return withWorktreeDir(root, JSON.parse(readFileSync(shared, 'utf8')))
  return withWorktreeDir(root, {})
}

/**
 * Where a repo's worktrees go when its config does not say: `../.rig-worktrees/<repo dir name>`.
 *
 * The 2.0 default was `../.rig-worktrees`, one directory shared by every repo under the same parent.
 * Two rigs in sibling repos then wrote their `qa` (and `c1`, `c2`…) worktrees to the same path: on
 * 2026-09-15 `rig qa` in this repo collided with another project's QA worktree and refused. A
 * per-repo subdirectory keeps them apart while still leaving the checkouts outside the repo, where
 * `npm test`, formatters and `git status` never see them. An explicit `worktreeDir` is honoured as is.
 */
export function defaultWorktreeDir(root) {
  let main = root
  try {
    main = mainRoot(root)
  } catch {
    /* not a git repo: name the directory itself */
  }
  return `${DEFAULTS.worktreeDir}/${basename(main)}`
}

function withWorktreeDir(root, fileCfg) {
  const cfg = { ...DEFAULTS, ...fileCfg }
  // 2.0's `rig init` saved all of DEFAULTS, so every repo it initialised carries the literal shared
  // value. That is the value that collided; it reads as "unset" and gets the per-repo default. Any
  // other explicit value is the person's choice. `rig init` writes the resolved path back.
  if (!fileCfg.worktreeDir || fileCfg.worktreeDir === DEFAULTS.worktreeDir) cfg.worktreeDir = defaultWorktreeDir(root)
  return cfg
}

export function saveConfig(root, cfg) {
  rigDir(root)
  writeFileSync(configPath(root), JSON.stringify(cfg, null, 2) + '\n')
}

export function sessionName(root) {
  return (
    'rig-' +
    root
      .split('/')
      .pop()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  )
}

export function currentBranch(cwd) {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
}

/**
 * The branch this checkout is on, or `null` when there is none to name: HEAD is unborn (a fresh
 * repo before its first commit) or detached without a branch. `currentBranch` throws in the first
 * case, which is how the pre-commit guard refused the very first commit of every repo it was
 * installed in — the hook ran, git had no HEAD to resolve, and the error read as a refusal.
 */
export function currentBranchOrNull(cwd) {
  const r = tryGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  if (!r.ok || !r.out || r.out === 'HEAD') return null
  return r.out
}

/** 'unborn' (no commit yet), 'detached' (a commit but no branch), or the branch name. */
export function headState(cwd) {
  const branch = currentBranchOrNull(cwd)
  if (branch) return branch
  // `--verify HEAD` fails only when HEAD points at nothing: a fresh repo. A detached HEAD resolves.
  return tryGit(['rev-parse', '--verify', '-q', 'HEAD'], cwd).ok ? 'detached' : 'unborn'
}

// ---- Gate semantics (5.6.1) -------------------------------------------------------------------
// An exit code means exactly one thing, and a server cannot pass a gate.

/** A command that starts something and keeps running: a dev server or watcher, never a test. */
const SERVER_WORDS = 'start|dev|serve|watch|preview'
const SERVER_SHAPES = [
  new RegExp(`(^|[\\s&;|(])(npm|pnpm|yarn|bun)\\s+(run\\s+)?(${SERVER_WORDS})(\\s|$|[&;|)])`),
  /(^|[\s&;|(/])(vite|next|nuxt|astro|webpack|rails)\s+(dev|start|serve|server|s)(\s|$|[&;|)])/,
  /(^|[\s&;|(/])(nodemon|http-server|live-server|serve)(\s|$|[&;|)])/,
]
export function serverShaped(cmd) {
  const c = String(cmd || '')
  return SERVER_SHAPES.some((re) => re.test(c))
}

/**
 * The command `rig qa` grades as the test: --run, else testCommand, else devCommand only when it is
 * not a server. Returns { cmd, from } or { cmd: null, refused: <why> | null }. devCommand is what
 * `npm start` runs: on 5.6.0 it was the default test, and a server that ran until the deadline was
 * recorded green.
 */
export function testCommandFor(cfg, runFlag) {
  if (runFlag) {
    if (serverShaped(runFlag))
      return {
        cmd: null,
        refused: `--run "${runFlag}" starts a server, and a server is not a test: it never finishes, so it cannot pass or fail. Run the project's tests.`,
      }
    return { cmd: runFlag, from: '--run' }
  }
  if (cfg.testCommand) {
    if (serverShaped(cfg.testCommand))
      return { cmd: null, refused: `testCommand "${cfg.testCommand}" starts a server, and a server is not a test.` }
    return { cmd: cfg.testCommand, from: 'testCommand' }
  }
  if (cfg.devCommand) {
    if (serverShaped(cfg.devCommand))
      return {
        cmd: null,
        refused: `devCommand "${cfg.devCommand}" starts a server, and rig qa does not grade a server as the test. Set "testCommand" in .rig/config.json or pass --run "<cmd>".`,
      }
    return { cmd: cfg.devCommand, from: 'devCommand (set "testCommand" to name the test command outright)' }
  }
  return { cmd: null, refused: null }
}

/** 'pass' | 'fail': what a negative command's exit means. `value` is the first one given (flag, config, plan). */
export function negativeExpectation(...values) {
  const v = values.find((x) => x !== undefined && x !== null && x !== '')
  if (v === undefined) return 'pass'
  if (v !== 'pass' && v !== 'fail') throw new Error(`negativeExpect must be "pass" or "fail", got ${JSON.stringify(v)}`)
  return v
}

/**
 * What a negative-control run's exit MEANS: { caught, meaning }.
 * "pass": the command exits 0 once every control went red (its own script absorbs the red).
 * "fail": the command exits non-zero when the break is caught, like `! cmd` or expect-fail.
 * A run that never reached a verdict (deadline, stall, signal, not found, not executable) catches
 * nothing under either reading, and neither does a "fail" command that exited 0 because nothing broke.
 */
export function classifyNegative({ exit, expect = 'pass', stalled = null, timedOut = false }) {
  if (stalled || timedOut || exit === 124) return { caught: false, meaning: 'not caught: the run was stopped before it reached a verdict' }
  if (exit >= 126)
    return {
      caught: false,
      meaning: `not caught: exit ${exit} means the command did not run to a verdict (signal, not found or not executable)`,
    }
  if (expect === 'fail')
    return exit === 0
      ? {
          caught: false,
          meaning: 'not caught: it exited 0, and this command is expected to exit non-zero when the break is caught, so nothing broke',
        }
      : { caught: true, meaning: 'caught: it exited non-zero, as it does when the break is caught' }
  return exit === 0
    ? { caught: true, meaning: 'caught: it exited 0, the command reports every control red' }
    : { caught: false, meaning: `not caught: it exited ${exit}, and this command is expected to exit 0 once every control went red` }
}
