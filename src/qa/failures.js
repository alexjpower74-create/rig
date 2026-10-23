// Reading a test run's output: which tests failed, by name, and how many passed.
//
// "0 new failures" is only a fact when both runs were read the same way, by a parser, from their
// own output. A name has to come out identical on two commits, so line numbers, durations and
// retry counters are cut away: they move when the code moves, and a known failure that shifted by
// one line would otherwise read as one fixed and one new.

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
export const plain = (s) => s.replace(ANSI, '').replace(/\r/g, '')

const DURATION = /\s+\((?:\d+(?:\.\d+)?\s*(?:ms|s|m)|\d+(?:\.\d+)?m\s*\d+(?:\.\d+)?s|retry #\d+)\)\s*$/
const tidy = (s) => {
  let t = s.trim()
  for (let i = 0; i < 3 && DURATION.test(t); i++) t = t.replace(DURATION, '')
  return t.trim()
}
// "tests/a.spec.ts:12:5" → "tests/a.spec.ts": the place moves between commits; the test does not.
const unplace = (s) => s.replace(/(\.[cm]?[jt]sx?|\.rb|\.py):\d+(?::\d+)?/g, '$1')

/**
 * The runners rig qa knows, each a line pattern and how to turn a match into a name. Order matters
 * only for speed; a line is offered to every one until one claims it.
 */
const RUNNERS = [
  // TAP, which node:test prints when not on a terminal: "not ok 3 - name". A TODO is not a failure.
  {
    id: 'tap',
    re: /^\s*not ok \d+(?: - (.*))?$/,
    name: (m) => (/#\s*(TODO|SKIP)\b/i.test(m[1] ?? '') ? null : tidy((m[1] ?? '').replace(/\s+#\s.*$/, ''))),
  },
  // node:test's spec reporter: "✖ name (1.2ms)". Its "✖ failing tests:" heading is not a test.
  { id: 'node-spec', re: /^\s*✖ (.+)$/, name: (m) => (/^failing tests:?$/.test(m[1].trim()) ? null : tidy(m[1])) },
  // The Rig's own harness: "  FAIL  name 12ms". Its VOID and UNPRV lines are not failures by
  // themselves (see parseMarks); a target's name ends at " — ".
  {
    id: 'harness',
    re: /^\s*FAIL\s{2}(\S.*?)(?:\s+\d+ms)?$/,
    name: (m) => m[1].split(' — ')[0].trim(),
  },
  // Jest names the failing file: "FAIL src/cart.test.js".
  { id: 'jest', re: /^\s*FAIL\s+(\S+\.[cm]?[jt]sx?)\s*$/, name: (m) => m[1] },
  // rspec's re-run list: "rspec ./spec/a_spec.rb:12 # does a thing". The description is the stable name.
  { id: 'rspec', re: /^rspec (\S+?)(?::\d+|\[[\d:]+\])?(?:\s+#\s+(.+))?$/, name: (m) => (m[2] ? m[2].trim() : m[1]) },
  // Playwright, list reporter ("  ✘  3 [chromium] › a.spec.ts:12:5 › title (1.2s)") and its summary
  // ("  1) [chromium] › a.spec.ts:12:5 › title ─────").
  {
    id: 'playwright',
    re: /^\s*(?:✘|×|\d+\))\s+(?:\d+\s+)?(\[[^\]]+\]\s+›\s+.+?)\s*─*\s*$/,
    name: (m) => unplace(tidy(m[1])),
  },
]

/**
 * The names of the tests that failed in `text`, in first-seen order, each once.
 * `pattern` is the repo's own `qaFailurePattern`: a regex whose `name` group (or first group) is
 * the test's name; it is tried first, so a repo can name what the built-in runners do not know.
 */
export function parseFailures(text, { pattern = null } = {}) {
  const custom = pattern ? new RegExp(pattern) : null
  const seen = new Set()
  for (const raw of plain(text).split('\n')) {
    const line = raw.trimEnd()
    if (custom) {
      const m = line.match(custom)
      if (m) {
        const n = (m.groups?.name ?? m[1] ?? m[0]).trim()
        if (n) seen.add(n)
        continue
      }
    }
    for (const r of RUNNERS) {
      const m = line.match(r.re)
      if (!m) continue
      const n = r.name(m)
      if (n) seen.add(n)
      break
    }
  }
  return [...seen]
}

/**
 * The harness's VOID and UNPRV checks by name, each under its own word: a check that passed
 * against a broken page (void) or was never shown to fail (unproven). Neither is a failing test.
 * The summary line ("  VOID checks passed against a broken page…") has one space and is skipped.
 */
export function parseMarks(text) {
  const out = { void: [], unproven: [] }
  for (const raw of plain(text).split('\n')) {
    const m = raw.trimEnd().match(/^\s*(?:(VOID)\s{2}|(UNPRV)\s)(\S.*?)(?:\s+\d+ms)?$/)
    if (!m) continue
    const name = m[3].split(' — ')[0].trim()
    const list = m[1] ? out.void : out.unproven
    if (!list.includes(name)) list.push(name)
  }
  return out
}

/**
 * The names a run contributes to the baseline's new-failure diff: its failures, and its VOID and
 * UNPRV checks only when the run's exit says it failed (the harness fails a run on VOID, and on
 * UNPRV under requireNegativeControl). In a green run they are notes, never new failures.
 */
export function diffNames(text, { exit, pattern = null } = {}) {
  const names = parseFailures(text, { pattern })
  if (exit === 0) return names
  const marks = parseMarks(text)
  return [...new Set([...names, ...marks.void, ...marks.unproven])]
}

/** Which runner's failure line this is, or null. Used to place a failure in time (needs-a-stub). */
export function failureIn(line, { pattern = null } = {}) {
  return parseFailures(line, { pattern })[0] ?? null
}

/** A result line of any kind, pass or fail: the boundary between one spec and the next. */
export function isResultLine(line) {
  const l = plain(line)
  return /^\s*(?:not ok|ok) \d+/.test(l) || /^\s*[✔✖✓✘×]\s/.test(l) || /^\s*(?:(?:PASS|FAIL|VOID)\s{2}|UNPRV\s)\S/.test(l)
}

/**
 * Passed and failed counts from the summary lines runners print, summed over every summary in the
 * output (test/run.js prints one per file). `passed` is null when no summary was found: a count
 * nobody printed is not invented.
 *
 * Given the run's `exit`, a failed count that contradicts it is not reported as a number: `failed`
 * is null and `conflict` says why. A summary is only text, and a test may print one inside a
 * passing run (a harness self-test prints its fixture suite's "1 void"): on main 515b118 that made
 * a green run read "failed 2" beside exit 0.
 */
export function tally(text, failures = null, exit = undefined) {
  const t = plain(text)
  let passed = null
  let failed = null
  const add = (which, n) => {
    if (which === 'p') passed = (passed ?? 0) + n
    else failed = (failed ?? 0) + n
  }
  for (const m of t.matchAll(/^\s*(?:#|ℹ) (pass|fail) (\d+)\s*$/gm)) add(m[1] === 'pass' ? 'p' : 'f', Number(m[2]))
  // "of which targets: …" breaks the suite's own count down; it is not another suite.
  // Void checks are counted apart (parseMarks): not failures, though they fail a harness run.
  for (const m of t.matchAll(/^(?!\s*of which\b).+?: (\d+) passed, (\d+) failed, (\d+) void/gm)) {
    add('p', Number(m[1]))
    add('f', Number(m[2]))
  }
  for (const m of t.matchAll(/^\s+(\d+) passed \(/gm)) add('p', Number(m[1]))
  for (const m of t.matchAll(/^\s+(\d+) failed\s*$/gm)) add('f', Number(m[1]))
  for (const m of t.matchAll(/^(\d+) examples?, (\d+) failures?/gm)) {
    add('p', Number(m[1]) - Number(m[2]))
    add('f', Number(m[2]))
  }
  for (const m of t.matchAll(/^Tests:\s+(.*)$/gm)) {
    const f = m[1].match(/(\d+) failed/)
    const p = m[1].match(/(\d+) passed/)
    if (p) add('p', Number(p[1]))
    add('f', f ? Number(f[1]) : 0)
  }
  const names = failures ?? parseFailures(text)
  const counted = failed ?? names.length
  let conflict = null
  if (exit === 0 && counted > 0)
    conflict = `the output counts ${counted} failed but the run exited 0 (a test may print a summary of its own)`
  const marks = parseMarks(text)
  if (typeof exit === 'number' && exit !== 0 && counted === 0 && !marks.void.length && !marks.unproven.length)
    conflict = `the run exited ${exit} but no failure was counted`
  return { passed, failed: conflict ? null : counted, names, conflict, void: marks.void.length, unproven: marks.unproven.length }
}

/**
 * The baseline comparison, from two (or, with a host, three) parsed runs.
 *
 * `here` and `there` are the head's failures on this machine and on the host (null when the host
 * did not run); `base` is the failures of the same command on the base commit. A failure is new
 * when the base did not fail it and it is not one that only needs a stub (a spec that reached for the
 * clipboard or the display, which rig qa took away). A known one is listed with where the head also
 * fails it.
 *
 * `complete` is false, and `why` says so, when a run failed without one parsable failure name: a
 * crash, a timeout, a stall or a runner rig qa cannot read. Then "0 new" would be a guess, and rig qa
 * never prints it.
 */
export function compareBaseline({ here, there = null, base, runs, needsStub = [] }) {
  const baseSet = new Set(base)
  const stub = new Set(needsStub)
  const heads = [
    ['here', here],
    ['there', there],
  ].filter(([, f]) => f)
  // A run that did not finish (a hard limit, a signal, the watchdog) may have more failures it never
  // reached, so its names are not the whole list either (r55g review 5).
  const cut = (r) => r.stalled || r.exit === 124 || r.exit >= 128
  const unread = (runs ?? []).filter((r) => cut(r) || (r.exit !== 0 && r.failures.length === 0))
  const all = [...new Set(heads.flatMap(([, f]) => f))]
  const where = (n) => {
    const w = heads.filter(([, f]) => f.includes(n)).map(([k]) => k)
    return w.length === 2 ? 'both' : w[0]
  }
  return {
    newFailures: all.filter((n) => !baseSet.has(n) && !stub.has(n)),
    needsStub: all.filter((n) => !baseSet.has(n) && stub.has(n)),
    known: all.filter((n) => baseSet.has(n)).map((name) => ({ name, where: where(name) })),
    fixed: base.filter((n) => !all.includes(n)),
    complete: unread.length === 0,
    why: unread.length
      ? unread
          .map((r) =>
            r.stalled
              ? `${r.label} stalled (exit ${r.exit})`
              : cut(r)
                ? `${r.label} did not finish (exit ${r.exit})`
                : `${r.label} exited ${r.exit} with no failure rig qa could name`,
          )
          .join('; ')
      : null,
  }
}

const SPEC_PATTERNS = [
  // Playwright's "[chromium] › tests/a.spec.ts:12:5 › title"
  (l) => l.match(/(\[[^\]]+\]\s+›\s+.+?)(?:\s+\(\d[^)]*\))?\s*$/)?.[1],
  // TAP subtest headers
  (l) => l.match(/^\s*# Subtest: (.+)$/)?.[1],
  // a spec file named on the line
  (l) =>
    l.match(
      /((?:\.{0,2}\/)?[\w@./-]*?(?:[\w-]+\.(?:spec|test)\.[cm]?[jt]sx?|[\w-]+_spec\.rb|[\w-]+_test\.(?:go|py|rb)|test_\w+\.py)(?::\d+(?::\d+)?)?)/,
    )?.[1],
  // a result line names a test
  (l) => l.match(/^\s*(?:ok|not ok) \d+ - (.+)$/)?.[1],
  (l) => l.match(/^\s*[▶✔✖✓✘]\s+(.+)$/)?.[1],
  (l) => l.match(/^\s*(?:PASS|FAIL|VOID)\s{2}(\S.*)$/)?.[1],
]

/** The last spec, file or test the given output mentions, or null. */
export function lastSpecIn(text) {
  const lines = plain(text).split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trimEnd()
    if (!l.trim()) continue
    for (const p of SPEC_PATTERNS) {
      const s = p(l)
      if (s) return tidy(s)
    }
  }
  return null
}
