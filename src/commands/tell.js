// `rig tell <name> "<one line>"`: tell a crew member something, from any member. Finishing, blocking
// and questions all go here, never into the sender's own pane, where nobody reads them. With one
// argument the name is `lead` in .rig/config.json, else RIG_LEAD.
//
// The message is filed first (src/inbox.js), then its fate is decided and said in one line
// (src/deliver.js): delivered as a turn to an idle agent in a Herdr app tab, queued for a busy one,
// left to an armed `rig inbox --wait`, refused for a blocked or gone one, or filed only when the name
// has no Herdr app tab. The name is looked up in the crew's own record (.rig/crew.json), never by
// matching a tab label.
//
// Exit: 0 delivered, queued, left to the inbox watcher, or filed only; 3 not delivered (blocked on a
// prompt, or the terminal is gone; the message is still filed); 2 usage.
import { mainRoot, loadConfig, currentBranchOrNull } from '../config.js'
import { readCrew, resolveMember } from '../crew.js'
import { blockedOn, deliverNow, ensureWatcher, EXIT_NOT_DELIVERED } from '../deliver.js'
import { inboxRoot, leadName, senderId, tellMessage, freshInboxNote } from '../inbox.js'

export default function tell(args) {
  // No flags: every argument is the name or the text, so a message may start with `--`.
  const words = args
  let cfg = {}
  let branch = null
  let root = null
  try {
    root = mainRoot()
    cfg = loadConfig(root)
    branch = currentBranchOrNull(process.cwd())
  } catch {
    // Outside a repo (a helper in a scratch folder): the environment still names the inbox.
    root = null
  }
  const lead = words.length >= 2 ? words[0] : leadName(cfg)
  const text = (words.length >= 2 ? words.slice(1) : words).join(' ').trim()
  if (!lead || !text) {
    console.error(
      !text
        ? 'usage: rig tell <name> "<one line>"'
        : 'rig tell: no lead named. Say it (rig tell <name> "…"), set "lead" in .rig/config.json, or export RIG_LEAD.',
    )
    process.exit(2)
  }
  const from = process.env.RIG_AGENT_ID
    ? senderId(process.env)
    : (memberAt(root, process.env.HC_TERMINAL_ID) ?? senderId(process.env, { branch, branchPrefix: cfg.branchPrefix || 'rig/' }))
  const note = freshInboxNote(cfg, process.env, lead)
  if (note) console.log(note)
  const inbox = inboxRoot(cfg)
  const file = tellMessage(inbox, lead, from, text)

  const filedOnly = (why = `${lead} has no Herdr app tab`) => {
    console.log(`filed only: ${why}; it reads this with rig inbox ${lead}`)
    console.log(`  ${file}`)
  }
  const member = root ? resolveMember(root, lead) : null
  if (member?.backend !== 'hc' || !member.terminal) return filedOnly()

  const t = member.terminal
  const r = deliverNow({ inbox, name: lead, terminal: t })
  switch (r.outcome) {
    case 'delivered':
      console.log(`delivered: ${lead} (${t}) has it as a turn now (from ${from})`)
      console.log(`  ${r.delivered.find((p) => p.endsWith(base(file))) ?? r.delivered[0]}`)
      return
    case 'watcher':
      console.log(`filed for ${lead}'s inbox watcher: rig inbox ${lead} --wait is armed and wakes ${lead} with it`)
      console.log(`  ${file}`)
      return
    case 'busy': {
      const w = ensureWatcher({ inbox, name: lead, terminal: t, root })
      const why = r.status?.state === 'sending' ? 'is being sent another message right now' : 'is working'
      console.log(`queued: ${lead} (${t}) ${why}; it is typed in as a turn when ${lead} is free (delivery watcher pid ${w.pid})`)
      console.log(`  ${file}`)
      return
    }
    case 'nothing':
      // Our file left the inbox between filing and claiming: a running delivery watcher or a reader
      // took it, and each takes a message once.
      console.log(`taken: ${lead}'s delivery watcher or inbox reader picked this up already`)
      return
    case 'silent':
      return filedOnly(`${lead} (${t}) does not report whether it is busy, so nothing was typed`)
    case 'missing':
      return filedOnly(`hc is not on PATH here, so ${lead}'s tab cannot be reached`)
    case 'blocked': {
      // Nothing is typed now. The watcher never types to a blocked agent either; once the prompt is
      // answered and the agent is free, it types this in, so the message is not stranded.
      const w = ensureWatcher({ inbox, name: lead, terminal: t, root })
      console.log(`not delivered: ${lead} is blocked on ${blockedOn(r.status)}`)
      console.log(
        `  filed and queued: typed in once ${lead} is free again (delivery watcher pid ${w.pid}), or read with rig inbox ${lead}: ${file}`,
      )
      process.exit(EXIT_NOT_DELIVERED)
      break
    }
    case 'gone':
      console.log(
        `not delivered: ${lead}'s terminal ${t} is gone (${r.status.gone === 'finished' ? 'it finished' : 'hc has no such terminal'})`,
      )
      console.log(`  filed, still waiting in ${lead}'s inbox (rig inbox ${lead}): ${file}`)
      process.exit(EXIT_NOT_DELIVERED)
      break
    default:
      console.log(`not delivered: hc could not reach ${lead} (${t}): ${r.status?.error ?? 'unknown error'}`)
      console.log(`  filed, still waiting in ${lead}'s inbox (rig inbox ${lead}): ${file}`)
      process.exit(EXIT_NOT_DELIVERED)
  }
}

const base = (p) => p.slice(p.lastIndexOf('/') + 1)

/** The crew member whose terminal this is (the lead has no slice branch to name it). */
function memberAt(root, terminal) {
  if (!root || !terminal) return null
  for (const [name, m] of Object.entries(readCrew(root).members)) if (m.terminal === terminal) return name
  return null
}
