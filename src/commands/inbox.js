// `rig inbox [<lead>] [--wait] [--deadline <min>]`: the lead's side of `rig tell`. Prints every new
// message and files it under read/. With --wait it blocks until one lands or the deadline passes;
// run it as a background job and its exit wakes the lead. Re-arm it after each message.
//
// Exit: 0 messages printed (or none, without --wait); 4 the deadline passed with nothing; 2 usage.
import { mainRoot, loadConfig } from '../config.js'
import { inboxRoot, leadName, takeAll, waitForMessages, formatMessage, DEFAULT_WAIT_MIN, DEFAULT_POLL_MS, checkLead } from '../inbox.js'

export const EXIT_DEADLINE = 4

export default async function inbox(args) {
  let cfg = {}
  try {
    cfg = loadConfig(mainRoot())
  } catch {
    /* outside a repo: the environment names the inbox */
  }
  const valued = new Set(['--deadline'])
  const pos = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]))
  const lead = pos[0] || leadName(cfg)
  if (!lead) {
    console.error('rig inbox: no lead named. Say it (rig inbox <lead>), set "lead" in .rig/config.json, or export RIG_LEAD.')
    process.exit(2)
  }
  checkLead(lead)
  const root = inboxRoot(cfg)
  const wait = args.includes('--wait')
  const dl = arg(args, '--deadline')
  const minutes = dl == null ? (cfg.inboxDeadline ?? DEFAULT_WAIT_MIN) : Number(dl)
  if (!(minutes > 0)) {
    console.error(`rig inbox: --deadline wants minutes above 0, not "${dl}"`)
    process.exit(2)
  }

  const print = (msgs) => {
    for (const m of msgs) console.log(formatMessage(m))
  }
  if (!wait) {
    const msgs = takeAll(root, lead)
    if (msgs.length) print(msgs)
    else console.log(`inbox ${lead}: nothing new`)
    return
  }
  const pollMs = Number(process.env.RIG_INBOX_POLL_MS) || DEFAULT_POLL_MS
  const msgs = await waitForMessages(root, lead, { deadlineMs: minutes * 60_000, pollMs })
  if (msgs.length) {
    print(msgs)
    console.log(`re-arm: rig inbox ${lead} --wait --deadline ${minutes}`)
    return
  }
  console.log(
    `inbox ${lead}: no message in ${minutes} min (the deadline). Check on the crew (rig status), then re-arm if a peer is still working.`,
  )
  process.exit(EXIT_DEADLINE)
}

function arg(args, name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}
