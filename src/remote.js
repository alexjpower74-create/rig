// The second machine. A second OS caught platform-only failures and a 1-in-3 flake the first machine
// never showed, so `rig qa --host <ssh-host>` runs the same suite there, at exactly the same sha.
//
// Nothing is pushed: the commit travels from the lead's tree as a `git bundle` on ssh's stdin, into
// a checkout per session under `qaHostDir` (default `~/.rig-qa/<repo>`), so two sessions sharing
// the host never share a working tree. Each session gets its own test DB name, RIG_TEST_DB=<repo>_<session>:
// two sessions once wiped each other's test DB on the second machine.
//
// Every wait has a deadline. ssh runs with BatchMode (a password prompt nobody can see is a hang,
// not a question) and ConnectTimeout (an unreachable host is a 255 in seconds, with its reason), and
// the command itself runs under a watchdog on the host as well as a timer here.

import { spawn, spawnSync } from 'node:child_process'
import { createReadStream, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { loadConfig, mainRoot } from './config.js'
import { tryGit } from './sh.js'

/** The ssh options every call uses: never prompt, never wait forever on a dead link. */
export function sshOptions({ connectTimeoutSec = 10 } = {}) {
  return [
    '-T',
    '-o',
    'BatchMode=yes',
    '-o',
    `ConnectTimeout=${connectTimeoutSec}`,
    // A link that drops mid-run is noticed within a minute, not when TCP gives up hours later.
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=4',
  ]
}

/** POSIX single-quote one word for a remote shell. */
export const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`

/**
 * The command line ssh sends: `sh -c '<script>' <name> '<arg>'…`. ssh joins its words with spaces
 * and the host's login shell parses the result, so every word is quoted here, once. The scripts are
 * kept free of backslash pairs, which fish (a login shell some hosts have) reads differently inside
 * single quotes.
 */
export function remoteCommand(script, name, args = []) {
  if (script.includes('\\\\')) throw new Error(`${name}: remote script must not contain a double backslash`)
  return ['sh', '-c', shq(script), name, ...args.map(shq)].join(' ')
}

/**
 * Run a POSIX sh script on `host` (or here, when host is null), synchronously.
 * @returns {{ code: number, out: string, err: string, why: string | null }} code 255 with `why` for an ssh failure.
 */
export function shOn(host, script, args = [], { connectTimeoutSec, timeoutMs = 60_000, env } = {}) {
  const [file, argv] = host
    ? ['ssh', [...sshOptions({ connectTimeoutSec }), host, remoteCommand(script, 'rig', args)]]
    : ['sh', ['-c', script, 'rig', ...args]]
  const r = spawnSync(file, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, killSignal: 'SIGKILL', env })
  const err = r.stderr || ''
  if (r.error?.code === 'ETIMEDOUT')
    return { code: 255, out: r.stdout || '', err, why: `${host || 'sh'}: no answer within ${Math.round(timeoutMs / 1000)} s` }
  if (r.error) return { code: 255, out: '', err, why: `${file}: ${r.error.message}` }
  const code = r.status ?? 128
  const why = host && code === 255 ? sshReason(host, err) : null
  return { code, out: r.stdout || '', err, why }
}

/** The line of ssh's stderr that says why it failed. */
function sshReason(host, err) {
  const line = err
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .pop()
  return `ssh ${host}: ${(line || 'connection failed (exit 255)').replace(/^ssh: /, '')}`
}

/** A name safe as a directory, a ref component and a database name. */
export const safeName = (s) => String(s).replace(/[^A-Za-z0-9_.-]/g, '_')

/** The per-session test DB name: letters, digits and underscores only, which every database accepts. */
export const testDbName = (repo, session) => `${repo}_${session}`.replace(/[^A-Za-z0-9_]/g, '_')

// Variables that reach the desktop: the display servers, the session bus and the clipboard.
export const DESKTOP_VARS = ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS', 'WAYLAND_SOCKET']
// Clipboard and input tools a spec might shell out to. On the host each is shadowed by a stub that
// fails at once: a spec that shelled out to the real clipboard hung whole runs and overwrote a
// person's clipboard.
export const DESKTOP_TOOLS = ['xclip', 'xsel', 'wl-copy', 'wl-paste', 'pbcopy', 'pbpaste', 'xdotool', 'ydotool', 'osascript']

// Runs on the host. $1 base dir, $2 sha, $3 the bundle's size in bytes when one comes first on
// stdin (0 = none), $4 limit in seconds (0 = none), $5 1 to leave the desktop reachable, $6 test DB
// name, $7 the command, then NAME=value pairs to export. Lines starting "rig-qa:" are ours;
// everything else is the suite's own output.
//
// After the bundle, stdin stays open for the whole run: it is the caller's lifeline. When the
// caller aborts (or dies, or the link drops) ssh's stdin reaches EOF and the run's process group is
// stopped, so a stopped rig qa never leaves a suite running on the host with its checkout and DB.
const RUN_SCRIPT = `
set -u
# A non-interactive ssh session on macOS has no /opt/homebrew/bin or /usr/local/bin, so npm is not
# found. Those dirs fill gaps at the END: put first, Homebrew's tools shadowed the host's own PATH.
for d in /opt/homebrew/bin /usr/local/bin; do
  case ":$PATH:" in *":$d:"*) ;; *) [ -d "$d" ] && PATH="$PATH:$d" ;; esac
done
export PATH
dir=$1 sha=$2 bundle=$3 limit=$4 desktop=$5 db=$6 cmd=$7
shift 7
case $dir in "~/"*) dir="$HOME/\${dir#"~/"}" ;; esac
say() { printf 'rig-qa: %s\\n' "$*" >&2; }
fail() { say "$*"; say "exit 3"; exit 3; }
mkdir -p "$dir" || fail "cannot create $dir"
cd "$dir" || fail "cannot enter $dir"
[ -d .git ] || git init -q . || fail "git init failed in $dir"
if [ "$bundle" -gt 0 ]; then
  head -c "$bundle" > .git/rig-incoming.bundle || fail "could not receive the bundle"
  got=$(wc -c < .git/rig-incoming.bundle | tr -d ' ')
  [ "$got" = "$bundle" ] || fail "the bundle was cut short: $got of $bundle bytes"
  git fetch -q .git/rig-incoming.bundle "+refs/rig/qa/*:refs/rig/qa/*" || fail "git fetch from the bundle failed"
  rm -f .git/rig-incoming.bundle
fi
git -c advice.detachedHead=false checkout -q --force --detach "$sha" || fail "could not check out $sha"
git clean -ffdxq -e node_modules
at=$(git rev-parse HEAD)
[ "$at" = "$sha" ] || fail "checked out $at, not $sha"
say "dir $PWD"
say "at $at"
lock=""
for f in package-lock.json npm-shrinkwrap.json pnpm-lock.yaml yarn.lock; do
  [ -f "$f" ] && { lock=$f; break; }
done
if [ -f package.json ]; then
  want="$lock $(git rev-parse "HEAD:\${lock:-package.json}")"
  have=$(cat .git/rig-deps 2>/dev/null || true)
  if [ "$want" != "$have" ] || [ ! -d node_modules ]; then
    case $lock in
      pnpm-lock.yaml) inst="pnpm install --frozen-lockfile" ;;
      yarn.lock) inst="yarn install --frozen-lockfile" ;;
      "") inst="npm install" ;;
      *) inst="npm ci" ;;
    esac
    say "installing ($inst): \${lock:-package.json} changed"
    $inst </dev/null >&2 || { c=$?; say "install failed"; say "exit $c"; exit $c; }
    printf '%s\\n' "$want" > .git/rig-deps
  else
    say "deps unchanged (\${lock:-package.json})"
  fi
fi
for kv in "$@"; do export "$kv"; done
RIG_TEST_DB=$db; RIG_QA_SHA=$sha; export RIG_TEST_DB RIG_QA_SHA
calls=""
if [ "$desktop" != 1 ]; then
  unset ${DESKTOP_VARS.join(' ')}
  stubs="$PWD/.git/rig-no-desktop"
  calls="$stubs/calls"
  mkdir -p "$stubs"
  : > "$calls"
  # Each stub records the call (tool, epoch ms, args) as well as failing: a spec that swallows the
  # stub's stderr is still known to have reached for the desktop.
  for t in ${DESKTOP_TOOLS.join(' ')}; do
    cat > "$stubs/$t" <<STUB
#!/bin/sh
ms=\\$(date +%s%3N 2>/dev/null)
case \\$ms in *[!0-9]* | "") ms=\\$(date +%s)000 ;; esac
printf '%s %s %s\\n' "$t" "\\$ms" "\\$*" >> "$calls"
echo "$t: the desktop is off in test runs (rig qa --desktop opts back in)" >&2
exit 1
STUB
    chmod +x "$stubs/$t"
  done
  PATH="$stubs:$PATH"
fi
if command -v bash >/dev/null 2>&1; then run="bash -o pipefail -c"; else run="sh -c"; fi
set -m
$run "$cmd" </dev/null &
pid=$!
# Only its stdin is ssh's: holding ssh's output open would keep the connection up after the run.
( cat >/dev/null; kill -TERM -$pid 2>/dev/null; sleep 5; kill -KILL -$pid 2>/dev/null ) >/dev/null 2>&1 &
lifeline=$!
set +m
flag="$PWD/.git/rig-timed-out"
rm -f "$flag"
if [ "$limit" -gt 0 ]; then
  # Polls once a second, so it is gone within a second of the command, never a sleeper left behind.
  (
    i=0
    while [ $i -lt "$limit" ]; do sleep 1; kill -0 $pid 2>/dev/null || exit 0; i=$((i + 1)); done
    : > "$flag"; kill -TERM -$pid 2>/dev/null; sleep 5; kill -KILL -$pid 2>/dev/null
  ) </dev/null >/dev/null 2>&1 &
fi
wait $pid
code=$?
# Whatever the command left running (a server still listening) holds ssh's pipes open: stop it.
kill -TERM -$pid 2>/dev/null
kill -TERM -$lifeline 2>/dev/null
if [ -n "$calls" ]; then
  sed -n "s/^/rig-qa: stub /p" "$calls" >&2
fi
if [ -f "$flag" ]; then rm -f "$flag"; say "still running after $limit s; stopped"; code=124; fi
say "exit $code"
exit $code
`

/**
 * Run `cmd` on a second machine at exactly `sha`, without pushing anything: the commit travels from
 * the lead's tree over SSH, into a per-session checkout on the host, with its own test DB name.
 *
 * @param {{ root: string, host: string, sha: string, cmd: string, session: string, env?: object,
 *           limitMs?: number, onOutput?: (chunk: string) => void }} opts
 * @returns {Promise<{ host: string, exit: number, ms: number, dir: string, db: string, log: string }>}
 *   exit follows rig qa's rules (124 timeout, 128+n signal, 255 ssh failure); log is the full output.
 *
 * Also takes `dir` (the base dir on the host; else config `qaHostDir`, else `~/.rig-qa/<repo>`),
 * `desktop` (true leaves the display and clipboard reachable), `connectTimeoutSec` (default 10) and
 * `signal` (an AbortSignal: on abort ssh is stopped, the host stops the run's whole process group
 * when its stdin closes, and the result is exit 143). The result also carries `why` (null, or the
 * reason for a 255, a 124, a 143 or a failed checkout), `sent` (whether a bundle was needed: a host
 * that already has the commit gets none) and `stubCalls` ([{ tool, t, args }]: each call a spec
 * made to a stubbed desktop tool, t in the host's epoch ms).
 */
export async function runOnHost(opts) {
  const { root, host, sha, cmd, session, env = {}, limitMs = 0, onOutput, desktop = false, connectTimeoutSec = 10, signal } = opts
  const started = Date.now()
  const repo = basename(mainRoot(root))
  const sess = safeName(session || 'default')
  const db = testDbName(repo, sess)
  const base = (opts.dir || loadConfig(root).qaHostDir || `~/.rig-qa/${repo}`).replace(/\/+$/, '')
  const dir = `${base}/${sess}`
  const done = (exit, why, log = '', extra = {}) => ({
    host,
    exit,
    ms: Date.now() - started,
    dir,
    db,
    log,
    why,
    sent: false,
    stubCalls: [],
    ...extra,
  })
  const stoppedEarly = () => done(143, `${host}: stopped by the caller before the run started`)
  if (signal?.aborted) return stoppedEarly()

  const full = tryGit(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], root)
  if (!full.ok) return done(1, `no commit ${sha} in ${root}`)
  for (const k of Object.keys(env)) if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) return done(1, `env: "${k}" is not a variable name`)

  // What the host already has decides what travels: a bundle of only the commits it lacks, or none.
  const probe = shOn(
    host,
    'cd "$1" 2>/dev/null && git for-each-ref --format="%(objectname)" refs/rig/qa 2>/dev/null; exit 0',
    [dir.replace(/^~\//, '')],
    { connectTimeoutSec, timeoutMs: (connectTimeoutSec + 20) * 1000 },
  )
  if (probe.code !== 0) return done(255, probe.why || `ssh ${host}: probe failed (exit ${probe.code})`, probe.err)
  const theirs = probe.out.split('\n').filter((s) => /^[0-9a-f]{40,64}$/.test(s) && tryGit(['cat-file', '-e', `${s}^{commit}`], root).ok)
  const has = theirs.some((s) => tryGit(['merge-base', '--is-ancestor', full.out, s], root).ok)
  if (signal?.aborted) return stoppedEarly()

  let tmp = null
  let bundle = null
  const ref = `refs/rig/qa/${sess}`
  try {
    if (!has) {
      tmp = mkdtempSync(join(tmpdir(), 'rig-bundle-'))
      bundle = join(tmp, 'qa.bundle')
      // A bundle carries refs, not bare shas: a temporary ref names the commit, and is gone after.
      const made = tryGit(['update-ref', ref, full.out], root)
      if (!made.ok) return done(1, `git update-ref: ${made.err}`)
      const b = tryGit(['bundle', 'create', '-q', bundle, ref, ...theirs.map((s) => `^${s}`)], root)
      tryGit(['update-ref', '-d', ref], root)
      if (!b.ok) return done(1, `git bundle: ${b.err}`)
    }
    const limitSec = limitMs > 0 ? Math.ceil(limitMs / 1000) : 0
    const args = [
      dir,
      full.out,
      bundle ? String(statSync(bundle).size) : '0',
      String(limitSec),
      desktop ? '1' : '0',
      db,
      cmd,
      ...Object.entries(env).map(([k, v]) => `${k}=${v}`),
    ]
    const argv = [...sshOptions({ connectTimeoutSec }), host, remoteCommand(RUN_SCRIPT, 'rig-qa', args)]
    const r = await stream('ssh', argv, { input: bundle, onOutput, limitMs: limitMs > 0 ? limitMs + 20_000 : 0, signal })
    const marks = [...r.log.matchAll(/^rig-qa: (\w+) (.*)$/gm)]
    const stubCalls = [...r.log.matchAll(/^rig-qa: stub (\S+) (\d+) ?(.*)$/gm)].map((m) => ({ tool: m[1], t: Number(m[2]), args: m[3] }))
    const mark = (k) => marks.filter((m) => m[1] === k).pop()?.[2] ?? null
    const reported = mark('exit')
    const at = mark('dir') ?? dir
    if (r.aborted)
      return done(143, `${host}: stopped by the caller; the run on the host was stopped with it`, r.log, {
        dir: at,
        sent: !!bundle,
        stubCalls,
      })
    if (r.timedOut)
      return done(124, `no exit from ${host} within ${Math.round((limitMs + 20_000) / 1000)} s; ssh stopped`, r.log, {
        dir: at,
        sent: !!bundle,
        stubCalls,
      })
    if (reported === null) {
      const code = r.code === 255 || r.code === null ? 255 : r.code
      return done(code, code === 255 ? sshReason(host, r.log) : `${host}: ended without an exit line`, r.log, {
        dir: at,
        sent: !!bundle,
        stubCalls,
      })
    }
    const exit = Number(reported)
    let why = null
    if (exit === 3 && mark('at') === null) why = marks.filter((m) => m[1] !== 'exit').pop()?.[0] ?? null
    else if (exit !== 0 && mark('install') === 'failed') why = `${host}: dependency install failed`
    else if (exit === 124) why = `${host}: still running after ${limitSec} s; stopped`
    return done(exit, why, r.log, { dir: at, sent: !!bundle, stubCalls })
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true })
  }
}

/**
 * Spawn, feed `input` (a file path) to stdin, stream output, collect the log. stdin is never closed
 * by us while the child runs: the host reads its EOF as "the caller is gone" (see RUN_SCRIPT), so
 * it is closed only to stop the run, on abort or at the backstop.
 */
function stream(file, argv, { input, onOutput, limitMs, signal }) {
  const write = onOutput ?? ((s) => process.stderr.write(s))
  return new Promise((resolve) => {
    const child = spawn(file, argv, { stdio: ['pipe', 'pipe', 'pipe'] })
    let log = ''
    let timedOut = false
    let aborted = false
    const stop = () => {
      child.stdin.destroy()
      child.kill('SIGTERM')
    }
    const onAbort = () => {
      aborted = true
      stop()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const take = (b) => {
      const s = b.toString()
      log += s
      write(s)
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    child.stdin.on('error', () => {}) // ssh gone before the bundle finished: its exit says why
    if (input) createReadStream(input).pipe(child.stdin, { end: false })
    const timer =
      limitMs > 0 &&
      setTimeout(() => {
        timedOut = true
        stop()
      }, limitMs)
    const settle = (r) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      child.stdin.destroy()
      resolve({ ...r, timedOut, aborted })
    }
    child.on('error', (e) => settle({ code: 255, log: `${log}${file}: ${e.message}\n` }))
    child.on('close', (code) => settle({ code, log }))
  })
}
