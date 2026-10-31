// Herdr desktop app backend. Since 2026-10-31 the agents live in the Herdr app: the window
// (`herdr-app`) arranges spaces > tabs > panes, and herdr-core (`hc`) runs the terminals and knows
// each agent's state. The rules are the terminal-herdr ones (src/herdr.js), carried over:
//
// - A build lives in the SPACE `rig up` is run from, never a new one. Each slice is its own TAB in
//   that space, named with the slice id, so the person keeps the lead and every helper on one screen.
// - Panes are read-only from out here. The one prompt the rig submits goes to an IDLE agent
//   (`rig job`, through `hc send`, which refuses a blocked one); the one key it presses answers Claude
//   Code's "trust this folder?" prompt on a fresh worktree, before any turn starts.
//
// hc injects HC_TERMINAL_ID (our address, e.g. t14) into every terminal it runs; the terminal's
// labels `herdr.space` and `herdr.tab` say where the window shows it. Outside one, `available()` is
// false and the next backend (terminal herdr, then tmux) takes over.

import { randomBytes } from 'node:crypto'
import { tryRun } from './sh.js'
import { preTrust } from './trust.js'

const parse = (r) => {
  if (!r.ok) return null
  try {
    return JSON.parse(r.out)
  } catch {
    return null
  }
}
const hcJson = (args) => parse(tryRun('hc', [...args, '--json']))
const app = (args) => parse(tryRun('herdr-app', args))
/** `herdr-app do <command> '<json>'`: the created ids, or null on `{ error }` / a failed call. */
const appDo = (command, payload) => {
  const r = app(['do', command, JSON.stringify(payload)])
  return r && !r.error ? r : null
}

export const inHc = () => !!process.env.HC_TERMINAL_ID
export const hasHc = () => inHc() && tryRun('hc', ['--version']).ok && tryRun('herdr-app', ['--version']).ok

/** Our own terminal's address, e.g. t14. */
export const homeTerminal = () => process.env.HC_TERMINAL_ID

/** Every space in the window, each with its tabs and their terminals (`herdr-app ls`). */
export function spaces() {
  return app(['ls'])?.spaces ?? []
}

/** Where the window shows us: { space, tab } from our terminal's labels, else found in `ls`. */
export function home() {
  const me = homeTerminal()
  const labels = hcJson(['get', me])?.labels ?? {}
  if (labels['herdr.space']) return { space: labels['herdr.space'], tab: labels['herdr.tab'] ?? null }
  for (const sp of spaces())
    for (const t of sp.tabs ?? []) if ((t.terminals ?? []).some((x) => x.terminal === me)) return { space: sp.id, tab: t.id }
  return { space: null, tab: null }
}

/** Tabs of our space. */
export function tabs(spaceId = home().space) {
  return spaces().find((s) => s.id === spaceId)?.tabs ?? []
}

/** This build's slice tabs: named exactly one of the plan's slice ids, never the tab we run in. */
export function selectSliceTabs(allTabs, ids, homeTabId) {
  const want = new Set(ids ?? [])
  return allTabs.filter((t) => t.name && t.id !== homeTabId && want.has(t.name))
}
const sliceTabs = (ids) => {
  const h = home()
  return selectSliceTabs(tabs(h.space), ids, h.tab)
}

/** Slice panes: the first terminal of each slice tab (the agent lives there), carrying the tab's name. */
const slicePanes = (ids) =>
  sliceTabs(ids)
    .map((t) => {
      const term = (t.terminals ?? [])[0]
      return term ? { ...term, tab: t.id, label: t.name } : null
    })
    .filter(Boolean)

// The "session" is kept for the shared driver shape; under the app it is always our own space.
export function sessionExists() {
  return inHc()
}

/**
 * The argv a tab starts. The launch command is a shell line (`claude --flag "Read …"`), and under
 * terminal herdr it was typed into a fresh shell, so the person's functions and PATH applied. Here
 * it runs through an interactive shell the same way, which then stays open when the agent exits.
 * Codex must run with --no-daemon under hc, or its commands execute outside hc.
 */
export function launchArgv(command, shell = process.env.SHELL || '/bin/sh') {
  let cmd = command
  if (/^\s*codex(\s|$)/.test(cmd) && !/(^|\s)--no-daemon(\s|$)/.test(cmd)) cmd = cmd.replace(/^(\s*codex)/, '$1 --no-daemon')
  return [shell, '-ic', `${cmd}; exec ${shell} -i`]
}

/** Blocks for `ms` without a busy loop (the rig's commands are synchronous). */
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/**
 * A new tab in our space, named with the slice id, running the command; returns its terminal.
 * It never moves the person's view (his rule 2026-10-31: "when helpers open ... I don't want it to
 * automatically jump to that"): `herdr-app do tab.new` always focuses the new tab, so the terminal is
 * started through herdr-core instead, labelled with our space and a fresh tab id, and the window shows
 * it as a new tab in that space without switching to it. Then the tab gets its name.
 */
function newTab(cwd, label, command) {
  const space = home().space
  if (!space) throw new Error(`herdr-app: cannot tell which space ${homeTerminal()} is in`)
  const tabId = 'tb' + randomBytes(16).toString('hex')
  const run = tryRun('hc', [
    'run',
    '--bg',
    '--keep',
    '--no-parent',
    '--json',
    '--cwd',
    cwd,
    '--label',
    `herdr.space=${space}`,
    '--label',
    `herdr.tab=${tabId}`,
    '--',
    ...launchArgv(command),
  ])
  const terminal = parse(run)?.address
  if (!terminal) throw new Error('hc: could not start a terminal for ' + label + (run.err ? ': ' + run.err : ''))
  const r = { terminal, tab: tabId }
  // The window picks the new tab up a moment after the core starts it; name it once it is there.
  for (let i = 0; i < 20 && !appDo('tab.rename', { id: tabId, name: label }); i++) pause(250)
  // A fresh worktree is an untrusted folder to Claude Code: preTrust() normally prevents the prompt.
  // If it shows anyway, answer it once, before the agent's first turn; if it never appears, the wait
  // just checks in and nothing is pressed.
  tryRun('hc', ['wait', r.terminal, '--output', 'trust this folder', '--timeout', '8'])
  if (/trust this folder/i.test(readPane(r.terminal, 20))) tryRun('hc', ['keys', r.terminal, 'down', 'enter'])
  // The agent may retitle its tab; the slice id is how the rig finds it again.
  const tab = r.tab && tabs(space).find((t) => t.id === r.tab)
  if (tab && tab.name !== label) appDo('tab.rename', { id: r.tab, name: label })
  return r.terminal
}

export function newSession(_name, windowName, cwd, command) {
  preTrust(cwd)
  return newTab(cwd, windowName, command)
}

export function newWindow(_name, windowName, cwd, command) {
  preTrust(cwd)
  return newTab(cwd, windowName, command)
}

/** Names of this build's slice tabs that exist right now. */
export function listWindows(_name, ids) {
  return slicePanes(ids).map((p) => p.label)
}

/** This build's slice panes, with hc's agent state attached. `pane` is the terminal address. */
export function sessionPanes(name, ids) {
  return slicePanes(ids).map((p) => ({
    session: name,
    name: p.label,
    index: p.terminal,
    pane: p.terminal,
    agent: p.app ?? null,
    agentStatus: p.status ?? 'unknown',
  }))
}

export function readPane(terminal, lines = 40) {
  const r = tryRun('hc', ['read', terminal, '--lines', String(lines)])
  return r.ok ? r.out : ''
}

export function capture(name, windowName, lines = 40) {
  const p = sessionPanes(name, [windowName]).find((x) => x.name === windowName)
  return p ? readPane(p.pane, lines) : ''
}

/** Close only this build's slice tabs (names equal to the plan's ids); the space is the person's. */
export function killSession(_name, ids) {
  const closed = []
  for (const t of sliceTabs(ids)) if (appDo('tab.close', { id: t.id, confirmed: true })) closed.push(t.name)
  return closed
}

/** Every live terminal hc runs, for the blocked scan. */
export function allPanes() {
  return (hcJson(['ls'])?.terminals ?? []).map((t) => ({
    session: t.where ?? '',
    name: t.where ?? t.address,
    index: t.address,
    pane: t.address,
    agent: t.agent ?? null,
    agentStatus: t.status ?? 'unknown',
  }))
}

export function attachHint() {
  const h = home()
  const name = spaces().find((s) => s.id === h.space)?.name || h.space
  return `already on screen — one tab per slice in this Herdr space (${name})`
}
export function readHint(name, sliceIds) {
  const ids = sessionPanes(name, sliceIds)
    .map((p) => `${p.name}=${p.pane}`)
    .join(' ')
  return `hc read <terminal> --lines 40${ids ? '   (' + ids + ')' : ''}`
}

// ---------------------------------------------------------------------------------------------
// Briefing one agent (`rig job`), the same contract as src/herdr.js. hc has no state counter, so
// `seq` is null; `turn` "goes up each time the status leaves working", which is a completion count.

/** The agent in a terminal: { status, seq, completion, dir, ... }, or null when it runs no agent. */
export function agentInfo(target) {
  const t = hcJson(['get', target])
  if (!t || t.state === 'finished') return null
  const status = t.status?.state ?? null
  if (!t.status?.app && !status) return null
  return {
    ...t,
    agent: t.status?.app ?? null,
    status: status ?? 'unknown',
    seq: null,
    completion: t.turn ?? null,
    dir: t.foreground?.cwd ?? t.cwd ?? null,
  }
}

export function agentPrompt(target, text) {
  return tryRun('hc', ['send', target, text])
}

export function agentRead(target, lines = 25) {
  return readPane(target, lines)
}
