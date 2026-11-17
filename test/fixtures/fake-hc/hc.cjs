// A fake herdr-core `hc` for the delivery tests: never the real one, never a real terminal.
//
// Each terminal's status is a file, `$FAKE_HC_DIR/<t>.state`, that the test rewrites over time:
//   idle | working | done | error | silent (never reported) | finished
//   blocked <kind> [<msg>]
// No file: hc has no such terminal. `$FAKE_HC_DIR/<t>.after-send` (optional) is the state a
// successful send moves the terminal to, as a real agent starts its turn.
// `$FAKE_HC_DIR/send-delay-ms` (optional) holds a send for that long before typing (race tests).
// Every send is one JSON line in `$FAKE_HC_DIR/sends.log`: { at, terminal, text, if, state, typed }.
// `typed` is what real hc 0.1.21 would have done: a send without --if types into a working terminal.
// Exit codes are real hc's: 3 not_found, 9 blocked, 10 status_mismatch, 11 finished.
const fs = require('node:fs')
const path = require('node:path')
const dir = process.env.FAKE_HC_DIR
const [cmd, ...rest] = process.argv.slice(2)
const out = (o, code = 0) => {
  process.stdout.write(JSON.stringify(o) + '\n')
  process.exit(code)
}
const fail = (kind, message, code) => out({ error: { kind, message, hint: '' } }, code)
const read = (t) => {
  try {
    return fs.readFileSync(path.join(dir, `${t}.state`), 'utf8').trim()
  } catch {
    return null
  }
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

if (cmd === '--version') {
  console.log('hc 0.0.0-fake')
  process.exit(0)
}
if (!dir) {
  console.error('fake hc: FAKE_HC_DIR is not set')
  process.exit(1)
}
const pos = rest.filter((a, i) => !a.startsWith('--') && rest[i - 1] !== '--if' && rest[i - 1] !== '--timeout')
const t = pos[0]
const raw = t ? read(t) : null
if (raw === null) fail('not_found', `no terminal "${t}"`, 3)
const [state, kind = null, ...msg] = raw.split(/\s+/)
const status =
  state === 'silent' || state === 'finished' ? null : { state, ...(kind ? { kind } : {}), ...(msg.length ? { msg: msg.join(' ') } : {}) }

if (cmd === 'get') out({ address: t, state: state === 'finished' ? 'finished' : 'live', status, turn: 0, labels: {} })

if (cmd === 'send') {
  const text = pos[1]
  const iff = rest.includes('--if') ? rest[rest.indexOf('--if') + 1] : null
  const delay = Number(
    (() => {
      try {
        return fs.readFileSync(path.join(dir, 'send-delay-ms'), 'utf8')
      } catch {
        return '0'
      }
    })(),
  )
  if (delay) sleep(delay)
  const now = read(t) ?? 'gone'
  const nowState = now.split(/\s+/)[0]
  const entry = { at: Date.now(), terminal: t, text, if: iff, state: nowState, force: rest.includes('--force') }
  const logIt = (typed) => fs.appendFileSync(path.join(dir, 'sends.log'), JSON.stringify({ ...entry, typed }) + '\n')
  if (now === 'gone') {
    logIt(false)
    fail('not_found', `no terminal "${t}"`, 3)
  }
  if (nowState === 'finished') {
    logIt(false)
    fail('finished', `${t} has finished`, 11)
  }
  if (nowState === 'blocked' && !entry.force) {
    logIt(false)
    fail('blocked', `${t} is blocked (${now.split(/\s+/)[1] || 'prompt'})`, 9)
  }
  if (iff && nowState !== iff) {
    logIt(false)
    fail('status_mismatch', `${t} is ${nowState}, not ${iff}`, 10)
  }
  logIt(true)
  try {
    const next = fs.readFileSync(path.join(dir, `${t}.after-send`), 'utf8').trim()
    if (next) fs.writeFileSync(path.join(dir, `${t}.state`), next + '\n')
  } catch {}
  out({ started: true, status: nowState, turn: 0 })
}
console.error(`fake hc: ${cmd} is not faked`)
process.exit(1)
