// Shared resources are scheduled, not shared by hope. Two sessions once wiped each other's test DB
// on the second machine; a lease written as a line in a chat channel would not have stopped that.
//
// A lease has a resource, an owner (`by`, a session id) and an expiry. It lives where the resource
// lives: `host:<ssh-host>` on that host, over ssh, so two sessions on two machines see the same
// lease; `db:<name>` under this user's state dir (`$XDG_STATE_HOME/rig/leases`, default
// `~/.local/state/rig/leases`), never in a repo's .rig/, so every repo and worktree sees it too;
// `db:<name>@<ssh-host>` on that host, beside the host's own leases.
//
// One POSIX sh script does the work in both places, so the local and remote leases cannot drift
// apart. Each call is one critical section under an atomic `mkdir` guard: read the holder file,
// decide, write the new one with a rename. Expiry is judged by the clock of the machine that holds
// the lease, so two clients whose clocks disagree still agree on who holds it.

import { safeName, shOn } from './remote.js'

const SCRIPT = `
set -u
op=$1 name=$2 by=$3 ttl=$4 res=$5
dir="\${XDG_STATE_HOME:-$HOME/.local/state}/rig/leases"
mkdir -p "$dir" || { echo "ERR cannot create $dir"; exit 3; }
lock="$dir/$name.lock" file="$dir/$name.json"
n=0
while ! mkdir "$lock" 2>/dev/null; do
  # A guard older than a minute belongs to a call that died inside a section that takes milliseconds.
  if [ -n "$(find "$lock" -maxdepth 0 -mmin +1 2>/dev/null)" ]; then rmdir "$lock" 2>/dev/null; continue; fi
  n=$((n + 1))
  [ $n -gt 50 ] && { echo "ERR busy: $lock"; exit 4; }
  sleep 0.1 2>/dev/null || sleep 1
done
trap 'rmdir "$lock" 2>/dev/null' EXIT
trap 'exit 130' INT TERM HUP
now=$(date +%s)
iso() { date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ; }
get() { printf '%s' "$2" | sed -n "s/.*\\"$1\\":\\"*\\([^\\",}]*\\).*/\\1/p"; }
live() { u=$(get untilEpoch "$1"); [ -n "$1" ] && [ -n "$u" ] && [ "$now" -lt "$u" ]; }
cur=$(cat "$file" 2>/dev/null || true)
case $op in
  holder)
    if live "$cur"; then echo "HELD $cur"; elif [ -n "$cur" ]; then echo "EXPIRED $cur"; else echo "FREE"; fi ;;
  list)
    for f in "$dir"/*.json; do
      [ -f "$f" ] || continue
      j=$(cat "$f")
      if live "$j"; then echo "HELD $j"; else echo "EXPIRED $j"; fi
    done ;;
  acquire)
    if live "$cur" && [ "$(get by "$cur")" != "$by" ]; then echo "REFUSED $cur"; exit 0; fi
    at=$(iso "$now")
    live "$cur" && at=$(get at "$cur")
    until=$((now + ttl))
    json=$(printf '{"resource":"%s","by":"%s","at":"%s","until":"%s","untilEpoch":%s}' "$res" "$by" "$at" "$(iso "$until")" "$until")
    printf '%s\\n' "$json" > "$file.$$" && mv -f "$file.$$" "$file" || { rm -f "$file.$$"; echo "ERR cannot write $file"; exit 3; }
    if live "$cur"; then echo "RENEWED $json"; elif [ -n "$cur" ]; then echo "TOOK $json"; echo "PREV $cur"; else echo "OK $json"; fi ;;
  release)
    if [ -z "$cur" ]; then echo "FREE"
    elif [ "$(get by "$cur")" = "$by" ]; then rm -f "$file"; echo "RELEASED $cur"
    elif live "$cur"; then echo "NOTYOURS $cur"
    else echo "FREE"
    fi ;;
  *) echo "ERR unknown op $op"; exit 2 ;;
esac
`

const ID = /^[A-Za-z0-9._:@-]{1,80}$/

/**
 * Where a resource's lease lives: `{ host, name }`, host null for this machine.
 * @throws on a resource that is neither `host:<h>` nor `db:<name>[@<h>]`.
 */
export function parseResource(resource) {
  const m = /^(host|db):(.+)$/.exec(String(resource || ''))
  if (!m || !ID.test(m[2])) throw new Error(`lease: "${resource}" is not a resource: use host:<ssh-host> or db:<name>[@<ssh-host>]`)
  if (m[1] === 'host') return { host: m[2], name: `host_${safeName(m[2])}`, resource }
  const at = m[2].indexOf('@')
  const db = at < 0 ? m[2] : m[2].slice(0, at)
  const host = at < 0 ? null : m[2].slice(at + 1)
  if (!db || host === '') throw new Error(`lease: "${resource}" names no database or no host`)
  return { host, name: `db_${safeName(db)}`, resource }
}

function call(op, resource, by = '-', ttlSec = 0, connectTimeoutSec = 10) {
  const r = parseResource(resource)
  if (op !== 'holder' && op !== 'list' && !ID.test(by))
    throw new Error(`lease: --by "${by}" must be a session id (letters, digits, . _ : @ -)`)
  const res = shOn(r.host, SCRIPT, [op, r.name, by, String(ttlSec), resource], {
    connectTimeoutSec,
    timeoutMs: (connectTimeoutSec + 20) * 1000,
  })
  if (res.code !== 0) return { error: res.why || res.out.trim() || res.err.trim() || `lease script exit ${res.code}`, lines: [] }
  const lines = res.out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const sp = l.indexOf(' ')
      const word = sp < 0 ? l : l.slice(0, sp)
      const rest = sp < 0 ? '' : l.slice(sp + 1)
      let rec = null
      try {
        rec = rest.startsWith('{') ? JSON.parse(rest) : null
      } catch {
        /* a holder file someone edited by hand: reported as unreadable below */
      }
      return { word, rec, rest }
    })
  return { error: null, lines }
}

const holderFrom = (rec) => (rec ? { by: rec.by, at: rec.at, until: rec.until } : null)

/**
 * Take a lease on a shared resource ('host:<ssh-host>' or 'db:<name>') for `by` (a session id).
 * Refused while someone else holds an unexpired lease; the same holder may renew.
 * @returns {{ ok: boolean, holder: {by: string, at: string, until: string} | null, why: string | null }}
 *
 * On success `holder` is the new lease. A lease past its ttl is taken over, and `tookOver` names
 * whose it was. An unreachable host is a refusal whose `why` says so: never a lease assumed free.
 */
export function acquire(_root, resource, by, { ttlMin = 120, connectTimeoutSec } = {}) {
  if (!Number.isFinite(ttlMin) || ttlMin <= 0) throw new Error(`lease: --ttl must be a number of minutes above 0, got ${ttlMin}`)
  const ttlSec = Math.max(1, Math.round(ttlMin * 60))
  const { error, lines } = call('acquire', resource, by, ttlSec, connectTimeoutSec)
  if (error) return { ok: false, holder: null, why: error, tookOver: null }
  const first = lines[0] || { word: 'ERR', rec: null, rest: 'no answer' }
  const prev = lines.find((l) => l.word === 'PREV')
  if (first.word === 'REFUSED') {
    const h = holderFrom(first.rec)
    return { ok: false, holder: h, why: `${resource} is held by ${h?.by ?? 'someone'} until ${h?.until ?? '?'}`, tookOver: null }
  }
  if (['OK', 'TOOK', 'RENEWED'].includes(first.word) && first.rec)
    return {
      ok: true,
      holder: holderFrom(first.rec),
      why: null,
      tookOver: prev ? holderFrom(prev.rec) : null,
      renewed: first.word === 'RENEWED',
    }
  return { ok: false, holder: null, why: `lease: ${first.rest || first.word}`, tookOver: null }
}

/** Give a lease back; only its holder can. @returns {{ ok: boolean, why: string | null }} */
export function release(_root, resource, by, { connectTimeoutSec } = {}) {
  const { error, lines } = call('release', resource, by, 0, connectTimeoutSec)
  if (error) return { ok: false, why: error }
  const first = lines[0] || { word: 'ERR', rest: 'no answer' }
  if (first.word === 'RELEASED') return { ok: true, why: null }
  if (first.word === 'FREE') return { ok: true, why: `${resource} was not held` }
  if (first.word === 'NOTYOURS') {
    const h = holderFrom(first.rec)
    return { ok: false, why: `${resource} is held by ${h?.by ?? 'someone else'} until ${h?.until ?? '?'}, not by ${by}`, holder: h }
  }
  return { ok: false, why: `lease: ${first.rest || first.word}` }
}

/**
 * Who holds it now, or null. An expired lease is nobody's.
 * @throws when the resource's machine cannot be asked: "unknown" must never read as "free".
 */
export function holderOf(_root, resource, { connectTimeoutSec } = {}) {
  const { error, lines } = call('holder', resource, '-', 0, connectTimeoutSec)
  if (error) throw new Error(error)
  const first = lines[0]
  return first?.word === 'HELD' ? holderFrom(first.rec) : null
}

/** Every lease on one machine (null for this one), live and expired: `[{ resource, by, at, until, live }]`. */
export function leasesOn(host = null) {
  const res = shOn(host, SCRIPT, ['list', 'list', '-', '0', '-'], { timeoutMs: 30_000 })
  if (res.code !== 0) throw new Error(res.why || res.out.trim() || `lease script exit ${res.code}`)
  return res.out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const sp = l.indexOf(' ')
      try {
        return { ...JSON.parse(l.slice(sp + 1)), live: l.slice(0, sp) === 'HELD' }
      } catch {
        return null
      }
    })
    .filter(Boolean)
}
