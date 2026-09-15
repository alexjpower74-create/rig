#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))

const COMMANDS = {
  init:   'scaffold PLAN.md + .rig/config.json (--hook installs the pre-commit guard)',
  up:     'create a worktree + branch per slice and launch an agent in each (--dry-run, --no-launch, --base <ref>, --launch "<cmd>", --keep-branches)',
  status: 'per-slice: agent state, commits ahead, uncommitted files, and anything edited outside its slice',
  guard:  'refuse work that reaches outside its slice (--staged for hook use, --agent <id>, --base <ref>)',
  qa:     'pin a QA worktree to an exact commit on its own port: rig qa [<ref>] (--port, --run "<cmd>"; exits with the command’s status)',
  brief:  'print an agent’s briefing so you can hand it over deliberately',
  review: 'write a fresh-eyes review brief for a slice’s diff: rig review <id> (--by <slice>, --launch for a new reviewer tab)',
  finish: 'the done gate: slices merged, nothing uncommitted, QA green on this commit; writes docs/FINISH.md',
  rule:   'add a learned rule to the project rulebook: rig rule "<rule>"',
  down:   'close this build’s slice tabs, stop processes inside its worktrees, remove the worktrees; refuses over uncommitted work unless --force'
}

const HELP = `rig ${pkg.version} — multi-agent build orchestration

  ${Object.entries(COMMANDS).map(([k, v]) => k.padEnd(7) + ' ' + v).join('\n  ')}

The loop: plan, build, prove, review, show, ship. The plan file is the contract, and a brief first:
what it's for, who uses it, what done looks like, what must not happen, where it lives. Agents own
file slices and nothing else. Numbers come from a QA worktree pinned to a sha. A check that cannot
fail measured nothing. Done means the finish gate passed.
`

const [cmd, ...args] = process.argv.slice(2)

if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') { console.log(HELP); process.exit(0) }
if (cmd === '-v' || cmd === '--version') { console.log(pkg.version); process.exit(0) }
if (!(cmd in COMMANDS)) { console.error(`unknown command "${cmd}"\n\n${HELP}`); process.exit(2) }

try {
  const mod = await import(join(here, '..', 'src', 'commands', `${cmd}.js`))
  await mod.default(args)
} catch (err) {
  console.error(`\x1b[31m${err.message}\x1b[0m`)
  if (process.env.RIG_DEBUG) console.error(err.stack)
  process.exit(1)
}
