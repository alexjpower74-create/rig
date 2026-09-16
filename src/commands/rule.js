import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mainRoot } from '../config.js'
import { ensureRulebook } from './init.js'

// "Add to the rulebook: …". A rule said once in conversation is lost by the next session; a rule in
// AGENTS.md is read by every agent on every future job. `rig rule "<text>"` puts it there.

export default function rule(args) {
  const text = args
    .filter((a) => !a.startsWith('--'))
    .join(' ')
    .trim()
  if (!text) throw new Error('usage: rig rule "<the rule, in one sentence>"')
  const root = mainRoot()
  ensureRulebook(root, root.split('/').pop())
  const added = addRule(join(root, 'AGENTS.md'), text)
  console.log(added ? `added to AGENTS.md: ${text}` : `already in AGENTS.md: ${text}`)
}

/** Append a dated rule under "## Rules learned", creating the section once. False if already there. */
export function addRule(file, text, date = new Date().toISOString().slice(0, 10)) {
  let body = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (body.includes(`- ${text} (`) || body.split('\n').some((l) => l.trim() === `- ${text}`)) return false
  if (!/^## Rules learned\s*$/m.test(body)) body = body.replace(/\s*$/, '\n\n## Rules learned\n')
  body = body.replace(/\s*$/, '\n') + `- ${text} (${date})\n`
  writeFileSync(file, body)
  return true
}
