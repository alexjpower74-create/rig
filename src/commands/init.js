import { writeFileSync, existsSync, readFileSync, mkdirSync, chmodSync, symlinkSync, lstatSync } from 'node:fs'
import { join, dirname, delimiter } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { mainRoot, loadConfig, saveConfig, DEFAULTS } from '../config.js'
import { git, tryRun } from '../sh.js'

const here = dirname(fileURLToPath(import.meta.url))
const template = name => readFileSync(join(here, '..', '..', 'templates', name), 'utf8')

export default function init (args) {
  const root = mainRoot()
  const project = root.split('/').pop()
  // loadConfig resolves the per-repo worktree base (../.rig-worktrees/<repo dir name>) when the
  // config has none; saving it makes the path visible in .rig/config.json rather than implied.
  const cfg = { ...DEFAULTS, ...loadConfig(root) }
  cfg.slug = argOf(args, '--slug') || cfg.slug || slugFor(project)
  saveConfig(root, cfg)
  console.log(`worktrees: ${cfg.worktreeDir}  slug: ${cfg.slug}`)

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

  // The app registry: one file per app in ~/.claude/apps, created by `apps new` from its template.
  // An app does not exist until it has one (the 2026-09-15 workflow), so `rig init` makes it, once.
  for (const line of ensureRegistry(cfg.slug, argOf(args, '--name') || project, { skip: args.includes('--no-registry') })) console.log(line)

  // .rig/ holds machine state, briefs and the QA record; it is never committed. Worktrees live
  // outside the repo (cfg.worktreeDir), so the old `.worktrees/` entry is no longer added.
  const ignore = join(root, '.gitignore')
  let existing = existsSync(ignore) ? readFileSync(ignore, 'utf8') : ''
  for (const entry of ['.rig/']) {
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

/** The registry slug for a repo directory: lower-cased, runs of anything else become one dash. */
export function slugFor (name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app'
}

/** Where the app registry keeps a slug's file. HOME is honoured, so tests can point it elsewhere. */
export const registryPath = slug => join(homedir(), '.claude', 'apps', `${slug}.md`)

/**
 * Create the registry file with `apps new <slug> "<Name>"` when `apps` is on PATH and the file is
 * missing. Never runs `apps` when the file exists: `apps new` refuses an existing slug, and the
 * file may hold a verdict. Returns the lines to print; `{ ran, path }` is on the array for tests.
 */
export function ensureRegistry (slug, name, opts = {}) {
  const said = []
  const file = registryPath(slug)
  said.ran = false; said.path = file
  if (opts.skip) { said.push('registry: skipped (--no-registry)'); return said }
  if (existsSync(file)) { said.push(`registry: ${file} exists; left alone`); return said }
  if (!onPath('apps')) { said.push('registry: no `apps` on PATH; create the registry file yourself when you can'); return said }
  const r = tryRun('apps', ['new', slug, name])
  if (!r.ok) { said.push(`registry: apps new ${slug} failed: ${(r.err || r.out).split('\n')[0]}`); return said }
  said.ran = true
  said.push(`registry: created ${file} — fill in What it is / Where it stands / Next`)
  return said
}

/** Is an executable of this name on PATH? (`apps` has no --version, so the file is looked for.) */
export function onPath (cmd) {
  return (process.env.PATH || '').split(delimiter).some(dir => dir && existsSync(join(dir, cmd)))
}

function argOf (args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }

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
