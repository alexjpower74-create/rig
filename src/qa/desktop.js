// Desktop-free test runs.
//
// A spec that shelled out to the real clipboard tool hung whole runs, and wrote over the human's
// clipboard while it did. So by default rig qa runs the command with no display to reach
// (DISPLAY and WAYLAND_DISPLAY unset) and a directory first on PATH whose clipboard tools fail at
// once, say why on stderr, and log the call. The real tool is never reached by name.
//
// A spec that fails because of that is not a regression in the code under test: it is a spec that
// needs a stub. Such specs are listed apart, so "0 new" stays a statement about the code.

import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { failureIn, isResultLine } from './failures.js'

export const SHIMMED = ['xclip', 'xsel', 'wl-copy', 'wl-paste', 'pbcopy', 'pbpaste']

export const shimMessage = (tool) =>
  `rig qa: ${tool} is unreachable in a desktop-free run: stub it in the spec, or run rig qa with --desktop`

// Milliseconds since the epoch from sh: GNU date has %N, BSD date does not (it prints "N"), perl has
// Time::HiRes on every macOS. Whole seconds are the last resort; the coincidence window allows it.
const NOW_MS = `t=$(date +%s%N 2>/dev/null); case "$t" in *N|'') t=$(perl -MTime::HiRes=time -e 'printf "%.0f", time*1000' 2>/dev/null || echo "$(date +%s)000");; *) t=$(echo "$t" | cut -c1-13);; esac`

const script = (tool, log) => `#!/bin/sh
# rig qa desktop-free shim for ${tool}: fails fast, logs the call, never reaches the real tool.
${NOW_MS}
printf '%s\\t%s\\t%s\\n' "$t" "${tool}" "$*" >> '${log.replace(/'/g, `'\\''`)}'
echo '${shimMessage(tool)}' >&2
exit 1
`

/**
 * Make the shim directory: one fail-fast script per tool and an empty call log.
 * @returns {{ dir: string, log: string, remove: () => void }}
 */
export function makeShims(parent = tmpdir()) {
  const dir = mkdtempSync(join(parent, 'rig-qa-shims-'))
  const log = join(dir, 'calls.tsv')
  writeFileSync(log, '')
  for (const tool of SHIMMED) {
    writeFileSync(join(dir, tool), script(tool, log))
    chmodSync(join(dir, tool), 0o755)
  }
  return { dir, log, remove: () => rmSync(dir, { recursive: true, force: true }) }
}

/** The environment a desktop-free command runs with: no display, the shims first on PATH. */
export function desktopFreeEnv(env, shims) {
  const out = { ...env, PATH: [shims.dir, env.PATH ?? ''].filter(Boolean).join(delimiter), RIG_QA_SHIMS: shims.log }
  delete out.DISPLAY
  delete out.WAYLAND_DISPLAY
  return out
}

/** The calls the shims logged: [{ t, tool, args }]. */
export function readShimCalls(log) {
  if (!log || !existsSync(log)) return []
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [t, tool, ...args] = l.split('\t')
      return { t: Number(t), tool, args: args.join('\t') }
    })
}

/**
 * The failing specs that need a stub, from the command's output as timed lines ([{ t, text }]) and
 * the shim calls. A failure counts when either:
 *  - its own block (the failure line and the detail under it, up to the next result line) names a
 *    tool that was called, or carries the shim's message; or
 *  - a shim call landed between the previous result line and this failure (with `slackMs` either
 *    side for whole-second clocks and pipe delay).
 * Returns [{ name, tool }]. Under a runner that runs specs in parallel the second rule can blame a
 * neighbour; the spec is still listed as a failure and the run still exits non-zero, it is only not
 * counted as new.
 */
export function needsStub(lines, calls, { pattern = null, slackMs = 250 } = {}) {
  if (!calls.length) return []
  const called = [...new Set(calls.map((c) => c.tool))]
  const found = new Map()
  let prevT = Number.NEGATIVE_INFINITY
  for (let i = 0; i < lines.length; i++) {
    const { t, text } = lines[i]
    if (!isResultLine(text)) continue
    const name = failureIn(text, { pattern })
    if (name && !found.has(name)) {
      let block = text
      for (let j = i + 1; j < lines.length && !isResultLine(lines[j].text); j++) block += `\n${lines[j].text}`
      const named = called.find((tool) => block.includes('rig qa: ' + tool) || new RegExp(`(^|[^\\w-])${tool}([^\\w-]|$)`).test(block))
      const during = calls.find((c) => c.t >= prevT - slackMs && c.t <= t + slackMs)
      if (named || during) found.set(name, named ?? during.tool)
    }
    prevT = t
  }
  return [...found].map(([name, tool]) => ({ name, tool }))
}
