// Leases (item 10). Two sessions once wiped each other's test DB on the second machine. A lease has
// an owner and an expiry, lives where the resource lives, and a second holder is refused.
//
// "Two machines" here are two clones with their own state dirs, run as separate processes; the
// shared host is a fake ssh host (a temp dir). Each check is shown red against a mutant of the code
// with the guard taken out.

import { existsSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { suite } from '../harness/check.js'
import { fixtureRepo, mutant, mutantFile, NO_CONNECT_TIMEOUT, RIG, runNode, world } from './fixtures/fake-ssh/kit.js'
import * as real from '../src/lease.js'

const w = world('rig-lease-')
const one = fixtureRepo(w.root, 'machine-one/app', [{ 'a.txt': '1\n' }])
const two = fixtureRepo(w.root, 'machine-two/app', [{ 'a.txt': '1\n' }])
// Each "machine" has its own state dir, as two computers would.
const envOf = (m) => ({ ...process.env, XDG_STATE_HOME: join(w.root, m, 'state') })

const cwdOf = (m) => (m === 'machine-one' ? one.dir : two.dir)
/** `rig lease …` run from one machine's clone; a control may point it at a mutant command. */
let rigLease = (m, args) => runNode([RIG, 'lease', ...args], { cwd: cwdOf(m), env: envOf(m) })

const fresh = () => rmSync(join(w.hostDir('box'), '.local'), { recursive: true, force: true })

let L = real
let raceSwaps = null
process.env.FAKE_SSH_HANG = '8'
const swap = (mod) => async () => {
  const keep = L
  L = await mod()
  return () => (L = keep)
}

// The refusal itself, removed: whoever asks gets the lease.
const NO_REFUSAL = [['if live "$cur" && [ "$(get by "$cur")" != "$by" ]; then echo "REFUSED $cur"; exit 0; fi', ':']]
// Expiry ignored: a lease, once taken, is held forever.
const NO_EXPIRY = [['[ -n "$1" ] && [ -n "$u" ] && [ "$now" -lt "$u" ]', '[ -n "$1" ]']]
// A slow critical section (to widen the race), with and without the mkdir guard.
const SLOW = ['cur=$(cat "$file" 2>/dev/null || true)', 'cur=$(cat "$file" 2>/dev/null || true); sleep 0.4']
const NO_GUARD = ['while ! mkdir "$lock" 2>/dev/null; do', 'while false; do']

await suite('machines: leases on shared resources', async (s) => {
  await s.check('a second holder is refused: two sessions on two machines, one fake ssh host', {
    assert: async () => {
      fresh()
      const a = await rigLease('machine-one', ['host:box', '--by', 'sess-a', '--ttl', '30'])
      const b = await rigLease('machine-two', ['host:box', '--by', 'sess-b'])
      const q = await rigLease('machine-two', ['host:box'])
      return (
        a.code === 0 &&
        /leased host:box to sess-a until/.test(a.out) &&
        b.code === 1 &&
        /refused, host:box is held by sess-a since .*, until .* \(30 min left\)/.test(b.out) &&
        /host:box: held by sess-a/.test(q.out)
      )
    },
    breaks: () => {
      const file = mutantFile('lease.js', NO_REFUSAL)
      const cmd = mutantFile('commands/lease.js', [["from '../lease.js'", `from '${pathToFileURL(file).href}'`]])
      const keep = rigLease
      const url = JSON.stringify(pathToFileURL(cmd).href)
      rigLease = (m, args) =>
        runNode(['--input-type=module', '-e', `const m = await import(${url}); await m.default(${JSON.stringify(args)})`], {
          cwd: cwdOf(m),
          env: envOf(m),
        })
      return () => {
        rigLease = keep
        rmSync(dirname(file), { recursive: true, force: true })
        rmSync(dirname(cmd), { recursive: true, force: true })
      }
    },
    timeout: 30_000,
  })

  await s.check('the lease lives on the host, not in either repo', {
    assert: () => {
      fresh()
      const a = L.acquire(one.dir, 'host:box', 'sess-a')
      const onHost = existsSync(join(w.hostDir('box'), '.local/state/rig/leases/host_box.json'))
      const inRepo = [one.dir, two.dir].some((d) => existsSync(join(d, '.rig')))
      const here = existsSync(join(process.env.XDG_STATE_HOME, 'rig/leases/host_box.json'))
      return a.ok && onHost && !inRepo && !here
    },
    // The naive lease: a file on this machine, which the other machine never sees.
    breaks: swap(() => mutant('lease.js', [['const res = shOn(r.host, SCRIPT', 'const res = shOn(null, SCRIPT']])),
  })

  await s.check('the same holder renews; release by anyone else is refused; release by the holder frees it', {
    assert: () => {
      fresh()
      const a = L.acquire(one.dir, 'host:box', 'sess-a', { ttlMin: 5 })
      const again = L.acquire(two.dir, 'host:box', 'sess-a', { ttlMin: 60 })
      const other = L.release(two.dir, 'host:box', 'sess-b')
      const still = L.holderOf(two.dir, 'host:box')
      const mine = L.release(one.dir, 'host:box', 'sess-a')
      const after = L.holderOf(two.dir, 'host:box')
      return (
        a.ok &&
        again.ok &&
        again.renewed &&
        again.holder.at === a.holder.at &&
        !other.ok &&
        still?.by === 'sess-a' &&
        mine.ok &&
        mine.why === null &&
        after === null
      )
    },
    breaks: swap(() =>
      mutant('lease.js', [['elif live "$cur"; then echo "NOTYOURS $cur"', 'elif true; then rm -f "$file"; echo "RELEASED $cur"']]),
    ),
  })

  await s.check('a lease past its ttl is taken over, and the result names whose it was', {
    assert: async () => {
      fresh()
      const a = L.acquire(one.dir, 'host:box', 'sess-a', { ttlMin: 1 / 60 })
      const early = L.acquire(two.dir, 'host:box', 'sess-b')
      await new Promise((r) => setTimeout(r, 2100))
      const gone = L.holderOf(two.dir, 'host:box')
      const b = L.acquire(two.dir, 'host:box', 'sess-b')
      return a.ok && !early.ok && gone === null && b.ok && b.tookOver?.by === 'sess-a' && L.holderOf(one.dir, 'host:box')?.by === 'sess-b'
    },
    breaks: swap(() => mutant('lease.js', NO_EXPIRY)),
    timeout: 20_000,
  })

  await s.check('eight sessions racing for one lease: exactly one gets it (the mkdir guard serialises a slow section)', {
    assert: async () => race(SLOW),
    breaks: () => {
      raceSwaps = [SLOW, NO_GUARD]
      return () => (raceSwaps = null)
    },
    timeout: 60_000,
  })

  await s.check('a db lease lives in the user state dir: every repo on this machine sees it', {
    assert: () => {
      const a = L.acquire(one.dir, 'db:app_test', 'sess-a')
      const b = L.acquire(two.dir, 'db:app_test', 'sess-b')
      const file = existsSync(join(process.env.XDG_STATE_HOME, 'rig/leases/db_app_test.json'))
      L.release(one.dir, 'db:app_test', 'sess-a')
      return a.ok && !b.ok && b.holder?.by === 'sess-a' && file
    },
    breaks: swap(() => mutant('lease.js', NO_REFUSAL)),
  })

  await s.check('db:<name>@<host> is leased on that host', {
    assert: () => {
      const a = L.acquire(one.dir, 'db:app_test@box', 'sess-a')
      const onHost = existsSync(join(w.hostDir('box'), '.local/state/rig/leases/db_app_test.json'))
      const b = L.acquire(two.dir, 'db:app_test@box', 'sess-b')
      L.release(one.dir, 'db:app_test@box', 'sess-a')
      return a.ok && onHost && !b.ok
    },
    breaks: swap(() => mutant('lease.js', [['const host = at < 0 ? null : m[2].slice(at + 1)', 'const host = null']])),
  })

  await s.target('an unreachable host refuses the lease (never "free"), in seconds', {
    measure: () => {
      const t = Date.now()
      const r = L.acquire(one.dir, 'host:unreachable', 'sess-a', { connectTimeoutSec: 1 })
      let threw = false
      try {
        L.holderOf(one.dir, 'host:unreachable', { connectTimeoutSec: 1 })
      } catch (e) {
        threw = /Connection timed out/.test(e.message)
      }
      const ms = Date.now() - t
      return !r.ok && /^ssh unreachable: .*Connection timed out/.test(r.why) && threw ? ms : Number.NaN
    },
    atMost: 5000,
    unit: 'ms',
    // Without ConnectTimeout the fake host hangs FAKE_SSH_HANG (8) s per call before it gives up.
    breaks: async () => {
      const remote = mutantFile('remote.js', [NO_CONNECT_TIMEOUT])
      const keep = L
      L = await mutant('lease.js', [["from './remote.js'", `from '${pathToFileURL(remote).href}'`]])
      return () => {
        L = keep
        rmSync(dirname(remote), { recursive: true, force: true })
      }
    },
    timeout: 60_000,
  })

  await s.check('leases list per machine, live and expired', {
    assert: () => {
      fresh()
      L.acquire(one.dir, 'host:box', 'sess-a')
      L.acquire(one.dir, 'db:x@box', 'sess-c', { ttlMin: 1 / 60 })
      const list = L.leasesOn('box')
      return list.length === 2 && list.some((l) => l.resource === 'host:box' && l.live && l.by === 'sess-a')
    },
    breaks: swap(() => mutant('lease.js', [['for f in "$dir"/*.json; do', 'for f in; do']])),
  })

  await s.check('acquire answers bad input as a refusal, never a throw, and takes a branch name as its holder (r55q review 2)', {
    assert: () => {
      fresh()
      const tries = [
        () => L.acquire(one.dir, 'host:box', 'rig/r55q'),
        () => L.acquire(one.dir, 'host:box', 'bad"quote'),
        () => L.acquire(one.dir, 'host:box', 'x', { ttlMin: 0 }),
        () => L.acquire(one.dir, 'nonsense', 'x'),
        () => L.release(one.dir, 'nonsense', 'x'),
      ]
      const got = tries.map((f) => {
        try {
          return f()
        } catch (e) {
          return { threw: e.message }
        }
      })
      const [branch, quote, ttl, res, rel] = got
      const refused = (r) => r && r.ok === false && typeof r.why === 'string' && !r.threw
      const back = L.release(one.dir, 'host:box', 'rig/r55q')
      return (
        branch.ok === true && branch.holder?.by === 'rig/r55q' && refused(quote) && refused(ttl) && refused(res) && refused(rel) && back.ok
      )
    },
    // The old answers: a branch name is no holder, and bad input throws.
    breaks: swap(() =>
      mutant('lease.js', [
        ['const BY = /^[A-Za-z0-9._:@/-]{1,80}$/', 'const BY = ID'],
        ['    return { error: e.message, lines: [] }', '    throw e'],
      ]),
    ),
  })

  await s.check('a resource that is neither host: nor db: is an error that says what to use', {
    assert: async () => {
      const r = await rigLease('machine-one', ['box', '--by', 'x'])
      return r.code === 1 && /say host:box or db:box/.test(r.out)
    },
    // The command that guesses: any bare name is passed on as it is.
    breaks: () => {
      const cmd = mutantFile('commands/lease.js', [['throw new Error(`rig lease: say', 'return raw || new Error(`']])
      const keep = rigLease
      const url = JSON.stringify(pathToFileURL(cmd).href)
      rigLease = (m, args) =>
        runNode(['--input-type=module', '-e', `const m = await import(${url}); await m.default(${JSON.stringify(args)})`], {
          cwd: cwdOf(m),
          env: envOf(m),
        })
      return () => {
        rigLease = keep
        rmSync(dirname(cmd), { recursive: true, force: true })
      }
    },
  })
})

w.done()

// --- helpers ----------------------------------------------------------------------------------------

/** Eight processes ask for host:box at once, through a mutant with `swaps`; true when exactly one wins. */
async function race(defaultSwaps) {
  fresh()
  const file = mutantFile('lease.js', raceSwaps ?? [defaultSwaps])
  try {
    const url = JSON.stringify(pathToFileURL(file).href)
    const runs = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        runNode(
          [
            '--input-type=module',
            '-e',
            `const L = await import(${url}); console.log(JSON.stringify(L.acquire('.', 'host:box', 'racer-${i}')))`,
          ],
          {
            cwd: i % 2 ? two.dir : one.dir,
          },
        ),
      ),
    )
    const won = runs.filter((r) => JSON.parse(r.out.trim().split('\n').pop()).ok).length
    const files = readdirSync(join(w.hostDir('box'), '.local/state/rig/leases')).filter((f) => f.endsWith('.lock'))
    return won === 1 && files.length === 0
  } finally {
    rmSync(dirname(file), { recursive: true, force: true })
  }
}
