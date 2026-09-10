// Detecting an agent that is stuck waiting on a human.
//
// This is the failure the rig was blindest to. An agent sitting on a permission prompt looks
// exactly like an agent thinking hard: no commits, some dirty files, quiet. The foreman reads
// `rig status`, sees nothing alarming, and everyone waits — one of them for hours.
//
// Reading panes is safe. Typing into them is not: a keystroke sent to a running session lands as
// an interrupt and kills the turn. So this looks, and then it tells a person.

import { tryRun } from './sh.js'
import * as herdr from './herdr.js'

/** Signatures of a session waiting on a human, rather than working. */
const PROMPT_MARKERS = [
  /^\s*❯?\s*1\.\s+/m,                    // a numbered choice list
  /\besc to cancel\b/i,
  /\bdo you want to\b/i,
  /\ballow\b.*\?\s*$/im,
  /\by\/n\b/i
]

/** Lines that mean it is still going, and override a stale prompt further up the scrollback. */
const BUSY_MARKERS = [
  /\besc to interrupt\b/i,
  /\(\s*\d+s\s*·/,                        // the running-token counter
  /^\s*⏺\s*$/m
]

export function panes () {
  if (herdr.inHerdr()) return herdr.allPanes()
  const r = tryRun('tmux', ['list-panes', '-a', '-F', '#{session_name}\t#{window_index}\t#{window_name}\t#{pane_id}'])
  if (!r.ok) return []
  return r.out.split('\n').filter(Boolean).map(line => {
    const [session, index, name, pane] = line.split('\t')
    return { session, index, name, pane }
  })
}

export function readPane (pane, lines = 40) {
  if (herdr.inHerdr()) return herdr.readPane(pane, lines)
  const r = tryRun('tmux', ['capture-pane', '-p', '-t', pane, '-S', `-${lines}`])
  return r.ok ? r.out : ''
}

/**
 * Is this pane waiting on a person? Looks only at the tail, because a prompt answered ten minutes
 * ago is still sitting in the scrollback and would otherwise read as a live block forever.
 */
export function inspect (pane, agentStatus = null) {
  // herdr watches the agent itself and says `blocked` when it recognises an approval or question
  // UI. That is a better signal than scraping, so it wins outright; `working` is trusted too.
  // Anything else falls through to the text scan, because `unknown` proves nothing either way.
  if (agentStatus === 'working') return { blocked: false }
  const text = readPane(pane, 40)
  if (agentStatus === 'blocked') return { blocked: true, ...question(text), text }
  if (!text.trim()) return { blocked: false }
  const tail = text.split('\n').slice(-14).join('\n')

  if (BUSY_MARKERS.some(re => re.test(tail))) return { blocked: false, text }
  if (!PROMPT_MARKERS.some(re => re.test(tail))) return { blocked: false, text }

  return { blocked: true, ...question(text), text }
}

/** Pull the question itself out, so the report says what is being asked rather than "stuck". */
function question (text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const qIndex = lines.findLastIndex(l => /\?\s*$/.test(l))
  const question = qIndex >= 0 ? lines[qIndex] : '(waiting on a prompt)'
  const options = lines.slice(qIndex + 1).filter(l => /^\s*❯?\s*\d\.\s+/.test(l)).slice(0, 4)
  return { question, options }
}

/** Every pane in every session that is currently waiting on a human. */
export function blockedPanes () {
  return panes().map(p => ({ ...p, ...inspect(p.pane, p.agentStatus ?? null) })).filter(p => p.blocked)
}
