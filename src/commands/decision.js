import { repoRoot } from '../config.js'
import { addDecision, DECISIONS, readDecisions, setStatus } from '../decisions.js'

// A decision reaches the build by being written where the crew reads, with where it came from. It
// is a tracked file in the checkout you are in; commit it like code, and `rig finish` reads it from
// the sha it is finishing.

export const USAGE = `rig decision "<what was decided>" --source <transcript|thread>
rig decision <id> --built | --scheduled <round> | --not-in-scope | --open
rig decision --list

  --source <where>     the transcript path or thread link it was decided in (required)
  --built              the build carries it
  --scheduled <round>  it is planned for a named later round
  --not-in-scope       decided against for this build, on purpose
  --open               reopen it
  --list               print every decision and its status

Writes ${DECISIONS} in this checkout; commit it. \`rig finish\` refuses while a decision made this round is open.`

const VALUE_FLAGS = new Set(['--source', '--scheduled'])

export default function decision(args) {
  if (args.includes('--help') || args.includes('-h')) return console.log(USAGE)
  const root = repoRoot()
  const bare = []
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i])) i++
    else if (!args[i].startsWith('--')) bare.push(args[i])
  }
  const argOf = (name) => {
    const i = args.indexOf(name)
    return i >= 0 ? (args[i + 1] ?? '') : null
  }

  if (args.includes('--list')) {
    const all = readDecisions(root)
    if (!all.length) return console.log(`no decisions in ${DECISIONS}`)
    for (const d of all) console.log(`${d.id.padEnd(4)} ${d.kind === 'open' ? 'OPEN ' : 'ok   '} ${d.what}  — ${d.status}`)
    return
  }

  const kinds = [
    ['--built', 'built'],
    ['--scheduled', 'scheduled'],
    ['--not-in-scope', 'not-in-scope'],
    ['--open', 'open'],
  ].filter(([flag]) => args.includes(flag))
  if (kinds.length > 1) {
    console.error(`rig decision: pick one of ${kinds.map(([f]) => f).join(', ')}. Nothing was written.`)
    process.exitCode = 2
    return
  }
  if (kinds.length === 1) {
    if (bare.length !== 1 || !/^D?\d+$/i.test(bare[0])) {
      console.error(`rig decision: name the decision by id, e.g. rig decision D3 ${kinds[0][0]}. Nothing was written.`)
      process.exitCode = 2
      return
    }
    const d = setStatus(root, bare[0], kinds[0][1], { round: argOf('--scheduled') })
    console.log(`${d.id}: ${d.status} — ${d.what}`)
    console.log(`commit it: git commit -m "Decision ${d.id}: ${d.kind}" -- ${DECISIONS}`)
    return
  }
  if (bare.length !== 1) {
    console.error(`${USAGE}\n\nrig decision: give what was decided as one quoted argument. Nothing was written.`)
    process.exitCode = 2
    return
  }
  const d = addDecision(root, { what: bare[0], source: argOf('--source') })
  console.log(`${d.id} (open): ${d.what}\n  source: ${d.source}`)
  console.log(`commit it: git commit -m "Decision ${d.id}" -- ${DECISIONS}`)
}
