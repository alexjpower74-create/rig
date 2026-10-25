// Rig 5: the creative prompt in every brief. Every brief the rig writes opens with the mindset
// block, and a slice brief carries the parts an agent cannot guess: the feeling, the specialist,
// the best work to start from, and a bar with a number.
//
// Every check's control swaps Rig 4's real function back in. The Rig 4 functions are copied below,
// verbatim from 7d40d97 apart from their names (and reviewBrief's git call, which these checks do
// not exercise). The two checks that run the `rig up` CLI use Rig 4's whole tree, unpacked from
// 7d40d97 with `git archive` into a temp folder.

import { suite } from '../harness/check.js'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { MINDSET } from '../src/mindset.js'
import { parsePlan, bullets, briefFields, missingBrief, barHasNoNumber, droppedNumbers } from '../src/plan.js'
import { briefFor } from '../src/brief.js'
import { reviewBrief } from '../src/commands/review.js'
import { parseRoll, tabBrief } from '../src/roll.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rig-five-')))
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

// Steve Clarke's paragraph, pinned by hash and length so the test holds no second copy of it.
const MINDSET_SHA256 = 'cb299adab899ada77cc57999c3bf9acdc87f64af8eb4e8b9b8ae6307ebda3e99'
const MINDSET_LENGTH = 589
const RIG4 = '7d40d97'

// ------------------------------------------------------------------------------------------------
// Rig 4, copied.

/** The standing orders every agent gets, plus the plan's brief and its own slice. */
function rig4BriefFor(plan, agent, ctx) {
  const others = plan.agents.filter((a) => a.id !== agent.id)
  const section = (title, body) => (body && body.trim() && !/^<.*>$/.test(body.trim()) ? `## ${title}\n${body.trim()}\n\n` : '')
  const mustNot = (plan.mustNotRules || []).filter((r) => !/^<.*>$/.test(r))
  return `# Brief — ${agent.id}${agent.title ? ' · ' + agent.title : ''}

Project: **${plan.title}**
Your branch: \`${ctx.branch}\`   Your worktree: \`${ctx.path}\`
The contract is \`${ctx.planPath}\` at the repo root. Read it before you touch anything.
${ctx.issue ? `Your issue: #${ctx.issue.number}${ctx.issue.url ? ' ' + ctx.issue.url : ''} — the lead closes it at \`rig finish\`; put what is waiting on a person there.\n` : ''}
${section("What it's for", plan.purpose)}${section('Who uses it, on what', plan.users)}${section('What done looks like', plan.done)}${
  mustNot.length
    ? `## What must not happen — hard rules, from the plan
${mustNot.map((r) => '- ' + r).join('\n')}

If your task seems to need one of these to happen, stop and say so in your report. These outrank
your task.

`
    : ''
}## You own
${agent.owns.map((o) => '- `' + o + '`').join('\n')}

Nothing else. If your task seems to need a change outside this list, **stop and say so in your
report** — do not reach into another agent's files. \`rig guard\` will refuse the commit anyway,
and a silent cross-slice edit is the defect that costs the most to find later.

## Also on this build
${others.length ? others.map((a) => `- \`${a.id}\`${a.title ? ' — ' + a.title : ''} owns ${a.owns.map((o) => '`' + o + '`').join(', ')}`).join('\n') : '- (you are alone on this one)'}

## Your task
${agent.task || '(none stated in the plan — ask before inventing one)'}

## The loop: plan, build, prove, review, show, commit

1. **Plan.** The contract is the plan. If the plan and your task disagree, say so before building.
2. **Build, and commit every verified step.** Never leave a green step uncommitted. A usage-limit
   pause lands mid-task with no warning, and whoever picks up your tree inherits the mess. Commit
   only your own paths, \`git commit -- <paths>\`, with a message that says what and why.
3. **Prove it — ask for the red, not just the green.** Before you call anything green, state what
   would make it red, then make it red once to prove the check is wired up. \`rig-harness\` has
   \`check()\` for exactly this — it marks an assertion VOID if its negative control also passes.
   A bug you fix gets a test that fails without the fix.
4. **Never grade the shared tree.** Numbers come from the QA worktree pinned to a commit, on its
   own port: \`rig qa <sha> --run "<your test command>"\`. Report the sha and the exit line it
   prints. Always give the sha: without one, \`rig qa\` pins the MAIN checkout's branch, not yours.
   Don't pipe a test run through \`tail\` or \`head\` and then read the exit code: write the
   output to a file instead. Your own working tree is half-finished by definition.
5. **Fresh eyes before done.** Your tests share your blind spots, and every real defect crosses a
   boundary between two people's work. Ask for a review of your diff early (\`rig review ${agent.id}\`),
   while it is still cheap to change, and review others' diffs when asked: read-only, findings only.
6. **Show it.** Anything a person sees gets screenshots of the real thing, phone and desktop where
   it matters, and you look at them before you call it done. Never an empty screen: seed demo data.
7. **Drive with real input; hit-test, don't measure.** Real pointer and wheel events, not
   programmatic scrolls — eased synthetic motion is what input-speed bugs outrun.
   \`document.elementFromPoint\` tells you what a user actually hits; \`getBoundingClientRect\` will
   tell you a covered button is fine.

## House rules

- **You will not be messaged by keystrokes.** Nobody types into your pane. If you need something,
  put it in your report.
- **Keep scratch files inside your own worktree.** Reading or writing outside the working directory
  triggers a permission prompt, and a prompt stops you dead until a human notices.
- **Stop only what you started.** Never \`pkill\`/\`killall\` a server by name, and never free a port
  you do not own: other builds' demos are running on this machine. Stop a process only if its
  working directory is inside your worktree, and stop your dev servers before the worktree goes.
- **Dependencies: install, don't link.** If your worktree needs \`node_modules\`, run \`npm ci\` in it.
  A symlink to the main checkout's looks like a shortcut until an \`npm install\` inside the worktree
  rewrites the folder every slice shares.
- **Nothing leaves without the owner.** No emails, posts, releases, deploys or pull requests to
  other people's repos. Stage them and say so in your report.

## Reporting
Write to \`${ctx.reportPath}\` — what you built, what you verified and how it could have failed (the
red you saw), what you left undone, and anything you need from another slice or from the owner.
Mark items DONE or REJECTED in place. This file is a record, not a queue.

**Commit it along with your work.** It is a tracked file, deliberately: your reasoning is worth
more than your diff to whoever picks this up, and it should survive your worktree being removed.
`
}

function rig4ReviewBrief(plan, agent, { base, branch, by }) {
  const files = (() => {
    const r = { ok: false } // (the test passes no repo: the diff list is not what is checked)
    return r.ok ? r.out.split('\n').filter(Boolean) : []
  })()
  const out = `docs/review-${agent.id}.md`
  const rules = (plan.mustNotRules || []).filter((r) => !/^<.*>$/.test(r))
  const text = `# Review brief — ${agent.id}${agent.title ? ' · ' + agent.title : ''}

You are reviewing work you did not write${by ? ` (you are ${by})` : ''}. **Read only: do not edit, commit
or fix anything.** Your job is to find what the author's own tests could not.

Project: **${plan.title}**. The contract is the plan at the repo root; read it first, and \`docs/API.md\`
if the project has one.

## What to read
\`git diff ${base}...${branch}\`

${files.length ? files.map((f) => '- `' + f + '`').join('\n') : '- (no changes on that branch yet)'}

The slice owns: ${agent.owns.map((o) => '`' + o + '`').join(', ')}

## What to look for
1. **Where this slice meets another.** Every real defect on a crew build has crossed that line: a
   field named differently on each side, a status code one side never sends, a time zone, an empty
   list. Check the diff against the contract, not against itself.
2. **Checks that cannot fail.** A test with no negative control, an assertion that passes on an
   empty page, an exit code read through a pipe.
3. **Paths nobody ran.** Errors, retries, offline, a second tab, two requests at once, midnight, a
   daylight-saving night.
4. **The hard rules below**, and anything in the diff that sends, deploys, spends or deletes.

${rules.length ? `## What must not happen (from the plan)\n${rules.map((r) => '- ' + r).join('\n')}\n\n` : ''}## Report
Write \`${out}\`: actionable findings only, each with the file and line, the concrete input or state
that goes wrong, and what the author should check. Say "no findings" if there are none; do not pad it.
Commit only that file.
`
  return { text, files, out }
}

function rig4TabBrief(roll, tab, repos, { rollDir, reportPath, briefPath }) {
  const rules = roll.mustNot.filter((r) => !/^<.*>$/.test(r))
  return `# Brief — ${tab} · ${roll.title}

This is a ROLL: one procedure applied to a list of repos, one after the other. You own the repos
below for the length of this roll and nothing else. The brief you are reading is \`${briefPath}\`;
the roll's contract is \`${join(rollDir, 'ROLL.md')}\`.

## What it's for
${roll.purpose || '(not stated)'}

${
  rules.length
    ? `## What must not happen — hard rules, from the brief
${rules.map((r) => '- ' + r).join('\n')}

If a step seems to need one of these to happen, stop on that repo, write SKIPPED with the reason in
your report, and move on. These outrank the procedure.

`
    : ''
}## Your repos, in order
${repos.map((r, i) => `${i + 1}. \`${r.slug}\`  ${r.path}`).join('\n')}

Every one of them ends the roll in exactly one state in your report: done (with its commit sha) or
SKIPPED with a reason. No repo is left out and no repo is left half-done.

## Procedure, per repo
${roll.procedure.length ? roll.procedure.map((p, i) => `${i + 1}. ${p}`).join('\n') : '(none stated in the brief — ask before inventing one)'}

## Commit discipline, per repo
- \`cd\` into the repo. Check the tree is clean (\`git status --porcelain\` empty) and you are on the
  default branch. A dirty tree or another branch: SKIPPED with the reason. Never stash, reset or
  checkout over someone's work.
- Record the test result BEFORE touching anything (run the repo's test command and note the exit
  and the failing names). A repo that is red before you start is reported as such; you are not
  here to fix it, only to tell the truth about it.
- One commit per repo, on the default branch, only the files the procedure touched.
  Subject: \`${roll.commitSubject || '<the brief has no ## Commit subject; use the roll title>'}\`.
  A repo that needs a second commit needs a note in the report saying why.
- After the commit: run the tests again and record the exit. Push when the repo has a remote
  (\`git push\`); note "local only" when it has none.
- After each push: \`jot "[<slug>] <one line: what changed, tests before/after>"\` and
  \`apps touch <slug>\` when those commands exist on PATH. Skip silently when they do not.
- Never run \`wrap\` or \`sync\`: the lead does that once for the whole roll.
- Nothing leaves without the owner: no releases, deploys, posts, or pull requests to other people's
  repos.

## Report
Write \`${reportPath}\` as you go, not at the end: one line per repo, in list order, as
\`- <slug>: done <short sha> — <what changed; tests before → after>\` or
\`- <slug>: SKIPPED — <reason>\`, then anything the owner has to decide. Update it after every repo.
A usage pause lands mid-roll with no warning; the report is what survives it.

## House rules
- Nobody types into your pane. If you need something, put it in the report.
- Work only inside the repos listed above and \`${rollDir}\`. Reading or writing anywhere else
  triggers a permission prompt that stops you until a person notices.
- Stop only what you started: never kill a process by name or free a port you do not own.
- Dependencies: install, don't link (\`npm ci\` in the repo, never a symlink to another checkout).
`
}

function rig4BriefFields(sections) {
  // Anchored, so a coincidental heading ("Page sizes", "Non-goals") cannot fill a brief field.
  const find = (re) => sections.find((s) => re.test(s.heading))?.body || ''
  const mustNot = find(/^(what must not happen|hard rules)\b/i)
  return {
    purpose: find(/^(what it'?s for|purpose|goals?)\b/i),
    users: find(/^who uses it\b/i),
    done: find(/^(what done looks like|definition of done|done means)\b/i),
    mustNot,
    mustNotRules: bullets(mustNot),
    lives: find(/^where it lives\b/i),
    size: find(/^size (and|&) mode\b/i),
    checks: find(/^(checks|how we prove)\b/i),
    openQuestions: find(/^(open questions|needs (you|the owner))\b/i),
  }
}
function rig4MissingBrief(plan) {
  const want = [
    ['purpose', "What it's for"],
    ['users', 'Who uses it, on what'],
    ['done', 'What done looks like'],
    ['mustNot', 'What must not happen'],
    ['lives', 'Where it lives'],
  ]
  // A section still holding the template's <placeholder> lines counts as empty.
  const placeholder = (text) =>
    text
      .split('\n')
      .map((l) => l.replace(/^\s*[-*]\s+/, '').trim())
      .filter(Boolean)
      .every((l) => /^<.*>$/.test(l))
  return want.filter(([k]) => !plan[k] || placeholder(plan[k])).map(([, label]) => label)
}

// ------------------------------------------------------------------------------------------------
// Fixtures.

// A Rig 5 plan, every section filled, its tasks quoting the mindset block the way real plans do.
const FIVE = `# Depot draw

## What it's for
Customers scan a QR at the counter and enter a monthly draw.

## The feeling
Calm and sure: one look and you know you are in.

## The specialist
- s1 works like a **retail checkout designer** who has shipped a one-tap flow.
- s2 works like a **payments engineer** who has run a prize draw audit.
- Both are checked by a **plain-language editor**.

## The best at this job
- Apple Pay's one-glance confirmation.
- The Starbucks app's order-ahead receipt.

Anti-references:
- A raffle form with nine fields and a captcha.

## The bar
A customer enters in at most 3 taps and under 30 s, at 390 px.

## Who uses it, on what
Depot customers, on their phones.

## What done looks like
A customer enters and sees "You're in".

## Where we're starting from
Nothing yet: a paper slip in a jar.

## What must not happen
- Never claim a refund amount it can't back up.

## What must not change
- The paper slips still count.

## Where it lives
New private project, local only.

## Freedom
The look and the wording are yours.

## Tools
The harness and headless Chrome.

## Checks
- The entry walk is a target check.

## Budget and autonomy
One sitting; decide anything with an established answer.

## What to hand back
Green commits and a report with the red you saw.

## Agents

### s1 — Entry page
Owns:
- app/**

Task:
${MINDSET}

Build the entry page the paragraph above would be proud of.

### s2 — The draw
Owns:
- draw/**

Task:
${MINDSET}

Run the draw.
`

const ORDER = [
  "## What it's for",
  '## The feeling',
  '## The specialist',
  '## The best at this job',
  '## The bar',
  '## Who uses it, on what',
  '## What done looks like',
  "## Where we're starting from",
  '## What must not happen',
  '## Freedom',
  '## Tools',
  '## Checks',
  '## Budget and autonomy',
  '## What to hand back',
]

const ctx = (extra = {}) => ({ branch: 'rig/s1', path: '/w/s1', planPath: 'PLAN.md', reportPath: 'docs/build-report-s1.md', ...extra })

/** The title line, a blank line, the block, and the block nowhere else: before any `## `. */
function opensWithMindset(text) {
  const lines = text.split('\n')
  const count = text.split(MINDSET).length - 1
  return (
    lines[0].startsWith('# ') && lines[1] === '' && lines[2] === MINDSET && count === 1 && text.indexOf(MINDSET) < text.indexOf('\n## ')
  )
}

const ROLL = `# Lint sweep

## What it's for
One formatter across the fleet.

## The bar
Lint exits 0 with 0 new warnings in every repo.

## What must not happen
- Never commit over a dirty tree.

## Procedure per repo
1. Run the tests.
2. Format.

## Commit subject
chore: adopt the shared formatter

## Lists

### lint1
alpha, beta
`

await suite('rig 5.0, the creative prompt in every brief', async (s) => {
  // ----------------------------------------------------------------------------------------------
  // 1. The block itself. Red with Rig 4: there was no block, and so no copy of it in src/.
  let mindset = MINDSET
  let srcHasModule = true
  await s.check('MINDSET is Steve’s paragraph byte-exact, on one line, and the only copy in src/', {
    assert: async () => {
      if (typeof mindset !== 'string') return false
      const hash = createHash('sha256').update(mindset).digest('hex')
      const files = readdirSync(join(repoRoot, 'src'), { recursive: true })
        .filter((f) => f.endsWith('.js'))
        .filter((f) => srcHasModule || f !== 'mindset.js')
      const holders = files.filter((f) => readFileSync(join(repoRoot, 'src', f), 'utf8').includes(mindset))
      return hash === MINDSET_SHA256 && mindset.length === MINDSET_LENGTH && !mindset.includes('\n') && holders.join() === 'mindset.js'
    },
    breaks: async () => {
      mindset = undefined
      srcHasModule = false
      return () => {
        mindset = MINDSET
        srcHasModule = true
      }
    },
  })

  // ----------------------------------------------------------------------------------------------
  // 2. All three briefs open with it, once. Red with Rig 4: no block (and the slice brief's only
  //    copy is the one quoted in its task, under ## Your task).
  const plan = parsePlan(FIVE)
  let slice = briefFor
  await s.check('a slice brief opens with the block straight after its title, before any ##, exactly once', {
    assert: async () => plan.agents.every((a) => opensWithMindset(slice(plan, a, ctx()))),
    breaks: async () => {
      slice = rig4BriefFor
      return () => {
        slice = briefFor
      }
    },
  })

  let review = reviewBrief
  await s.check('a review brief opens with the block, once, before any ##', {
    assert: async () => opensWithMindset(review(plan, plan.agents[0], { root: tmp, base: 'main', branch: 'rig/s1' }).text),
    breaks: async () => {
      review = rig4ReviewBrief
      return () => {
        review = reviewBrief
      }
    },
  })

  let tab = tabBrief
  const roll = parseRoll(ROLL)
  const tabCtx = {
    rollDir: join(tmp, 'roll'),
    reportPath: join(tmp, 'roll', 'lint1', 'REPORT.md'),
    briefPath: join(tmp, 'roll', 'lint1', 'BRIEF.md'),
  }
  await s.check('a roll tab brief opens with the block, once, before any ##', {
    assert: async () => opensWithMindset(tab(roll, 'lint1', [], tabCtx)),
    breaks: async () => {
      tab = rig4TabBrief
      return () => {
        tab = tabBrief
      }
    },
  })

  // ----------------------------------------------------------------------------------------------
  // 3. briefFields learns the new headings and their aliases, and combines the must-not lists.
  //    Red with Rig 4: none of the new fields exist, and "What must not change" was dropped.
  const ALIASED = FIVE.replace('## The feeling', '## The one quality')
    .replace('## The best at this job', '## References')
    .replace('\nAnti-references:\n- A raffle form with nine fields and a captcha.\n', '')
    .replace('## The bar', '## Anti-references\n- A raffle form with nine fields and a captcha.\n\n## The bar')
  let fields = briefFields
  await s.check('briefFields reads the Rig 5 headings, their aliases, both anti-reference forms, and combined must-nots', {
    assert: async () => {
      const sections = (t) => parsePlan(t).sections
      for (const text of [FIVE, ALIASED]) {
        const f = fields(sections(text))
        const ok =
          f.feeling === 'Calm and sure: one look and you know you are in.' &&
          /retail checkout designer/.test(f.specialist) &&
          f.references?.join('|') === "Apple Pay's one-glance confirmation.|The Starbucks app's order-ahead receipt." &&
          f.antiReferences?.join('|') === 'A raffle form with nine fields and a captcha.' &&
          f.bar === 'A customer enters in at most 3 taps and under 30 s, at 390 px.' &&
          f.start === 'Nothing yet: a paper slip in a jar.' &&
          f.freedom === 'The look and the wording are yours.' &&
          f.tools === 'The harness and headless Chrome.' &&
          f.budget === 'One sitting; decide anything with an established answer.' &&
          f.handBack === 'Green commits and a report with the red you saw.' &&
          f.mustNotRules.join('|') === "Never claim a refund amount it can't back up.|The paper slips still count."
        if (!ok) return false
      }
      // "What must not happen or change" is the same list under one heading.
      const merged = fields(sections(FIVE.replace('## What must not happen\n', '## What must not happen or change\n')))
      return merged.mustNotRules.length === 2
    },
    breaks: async () => {
      fields = rig4BriefFields
      return () => {
        fields = briefFields
      }
    },
  })

  // ----------------------------------------------------------------------------------------------
  // 4. The slice brief carries every filled section, in the contract's order.
  slice = briefFor
  await s.check('a slice brief carries every filled section in order: feeling … what to hand back', {
    assert: async () => {
      const text = slice(plan, plan.agents[0], ctx())
      const at = ORDER.map((h) => (text.indexOf(h + '\n') >= 0 ? text.indexOf(h + '\n') : text.indexOf(h + ' ')))
      return at.every((i, n) => i >= 0 && (n === 0 || i > at[n - 1])) && text.includes('- A raffle form with nine fields and a captcha.')
    },
    breaks: async () => {
      slice = rig4BriefFor
      return () => {
        slice = briefFor
      }
    },
  })

  await s.check('the specialist section carries this slice’s specialist and the shared one, not the other slice’s', {
    assert: async () => {
      const s1 = slice(plan, plan.agents[0], ctx())
      const s2 = slice(plan, plan.agents[1], ctx())
      return (
        s1.includes('retail checkout designer') &&
        !s1.includes('payments engineer') &&
        s1.includes('plain-language editor') &&
        s2.includes('payments engineer') &&
        !s2.includes('retail checkout designer')
      )
    },
    breaks: async () => {
      slice = rig4BriefFor
      return () => {
        slice = briefFor
      }
    },
  })

  // 5. <placeholder> text never reaches a brief. Rig 4's test was /^<.*>$/ on the whole body, which a
  //    two-line placeholder (or one with real text before it) slips past.
  const template = readFileSync(join(repoRoot, 'templates', 'PLAN.md'), 'utf8').replaceAll('{{PROJECT}}', 'x')
  const HALF = template
    .replace('<the job it does in the world, in one or two sentences — not the tech>', 'A monthly draw at the counter.')
    .replace(
      '<the screen you want to see, the number you want to read, the thing that happens — concrete>',
      '<the screen you want to see>\n<the number you want to read, the thing that happens>',
    )
  await s.check('no <placeholder> text reaches a slice brief made from a half-filled template', {
    assert: async () => {
      const p = parsePlan(HALF)
      const text = slice(p, p.agents[0], ctx())
      // Anything in backticks is a real command (`rig qa <sha> --run "<your test command>"`).
      return text.includes('A monthly draw at the counter.') && !/<[^<>`]*>/.test(text.replace(/`[^`]*`/g, ''))
    },
    breaks: async () => {
      slice = rig4BriefFor
      return () => {
        slice = briefFor
      }
    },
  })

  // ----------------------------------------------------------------------------------------------
  // 6. The loop learns two steps; the harness names are the contract's, exactly.
  await s.check('the loop says the bar is a floor and hard numbers are checks, naming s.target and countInput exactly', {
    assert: async () => {
      const text = slice(plan, plan.agents[0], ctx())
      return (
        /\*\*The bar is a floor\.\*\* Put the work beside the references: screenshots side by side/.test(text) &&
        text.includes('**Hard numbers are checks.**') &&
        text.includes('`s.target(name, { measure, atMost, atLeast, unit, breaks, timeout })`') &&
        text.includes('`countInput(page)`') &&
        /Call `reset\(\)` at the start of `measure`/.test(text)
      )
    },
    breaks: async () => {
      slice = rig4BriefFor
      return () => {
        slice = briefFor
      }
    },
  })

  // 7. His taste. With a TASTE.md the brief points at it and says the ratings win.
  await s.check('with a TASTE.md the brief says: read it before you design, the ratings outrank yours, name the principles', {
    assert: async () => {
      const text = slice(plan, plan.agents[0], ctx({ taste: '.rig/TASTE.md' }))
      const none = briefFor(plan, plan.agents[0], ctx())
      return (
        /Read `\.rig\/TASTE\.md` before you design anything/.test(text) &&
        /ratings outrank your own taste/.test(text) &&
        /name the principles behind them/.test(text) &&
        !none.includes('TASTE.md')
      )
    },
    breaks: async () => {
      slice = rig4BriefFor
      return () => {
        slice = briefFor
      }
    },
  })

  // 8. Review: a fifth thing to look for.
  review = reviewBrief
  await s.check('a review brief asks whether the bar is a target check seen red, and how it looks beside the references', {
    assert: async () => {
      const t = review(plan, plan.agents[0], { root: tmp, base: 'main', branch: 'rig/s1' }).text
      return (
        /^5\. \*\*The bar, measured and looked at\.\*\*/m.test(t) &&
        t.includes('`s.target`') &&
        /seen red/.test(t) &&
        /beside the references/.test(t) &&
        t.includes('A customer enters in at most 3 taps and under 30 s, at 390 px.')
      )
    },
    breaks: async () => {
      review = rig4ReviewBrief
      return () => {
        review = reviewBrief
      }
    },
  })

  // 9. Roll: an optional ## The bar reaches every tab.
  tab = tabBrief
  await s.check('a roll’s optional ## The bar reaches its tab briefs, and a roll without one has no bar section', {
    assert: async () => {
      const without = parseRoll(ROLL.replace(/## The bar\n.*\n\n/, ''))
      return (
        tab(roll, 'lint1', [], tabCtx).includes('## The bar\nLint exits 0 with 0 new warnings in every repo.') &&
        !tabBrief(without, 'lint1', [], tabCtx).includes('## The bar')
      )
    },
    breaks: async () => {
      tab = rig4TabBrief
      return () => {
        tab = tabBrief
      }
    },
  })

  // ----------------------------------------------------------------------------------------------
  // 10. Warnings. missingBrief names the three an agent cannot guess when asked for them, and still
  //     counts Rig 4's five when it is not (callers written for five keep five).
  let missing = missingBrief
  await s.check('missingBrief({ aim: true }) names The feeling, The best at this job and The bar on an empty template', {
    assert: async () => {
      const gaps = missing(parsePlan(template), { aim: true })
      const filled = missing(plan, { aim: true })
      return (
        ['The feeling', 'The best at this job', 'The bar'].every((g) => gaps.includes(g)) &&
        gaps.length === 8 &&
        filled.length === 0 &&
        missingBrief(parsePlan(template)).length === 5
      )
    },
    breaks: async () => {
      missing = rig4MissingBrief
      return () => {
        missing = missingBrief
      }
    },
  })

  // Rig 4 had no such test: it never warned, which is `() => false`.
  let noNumber = barHasNoNumber
  await s.check('barHasNoNumber is true for a bar with no digit, false for one with a number or no bar at all', {
    assert: async () => {
      const withBar = (bar) => parsePlan(FIVE.replace('A customer enters in at most 3 taps and under 30 s, at 390 px.', bar))
      return (
        noNumber(withBar('Fast, and it feels effortless.')) === true &&
        noNumber(withBar('Found in under 10 s.')) === false &&
        noNumber(parsePlan(template)) === false &&
        noNumber(plan) === false
      )
    },
    breaks: async () => {
      noNumber = () => false
      return () => {
        noNumber = barHasNoNumber
      }
    },
  })

  // ----------------------------------------------------------------------------------------------
  // 11. The CLI, end to end, against Rig 4's real tree as the control.
  const rig4Dir = join(tmp, 'rig4')
  mkdirSync(rig4Dir)
  git(['archive', '-o', join(tmp, 'rig4.tar'), RIG4], repoRoot)
  execFileSync('tar', ['-xf', join(tmp, 'rig4.tar'), '-C', rig4Dir])
  const home = join(tmp, 'home')
  mkdirSync(home)
  const runRig = (bin, args, cwd) =>
    spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', env: { ...process.env, HOME: home, NO_COLOR: '1' } })
  const repoWith = (name, planText) => {
    const r = join(tmp, name)
    mkdirSync(join(r, 'docs'), { recursive: true })
    git(['init', '-q', '-b', 'main'], r)
    git(['config', 'user.email', 'test@example.invalid'], r)
    git(['config', 'user.name', 'Rig Test'], r)
    writeFileSync(join(r, '.gitignore'), '.rig/\n.worktrees/\n')
    writeFileSync(join(r, 'PLAN.md'), planText)
    mkdirSync(join(r, '.rig'))
    writeFileSync(join(r, '.rig', 'config.json'), JSON.stringify({ worktreeDir: '.worktrees', issues: false }))
    git(['add', '-A'], r)
    git(['commit', '-qm', 'plan'], r)
    return r
  }

  let rigBin = join(repoRoot, 'bin', 'rig.js')
  const vague = repoWith(
    'vague',
    FIVE.replace(/## The feeling\n.*\n\n/, '').replace(
      'A customer enters in at most 3 taps and under 30 s, at 390 px.',
      'Fast, and it feels effortless.',
    ),
  )
  await s.check('rig up names a missing feeling and prints one line when the bar has no number (warns, never refuses)', {
    assert: async () => {
      const r = runRig(rigBin, ['up', '--dry-run'], vague)
      if (r.status !== 0) throw new Error(r.stderr || r.stdout)
      const out = r.stdout.replace(/\x1b\[[0-9;]*m/g, '')
      const barLines = out.split('\n').filter((l) => /bar has no number/.test(l))
      return /brief is missing: .*The feeling/.test(out) && barLines.length === 1 && /would branch rig\/s1/.test(out)
    },
    breaks: async () => {
      rigBin = join(rig4Dir, 'bin', 'rig.js')
      return () => {
        rigBin = join(repoRoot, 'bin', 'rig.js')
      }
    },
  })

  const tasted = repoWith('tasted', FIVE)
  const TASTE = '# Taste\n\n## Ratings\n| reference | rating | note |\n|---|---|---|\n| apple-pay | 5 | |\n\n## Principles\n- One look.\n'
  writeFileSync(join(tasted, 'docs', 'TASTE.md'), TASTE) // untracked, as it is right after a round
  await s.check('rig up with docs/TASTE.md in the main checkout: each worktree gets a copy and its brief points at it', {
    assert: async () => {
      rmSync(join(tasted, '.worktrees'), { recursive: true, force: true })
      git(['worktree', 'prune'], tasted)
      for (const b of ['rig/s1', 'rig/s2']) spawnSync('git', ['branch', '-D', b], { cwd: tasted })
      const r = runRig(rigBin, ['up', '--no-launch', '--no-issues'], tasted)
      if (r.status !== 0) throw new Error(r.stderr || r.stdout)
      return ['s1', 's2'].every((id) => {
        const wt = join(tasted, '.worktrees', id)
        const brief = readFileSync(join(wt, '.rig', 'BRIEF.md'), 'utf8')
        return (
          existsSync(join(wt, '.rig', 'TASTE.md')) &&
          readFileSync(join(wt, '.rig', 'TASTE.md'), 'utf8') === TASTE &&
          brief.includes('Read `.rig/TASTE.md` before you design anything') &&
          opensWithMindset(brief)
        )
      })
    },
    breaks: async () => {
      rigBin = join(rig4Dir, 'bin', 'rig.js')
      return () => {
        rigBin = join(repoRoot, 'bin', 'rig.js')
      }
    },
  })

  // ----------------------------------------------------------------------------------------------
  // 13. From fv3's review of this slice. The control for these is the slice as it was reviewed
  //     (be201ba), unpacked whole, so the old placeholder rule runs inside the old briefs.
  const pre = join(tmp, 'pre-review')
  mkdirSync(pre)
  git(['archive', '-o', join(tmp, 'pre.tar'), 'be201ba'], repoRoot)
  execFileSync('tar', ['-xf', join(tmp, 'pre.tar'), '-C', pre])
  const live = {
    plan: await import('../src/plan.js'),
    brief: await import('../src/brief.js'),
    review: await import('../src/commands/review.js'),
    roll: await import('../src/roll.js'),
  }
  const old = {
    plan: await import(join(pre, 'src', 'plan.js')),
    brief: await import(join(pre, 'src', 'brief.js')),
    review: await import(join(pre, 'src', 'commands', 'review.js')),
    roll: await import(join(pre, 'src', 'roll.js')),
  }
  const COMPARE = 'Search answers in < 200 ms and fails > 1 time in 1000 runs.'
  let code = live
  await s.check('a bar that compares with < and > reaches the slice, review and roll briefs; real placeholders still do not', {
    assert: async () => {
      const p = code.plan.parsePlan(FIVE.replace('A customer enters in at most 3 taps and under 30 s, at 390 px.', COMPARE))
      const slice = code.brief.briefFor(p, p.agents[0], ctx())
      const review = code.review.reviewBrief(p, p.agents[0], { root: tmp, base: 'main', branch: 'rig/s1' }).text
      const tab = code.roll.tabBrief(
        code.roll.parseRoll(ROLL.replace('Lint exits 0 with 0 new warnings in every repo.', COMPARE)),
        'lint1',
        [],
        tabCtx,
      )
      const stillDropped = code.plan.withoutPlaceholders(
        '<the one command whose run proves it>\nNegative controls: <the one command whose run proves it>',
      )
      return (
        slice.includes('## The bar\n' + COMPARE) &&
        review.includes('   ' + COMPARE) &&
        tab.includes('## The bar\n' + COMPARE) &&
        code.plan.missingBrief(p, { aim: true }).length === 0 &&
        stillDropped === ''
      )
    },
    breaks: async () => {
      code = old
      return () => {
        code = live
      }
    },
  })

  await s.check('barHasNoNumber sees a comparison bar: true with no digit, false with one', {
    assert: async () => {
      const bar = (b) => code.plan.parsePlan(FIVE.replace('A customer enters in at most 3 taps and under 30 s, at 390 px.', b))
      return (
        code.plan.barHasNoNumber(bar('Replies in < a blink and never > a breath.')) === true &&
        code.plan.barHasNoNumber(bar(COMPARE)) === false
      )
    },
    breaks: async () => {
      code = old
      return () => {
        code = live
      }
    },
  })

  // From fv2's re-check of ac1c2da: comparisons written without spaces were still read as
  // placeholders. The control is ac1c2da, unpacked whole.
  const ac = join(tmp, 'ac1c2da')
  mkdirSync(ac)
  git(['archive', '-o', join(tmp, 'ac.tar'), 'ac1c2da'], repoRoot)
  execFileSync('tar', ['-xf', join(tmp, 'ac.tar'), '-C', ac])
  const acCode = {
    plan: await import(join(ac, 'src', 'plan.js')),
    brief: await import(join(ac, 'src', 'brief.js')),
    review: await import(join(ac, 'src', 'commands', 'review.js')),
    roll: await import(join(ac, 'src', 'roll.js')),
  }
  const TIGHT = ['- x<3 and y>2', '- latency<200 ms and jank>1 frame']
  code = live
  await s.check('comparisons with no spaces (x<3 and y>2, latency<200 ms and jank>1 frame) reach every brief', {
    assert: async () => {
      if (code.plan.withoutPlaceholders(TIGHT.join('\n')) !== TIGHT.join('\n')) return false
      const p = code.plan.parsePlan(FIVE.replace('A customer enters in at most 3 taps and under 30 s, at 390 px.', TIGHT.join('\n')))
      const slice = code.brief.briefFor(p, p.agents[0], ctx())
      const review = code.review.reviewBrief(p, p.agents[0], { root: tmp, base: 'main', branch: 'rig/s1' }).text
      const tab = code.roll.tabBrief(
        code.roll.parseRoll(ROLL.replace('Lint exits 0 with 0 new warnings in every repo.', TIGHT.join('\n'))),
        'lint1',
        [],
        tabCtx,
      )
      return (
        TIGHT.every((l) => slice.includes(l) && review.includes(l) && tab.includes(l)) &&
        code.plan.withoutPlaceholders('<the one command whose run proves it>') === ''
      )
    },
    breaks: async () => {
      code = acCode
      return () => {
        code = live
      }
    },
  })

  // Belt and braces: a line still read as a placeholder that has a number outside it is named by
  // rig up. Red with ac1c2da's rig up, which drops it without a word.
  let upBin = join(repoRoot, 'bin', 'rig.js')
  const DROPPED = 'Ship by <the date we agree on together> or 2 weeks after.'
  const numbered = repoWith(
    'numbered',
    FIVE.replace('Nothing yet: a paper slip in a jar.', 'Nothing yet: a paper slip in a jar.\n' + DROPPED),
  )
  await s.check('rig up names a line with a number that the placeholder rule leaves out of the briefs (one line, none for a template)', {
    assert: async () => {
      const r = runRig(upBin, ['up', '--dry-run'], numbered)
      if (r.status !== 0) throw new Error(r.stderr || r.stdout)
      const out = r.stdout.replace(/\x1b\[[0-9;]*m/g, '')
      const named = out.split('\n').filter((l) => /left out of the briefs/.test(l))
      const quiet = droppedNumbers(parsePlan(template)).length === 0 && droppedNumbers(plan).length === 0
      return named.length === 1 && named[0].includes("(## Where we're starting from)") && named[0].includes(DROPPED) && quiet
    },
    breaks: async () => {
      upBin = join(ac, 'bin', 'rig.js')
      return () => {
        upBin = join(repoRoot, 'bin', 'rig.js')
      }
    },
  })

  // `rig brief <id>` after a taste round: the crew is already building, and the re-printed brief and
  // the worktree's copy carry the new ratings. Red with the slice as reviewed: rig brief had no taste.
  let briefBin = join(repoRoot, 'bin', 'rig.js')
  await s.check('rig brief <id> after a later taste round copies the new TASTE.md and points at it', {
    assert: async () => {
      const LATER = TASTE.replace('| apple-pay | 5 | |', '| apple-pay | 5 | |\n| starbucks | 2 | too busy |')
      writeFileSync(join(tasted, 'docs', 'TASTE.md'), LATER)
      try {
        const r = runRig(briefBin, ['brief', 's1'], tasted)
        if (r.status !== 0) throw new Error(r.stderr || r.stdout)
        const copy = join(tasted, '.worktrees', 's1', '.rig', 'TASTE.md')
        return (
          r.stdout.includes("## The owner's taste, in ratings") &&
          r.stdout.includes('Read `.rig/TASTE.md` before you design anything') &&
          readFileSync(copy, 'utf8') === LATER
        )
      } finally {
        writeFileSync(join(tasted, 'docs', 'TASTE.md'), TASTE)
      }
    },
    breaks: async () => {
      briefBin = join(pre, 'bin', 'rig.js')
      return () => {
        briefBin = join(repoRoot, 'bin', 'rig.js')
      }
    },
  })

  // ----------------------------------------------------------------------------------------------
  // 12. Templates. PLAN.md carries the new sections in the contract's order, each with a one-line
  //     placeholder, and keeps every Rig 4 section; ROLL.md has an optional ## The bar.
  let templates = repoRoot
  await s.check('templates/PLAN.md has the Rig 5 sections in order with one-line placeholders; ROLL.md has ## The bar', {
    assert: async () => {
      const t = readFileSync(join(templates, 'templates', 'PLAN.md'), 'utf8')
      const roll4 = readFileSync(join(templates, 'templates', 'ROLL.md'), 'utf8')
      const heads = t.split('\n').filter((l) => /^## /.test(l))
      const want = [
        "## What it's for",
        '## The feeling',
        '## The specialist',
        '## The best at this job',
        '## The bar',
        '## Who uses it, on what',
        '## What done looks like',
        "## Where we're starting from",
        '## What must not happen or change',
        '## Freedom',
        '## Tools',
        '## Checks',
        '## Budget and autonomy',
        '## What to hand back',
      ]
      const at = want.map((h) => heads.indexOf(h))
      const inOrder = at.every((i, n) => i >= 0 && (n === 0 || i > at[n - 1]))
      const kept = ['## Where it lives', '## Size and mode', '## Rules', '## Agents', '## Open questions'].every((h) => heads.includes(h))
      const sections = parsePlan(t).sections
      const placeholders = [
        'The feeling',
        'The specialist',
        'The bar',
        "Where we're starting from",
        'Freedom',
        'Tools',
        'Budget and autonomy',
        'What to hand back',
      ]
        .map((h) => sections.find((x) => x.heading === h)?.body || '')
        .every((b) => /^<[^\n]+>$/.test(b))
      const refs = bullets(sections.find((x) => x.heading === 'The best at this job')?.body || '')
      return (
        inOrder &&
        kept &&
        placeholders &&
        refs.length === 2 &&
        refs.every((r) => /^<.*>$/.test(r)) &&
        /^## The bar\n<optional:/m.test(roll4)
      )
    },
    breaks: async () => {
      templates = rig4Dir
      return () => {
        templates = repoRoot
      }
    },
  })
  // ------------------------------------------------------------------------------------------------
  // 5.5.2: test what you touched. Every slice brief and both templates say agents run only the tests
  // their change touches and the whole suite runs once on the final sha. Red on 5.5.1 (HEAD~ text).
  {
    const plan = parsePlan(FIVE)
    const rule = /Test what you touched/i
    const once = /whole suite (runs )?once/i
    let brief = (a) => briefFor(plan, a, ctx())
    let template = (name) => readFileSync(join(repoRoot, 'templates', name), 'utf8')
    await s.check('slice briefs and the PLAN and AGENTS templates carry the test-what-you-touched rule', {
      assert: async () =>
        plan.agents.every((a) => rule.test(brief(a)) && once.test(brief(a))) &&
        ['PLAN.md', 'AGENTS.md'].every((n) => rule.test(template(n)) && once.test(template(n))),
      breaks: async () => {
        const old = (path) => execFileSync('git', ['-C', repoRoot, 'show', `7c9dddb:${path}`], { encoding: 'utf8' })
        brief = (a) => briefFor(plan, a, ctx()).replace(/\*\*Test what you touched\.\*\*[\s\S]*?edge cases instead\.\n/, '')
        template = (name) => old(`templates/${name}`)
        return () => {
          brief = (a) => briefFor(plan, a, ctx())
          template = (name) => readFileSync(join(repoRoot, 'templates', name), 'utf8')
        }
      },
    })
  }
})

rmSync(tmp, { recursive: true, force: true })
