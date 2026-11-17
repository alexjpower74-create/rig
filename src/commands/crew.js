// `rig crew` (list), `rig crew add <name> <terminal> [--role lead|slice|reviewer]`, `rig crew rm <name>`:
// the crew's own record of which terminal each member runs in (src/crew.js). `rig up` and
// `rig review --launch` write it; this is the hand-edit for a member spawned outside the rig and the
// way to look at it. The list asks hc for each member's live state when hc is there.

import { mainRoot } from '../config.js'
import { readCrew, recordMember, forgetMember } from '../crew.js'
import { terminalState } from '../hc.js'
import { tryRun } from '../sh.js'

export const USAGE = 'rig crew | rig crew add <name> <terminal> [--role lead|slice|reviewer] [--backend hc|herdr|tmux] | rig crew rm <name>'

export default function crew(args) {
  const root = mainRoot()
  const [sub, ...rest] = args
  if (!sub || sub === 'list') return list(root)
  if (sub === 'add') return add(root, rest)
  if (sub === 'rm' || sub === 'remove') {
    const name = rest[0]
    if (!name) throw new Error(`usage: ${USAGE}`)
    console.log(forgetMember(root, name) ? `forgot ${name}` : `${name} was not in the crew record`)
    return
  }
  throw new Error(`usage: ${USAGE}`)
}

function list(root) {
  const members = Object.entries(readCrew(root).members)
  if (!members.length) {
    console.log('no crew recorded yet (`rig up` records the lead and the slice tabs; `rig crew add <name> <terminal>` adds one by hand)')
    return
  }
  const live = tryRun('hc', ['--version']).ok
  const order = { lead: 0, reviewer: 1, slice: 2 }
  members.sort((a, b) => order[a[1].role] - order[b[1].role] || a[0].localeCompare(b[0]))
  const w = Math.max(...members.map(([n]) => n.length))
  for (const [name, m] of members) {
    const state = live && m.backend === 'hc' ? terminalState(m.terminal) : '-'
    console.log(`${name.padEnd(w)}  ${m.role.padEnd(8)}  ${m.terminal.padEnd(8)}  ${(m.backend ?? '-').padEnd(5)}  ${state}`)
  }
}

function add(root, rest) {
  const flag = (n) => {
    const i = rest.indexOf(n)
    return i >= 0 ? rest[i + 1] : null
  }
  const bare = []
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) i++
    else bare.push(rest[i])
  }
  const [name, terminal] = bare
  if (!name || !terminal) throw new Error(`usage: ${USAGE}`)
  const role = flag('--role') || (name.startsWith('rv-') ? 'reviewer' : 'slice')
  // An hc address looks like t14; anything else (a tmux target, a herdr pane) is recorded without a driver unless told.
  const backend = flag('--backend') || (/^t\d+$/.test(terminal) ? 'hc' : null)
  const e = recordMember(root, name, { terminal, role, backend })
  console.log(`recorded ${name}: ${e.role} in ${e.terminal}${e.backend ? ' (' + e.backend + ')' : ''}`)
}
