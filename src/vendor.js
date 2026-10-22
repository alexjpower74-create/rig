// The second-vendor verdict. Two reviews from the same model vendor share blind spots the way an
// author's tests share the author's: on one build a reviewer from a second vendor found nine real
// defects that two same-vendor reviews had passed. So "reviewed" at the finish line means a reviewer
// from a different vendor than the builders passed exactly this sha, recorded in .rig/reviews.jsonl.
//
// A verdict is a fact with a sha beside it. A pass on an older sha says nothing about this one, and
// the newest verdict on a sha wins, so a later --fail takes back an earlier pass.

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { DEFAULTS } from './config.js'
import { rigDir } from './rigdir.js'

/** Names people type (tools, model families, companies) → the vendor that trained the model. */
const ALIASES = {
  anthropic: ['anthropic', 'claude', 'claude-code', 'opus', 'sonnet', 'haiku', 'fable'],
  openai: ['openai', 'codex', 'chatgpt', 'gpt', 'o1', 'o3', 'o4'],
  google: ['google', 'gemini', 'gemma', 'jules'],
  xai: ['xai', 'grok'],
  mistral: ['mistral', 'codestral', 'vibe'],
  deepseek: ['deepseek'],
  alibaba: ['alibaba', 'qwen'],
  moonshot: ['moonshot', 'kimi'],
}
const BY_ALIAS = new Map(Object.entries(ALIASES).flatMap(([vendor, names]) => names.map((n) => [n, vendor])))

/**
 * The vendor behind a name: `codex` → openai, `Claude` → anthropic, `gpt-5` → openai. A name the
 * table does not know is its own vendor (lowercased), so a new vendor works without a code change
 * and two spellings of it still compare equal. Empty → null.
 */
export function vendorOf(name) {
  if (!name) return null
  const n = String(name).trim().toLowerCase()
  if (!n) return null
  if (BY_ALIAS.has(n)) return BY_ALIAS.get(n)
  // A model id or a versioned tool: gpt-5.1, claude-opus-5-5, gemini-3-pro.
  const head = n.split(/[-_.\s/@:]/)[0]
  if (BY_ALIAS.has(head)) return BY_ALIAS.get(head)
  return n
}

/**
 * The vendor of the model that built this round, and where that answer came from: `vendor` in the
 * config, else the launch command's program (`claude …` → anthropic, `codex …` → openai). The launch
 * command defaults like the config does, so a repo with no config still has an answer.
 * @returns {{ vendor: string|null, from: string }}
 */
export function builderVendor(cfg = {}) {
  if (cfg.vendor) return { vendor: vendorOf(cfg.vendor), from: `vendor "${cfg.vendor}" in .rig/config.json` }
  const launch = cfg.launch ?? DEFAULTS.launch
  const program = launchProgram(launch)
  if (!program) return { vendor: null, from: 'no vendor in .rig/config.json and no launch command' }
  return { vendor: vendorOf(program), from: `the launch command (${program})` }
}

/** The program a launch command runs, past `env X=y`, `npx` and a path: `npx -y @x/codex --full-auto` → codex. */
export function launchProgram(launch) {
  const words = String(launch || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  let i = 0
  while (i < words.length) {
    const w = words[i]
    if (w === 'env' || w === 'exec' || w === 'command' || /^[A-Z_][A-Z0-9_]*=/.test(w) || w.startsWith('-')) i++
    else if (w === 'npx' || w === 'bunx' || w === 'pnpm' || w === 'dlx') i++
    else break
  }
  if (i >= words.length) return null
  // @scope/name@1.2 → name
  return basename(words[i].replace(/@[^/]*$/, '') || words[i]).replace(/^@/, '') || null
}

export const reviewsPath = (root) => join(root, '.rig', 'reviews.jsonl')

/** Append one verdict: { sha, vendor, verdict: 'pass'|'fail', what, builder, ms }. */
export function recordVerdict(root, entry) {
  rigDir(root)
  const line = { at: new Date().toISOString(), ...entry, vendor: vendorOf(entry.vendor) }
  appendFileSync(reviewsPath(root), JSON.stringify(line) + '\n')
  return line
}

/** Every verdict, oldest first. A torn line is skipped, never thrown. */
export function readVerdicts(root) {
  const p = reviewsPath(root)
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

/** The newest verdict on exactly this sha (full), or null. */
export function verdictOn(root, sha) {
  return (
    readVerdicts(root)
      .filter((v) => v.sha === sha)
      .pop() || null
  )
}

/**
 * Would a pass from `reviewer` count against `builder`? Returns null when it would, else the reason
 * it would not, in words that tell the person what to do instead.
 */
export function sameVendorReason(reviewer, builder) {
  const r = vendorOf(reviewer)
  if (!builder.vendor)
    return `the builders' vendor is unknown (${builder.from}): set "vendor" in .rig/config.json so a second vendor can be told apart`
  if (r === builder.vendor)
    return `${reviewer} is ${r}, the same vendor that built this round (${builder.from}). Same-vendor reviews share the builders' blind spots; a second-vendor pass has to come from a model trained by someone else`
  return null
}

/**
 * The finish gate's answer for one sha: { state: 'ok'|'fail', detail, verdict }.
 * The newest verdict on the sha decides; a pass recorded by the builders' own vendor (the config can
 * change after it was written) does not count.
 */
export function vendorGate(root, sha, cfg) {
  const builder = builderVendor(cfg)
  const v = verdictOn(root, sha)
  const short = sha.slice(0, 7)
  if (!v) {
    const older = readVerdicts(root).filter((x) => x.verdict === 'pass' && x.sha !== sha)
    const hint = older.length ? ` (the last pass was on ${older.at(-1).sha.slice(0, 7)}, not this sha)` : ''
    return {
      state: 'fail',
      verdict: null,
      detail: `no second-vendor verdict on ${short}${hint}: \`rig review --vendor <name> --pass "<what ran>" --sha ${short}\``,
    }
  }
  if (v.verdict !== 'pass') return { state: 'fail', verdict: v, detail: `${v.vendor} failed it: ${v.what}` }
  const why = sameVendorReason(v.vendor, builder)
  if (why) return { state: 'fail', verdict: v, detail: why }
  return { state: 'ok', verdict: v, detail: `${v.vendor}: ${v.what}` }
}
