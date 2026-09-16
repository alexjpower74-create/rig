// Pre-trust a worktree in Claude Code's config so a fresh agent never shows the
// "Yes, I trust this folder" prompt (Alexander's rule, 2026-09-13: he was answering it
// once per tab). Claude Code keeps trust per absolute path in ~/.claude.json under
// projects[path].hasTrustDialogAccepted. Best effort: a missing or unreadable config is
// left alone and the auto-answer in launch() still runs.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function preTrust(cwd) {
  const file = path.join(os.homedir(), '.claude.json')
  let cfg
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return false
  }
  if (!cfg || typeof cfg !== 'object') return false
  cfg.projects ||= {}
  const key = path.resolve(cwd)
  const entry = (cfg.projects[key] ||= { allowedTools: [] })
  if (entry.hasTrustDialogAccepted === true) return true
  entry.hasTrustDialogAccepted = true
  const tmp = file + '.rig-tmp'
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2))
  fs.renameSync(tmp, file)
  return true
}
