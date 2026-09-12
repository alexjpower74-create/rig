import { tryRun, run } from './sh.js'
import { preTrust } from './trust.js'

// The rig never types into an agent's pane. Keystrokes land as an interrupt and kill the turn
// the agent is in the middle of. Panes are read-only from out here; briefing goes over
// SendMessage, or into a file the agent is told to read.

export const hasTmux = () => tryRun('tmux', ['-V']).ok

export function sessionExists (name) {
  return tryRun('tmux', ['has-session', '-t', name]).ok
}

export function newSession (name, windowName, cwd, command) {
  preTrust(cwd)
  run('tmux', ['new-session', '-d', '-s', name, '-n', windowName, '-c', cwd, command])
}

export function newWindow (name, windowName, cwd, command) {
  preTrust(cwd)
  run('tmux', ['new-window', '-t', name, '-n', windowName, '-c', cwd, command])
}

export function listWindows (name) {
  const r = tryRun('tmux', ['list-windows', '-t', name, '-F', '#{window_name}'])
  return r.ok ? r.out.split('\n').filter(Boolean) : []
}

/** Read a pane without touching it. */
export function capture (name, windowName, lines = 40) {
  const r = tryRun('tmux', ['capture-pane', '-p', '-t', `${name}:${windowName}`, '-S', `-${lines}`])
  return r.ok ? r.out : ''
}

export function killSession (name) { tryRun('tmux', ['kill-session', '-t', name]) }
