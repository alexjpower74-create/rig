// The repo's own local CI, and the seeds a repeat run passes on.
//
// More teams run CI on their own machines now. Where a repo has a CI command, that exact command is
// the gate, and the Rig's checks come on top of it, never instead of it.

import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The repo's local CI command, read from the commit being graded (the QA worktree), first match wins:
 *  1. `ciCommand` in .rig/config.json (null or "" there means "this repo has none": detection off);
 *  2. `scripts.ci` in package.json            → `npm run ci`
 *  3. an executable `bin/ci`                   → `./bin/ci`
 *  4. an executable `script/ci` or `script/cibuild` (the "scripts to rule them all" layout)
 *  5. a `ci:` target in a Makefile              → `make ci`
 * @returns {{ cmd: string, from: string } | null}
 */
export function detectCi(dir, cfg = {}) {
  if (Object.hasOwn(cfg, 'ciCommand')) return cfg.ciCommand ? { cmd: cfg.ciCommand, from: 'ciCommand in .rig/config.json' } : null
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    if (typeof pkg.scripts?.ci === 'string' && pkg.scripts.ci.trim()) return { cmd: 'npm run ci', from: 'scripts.ci in package.json' }
  } catch {}
  for (const f of ['bin/ci', 'script/ci', 'script/cibuild']) if (executable(join(dir, f))) return { cmd: `./${f}`, from: `executable ${f}` }
  try {
    if (/^ci\s*:/m.test(readFileSync(join(dir, 'Makefile'), 'utf8'))) return { cmd: 'make ci', from: 'a ci target in the Makefile' }
  } catch {}
  return null
}

function executable(p) {
  try {
    if (!statSync(p).isFile()) return false
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * The "CI passed" status the CI command posted, if it posted one rig qa can read.
 *
 * rig qa hands the command a file path in RIG_CI_STATUS. A CI script that wants its verdict on the
 * record writes one line there: `success` / `failure` (or pass/passed/fail/failed/error), optionally
 * followed by a message, or a JSON object `{ "state": "success", "description": "…" }`. Nothing
 * else is read: no network, no hosted API. When the file is empty the status is null, and the
 * record says the command posted none.
 * @returns {{ state: 'success'|'failure', text: string|null } | null}
 */
export function readCiStatus(file) {
  if (!file || !existsSync(file)) return null
  const raw = readFileSync(file, 'utf8').trim()
  if (!raw) return null
  let state = null
  let text = null
  try {
    const j = JSON.parse(raw)
    state = String(j.state ?? j.status ?? '')
    text = j.description ?? j.message ?? null
  } catch {
    const [first, ...rest] = raw.split(/\s+/)
    state = first
    text = rest.join(' ') || null
  }
  const s = state.toLowerCase()
  if (['success', 'pass', 'passed', 'ok', 'green'].includes(s)) return { state: 'success', text }
  if (['failure', 'fail', 'failed', 'error', 'red'].includes(s)) return { state: 'failure', text }
  return { state: 'failure', text: `unreadable status ${JSON.stringify(raw.slice(0, 80))}` }
}

/**
 * The seeds for `--repeat N --seeds [list]`: every listed seed, then fresh ones up to N. A listed
 * seed always runs, even when the list is longer than N, because the failing seed is the one that
 * proves the fix.
 */
export function planSeeds(n, listed = [], rand = () => Math.floor(Math.random() * 2 ** 31)) {
  const seeds = [...new Set(listed.map(String))]
  while (seeds.length < n) {
    const s = String(rand())
    if (!seeds.includes(s)) seeds.push(s)
  }
  return seeds
}

/**
 * The command with the seed passed the way its runner takes one, for runners that have a seed:
 * node --test (--test-random-seed, which also turns on --test-randomize), Jest (--seed), Vitest
 * (--sequence.seed with --sequence.shuffle), rspec (--seed). Anything else gets RIG_SEED only.
 * Only the leading word decides (after npx / bunx / bundle exec), so a seed is never appended to a
 * pipeline or to `npm test`, whose arguments may go nowhere.
 * @returns {{ cmd: string, how: string }}
 */
export function withSeed(cmd, seed) {
  const words = cmd.trim().split(/\s+/)
  if (/[|;&><`$()]/.test(cmd)) return { cmd, how: 'RIG_SEED' }
  let i = 0
  if (['npx', 'bunx', 'pnpx'].includes(words[0])) i = 1
  else if (words[0] === 'bundle' && words[1] === 'exec') i = 2
  const tool = (words[i] ?? '').split('/').pop()
  if (tool === 'node' && words.includes('--test'))
    return {
      cmd: `${words.slice(0, i + 1).join(' ')} --test-random-seed=${seed} ${words.slice(i + 1).join(' ')}`.trim(),
      how: 'node --test-random-seed',
    }
  if (tool === 'jest') return { cmd: `${cmd} --seed=${seed}`, how: 'jest --seed' }
  if (tool === 'vitest') return { cmd: `${cmd} --sequence.shuffle --sequence.seed=${seed}`, how: 'vitest --sequence.seed' }
  if (tool === 'rspec') return { cmd: `${cmd} --seed ${seed}`, how: 'rspec --seed' }
  return { cmd, how: 'RIG_SEED' }
}
