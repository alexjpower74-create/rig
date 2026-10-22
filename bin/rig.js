#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))

const COMMANDS = {
  init: 'scaffold PLAN.md + AGENTS.md + .rig/config.json, and the app registry file when `apps` is on PATH (--hook installs the pre-commit guard)',
  up: 'create a worktree + branch per slice, open one GitHub issue per slice, and launch an agent in each (--dry-run, --no-launch, --no-issues, --base <ref>, --launch "<cmd>", --keep-branches)',
  status: 'per-slice: agent state, commits ahead, uncommitted files, and anything edited outside its slice',
  guard: 'refuse work that reaches outside its slice (--staged for hook use, --agent <id>, --base <ref>)',
  qa: 'grade from a clean QA worktree pinned to an exact commit: rig qa <sha> (--run "<cmd>", --negative "<cmd>", --port, --fresh; qa, qa-2… per run; exits with the command’s status)',
  brief: 'print an agent’s briefing so you can hand it over deliberately',
  review: 'write a fresh-eyes review brief for a slice’s diff: rig review <id> (--by <slice>, --launch for a new reviewer tab)',
  finish:
    'the done gate: reviewed, merged, QA + negatives green on this sha, tree clean; closes issues, jots, touches the registry on a pass (--no-review, --no-desk, --wrap "<msg>"); writes docs/FINISH.md',
  rule: 'add a learned rule to the project rulebook: rig rule "<rule>"',
  roll: 'a cross-repo crew from one brief: rig roll up <brief.md> | status | finish | down (tabs in this workspace, one list of repos each)',
  taste:
    'a rating round you answer by tapping: references one at a time, 1 to 5, every tap saved; Done writes docs/TASTE.md (--from <dir>, --url <u>, --comps <dir> --ask "<q>", --lan, --no-open, --done)',
  down: 'close this build’s slice tabs, stop processes inside its worktrees, remove the worktrees; refuses over uncommitted work unless --force',
  fold: 'fold the fix commits into their owning commits once, at the end: every commit walked, the folded tree checked against old tip + fixes, new shas stamped',
  decision:
    'record a decision for the build: rig decision "<what was decided>" --source <transcript|thread>; finish refuses while one is open',
  job: 'brief an agent in another pane and wait until it is idle, done or blocked, or the deadline: rig job <pane> "<task>" --expect <file> --deadline <min>',
  tell: 'tell the lead something, from any peer: rig tell <lead> "<one line>"',
  inbox: 'the lead’s inbox: print new messages, or --wait until one lands (--deadline <min>)',
  lease: 'lease a shared resource (a second machine, a test DB): rig lease <host|db> --by <id>; refused while someone else holds it',
  rebase: 'rebase a slice onto the live base; stops and asks the slice owner when upstream deleted or rewrote a file the slice changed',
}

// Per-command usage. Printed by `rig <cmd> --help` BEFORE the command module is imported: a help
// request must create nothing, and `rig qa --help` once made a worktree on its way to reading the flag.
const USAGE = {
  init: `rig init [--hook] [--slug <slug>] [--name "<Name>"] [--no-registry]
  --hook installs the pre-commit guard; --slug/--name feed the registry file; --no-registry skips \`apps new\``,
  up: `rig up [--dry-run] [--no-launch] [--no-issues] [--base <ref>] [--launch "<cmd>"] [--keep-branches]
  one worktree, branch, brief, tab and GitHub issue per slice; --no-issues opens none`,
  status: `rig status [--base <ref>]`,
  guard: `rig guard [--staged] [--agent <id>] [--base <ref>]
  --staged checks the index (pre-commit hook); --agent names the slice when it cannot be inferred`,
  qa: `rig qa [<ref>] [--run "<cmd>"] [--negative "<cmd>"] [--port <n>] [--fresh]
  --negative "<cmd>" runs the negative-control command in the same pinned tree and records it; --fresh also
  removes ignored files before the pin (git clean -x: node_modules reinstalls). One worktree per run: qa, qa-2…`,
  brief: `rig brief <id>`,
  review: `rig review <id> [--by <slice>] [--base <ref>] [--launch] [--launch-cmd "<cmd>"]`,
  finish: `rig finish [--base <ref>] [--no-review] [--no-desk] [--no-write] [--wrap "<message>"]
  --no-review turns the review gate into a warning; --no-desk skips issues, jot and the registry;
  --wrap "<message>" runs \`wrap\` after a pass and only then`,
  rule: `rig rule "<the rule, in one sentence>"`,
  roll: `rig roll up <brief.md>   [--dir <rollsDir>] [--no-launch] [--dry-run] [--launch "<cmd>"]
rig roll status [<rollDir>]   [--no-fetch]  newest roll by default; exit 1 while any repo is in progress
rig roll finish [<rollDir>]   [--no-fetch]  every repo reported, clean and pushed; writes ROLL-FINISH.md; jots
rig roll down   [<rollDir>]   [--force]  closes only this roll's tabs; makes and removes no worktrees`,
  taste: `rig taste [--from <dir>] [--url <u>]... [--comps <dir> --ask "<question>"] [--port <n>] [--lan] [--no-open] [--done]
  references: images in --from (name-desktop.png + name-phone.png pair up), each --url, and URLs under
  "## The best at this job" in the plan, captured headless at 1440×900 and 390×844 into .rig/taste/shots/;
  --comps <dir> --ask "<q>" adds one question over 2 to 4 comps, rated and starred side by side;
  --port defaults to tastePort in .rig/config.json, else 5391 (0 takes any free port); --no-open prints the URL without opening it;
  --lan also listens on this machine's network address and prints a link for a phone (with the round's token);
  --done writes docs/TASTE.md from the saved ratings (and stops a board still running in this repo).
  Every round is kept in .rig/taste/ratings.json; the same sources again resume the newest round`,
  down: `rig down [--force] [--discard-reports]`,
  fold: `rig fold [--base <ref>]`,
  decision: `rig decision "<what was decided>" --source <transcript|thread>`,
  job: `rig job <pane> "<task>" [--expect <file>] [--deadline <min>]`,
  tell: `rig tell <lead> "<one line>"`,
  inbox: `rig inbox [<lead>] [--wait] [--deadline <min>]`,
  lease: `rig lease <host|db> --by <id>`,
  rebase: `rig rebase <id> [--base <ref>]`,
}

const HELP = `rig ${pkg.version} — multi-agent build orchestration

  ${Object.entries(COMMANDS)
    .map(([k, v]) => k.padEnd(7) + ' ' + v)
    .join('\n  ')}

  rig <cmd> --help   that command's usage; creates nothing

The loop: plan, build, prove, review, show, finish (jot, issues, registry), ship. The plan file is
the contract, and a brief first: what it's for, who uses it, what done looks like, what must not
happen, where it lives. Agents own file slices and nothing else. Numbers come from a QA worktree
pinned to a sha. A check that cannot fail measured nothing. Done means the finish gate passed:
reviewed, merged, clean, QA and negatives green on this sha, the issues closed and the log written.
`

const [cmd, ...args] = process.argv.slice(2)

if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
  console.log(HELP)
  process.exit(0)
}
if (cmd === '-v' || cmd === '--version') {
  console.log(pkg.version)
  process.exit(0)
}
if (!(cmd in COMMANDS)) {
  console.error(`unknown command "${cmd}"\n\n${HELP}`)
  process.exit(2)
}
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
