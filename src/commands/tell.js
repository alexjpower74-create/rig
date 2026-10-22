// `rig tell <lead> "<one line>"`: a peer reports itself to the lead. Finishing, blocking and
// questions all go here, never into the peer's own pane, where nobody reads them. With one argument
// the lead is `lead` in .rig/config.json, else RIG_LEAD.
import { mainRoot, loadConfig, currentBranchOrNull } from '../config.js'
import { inboxRoot, leadName, senderId, tellMessage, freshInboxNote } from '../inbox.js'

export default function tell(args) {
  // No flags: every argument is the lead or the text, so a message may start with `--`.
  const words = args
  let cfg = {}
  let branch = null
  try {
    const root = mainRoot()
    cfg = loadConfig(root)
    branch = currentBranchOrNull(process.cwd())
  } catch {
    // Outside a repo (a helper in a scratch folder): the environment still names the inbox.
  }
  const lead = words.length >= 2 ? words[0] : leadName(cfg)
  const text = (words.length >= 2 ? words.slice(1) : words).join(' ').trim()
  if (!lead || !text) {
    console.error(
      !text
        ? 'usage: rig tell <lead> "<one line>"'
        : 'rig tell: no lead named. Say it (rig tell <lead> "…"), set "lead" in .rig/config.json, or export RIG_LEAD.',
    )
    process.exit(2)
  }
  const from = senderId(process.env, { branch, branchPrefix: cfg.branchPrefix || 'rig/' })
  const note = freshInboxNote(cfg, process.env, lead)
  if (note) console.log(note)
  const file = tellMessage(inboxRoot(cfg), lead, from, text)
  console.log(`told ${lead} (from ${from}): ${file}`)
}
