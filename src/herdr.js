// herdr backend. A build lives in the workspace `rig up` is run from — never a new one. Each
// slice is a pane split off inside that workspace, labelled with the slice id, so the person
// running the rig keeps main and every helper on one screen (Alexander's rule, 2026-09-11:
// "always stay in your own space when working on a project and create more panes").
// Same rule as tmux: panes are read-only from out here. herdr can type into an agent
// (`agent send-keys`, `agent prompt`), and the rig deliberately never calls either once an agent
// is running — keystrokes into a running turn interrupt it. The one exception is Claude Code's
// "trust this folder?" prompt on a fresh worktree, which appears before any turn starts.
//
// herdr injects HERDR_ENV=1 and HERDR_PANE_ID into every pane it manages. Outside one, its
// socket is not ours to drive, so `available()` is false and the tmux backend takes over.

import { tryRun } from './sh.js'

const json = (args) => {
  const r = tryRun('herdr', args)
  if (!r.ok) return null
  try { return JSON.parse(r.out).result } catch { return null }
}

export const inHerdr = () => process.env.HERDR_ENV === '1' && !!process.env.HERDR_PANE_ID
export const hasHerdr = () => inHerdr() && tryRun('herdr', ['--version']).ok

/** The workspace we are running in: HERDR_PANE_ID is "<workspace>:p<n>". */
export const homePane = () => process.env.HERDR_PANE_ID
export const homeWorkspace = () => homePane().split(':')[0]

export function workspaces () { return json(['workspace', 'list'])?.workspaces ?? [] }
export function panes (wid = homeWorkspace()) { return json(['pane', 'list', '--workspace', wid])?.panes ?? [] }

/** Slice panes are the ones in our workspace labelled with a slice id. */
const slicePanes = () => panes().filter(p => p.label && p.pane_id !== homePane())

// The "session" name is kept for the shared driver shape; under herdr it is always our own
// workspace, so it exists as soon as we are inside one.
export function sessionExists () { return inHerdr() }

function launch (paneId, command) {
  // The pane is a fresh zsh at its prompt; the command is typed there, so the user's shell
  // functions and PATH apply — the same as a person launching it by hand.
  tryRun('herdr', ['pane', 'run', paneId, command])
  // A fresh worktree is an untrusted folder to Claude Code. Answer its prompt once, before the
  // agent's first turn; if it never appears, wait-output just times out and nothing is sent.
  const w = tryRun('herdr', ['pane', 'wait-output', paneId, '--match', 'trust this folder', '--timeout', '8000'])
  if (w.ok) tryRun('herdr', ['pane', 'send-keys', paneId, 'down', 'enter'])
  return paneId
}

function split (from, direction, cwd, label) {
  const r = json(['pane', 'split', from, '--direction', direction, '--cwd', cwd])
  const id = r?.pane?.pane_id
  if (!id) throw new Error('herdr: could not split pane ' + from)
  tryRun('herdr', ['pane', 'rename', id, label])
  return id
}

/** First slice: split main to the right. Later slices: split the newest slice pane down. */
export function newSession (name, windowName, cwd, command) {
  return launch(split(homePane(), 'right', cwd, windowName), command)
}

export function newWindow (name, windowName, cwd, command) {
  const existing = slicePanes()
  const from = existing.length ? existing[existing.length - 1].pane_id : homePane()
  return launch(split(from, existing.length ? 'down' : 'right', cwd, windowName), command)
}

export function listWindows () { return slicePanes().map(p => p.label) }

/** Every slice pane in this workspace, with the herdr-detected agent state attached. */
export function sessionPanes (name) {
  return slicePanes().map(p => ({
    session: name, name: p.label, index: p.pane_id, pane: p.pane_id,
    agent: p.agent ?? null, agentStatus: p.agent_status ?? 'unknown'
  }))
}

export function readPane (paneId, lines = 40) {
  const r = tryRun('herdr', ['pane', 'read', paneId, '--lines', String(lines), '--source', 'recent', '--format', 'text'])
  return r.ok ? r.out : ''
}

export function capture (name, windowName, lines = 40) {
  const p = sessionPanes(name).find(x => x.name === windowName)
  return p ? readPane(p.pane, lines) : ''
}

/** Close only the slice panes; the workspace is the person's, not ours. */
export function killSession () {
  for (const p of slicePanes()) tryRun('herdr', ['pane', 'close', p.pane_id])
}

/** Panes across every workspace, for the blocked scan. */
export function allPanes () {
  return workspaces().flatMap(ws =>
    panes(ws.workspace_id).map(p => ({
      session: ws.label, name: p.label ?? p.pane_id, index: p.pane_id, pane: p.pane_id,
      agent: p.agent ?? null, agentStatus: p.agent_status ?? 'unknown'
    })))
}

export function attachHint () {
  return `already on screen — the slices are panes in this workspace (${homeWorkspace()})`
}
export function readHint (name) {
  const ids = sessionPanes(name).map(p => `${p.name}=${p.pane}`).join(' ')
  return `herdr pane read <pane-id> --lines 40${ids ? '   (' + ids + ')' : ''}`
}
