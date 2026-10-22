// The second machine (item 3): runOnHost sends the commit as a git bundle over ssh (nothing pushed),
// checks out exactly that sha in a checkout per session, and returns the command's exit. Every wait
// has a deadline: an unreachable or password-locked host is a 255 in seconds, a run past its limit
// is a 124, and nothing the suite left running keeps ssh open.
//
// The host is a fake ssh (test/fixtures/fake-ssh/ssh): a temp dir that runs the remote command as
// real ssh would, with a clean environment. Each check is shown red against a mutant of
// src/remote.js with the guard taken out or the naive behaviour put back.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { suite } from '../harness/check.js'
import { fixtureRepo, git, mutant, NO_BATCH_MODE, NO_CONNECT_TIMEOUT, world } from './fixtures/fake-ssh/kit.js'
import * as real from '../src/remote.js'

const w = world('rig-remote-')
process.env.FAKE_SSH_HANG = '8'
const app = fixtureRepo(w.root, 'app', [
  { 'v.txt': 'one\n', 'package.json': '{"name":"app"}\n', 'package-lock.json': '{"v":1}\n' },
  { 'v.txt': 'two\n' },
  { 'package-lock.json': '{"v":2}\n' },
])
const [c1, c2, c3] = app.shas
// A real `xclip` on the host: if a run reaches it, the clipboard was touched.
w.tool('xclip', `cat > /dev/null; : > "${w.root}/clipboard-touched"; exit 0`)
// npm on the host: logs each install instead of fetching anything.
w.tool('npm', `echo "npm $*" >> "$HOME/npm.log"; mkdir -p node_modules`)

let R = real
const swap = (swaps) => async () => {
  const keep = R
  R = await mutant('remote.js', swaps)
  return () => (R = keep)
}
const quiet = () => {}
let fresh = 0
const run = (o) => R.runOnHost({ root: app.dir, host: 'box', session: 's1', onOutput: quiet, ...o })
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

await suite('machines: the second-machine runner', async (s) => {
  await s.check('checks out exactly the sha asked for, not the branch tip, and returns its exit', {
    assert: async () => {
      // A fresh session each time, so the commit has to travel.
      const r = await run({ sha: c1, cmd: 'git rev-parse HEAD; cat v.txt; exit 7', session: `exact-${++fresh}` })
      const lines = r.log.split('\n')
      return r.exit === 7 && lines.includes(c1) && lines.includes('one') && !r.log.includes(c3) && r.host === 'box' && r.why === null
    },
    // The naive runner: bundle the branch and run whatever it checks out.
    breaks: swap([
      ["tryGit(['update-ref', ref, full.out], root)", "tryGit(['update-ref', ref, 'HEAD'], root)"],
      ['--detach "$sha" || fail', '--detach "refs/rig/qa/$(ls .git/refs/rig/qa)" || fail'],
      ['[ "$at" = "$sha" ] || fail "checked out $at, not $sha"', ':'],
    ]),
    timeout: 30_000,
  })

  await s.check("the command's exit comes back as it is: 0, 7, 1", {
    assert: async () => {
      const codes = []
      for (const cmd of ['true', 'exit 7', 'false | true']) codes.push((await run({ sha: c2, cmd })).exit)
      return codes.join() === '0,7,1'
    },
    // `false | true` is 1 only under pipefail; and an exit line that always says 0 is the lie.
    breaks: swap([['say "exit $code"\nexit $code', 'say "exit 0"\nexit 0']]),
    timeout: 30_000,
  })

  await s.check('nothing is pushed: no remote, no ref left behind here, and a host that has the commit gets no bundle', {
    assert: async () => {
      const a = await run({ sha: c2, cmd: 'true', session: 'fresh' })
      const b = await run({ sha: c1, cmd: 'true', session: 'fresh' })
      const refs = git(app.dir, 'for-each-ref', 'refs/rig')
      return a.sent && !b.sent && b.exit === 0 && refs === '' && git(app.dir, 'remote') === ''
    },
    breaks: swap([["tryGit(['update-ref', '-d', ref], root)", 'null']]),
    timeout: 30_000,
  })

  await s.check('each session has its own checkout and its own test DB; env reaches the command', {
    assert: async () => {
      const a = await run({
        sha: c1,
        session: 'sess-a',
        cmd: 'echo "db=$RIG_TEST_DB sha=$RIG_QA_SHA pwd=$PWD x=$X"',
        env: { X: "it's two words" },
      })
      const b = await run({ sha: c2, session: 'sess-b', cmd: 'echo "db=$RIG_TEST_DB pwd=$PWD"; cat v.txt' })
      return (
        a.db === 'app_sess_a' &&
        b.db === 'app_sess_b' &&
        a.log.includes(`db=app_sess_a sha=${c1} pwd=${w.hostDir('box')}/.rig-qa/app/sess-a x=it's two words`) &&
        b.log.includes(`db=app_sess_b pwd=${w.hostDir('box')}/.rig-qa/app/sess-b`) &&
        a.dir !== b.dir &&
        readFileSync(join(w.hostDir('box'), '.rig-qa/app/sess-a/v.txt'), 'utf8') === 'one\n'
      )
    },
    // One shared checkout and one DB name: the setup that let two sessions wipe each other's DB.
    breaks: swap([
      ['const dir = `$' + '{base}/$' + '{sess}`', 'const dir = base'],
      ['const db = testDbName(repo, sess)', "const db = testDbName(repo, 'test')"],
    ]),
    timeout: 30_000,
  })

  await s.check('desktop-free by default: no DISPLAY or WAYLAND_DISPLAY, the clipboard tool fails at once; --desktop opts back in', {
    assert: async () => {
      writeFileSync(join(w.hostDir('box'), '.env'), 'DISPLAY=:99 WAYLAND_DISPLAY=wayland-9\n')
      const cmd =
        'echo "d=$(printenv DISPLAY || echo unset) w=$(printenv WAYLAND_DISPLAY || echo unset)"; echo secret | xclip -selection clipboard; echo "xclip=$?"'
      const off = await run({ sha: c2, cmd })
      const touchedOff = existsSync(join(w.root, 'clipboard-touched'))
      const on = await run({ sha: c2, cmd, desktop: true })
      const touchedOn = existsSync(join(w.root, 'clipboard-touched'))
      writeFileSync(join(w.hostDir('box'), '.env'), '')
      rmSync(join(w.root, 'clipboard-touched'), { force: true })
      return (
        off.log.includes('d=unset w=unset') &&
        off.log.includes('xclip=1') &&
        /xclip: the desktop is off in test runs/.test(off.log) &&
        !touchedOff &&
        on.log.includes('d=:99 w=wayland-9') &&
        touchedOn
      )
    },
    breaks: swap([['if [ "$desktop" != 1 ]; then', 'if false; then']]),
    timeout: 30_000,
  })

  await s.check('deps install when the lockfile changed, and only then', {
    assert: async () => {
      const log = join(w.hostDir('box'), 'npm.log')
      writeFileSync(log, '')
      for (const sha of [c1, c2, c3, c3]) await run({ sha, cmd: 'true', session: 'deps' })
      return readFileSync(log, 'utf8') === 'npm ci\nnpm ci\n'
    },
    breaks: swap([['if [ "$want" != "$have" ] || [ ! -d node_modules ]; then', 'if true; then']]),
    timeout: 30_000,
  })

  await s.target('an unreachable host is exit 255 with the reason, in seconds', {
    measure: async () => {
      const t = Date.now()
      const r = await R.runOnHost({
        root: app.dir,
        host: 'unreachable',
        sha: c1,
        cmd: 'true',
        session: 's1',
        connectTimeoutSec: 1,
        onOutput: quiet,
      })
      return r.exit === 255 && /^ssh unreachable: .*Connection timed out/.test(r.why) ? Date.now() - t : Number.NaN
    },
    atMost: 5000,
    unit: 'ms',
    // Without ConnectTimeout the fake host hangs 8 s before it gives up (a real one: minutes).
    breaks: swap([NO_CONNECT_TIMEOUT]),
    timeout: 60_000,
  })

  await s.target('a host that wants a password is exit 255 at once, never a prompt nobody sees', {
    measure: async () => {
      const t = Date.now()
      const r = await R.runOnHost({ root: app.dir, host: 'locked', sha: c1, cmd: 'true', session: 's1', onOutput: quiet })
      return r.exit === 255 && /Permission denied/.test(r.why) ? Date.now() - t : Number.NaN
    },
    atMost: 3000,
    unit: 'ms',
    breaks: swap([NO_BATCH_MODE]),
    timeout: 60_000,
  })

  await s.target('a run past limitMs comes back 124, and nothing of it is left on the host', {
    // Time from the start until the run is really over: 124 returned and its last process gone.
    measure: async () => {
      const t = Date.now()
      const pidFile = join(w.hostDir('box'), 'sleeper.pid')
      const r = await run({ sha: c2, cmd: `sleep 40 & echo $! > ${pidFile}; wait`, limitMs: 1500 })
      const pid = Number(readFileSync(pidFile, 'utf8'))
      while (alive(pid) && Date.now() - t < 50_000) await new Promise((res) => setTimeout(res, 100))
      return r.exit === 124 && /still running after|no exit from box/.test(r.why) && !alive(pid) ? Date.now() - t : Number.NaN
    },
    atMost: 8000,
    unit: 'ms',
    // No watchdog on the host: only the local backstop (limit + 20 s) ends the wait, and the
    // sleeper lives on to its natural end.
    breaks: swap([['    const limitSec = limitMs > 0 ? Math.ceil(limitMs / 1000) : 0', '    const limitSec = 0']]),
    timeout: 90_000,
  })

  await s.target('a process the suite left running does not hold ssh open', {
    measure: async () => {
      const t = Date.now()
      const pidFile = join(w.hostDir('box'), 'server.pid')
      const r = await run({ sha: c2, cmd: `sleep 12 & echo $! > ${pidFile}; echo started` })
      const pid = Number(readFileSync(pidFile, 'utf8'))
      while (alive(pid) && Date.now() - t < 30_000) await new Promise((res) => setTimeout(res, 100))
      return r.exit === 0 && !alive(pid) ? Date.now() - t : Number.NaN
    },
    atMost: 5000,
    unit: 'ms',
    breaks: swap([
      [
        "code=$?\n# Whatever the command left running (a server still listening) holds ssh's pipes open: stop it.\nkill -TERM -$pid 2>/dev/null\n",
        'code=$?\n',
      ],
    ]),
    timeout: 60_000,
  })

  await s.target("a caller's abort signal stops the run on the host, not only the wait (r55q review 1)", {
    // No limitMs: the signal alone must stop it. Measured until the host's last process is gone.
    measure: async () => {
      const pidFile = join(w.hostDir('box'), 'aborted.pid')
      rmSync(pidFile, { force: true })
      const ac = new AbortController()
      const t = Date.now()
      const going = run({ sha: c2, cmd: `sleep 15 & echo $! > ${pidFile}; wait`, signal: ac.signal, session: 'abort' })
      while (!existsSync(pidFile) && Date.now() - t < 10_000) await new Promise((res) => setTimeout(res, 50))
      const pid = Number(readFileSync(pidFile, 'utf8'))
      const asked = Date.now()
      ac.abort()
      const r = await going
      while (alive(pid) && Date.now() - asked < 25_000) await new Promise((res) => setTimeout(res, 100))
      const pre = new AbortController()
      pre.abort()
      const early = await run({ sha: c2, cmd: 'true', signal: pre.signal })
      return r.exit === 143 && /stopped by the caller/.test(r.why) && !alive(pid) && early.exit === 143 ? Date.now() - asked : Number.NaN
    },
    atMost: 5000,
    unit: 'ms',
    // ssh killed here, nothing on the host watching for it: the sleeper lives on to its end.
    breaks: swap([['( cat >/dev/null; kill -TERM -$pid 2>/dev/null; sleep 5; kill -KILL -$pid 2>/dev/null ) >/dev/null 2>&1 &\n', '']]),
    timeout: 60_000,
  })

  await s.check('host stubs record each call: rig-qa: stub lines and stubCalls name the tool and its args (r55q review 3)', {
    assert: async () => {
      // The spec swallows the stub's stderr, so only the record can say the clipboard was reached.
      const r = await run({ sha: c2, cmd: 'echo secret | xclip -selection clipboard 2>/dev/null; pbcopy 2>/dev/null; echo done' })
      const calls = r.stubCalls || []
      return (
        r.exit === 0 &&
        /^rig-qa: stub xclip \d+ -selection clipboard$/m.test(r.log) &&
        calls.length === 2 &&
        calls[0].tool === 'xclip' &&
        calls[0].args === '-selection clipboard' &&
        Number.isFinite(calls[0].t) &&
        Math.abs(calls[0].t - Date.now()) < 60_000 &&
        calls[1].tool === 'pbcopy'
      )
    },
    breaks: swap([['  sed -n "s/^/rig-qa: stub /p" "$calls" >&2\n', '']]),
    timeout: 30_000,
  })

  await s.check('output streams while the command runs, not at the end', {
    assert: async () => {
      const t = Date.now()
      let firstAt = null
      const r = await R.runOnHost({
        root: app.dir,
        host: 'box',
        sha: c2,
        session: 's1',
        cmd: 'echo first; sleep 2; echo second',
        onOutput: (c) => {
          if (firstAt === null && c.includes('first')) firstAt = Date.now() - t
        },
      })
      return r.exit === 0 && firstAt !== null && firstAt < Date.now() - t - 1500
    },
    breaks: swap([
      ['      log += s\n      write(s)', '      log += s'],
      ['      resolve({ ...r, timedOut, aborted })', '      write(r.log)\n      resolve({ ...r, timedOut, aborted })'],
    ]),
    timeout: 30_000,
  })

  await s.check('an unknown sha is refused here, before ssh is asked anything', {
    assert: async () => {
      const before = w.sshLog().split('\n').length
      const r = await run({ sha: 'f'.repeat(40), cmd: 'true' })
      return r.exit === 1 && /no commit f+ in/.test(r.why) && w.sshLog().split('\n').length === before
    },
    breaks: swap([['if (!full.ok) return done(1', 'if (false) return done(1']]),
  })

  await s.check("the command line survives the host's login shell: sh, bash, zsh and fish where installed", {
    assert: () => {
      // ssh hands the joined line to the host user's login shell, which is not always sh.
      const shells = ['sh', 'bash', 'zsh', 'fish'].filter((sh) => spawnSync(sh, ['-c', 'exit 0']).status === 0)
      const args = ["it's", 'two words', '$HOME', '`id`', '"q"', 'a\\b', '*', '']
      const line = R.remoteCommand('printf "[%s]" "$@"', 'rig', args)
      const want = args.map((a) => `[${a}]`).join('')
      return shells.length >= 1 && shells.every((sh) => spawnSync(sh, ['-c', line], { encoding: 'utf8' }).stdout === want)
    },
    breaks: swap([
      ["return ['sh', '-c', shq(script), name, ...args.map(shq)].join(' ')", "return ['sh', '-c', shq(script), name, ...args].join(' ')"],
    ]),
  })

  await s.check('every ssh call carries BatchMode and ConnectTimeout', {
    assert: () => {
      // The controls above drop these options on purpose against the two failure hosts; every call
      // to the working host is the runner's own.
      const calls = w
        .sshLog()
        .trim()
        .split('\n')
        .filter((l) => l.startsWith('box\t'))
      return calls.length > 10 && calls.every((l) => l.includes('-o BatchMode=yes') && /-o ConnectTimeout=\d+/.test(l))
    },
    // One call made without them, as a hand-rolled `ssh host cmd` would be.
    breaks: () => {
      const log = w.sshLog()
      writeFileSync(join(w.root, 'ssh.log'), `${log}box\t -T\n`)
      return () => writeFileSync(join(w.root, 'ssh.log'), log)
    },
  })
})

w.done()
