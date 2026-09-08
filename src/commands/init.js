import { writeFileSync, existsSync, readFileSync, mkdirSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { repoRoot, loadConfig, saveConfig, DEFAULTS } from '../config.js'
import { git } from '../sh.js'

const here = dirname(fileURLToPath(import.meta.url))

export default function init (args) {
  const root = repoRoot()
  const cfg = { ...DEFAULTS, ...loadConfig(root) }
  saveConfig(root, cfg)

  const planPath = join(root, cfg.plan)
  if (!existsSync(planPath)) {
    const tpl = readFileSync(join(here, '..', '..', 'templates', 'PLAN.md'), 'utf8')
    writeFileSync(planPath, tpl.replaceAll('{{PROJECT}}', root.split('/').pop()))
    console.log(`wrote ${cfg.plan} — this is the contract. Edit the slices before \`rig up\`.`)
  } else {
    console.log(`${cfg.plan} already exists; left alone.`)
  }

  // .rig/ holds machine state and briefings. Never commit it.
  const ignore = join(root, '.gitignore')
  const existing = existsSync(ignore) ? readFileSync(ignore, 'utf8') : ''
  if (!existing.split('\n').some(l => l.trim() === '.rig/')) {
    writeFileSync(ignore, existing + (existing.endsWith('\n') || existing === '' ? '' : '\n') + '.rig/\n')
    console.log('added .rig/ to .gitignore')
  }

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
  console.log('next: edit the slices in ' + cfg.plan + ', then `rig up`')
}
