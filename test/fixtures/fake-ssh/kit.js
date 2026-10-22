// Shared by test/machines-*.test.js: a fake ssh world in a temp dir, fixture repos, and mutants (a
// copy of a source file with one behaviour swapped back to the broken one, for negative controls).

import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const REPO = resolve(here, '..', '..', '..')
export const FAKE_SSH_DIR = here
export const RIG = join(REPO, 'bin', 'rig.js')

/**
 * A temp world: `root` holds the fake hosts (hosts/<name>) and ssh.log; `bin` is a dir for more
 * fakes (npm, xclip). Sets PATH, FAKE_SSH_ROOT and XDG_STATE_HOME for this process, so every
 * spawn reaches the fakes, never a real host. Desktop variables are cleared.
 */
export function world(prefix = 'rig-machines-') {
  const root = mkdtempSync(join(tmpdir(), prefix))
  const bin = join(root, 'bin')
  mkdirSync(bin)
  process.env.PATH = `${FAKE_SSH_DIR}:${bin}:${process.env.PATH}`
  process.env.FAKE_SSH_ROOT = root
  process.env.XDG_STATE_HOME = join(root, 'local-state')
  for (const v of ['DISPLAY', 'WAYLAND_DISPLAY']) delete process.env[v]
  return {
    root,
    bin,
    hostDir: (h) => join(root, 'hosts', h),
    sshLog: () => {
      try {
        return readFileSync(join(root, 'ssh.log'), 'utf8')
      } catch {
        return ''
      }
    },
    /** A script on the fake hosts' PATH (and ours). */
    tool(name, body) {
      const p = join(bin, name)
      writeFileSync(p, `#!/bin/sh\n${body}\n`)
      chmodSync(p, 0o755)
      return p
    },
    done: () => rmSync(root, { recursive: true, force: true }),
  }
}

export const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.invalid',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.invalid',
    },
  }).trim()

/** A repo with one commit per entry of `commits` ({ file: content }); returns { dir, shas }. */
export function fixtureRepo(parent, name, commits) {
  const dir = join(parent, name)
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  const shas = []
  commits.forEach((files, i) => {
    for (const [f, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, f)), { recursive: true })
      writeFileSync(join(dir, f), body)
    }
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', `c${i + 1}`)
    shas.push(git(dir, 'rev-parse', 'HEAD'))
  })
  return { dir, shas }
}

let n = 0
/**
 * Import a copy of `src/<rel>` with each [from, to] swapped in. Every `from` must occur, or the
 * mutant would be the original and its control would prove nothing. Relative imports point back at
 * the real files, so only the mutated module differs.
 */
export async function mutant(rel, swaps) {
  const file = join(REPO, 'src', rel)
  let text = readFileSync(file, 'utf8')
  for (const [from, to] of swaps) {
    if (!text.includes(from)) throw new Error(`mutant ${rel}: "${from.slice(0, 60)}" not found`)
    text = text.split(from).join(to)
  }
  text = text.replace(/from '(\.\.?\/[^']+)'/g, (_, p) => `from '${pathToFileURL(resolve(dirname(file), p)).href}'`)
  const dir = mkdtempSync(join(tmpdir(), 'rig-mutant-'))
  const out = join(dir, `${rel.replace(/\//g, '_')}.${++n}.mjs`)
  writeFileSync(out, text)
  try {
    return await import(pathToFileURL(out).href)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Run a node script (argv) to completion: { code, out, ms }. Never inherits a desktop. */
export function runNode(argv, { cwd = REPO, env = process.env, timeoutMs = 60_000 } = {}) {
  const started = Date.now()
  return new Promise((res) => {
    const child = spawn(process.execPath, argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (b) => (out += b))
    child.stderr.on('data', (b) => (out += b))
    const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.on('close', (code, signal) => {
      clearTimeout(t)
      res({ code: code ?? 128 + (signal ? 9 : 0), out, ms: Date.now() - started })
    })
  })
}
