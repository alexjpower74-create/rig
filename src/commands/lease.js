import { loadConfig, mainRoot } from '../config.js'
import { acquire, holderOf, leasesOn, parseResource, release } from '../lease.js'

// `rig lease <resource> --by <id> [--release] [--ttl <min>]`: take, renew or give back a lease on a
// shared resource. Refused while someone else holds it: the holder is printed and the exit is 1, so
// a script can wait on it. Without --by it only says who holds it: taking a lease is never implied.
// `rig lease --list [--host <ssh-host>]` lists every lease on one machine.

const DIM = (s) => `\x1b[2m${s}\x1b[0m`

export default function lease(args) {
  const root = mainRoot()
  const cfg = loadConfig(root)
  if (args.includes('--list')) return list(argOf(args, '--host') || null)

  const raw = firstBare(args)
  if (!raw) throw new Error('usage: rig lease <host:<ssh-host>|db:<name>> --by <id> [--release] [--ttl <min>]')
  const resource = resolve(raw, cfg)
  parseResource(resource)
  const by = argOf(args, '--by')

  if (args.includes('--release')) {
    if (!by) throw new Error('rig lease --release needs --by <id>: only the holder can give a lease back')
    const r = release(root, resource, by)
    if (!r.ok) {
      console.log(`rig lease: ${r.why}`)
      process.exitCode = 1
      return
    }
    console.log(r.why ? `${resource}: ${r.why}` : `released ${resource} (${by})`)
    return
  }

  if (!by) {
    const h = holderOf(root, resource)
    console.log(h ? `${resource}: ${describe(h)}` : `${resource}: free`)
    return
  }

  const ttlArg = argOf(args, '--ttl')
  const ttlMin = ttlArg === null ? 120 : Number(ttlArg)
  const r = acquire(root, resource, by, { ttlMin })
  if (!r.ok) {
    console.log(r.holder ? `rig lease: refused, ${resource} is ${describe(r.holder)}` : `rig lease: not taken: ${r.why}`)
    process.exitCode = 1
    return
  }
  const how = r.renewed ? ' (renewed)' : r.tookOver ? ` (took over from ${r.tookOver.by}, whose lease ran out at ${r.tookOver.until})` : ''
  console.log(`leased ${resource} to ${by} until ${r.holder.until}${how}`)
}

function list(host) {
  const all = leasesOn(host)
  const where = host || 'this machine'
  if (!all.length) return console.log(`no leases on ${where}`)
  console.log(`leases on ${where}`)
  for (const l of all) console.log(`  ${l.resource}  ${l.live ? describe(l) : DIM(`expired: was ${l.by}'s until ${l.until}`)}`)
}

/** `held by r55q since …, until … (37 min left)` */
function describe(h) {
  const left = Math.round((Date.parse(h.until) - Date.now()) / 60_000)
  return `held by ${h.by} since ${h.at}, until ${h.until}${Number.isFinite(left) ? ` (${Math.max(left, 0)} min left)` : ''}`
}

/** `host:x` and `db:x` as given; a bare name is the configured qaHost when it matches. */
function resolve(raw, cfg) {
  if (/^(host|db):/.test(raw)) return raw
  if (cfg.qaHost && raw === cfg.qaHost) return `host:${raw}`
  throw new Error(`rig lease: say host:${raw} or db:${raw}`)
}

function argOf(args, name) {
  const i = args.indexOf(name)
  return i >= 0 ? (args[i + 1] ?? null) : null
}

function firstBare(args) {
  for (let i = 0; i < args.length; i++) {
    if (['--by', '--ttl', '--host'].includes(args[i])) i++
    else if (!args[i].startsWith('--')) return args[i]
  }
  return null
}
