// herdr backend. A build is a herdr workspace labelled with the session name; each slice is a tab
// labelled with the slice id. Same rule as tmux: panes are read-only from out here. herdr can type
// into an agent (`agent send-keys`, `agent prompt`), and the rig deliberately never calls either —
// keystrokes into a running turn interrupt it.
//
// herdr injects HERDR_ENV=1 into every pane it manages. Outside one, its socket is not ours to
// drive, so `available()` is false and the tmux backend takes over.

import { tryRun } from './sh.js'

const json = (args) => {
  const r = tryRun('herdr', args)
  if (!r.ok) return null
  try { return JSON.parse(r.out).result } catch { return null }
}

export const inHerdr = () => process.env.HERDR_ENV === '1'
export const hasHerdr = () => inHerdr() && tryRun('herdr', ['--version']).ok

export function workspaces () { return json(['workspace', 'list'])?.workspaces ?? [] }
export function findWorkspace (name) { return workspaces().find(w => w.label === name) ?? null }
export function sessionExists (name) { return !!findWorkspace(name) }

export function tabs (wid) { return json(['tab', 'list', '--workspace', wid])?.tabs ?? [] }
export function panes (wid) { return json(['pane', 'list', '--workspace', wid])?.panes ?? [] }

function launch (paneId, cwd, command) {
  // The pane is a fresh zsh at its prompt; the command is typed there, so the user's shell
  // functions and PATH apply — the same as a person launching it by hand.
  tryRun('herdr', ['pane', 'run', paneId, command])
  return paneId
}

export function newSession (name, windowName, cwd, command) {
  const r = json(['workspace', 'create', '--cwd', cwd, '--label', name, '--no-focus'])
  if (!r) throw new Error('herdr: could not create workspace ' + name)
  // A new workspace comes with one tab ("1"). Make it the first slice rather than leaving a stray.
  tryRun('herdr', ['tab', 'rename', r.tab.tab_id, windowName])
  return launch(r.root_pane.pane_id, cwd, command)
}

export function newWindow (name, windowName, cwd, command) {
  const ws = findWorkspace(name)
  if (!ws) throw new Error('herdr: no workspace ' + name)
  const r = json(['tab', 'create', '--workspace', ws.workspace_id, '--cwd', cwd, '--label', windowName, '--no-focus'])
  if (!r) throw new Error('herdr: could not create tab ' + windowName)
  return launch(r.root_pane.pane_id, cwd, command)
}

export function listWindows (name) {
  const ws = findWorkspace(name)
  return ws ? tabs(ws.workspace_id).map(t => t.label) : []
}

/** Every pane of every slice in this session, with the herdr-detected agent state attached. */
export function sessionPanes (name) {
  const ws = findWorkspace(name)
  if (!ws) return []
  const byTab = new Map(tabs(ws.workspace_id).map(t => [t.tab_id, t.label]))
  return panes(ws.workspace_id).map(p => ({
    session: name, name: byTab.get(p.tab_id) ?? p.tab_id, index: p.tab_id, pane: p.pane_id,
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

export function killSession (name) {
  const ws = findWorkspace(name)
  if (ws) tryRun('herdr', ['workspace', 'close', ws.workspace_id])
}

/** Panes across every workspace, for the blocked scan. */
export function allPanes () {
  return workspaces().flatMap(ws => {
    const byTab = new Map(tabs(ws.workspace_id).map(t => [t.tab_id, t.label]))
    return panes(ws.workspace_id).map(p => ({
      session: ws.label, name: byTab.get(p.tab_id) ?? p.tab_id, index: p.tab_id, pane: p.pane_id,
      agent: p.agent ?? null, agentStatus: p.agent_status ?? 'unknown'
    }))
  })
}

export function attachHint (name) {
  const ws = findWorkspace(name)
  return ws ? `herdr workspace focus ${ws.workspace_id}` : `herdr workspace focus <id>   (herdr workspace list)`
}
export function readHint (name) {
  const ws = findWorkspace(name)
  const ids = ws ? sessionPanes(name).map(p => `${p.name}=${p.pane}`).join(' ') : ''
  return `herdr pane read <pane-id> --lines 40${ids ? '   (' + ids + ')' : ''}`
}
