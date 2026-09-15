import { writeFileSync, existsSync, readFileSync, mkdirSync, chmodSync, symlinkSync, lstatSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mainRoot, loadConfig, saveConfig, DEFAULTS } from '../config.js'
import { git } from '../sh.js'

const here = dirname(fileURLToPath(import.meta.url))
const template = name => readFileSync(join(here, '..', '..', 'templates', name), 'utf8')

export default function init (args) {
  const root = mainRoot()
  const project = root.split('/').pop()
  const cfg = { ...DEFAULTS, ...loadConfig(root) }
  saveConfig(root, cfg)

  // The plan: a brief first (what it's for, who uses it, what done looks like, what must not
  // happen, where it lives), then the slices.
  const planPath = join(root, cfg.plan)
  if (!existsSync(planPath)) {
    writeFileSync(planPath, template('PLAN.md').replaceAll('{{PROJECT}}', project))
    console.log(`wrote ${cfg.plan} — the contract. Fill in the brief and the slices before \`rig up\`.`)
  } else {
    console.log(`${cfg.plan} already exists; left alone.`)
  }

  // The rulebook: AGENTS.md is canonical and CLAUDE.md points at it, so every agent tool reads one
  // text. Two rulebooks drift, and an agent obeys whichever it read last.
  const rulebook = ensureRulebook(root, project)
  for (const line of rulebook) console.log(line)

  // .rig/ holds machine state, briefs and the QA record; .worktrees/ holds the slice checkouts.
  // Neither is ever committed.
  const ignore = join(root, '.gitignore')
  let existing = existsSync(ignore) ? readFileSync(ignore, 'utf8') : ''
  for (const entry of ['.rig/', '.worktrees/']) {
    if (!existing.split('\n').some(l => l.trim() === entry)) {
      existing = existing + (existing.endsWith('\n') || existing === '' ? '' : '\n') + entry + '\n'
      console.log(`added ${entry} to .gitignore`)
    }
  }
  writeFileSync(ignore, existing)

  if (args.includes('--hook')) {
    const hookDir = git(['rev-parse', '--git-path', 'hooks'], root)
    const abs = hookDir.startsWith('/') ? hookDir : join(root, hookDir)
    mkdirSync(abs, { recursive: true })
    const hook = join(abs, 'pre-commit')
    writeFileSync(hook, '#!/bin/sh\n# installed by `rig init --hook`\nexec rig guard --staged\n')
    chmodSync(hook, 0o755)
    console.log('installed pre-commit hook: a commit that reaches outside your slice is now refused')
  }

  console.log(`\nrig ready in ${root}`)
  console.log('next: fill in the brief and slices in ' + cfg.plan + ', then `rig up`')
}

/** Create AGENTS.md from the template and link CLAUDE.md to it, touching nothing that exists. */
export function ensureRulebook (root, project) {
  const said = []
  const agents = join(root, 'AGENTS.md')
  const claude = join(root, 'CLAUDE.md')
  if (!existsSync(agents)) {
    writeFileSync(agents, template('AGENTS.md').replaceAll('{{PROJECT}}', project))
    said.push('wrote AGENTS.md — the project rulebook')
  }
  let claudeExists = false
  try { lstatSync(claude); claudeExists = true } catch { /* absent */ }
  if (!claudeExists) {
    symlinkSync('AGENTS.md', claude)
    said.push('linked CLAUDE.md -> AGENTS.md')
  } else if (!lstatSync(claude).isSymbolicLink()) {
    said.push('CLAUDE.md is a separate file, not a link to AGENTS.md — two rulebooks drift; merge them when you can')
  }
  return said
}
