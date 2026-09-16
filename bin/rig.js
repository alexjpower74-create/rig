#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))

const COMMANDS = {
  init:   'scaffold PLAN.md + AGENTS.md + .rig/config.json, and the app registry file when `apps` is on PATH (--hook installs the pre-commit guard)',
  up:     'create a worktree + branch per slice, open one GitHub issue per slice, and launch an agent in each (--dry-run, --no-launch, --no-issues, --base <ref>, --launch "<cmd>", --keep-branches)',
  status: 'per-slice: agent state, commits ahead, uncommitted files, and anything edited outside its slice',
  guard:  'refuse work that reaches outside its slice (--staged for hook use, --agent <id>, --base <ref>)',
  qa:     'grade from a clean QA worktree pinned to an exact commit, per project and per run: rig qa <sha> (--run "<cmd>", --negative, --fresh, --port; exits with the command’s status)',
  brief:  'print an agent’s briefing so you can hand it over deliberately',
  review: 'write a fresh-eyes review brief for a slice’s diff: rig review <id> (--by <slice>, --launch for a new reviewer tab)',
  finish: 'the done gate: reviewed, merged, clean, QA and negatives green on this sha; closes the slice issues, jots, touches the registry, writes docs/FINISH.md',
  rule:   'add a learned rule to the project rulebook: rig rule "<rule>"',
  roll:   'a cross-repo crew from one brief: rig roll up <brief.md> | status | finish | down (tabs in this workspace, one list of repos each)',
  down:   'close this build’s slice tabs, stop processes inside its worktrees, remove the worktrees; refuses over uncommitted work unless --force'
}

// Per-command usage. Printed by `rig <cmd> --help` BEFORE the command module is imported: a help
// request must create nothing, and `rig qa --help` once made a worktree on its way to reading the flag.
const USAGE = {
  init:   `rig init [--hook] [--slug <slug>] [--name "<Name>"] [--no-registry]
  --hook installs the pre-commit guard; --slug/--name feed the registry file; --no-registry skips \`apps new\``,
  up:     `rig up [--dry-run] [--no-launch] [--no-issues] [--base <ref>] [--launch "<cmd>"] [--keep-branches]
  one worktree, branch, brief, tab and GitHub issue per slice; --no-issues opens none`,
  status: `rig status [--base <ref>]`,
  guard:  `rig guard [--staged] [--agent <id>] [--base <ref>]
  --staged checks the index (pre-commit hook); --agent names the slice when it cannot be inferred`,
  qa:     `rig qa [<sha>] [--run "<cmd>"] [--negative] [--fresh] [--port <n>] [--ref <ref>] [--branch <name>]
  --negative records the run as the negative-control command; --fresh discards a QA worktree before pinning`,
  brief:  `rig brief <id>`,
  review: `rig review <id> [--by <slice>] [--base <ref>] [--launch] [--launch-cmd "<cmd>"]`,
  finish: `rig finish [--base <ref>] [--no-write] [--no-review] [--no-desk] [--wrap]
  --no-review skips the review gate; --no-desk skips jot and the registry; --wrap runs \`wrap\` after a pass`,
  rule:   `rig rule "<the rule, in one sentence>"`,
  roll:   `rig roll up <brief.md> [--dir <rolls dir>] [--dry-run]
rig roll status [<name>] | rig roll finish [<name>] | rig roll down [<name>] [--force]`,
  down:   `rig down [--force] [--discard-reports]`
}

const HELP = `rig ${pkg.version} — multi-agent build orchestration

  ${Object.entries(COMMANDS).map(([k, v]) => k.padEnd(7) + ' ' + v).join('\n  ')}

  rig <cmd> --help   that command's usage; creates nothing

The loop: plan, build, prove, review, show, finish (jot, issues, registry), ship. The plan file is
the contract, and a brief first: what it's for, who uses it, what done looks like, what must not
happen, where it lives. Agents own file slices and nothing else. Numbers come from a QA worktree
pinned to a sha. A check that cannot fail measured nothing. Done means the finish gate passed:
reviewed, merged, clean, QA and negatives green on this sha, the issues closed and the log written.
`

const [cmd, ...args] = process.argv.slice(2)

if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') { console.log(HELP); process.exit(0) }
if (cmd === '-v' || cmd === '--version') { console.log(pkg.version); process.exit(0) }
if (!(cmd in COMMANDS)) { console.error(`unknown command "${cmd}"\n\n${HELP}`); process.exit(2) }
if (args.includes('-h') || args.includes('--help')) {
  console.log(`rig ${cmd}  — ${COMMANDS[cmd]}\n\nUSAGE\n  ${USAGE[cmd].replace(/\n/g, '\n  ')}`)
  process.exit(0)
}

try {
  const mod = await import(join(here, '..', 'src', 'commands', `${cmd}.js`))
  await mod.default(args)
} catch (err) {
  console.error(`\x1b[31m${err.message}\x1b[0m`)
  if (process.env.RIG_DEBUG) console.error(err.stack)
  process.exit(1)
}
