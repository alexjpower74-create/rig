// The one place that knows which terminal multiplexer is holding the agents.
//
// The Herdr desktop app (hc + herdr-app) when the rig runs in one of its terminals (HC_TERMINAL_ID
// set), terminal herdr when it runs inside that (HERDR_ENV=1), tmux otherwise. Force one with
// `"terminal": "hc" | "herdr" | "tmux"` in .rig/config.json ("herdr-app" means "hc"). Every driver
// exposes the same shape, and none ever types into an agent's pane.

import * as tmux from './tmux.js'
import * as herdr from './herdr.js'
import * as hc from './hc.js'

const tmuxDriver = {
  name: 'tmux',
  available: tmux.hasTmux,
  sessionExists: tmux.sessionExists,
  newSession: tmux.newSession,
  newWindow: tmux.newWindow,
  listWindows: tmux.listWindows,
  capture: tmux.capture,
  killSession: (name) => {
    tmux.killSession(name)
    return null
  },
  slicePanes: () => [], // tmux has no agent-state signal; `status` falls back to window presence
  attachHint: (name) => `tmux attach -t ${name}`,
  readHint: (name) => `tmux capture-pane -p -t ${name}:<id>`,
}

const herdrDriver = {
  name: 'herdr',
  available: herdr.hasHerdr,
  sessionExists: herdr.sessionExists,
  newSession: herdr.newSession,
  newWindow: herdr.newWindow,
  listWindows: herdr.listWindows,
  capture: herdr.capture,
  killSession: herdr.killSession,
  slicePanes: herdr.sessionPanes,
  attachHint: herdr.attachHint,
  readHint: herdr.readHint,
  tabs: true, // one tab per slice, not one window
}

const hcDriver = {
  name: 'hc',
  available: hc.hasHc,
  sessionExists: hc.sessionExists,
  newSession: hc.newSession,
  newWindow: hc.newWindow,
  listWindows: hc.listWindows,
  capture: hc.capture,
  killSession: hc.killSession,
  slicePanes: hc.sessionPanes,
  attachHint: hc.attachHint,
  readHint: hc.readHint,
  tabs: true,
}

/** Which backend: an explicit setting, else the environment the rig was started in. */
export function backendName(cfg = {}) {
  const want = cfg.terminal || 'auto'
  if (want === 'hc' || want === 'herdr-app') return 'hc'
  if (want === 'tmux' || want === 'herdr') return want
  if (hc.inHc()) return 'hc'
  return herdr.inHerdr() ? 'herdr' : 'tmux'
}

export function terminal(cfg = {}) {
  return { hc: hcDriver, herdr: herdrDriver, tmux: tmuxDriver }[backendName(cfg)]
}

/** The agent calls `rig job` makes (agentInfo, agentPrompt, agentRead): hc's in the app, else herdr's. */
export function agentBackend(cfg = {}) {
  return backendName(cfg) === 'hc' ? hc : herdr
}

/** How to get the rig into a terminal it can drive, for the "not available" line. */
export function availableHint(name, cmd = 'rig up') {
  if (name === 'hc') return `(run \`${cmd}\` from a terminal in the Herdr app, or set "terminal": "tmux" in .rig/config.json)`
  if (name === 'herdr') return `(run \`${cmd}\` from inside a herdr pane, or set "terminal": "tmux" in .rig/config.json)`
  return null
}
