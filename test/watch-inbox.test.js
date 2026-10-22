// Rig 5.5, items 5, 6 and 14: peers report themselves (`rig tell`, `rig inbox --wait`), every brief
// ends with the tell line and says "ask the lead, never the human", `rig up` names the lead's watcher,
// and `rig up` warns when a plan with a UI over rules has no refusal → repair matrix.
//
// Each check's control runs a copy of the rig's tree with the guard taken out, so a check that would
// pass against the broken code is VOID. Every inbox is a temp directory; HOME is a temp directory.

import { suite } from '../harness/check.js'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync, readFileSync, readdirSync, cpSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn, spawnSync, execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rig-watch-inbox-')))
const home = join(tmp, 'home')
mkdirSync(home)
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function brokenTree(patches) {
  const root = mkdtempSync(join(tmp, 'broken-'))
  for (const d of ['bin', 'src', 'templates']) cpSync(join(repo, d), join(root, d), { recursive: true })
  cpSync(join(repo, 'package.json'), join(root, 'package.json'))
  for (const [file, from, to] of patches) {
    const p = join(root, file)
    const text = readFileSync(p, 'utf8')
    if (!text.includes(from)) throw new Error(`control patch not found in ${file}: ${from}`)
    writeFileSync(p, text.replace(from, to))
  }
  return root
}
let tree = repo
const broken = (patches) => async () => {
  tree = brokenTree(patches)
  return () => {
    tree = repo
  }
}
/** The tree's own module, so a control swaps the code in-process too. */
const mod = (rel) => import(pathToFileURL(join(tree, rel)).href + `?t=${tree === repo ? 0 : tree}`)

let n = 0
const freshInbox = () => join(tmp, `inbox-${++n}`)
const baseEnv = (inbox) => {
  const env = { ...process.env, HOME: home, RIG_INBOX_DIR: inbox }
  for (const k of ['RIG_LEAD', 'RIG_AGENT_ID', 'CODEX_PERSONA', 'XDG_STATE_HOME', 'HERDR_ENV', 'HERDR_PANE_ID']) delete env[k]
  return env
}
const rigSync = (args, cwd, env) => spawnSync(process.execPath, [join(tree, 'bin', 'rig.js'), ...args], { cwd, encoding: 'utf8', env })
/** A rig command in the background: { done: Promise<{ code, out, at }>, child }. */
function rigBg(args, cwd, env, limit = 90_000) {
  const child = spawn(process.execPath, [join(tree, 'bin', 'rig.js'), ...args], { cwd, env })
  let out = ''
  child.stdout.on('data', (d) => (out += d))
  child.stderr.on('data', (d) => (out += d))
  const kill = setTimeout(() => child.kill('SIGKILL'), limit)
  const done = new Promise((resolve) =>
    child.on('close', (code) => {
      clearTimeout(kill)
      resolve({ code, out, at: Date.now() })
    }),
  )
  return { child, done }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** Wait until `rig inbox --wait` has marked itself as listening, so the tell is not early. */
async function armed(inbox, lead) {
  const mark = join(inbox, lead, '.watcher.json')
  for (let i = 0; i < 200 && !existsSync(mark); i++) await sleep(25)
  if (!existsSync(mark)) throw new Error('the watcher never armed')
}

const scratch = join(tmp, 'scratch')
mkdirSync(scratch)

// A fixture repo with a plan and a config naming the lead.
function fixture(planText, cfg = { lead: 'boss' }) {
  const r = mkdtempSync(join(tmp, 'repo-'))
  git(['init', '-q', '-b', 'main'], r)
  git(['config', 'user.email', 'test@example.invalid'], r)
  git(['config', 'user.name', 'Rig Test'], r)
  writeFileSync(join(r, 'PLAN.md'), planText)
  writeFileSync(join(r, '.gitignore'), '.rig/\n')
  git(['add', '-A'], r)
  git(['commit', '-qm', 'plan'], r)
  mkdirSync(join(r, '.rig'))
  writeFileSync(join(r, '.rig', 'config.json'), JSON.stringify({ issues: false, ...cfg }))
  return r
}
const PLAN_UI = `# Expenses

## What it's for
A claim form that refuses claims over the approved limit.

## Agents

### e1 — Claim form
Owns:
- src/claims/**

Task:
Build the claim form.
`

await suite('rig 5.5: peers report themselves, briefs say who acts', async (s) => {
  // ---------------------------------------------------------------------------------------------
  // rig tell / rig inbox
  await s.check('rig tell writes one message file into <inbox>/<lead>/, from RIG_AGENT_ID, with from/at/text', {
    assert: async () => {
      const inbox = freshInbox()
      const r = rigSync(['tell', 'boss', 'w1: done — report committed'], scratch, { ...baseEnv(inbox), RIG_AGENT_ID: 'w1' })
      if (r.status !== 0) throw new Error(r.stderr || r.stdout)
      const files = readdirSync(join(inbox, 'boss'))
      if (files.length !== 1 || !/^\d{8}T\d{6}\.\d{3}-\d{6}-\d+-[0-9a-f]{6}\.md$/.test(files[0])) throw new Error(files.join(','))
      const body = readFileSync(join(inbox, 'boss', files[0]), 'utf8')
      return /^from: w1\nat: \d{4}-\d\d-\d\d \d\d:\d\d\n\nw1: done — report committed\n$/.test(body)
    },
    breaks: broken([['src/inbox.js', 'if (env.RIG_AGENT_ID) return env.RIG_AGENT_ID', '']]),
  })

  await s.check('the sender is RIG_AGENT_ID, else the slice id from the branch, else CODEX_PERSONA, else "peer"', {
    assert: async () => {
      const { senderId } = await mod('src/inbox.js')
      const b = { branch: 'rig/r9', branchPrefix: 'rig/' }
      return (
        senderId({ RIG_AGENT_ID: 'a', CODEX_PERSONA: 'p' }, b) === 'a' &&
        senderId({ CODEX_PERSONA: 'p' }, b) === 'r9' &&
        senderId({ CODEX_PERSONA: 'p' }, { branch: 'main' }) === 'p' &&
        senderId({}, {}) === 'peer'
      )
    },
    breaks: broken([['src/inbox.js', '    return branch.slice(branchPrefix.length)', '    return null']]),
  })

  await s.check(
    'the inbox lives in RIG_INBOX_DIR, else inboxDir in config, else $XDG_STATE_HOME/rig/inbox, else ~/.local/state/rig/inbox',
    {
      assert: async () => {
        const { inboxRoot } = await mod('src/inbox.js')
        return (
          inboxRoot({ inboxDir: '/c' }, { RIG_INBOX_DIR: '/e', XDG_STATE_HOME: '/x', HOME: '/h' }) === '/e' &&
          inboxRoot({ inboxDir: '/c' }, { XDG_STATE_HOME: '/x', HOME: '/h' }) === '/c' &&
          inboxRoot({}, { XDG_STATE_HOME: '/x', HOME: '/h' }) === '/x/rig/inbox' &&
          inboxRoot({}, { HOME: '/h' }) === '/h/.local/state/rig/inbox'
        )
      },
      breaks: broken([['src/inbox.js', "  if (env.XDG_STATE_HOME) return join(env.XDG_STATE_HOME, 'rig', 'inbox')\n", '']]),
    },
  )

  await s.check('a lead name that is a path is refused (no writing outside the inbox)', {
    assert: async () => {
      const inbox = freshInbox()
      const r = rigSync(['tell', '../escape', 'x'], scratch, baseEnv(inbox))
      return r.status !== 0 && !existsSync(join(dirname(inbox), 'escape'))
    },
    breaks: broken([['src/inbox.js', "  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(lead || '') || lead.includes('..'))", '  if (false)']]),
  })

  await s.check('rig inbox prints every new message oldest first, files them under read/, and the next read is empty', {
    assert: async () => {
      const inbox = freshInbox()
      const env = baseEnv(inbox)
      rigSync(['tell', 'boss', 'first'], scratch, { ...env, RIG_AGENT_ID: 'a1' })
      rigSync(['tell', 'boss', 'second'], scratch, { ...env, RIG_AGENT_ID: 'a2' })
      // A write in flight (the dot-tmp name a tell renames from) is not a message yet.
      writeFileSync(join(inbox, 'boss', '.20990101T000000-1-abcdef.md.tmp'), 'from: half')
      const r = rigSync(['inbox', 'boss'], scratch, env)
      const again = rigSync(['inbox', 'boss'], scratch, env)
      const read = readdirSync(join(inbox, 'boss', 'read'))
      return (
        r.status === 0 &&
        r.stdout.indexOf('first') < r.stdout.indexOf('second') &&
        /=== a1 · /.test(r.stdout) &&
        !r.stdout.includes('half') &&
        read.length === 2 &&
        /nothing new/.test(again.stdout)
      )
    },
    breaks: broken([['src/inbox.js', ".filter((f) => f.endsWith('.md') && !f.startsWith('.'))", ".filter((f) => f.includes('.md'))"]]),
  })

  await s.check('rig inbox with no lead named says so and exits 2; with RIG_LEAD it reads that lead', {
    assert: async () => {
      const inbox = freshInbox()
      const none = rigSync(['inbox'], scratch, baseEnv(inbox))
      rigSync(['tell', 'boss', 'hi'], scratch, baseEnv(inbox))
      const named = rigSync(['inbox'], scratch, { ...baseEnv(inbox), RIG_LEAD: 'boss' })
      return none.status === 2 && /no lead named/.test(none.stderr) && named.status === 0 && named.stdout.includes('hi')
    },
    breaks: broken([['src/inbox.js', 'return cfg.lead || env.RIG_LEAD || null', 'return cfg.lead || null']]),
  })

  // The bar: `rig inbox --wait` wakes within 60 s of a `rig tell`, on the poll alone (fs.watch off,
  // as on a filesystem that drops its events). The control lifts the 5 s cap and asks for a 2-minute
  // poll: the watcher that only looks now and then.
  await s.target('rig inbox --wait wakes after rig tell, on the poll alone', {
    measure: async () => {
      const inbox = freshInbox()
      const env = { ...baseEnv(inbox), RIG_INBOX_WATCH: '0', RIG_INBOX_POLL_MS: '120000' }
      const w = rigBg(['inbox', 'boss', '--wait', '--deadline', '5'], scratch, env, 62_000)
      await armed(inbox, 'boss')
      await sleep(300)
      const t0 = Date.now()
      rigSync(['tell', 'boss', 'w1: done'], scratch, env)
      const r = await w.done
      if (r.code === null) return 62_000
      if (r.code !== 0 || !r.out.includes('w1: done')) throw new Error(`exit ${r.code}: ${r.out}`)
      return r.at - t0
    },
    atMost: 60_000,
    unit: 'ms',
    timeout: 70_000,
    breaks: broken([['src/inbox.js', 'Math.min(MAX_POLL_MS, pollMs)', 'pollMs']]),
  })

  await s.target('rig inbox --wait wakes after rig tell, with fs.watch on (the default)', {
    measure: async () => {
      const inbox = freshInbox()
      const env = { ...baseEnv(inbox), RIG_INBOX_POLL_MS: '5000' }
      const w = rigBg(['inbox', 'boss', '--wait', '--deadline', '1'], scratch, env, 20_000)
      await armed(inbox, 'boss')
      await sleep(5300) // just past a poll, so the next one is ~5 s away
      const t0 = Date.now()
      rigSync(['tell', 'boss', 'w2: blocked — on a permission dialog'], scratch, env)
      const r = await w.done
      return r.code === 0 ? r.at - t0 : 20_000
    },
    atMost: 1500,
    unit: 'ms',
    timeout: 30_000,
    breaks: broken([['src/inbox.js', "process.env.RIG_INBOX_WATCH === '0'", 'true']]),
  })

  await s.check('rig inbox --wait with nothing arriving exits 4 at its deadline and says how to re-arm', {
    assert: async () => {
      const inbox = freshInbox()
      const w = rigBg(['inbox', 'boss', '--wait', '--deadline', '0.03'], scratch, { ...baseEnv(inbox), RIG_INBOX_POLL_MS: '200' }, 8000)
      const r = await w.done
      return r.code === 4 && /no message in 0\.03 min \(the deadline\)/.test(r.out) && !existsSync(join(inbox, 'boss', '.watcher.json'))
    },
    breaks: broken([['src/inbox.js', '      if (Date.now() >= until) finish([])', '']]),
  })

  // ---------------------------------------------------------------------------------------------
  // Briefs: the tell line is the last line, and item 6 is said outright.
  const PLAN = `# P

## What it's for
A thing.

## Agents

### a1 — One
Owns:
- src/a/**

Task:
Do a.

### a2 — Two
Owns:
- src/b/**

Task:
Do b.
`
  const ctx = { branch: 'rig/a1', path: '/w/a1', planPath: 'PLAN.md', reportPath: 'docs/build-report-a1.md', lead: 'boss' }
  const lastLine = (t) => t.trimEnd().split('\n').pop()

  await s.check('a slice brief’s last line is the tell line, naming the lead and the slice', {
    assert: async () => {
      const { parsePlan } = await mod('src/plan.js')
      const { briefFor, tellLine } = await mod('src/brief.js')
      const plan = parsePlan(PLAN)
      const want = tellLine('boss', 'a1')
      return lastLine(briefFor(plan, plan.agents[0], ctx)) === want && want.includes('rig tell boss "a1: ')
    },
    breaks: broken([['src/brief.js', '\n\n${askTheLead(ctx.lead, agent.id)}`', '`']]),
  })

  await s.check('with no lead named, the tell line leaves the name for rig tell to look up', {
    assert: async () => {
      const { tellLine } = await mod('src/brief.js')
      return tellLine(null, 'a1').includes('`rig tell "a1: ') && !tellLine(null, 'a1').includes('null')
    },
    breaks: broken([['src/brief.js', "${lead ? lead + ' ' : ''}", '${lead} ']]),
  })

  await s.check('a roll tab’s brief ends with the tell line too', {
    assert: async () => {
      const { tabBrief } = await mod('src/roll.js')
      const { tellLine } = await mod('src/brief.js')
      const roll = { title: 'Lint sweep', purpose: 'Lint every repo.', mustNot: [], procedure: ['Run lint.'], bar: '' }
      const t = tabBrief(roll, 't1', [], { rollDir: '/r', reportPath: 'x', briefPath: 'y', lead: 'boss' })
      return lastLine(t) === tellLine('boss', 't1')
    },
    breaks: broken([['src/roll.js', '\n\n${askTheLead(lead, tab)}`', '`']]),
  })

  await s.check('briefs say it outright: ask the lead, never the human; only a permission dialog, a go or a taste call go to the human', {
    assert: async () => {
      const { parsePlan } = await mod('src/plan.js')
      const { briefFor } = await mod('src/brief.js')
      const plan = parsePlan(PLAN)
      const t = briefFor(plan, plan.agents[0], ctx).replace(/\s+/g, ' ')
      return (
        t.includes('## Ask the lead, never the human') &&
        t.includes('A question left in your own pane reaches nobody') &&
        t.includes('a permission dialog, a go (for anything that leaves the machine), and a taste call')
      )
    },
    breaks: broken([['src/brief.js', 'A question left in your own pane reaches nobody', 'Questions go in your report']]),
  })

  // ---------------------------------------------------------------------------------------------
  // rig up: the watcher, and the refusal matrix.
  await s.check('rig up prints the lead’s watcher command exactly, with the lead from config', {
    assert: async () => {
      const r = rigSync(['up', '--dry-run'], fixture(PLAN.replace('A thing.', 'A thing.\n\nUI: none')), baseEnv(freshInbox()))
      if (r.status !== 0) throw new Error(r.stderr || r.stdout)
      return r.stdout.includes('lead inbox: boss') && r.stdout.includes('\n    rig inbox boss --wait --deadline 240\n')
    },
    breaks: broken([
      [
        'src/commands/up.js',
        "    console.log('\\ndry run — nothing created')\n    watcherNote(cfg, lead)",
        "    console.log('\\ndry run — nothing created')",
      ],
    ]),
  })

  await s.check('with RIG_LEAD and no lead in config, rig up names that lead; with neither it warns', {
    assert: async () => {
      const plan = PLAN.replace('A thing.', 'A thing.\n\nUI: none')
      const a = rigSync(['up', '--dry-run'], fixture(plan, {}), { ...baseEnv(freshInbox()), RIG_LEAD: 'chief' })
      const b = rigSync(['up', '--dry-run'], fixture(plan, {}), baseEnv(freshInbox()))
      return (
        a.stdout.includes('rig inbox chief --wait --deadline 240') && /no lead named/.test(b.stdout) && !b.stdout.includes('rig inbox ')
      )
    },
    breaks: broken([['src/inbox.js', 'return cfg.lead || env.RIG_LEAD || null', 'return cfg.lead || null']]),
  })

  await s.check('rig up says when the watcher is already armed, instead of printing the command again', {
    assert: async () => {
      const inbox = freshInbox()
      const env = baseEnv(inbox)
      const w = rigBg(['inbox', 'boss', '--wait', '--deadline', '1'], scratch, env, 20_000)
      await armed(inbox, 'boss')
      const r = rigSync(['up', '--dry-run'], fixture(PLAN.replace('A thing.', 'A thing.\n\nUI: none')), env)
      w.child.kill()
      await w.done
      return /watcher armed: pid \d+/.test(r.stdout) && !r.stdout.includes('no watcher armed')
    },
    breaks: broken([['src/inbox.js', '    return alive && w.until > now ? w : null', '    return null']]),
  })

  await s.check('rig up --watch sets up the crew, then waits as the watcher and exits on the first tell', {
    assert: async () => {
      const inbox = freshInbox()
      const env = baseEnv(inbox)
      const r = fixture(PLAN.replace('A thing.', 'A thing.\n\nUI: none'))
      const up = rigBg(['up', '--no-launch', '--watch'], r, env, 30_000)
      await armed(inbox, 'boss')
      rigSync(['tell', 'boss', 'a2: question — which port?'], scratch, { ...env, RIG_AGENT_ID: 'a2' })
      const out = await up.done
      return out.code === 0 && out.out.includes('watching: rig inbox boss --wait') && out.out.includes('a2: question — which port?')
    },
    breaks: broken([['src/commands/up.js', "if (watch && args.includes('--watch')) {", 'if (false) {']]),
    timeout: 40_000,
  })

  await s.check('rig up warns when a plan with a UI over rules has no ## Refusals matrix, naming why', {
    assert: async () => {
      const r = rigSync(['up', '--dry-run'], fixture(PLAN_UI), baseEnv(freshInbox()))
      return (
        r.status === 0 &&
        r.stdout.includes('no ## Refusals matrix') &&
        r.stdout.includes('(it talks about "form" and "refuses" in one sentence)') &&
        r.stdout.includes('`UI: none`')
      )
    },
    breaks: broken([['src/commands/up.js', '  const refusals = refusalsGap(plan)', '  const refusals = null']]),
  })

  await s.check('a filled Refusals matrix, or a UI: none line, silences it; the template’s own row does not', {
    assert: async () => {
      const tpl = readFileSync(join(tree, 'templates', 'PLAN.md'), 'utf8')
      const section = tpl.slice(tpl.indexOf('## Refusals'), tpl.indexOf('## Where we'))
      if (!section.includes('| Refusal')) throw new Error('the template has no Refusals table')
      const withTemplate = PLAN_UI.replace('## Agents', `${section}## Agents`)
      const filled = PLAN_UI.replace(
        '## Agents',
        '## Refusals\n| Refusal | Repair |\n|---|---|\n| Submit over the limit | the message names the approver |\n\n## Agents',
      )
      const out = (p) => rigSync(['up', '--dry-run'], fixture(p), baseEnv(freshInbox())).stdout
      return (
        out(withTemplate).includes('no ## Refusals matrix') &&
        !out(filled).includes('no ## Refusals matrix') &&
        !out(PLAN_UI.replace('Build the claim form.', 'Build the claim form.\n\nUI: none')).includes('no ## Refusals matrix')
      )
    },
    breaks: broken([
      ['src/plan.js', "    if (cells.every((c) => /^<.*>$/.test(c) || c === '')) continue // the template's own example\n", ''],
    ]),
  })

  await s.check('a plan with no UI, or a UI with no rules, gets no warning', {
    assert: async () => {
      const { parsePlan, refusalsGap } = await mod('src/plan.js')
      const cli = parsePlan(PLAN_UI.replace('A claim form that refuses claims over the approved limit.', 'A command that prints the time.'))
      const plainUi = parsePlan(PLAN_UI.replace('A claim form that refuses claims over the approved limit.', 'A page that shows the time.'))
      const uiFiles = parsePlan(PLAN_UI.replace('src/claims/**', 'src/components/**').replace('A claim form that refuses', 'It refuses'))
      return refusalsGap(cli) === null && refusalsGap(plainUi) === null && /a slice owns src\/components/.test(refusalsGap(uiFiles))
    },
    breaks: broken([['src/plan.js', 'const r = w && sentence.match(RULE_WORDS)?.[0]', 'const r = w']]),
  })

  await s.check('a filled matrix reaches the brief; the template’s placeholder row does not', {
    assert: async () => {
      const { parsePlan } = await mod('src/plan.js')
      const { briefFor } = await mod('src/brief.js')
      const filled = parsePlan(
        PLAN_UI.replace(
          '## Agents',
          '## Refusals\n| Refusal | Repair |\n|---|---|\n| Submit over the limit | the message names the approver |\n\n## Agents',
        ),
      )
      const tpl = readFileSync(join(tree, 'templates', 'PLAN.md'), 'utf8')
      const empty = parsePlan(PLAN_UI.replace('## Agents', tpl.slice(tpl.indexOf('## Refusals'), tpl.indexOf('## Where we')) + '## Agents'))
      const c = { ...ctx, branch: 'rig/e1' }
      return (
        briefFor(filled, filled.agents[0], c).includes('the message names the approver') &&
        !briefFor(empty, empty.agents[0], c).includes('## Refusals')
      )
    },
    breaks: broken([
      ['src/brief.js', "refusalRows(plan.refusals).length ? section('Refusals (every one has a repair)', plan.refusals) : ''", "''"],
    ]),
  })

  // ---------------------------------------------------------------------------------------------
  // r55u's review of ef60454.

  // 1. This repo's own plan (a CLI with no screens, full of "page" and "blocked") gets no warning.
  //    Taken from git at the plan commit, so a later `UI: none` in PLAN.md cannot make it pass.
  await s.check('Rig 5.5’s own PLAN.md (a CLI plan) gets no refusal-matrix warning from rig up', {
    assert: async () => {
      const text = git(['show', '14a1ad6:PLAN.md'], repo)
      if (/^\s*UI:/m.test(text)) throw new Error('the fixture has a UI: line; it would prove nothing')
      const { parsePlan, refusalsGap } = await mod('src/plan.js')
      const gap = refusalsGap(parsePlan(text))
      const r = rigSync(['up', '--dry-run'], fixture(text), baseEnv(freshInbox()))
      if (r.status !== 0) throw new Error(r.stderr || r.stdout)
      return gap === null && !r.stdout.includes('Refusals')
    },
    // 5.5's first trigger: any screen word and any rule word, anywhere in the brief or the tasks.
    breaks: broken([
      [
        'src/plan.js',
        '  for (const sentence of sentences(brief)) {',
        '  if (prose.match(UI_WORDS) && prose.match(RULE_WORDS)) return `it talks about "${prose.match(UI_WORDS)[0]}"`\n  for (const sentence of sentences(brief)) {',
      ],
    ]),
  })

  // 2. Two tells in the same millisecond come back in the order they were written.
  await s.check('messages written back to back (same millisecond) are read oldest first, 300 pairs out of 300', {
    assert: async () => {
      const { tellMessage, takeAll } = await mod('src/inbox.js')
      const root = freshInbox()
      const at = new Date()
      let wrong = 0
      for (let i = 0; i < 300; i++) {
        tellMessage(root, 'boss', 'w1', `first ${i}`, at)
        tellMessage(root, 'boss', 'w1', `correction ${i}`, at)
        const got = takeAll(root, 'boss').map((m) => m.text)
        if (got.join('|') !== `first ${i}|correction ${i}`) wrong++
      }
      if (wrong) throw new Error(`${wrong} of 300 pairs came back out of order`)
      return true
    },
    // ef60454's name: seconds, pid, random suffix.
    breaks: broken([
      ['src/inbox.js', "`${stamp(now)}-${String(seq++).padStart(6, '0')}-${process.pid}-", '`${stamp(now).slice(0, 15)}-${process.pid}-'],
    ]),
  })

  await s.check('two rig tell commands run back to back are read in that order, 10 times', {
    assert: async () => {
      for (let i = 0; i < 10; i++) {
        const inbox = freshInbox()
        rigSync(['tell', 'boss', 'done'], scratch, baseEnv(inbox))
        rigSync(['tell', 'boss', 'correction: blocked'], scratch, baseEnv(inbox))
        const r = rigSync(['inbox', 'boss'], scratch, baseEnv(inbox))
        if (!(r.stdout.indexOf('\ndone\n') < r.stdout.indexOf('correction: blocked'))) throw new Error(r.stdout)
      }
      return true
    },
    // Names that sort the wrong way round whenever both land in one second.
    breaks: broken([
      [
        'src/inbox.js',
        "`${stamp(now)}-${String(seq++).padStart(6, '0')}-${process.pid}-",
        '`${stamp(now).slice(0, 15)}-${String(1e6 - process.pid)}-',
      ],
    ]),
    timeout: 30_000,
  })

  // 3. A fresh default inbox says once that an existing one can be kept, naming no other tool.
  await s.check('a fresh default inbox prints the inboxDir note once, naming no vendor folder; inboxDir is honoured', {
    assert: async () => {
      const state = mkdtempSync(join(tmp, 'xdg-'))
      const env = { ...baseEnv('x'), XDG_STATE_HOME: state }
      delete env.RIG_INBOX_DIR
      const first = rigSync(['inbox', 'boss'], scratch, env)
      rigSync(['tell', 'boss', 'hello'], scratch, env)
      const second = rigSync(['inbox', 'boss'], scratch, env)
      const note = first.stdout.split('\n').find((l) => l.startsWith('note:')) || ''
      // inboxDir from the config of the repo the command runs in.
      const r = fixture('# P\n\n## Agents\n\n### a1 — x\nOwns:\n- src/a/**\n\nTask:\nx\n', {
        lead: 'boss',
        inboxDir: join(tmp, 'kept-inbox'),
      })
      const told = rigSync(['tell', 'kept'], r, env)
      return (
        note.includes('"inboxDir" in .rig/config.json') &&
        !/claude|codex|anthropic|openai|gemini/i.test(note) &&
        !second.stdout.includes('note:') &&
        second.stdout.includes('hello') &&
        told.status === 0 &&
        !told.stdout.includes('note:') &&
        readdirSync(join(tmp, 'kept-inbox', 'boss')).some((f) => f.endsWith('.md'))
      )
    },
    breaks: broken([['src/inbox.js', '  if (env.RIG_INBOX_DIR || cfg.inboxDir) return null\n', '  return null\n']]),
  })

  await s.check('inboxDir in config moves the inbox (the note path aside)', {
    assert: async () => {
      const state = mkdtempSync(join(tmp, 'xdg-'))
      const env = { ...baseEnv('x'), XDG_STATE_HOME: state }
      delete env.RIG_INBOX_DIR
      const r = fixture('# P\n\n## Agents\n\n### a1 — x\nOwns:\n- src/a/**\n\nTask:\nx\n', { lead: 'boss', inboxDir: join(tmp, 'kept-2') })
      rigSync(['tell', 'moved'], r, env)
      return existsSync(join(tmp, 'kept-2', 'boss')) && !existsSync(join(state, 'rig', 'inbox', 'boss'))
    },
    breaks: broken([['src/inbox.js', '  if (cfg.inboxDir) return expandHome(cfg.inboxDir)\n', '']]),
  })

  // 4. A message may start with `--`.
  await s.check('rig tell keeps text that starts with --', {
    assert: async () => {
      const inbox = freshInbox()
      rigSync(['tell', 'boss', '--no-vendor was needed'], scratch, baseEnv(inbox))
      const r = rigSync(['inbox', 'boss'], scratch, baseEnv(inbox))
      return r.stdout.includes('\n--no-vendor was needed\n')
    },
    breaks: broken([['src/commands/tell.js', '  const words = args\n', "  const words = args.filter((a) => !a.startsWith('--'))\n"]]),
  })
})

rmSync(tmp, { recursive: true, force: true })
