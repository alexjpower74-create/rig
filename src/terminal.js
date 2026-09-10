// The one place that knows which terminal multiplexer is holding the agents.
//
// herdr when the rig itself is running inside herdr (HERDR_ENV=1), tmux otherwise. Force one with
// `"terminal": "herdr" | "tmux"` in .rig/config.json. Both drivers expose the same shape, and
// neither ever types into an agent's pane.

import * as tmux from './tmux.js'
import * as herdr from './herdr.js'

const tmuxDriver = {
  name: 'tmux',
  available: tmux.hasTmux,
  sessionExists: tmux.sessionExists,
  newSession: tmux.newSession,
  newWindow: tmux.newWindow,
  listWindows: tmux.listWindows,
  capture: tmux.capture,
  killSession: tmux.killSession,
  attachHint: (name) => `tmux attach -t ${name}`,
  readHint: (name) => `tmux capture-pane -p -t ${name}:<id>`
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
  attachHint: herdr.attachHint,
  readHint: herdr.readHint
}

export function terminal (cfg = {}) {
  const want = cfg.terminal || 'auto'
  if (want === 'tmux') return tmuxDriver
  if (want === 'herdr') return herdrDriver
  return herdr.inHerdr() ? herdrDriver : tmuxDriver
}
