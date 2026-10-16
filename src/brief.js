import { MINDSET } from './mindset.js'
import { withoutPlaceholders } from './plan.js'

/**
 * The plan's specialist lines for this slice. A bullet that starts with a slice id (`- fv1 writes
 * like ...`) belongs to that slice; one that names no slice is for everyone.
 */
export function specialistFor(plan, agent) {
  const body = withoutPlaceholders(plan.specialist)
  const ids = plan.agents.map((a) => a.id)
  const owner = (l) => ids.find((id) => new RegExp(`^\\s*[-*]\\s+\\**${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(l))
  const lines = body.split('\n')
  if (!lines.some(owner)) return body
  // Keep each bullet whole (with its wrapped lines) and drop the ones that belong to another slice.
  const out = []
  let keep = true
  for (const l of lines) {
    if (/^\s*[-*]\s+/.test(l)) {
      const o = owner(l)
      keep = !o || o === agent.id
    }
    if (keep) out.push(l)
  }
  return out.join('\n').trim()
}

/**
 * The slice's task without the mindset block. Plans quote the block at the top of each task (it is
 * the creative prompt), and the brief already opens with it: once is the rule, and a task that
 * says "the paragraph above" still points at it.
 */
export function taskText(task) {
  return (task || '')
    .split('\n')
    .filter((l) => l.trim() !== MINDSET)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The standing orders every agent gets, plus the plan's brief and its own slice. */
export function briefFor(plan, agent, ctx) {
  // A slice still holding the template's <slice title> or <task> reads as not stated, not as text.
  const placeholder = (t) => /^<[^>]*>$/.test((t || '').trim())
  if (placeholder(agent.title) || placeholder(agent.task))
    agent = { ...agent, title: placeholder(agent.title) ? '' : agent.title, task: placeholder(agent.task) ? '' : agent.task }
  const others = plan.agents.filter((a) => a.id !== agent.id).map((a) => (placeholder(a.title) ? { ...a, title: '' } : a))
  const section = (title, body) => {
    const text = withoutPlaceholders(body)
    return text ? `## ${title}\n${text}\n\n` : ''
  }
  const mustNot = (plan.mustNotRules || []).filter((r) => !/^<.*>$/.test(r))
  const refs = (plan.references || []).filter((r) => !/^<.*>$/.test(r))
  const anti = (plan.antiReferences || []).filter((r) => !/^<.*>$/.test(r))
  const best =
    refs.length || anti.length
      ? `## The best at this job
${refs.length ? `Start from these and go past them:\n${refs.map((r) => '- ' + r).join('\n')}\n` : ''}${refs.length && anti.length ? '\n' : ''}${anti.length ? `Anti-references — not this:\n${anti.map((r) => '- ' + r).join('\n')}\n` : ''}
`
      : section('The best at this job', plan.referencesText)
  return `# Brief — ${agent.id}${agent.title ? ' · ' + agent.title : ''}

${MINDSET}

Project: **${plan.title}**
Your branch: \`${ctx.branch}\`   Your worktree: \`${ctx.path}\`
The contract is \`${ctx.planPath}\` at the repo root. Read it before you touch anything.
${ctx.issue ? `Your issue: #${ctx.issue.number}${ctx.issue.url ? ' ' + ctx.issue.url : ''} — the lead closes it at \`rig finish\`; put what is waiting on a person there.\n` : ''}
${section("What it's for", plan.purpose)}${section('The feeling', plan.feeling)}${section('The specialist', specialistFor(plan, agent))}${best}${section(
  'The bar',
  plan.bar,
)}${section('Who uses it, on what', plan.users)}${section('What done looks like', plan.done)}${section("Where we're starting from", plan.start)}${
  mustNot.length
    ? `## What must not happen — hard rules, from the plan
${mustNot.map((r) => '- ' + r).join('\n')}

If your task seems to need one of these to happen, stop and say so in your report. These outrank
your task.

`
    : ''
}${section('Freedom', plan.freedom)}${section('Tools', plan.tools)}${section('Checks', plan.checks)}${section(
  'Budget and autonomy',
  plan.budget,
)}${section('What to hand back', plan.handBack)}## You own
${agent.owns.map((o) => '- `' + o + '`').join('\n')}

Nothing else. If your task seems to need a change outside this list, **stop and say so in your
report** — do not reach into another agent's files. \`rig guard\` will refuse the commit anyway,
and a silent cross-slice edit is the defect that costs the most to find later.

## Also on this build
${others.length ? others.map((a) => `- \`${a.id}\`${a.title ? ' — ' + a.title : ''} owns ${a.owns.map((o) => '`' + o + '`').join(', ')}`).join('\n') : '- (you are alone on this one)'}

## Your task
${taskText(agent.task) || '(none stated in the plan — ask before inventing one)'}

${
  ctx.taste
    ? `## His taste, in ratings
Read \`${ctx.taste}\` before you design anything (a copy of the main checkout's \`docs/TASTE.md\`).
It holds the ratings the owner tapped on real examples. The ratings outrank your own taste: where they disagree with what you would have made,
they win. In your report, name the principles behind them that you designed to.

`
    : ''
}## The loop: plan, build, prove, review, show, commit

1. **Plan.** The contract is the plan. If the plan and your task disagree, say so before building.
2. **Build, and commit every verified step.** Never leave a green step uncommitted. A usage-limit
   pause lands mid-task with no warning, and whoever picks up your tree inherits the mess. Commit
   only your own paths, \`git commit -- <paths>\`, with a message that says what and why.
3. **Prove it — ask for the red, not just the green.** Before you call anything green, state what
   would make it red, then make it red once to prove the check is wired up. \`rig-harness\` has
   \`check()\` for exactly this — it marks an assertion VOID if its negative control also passes.
   A bug you fix gets a test that fails without the fix.
4. **Hard numbers are checks.** Write the bar as a target, not a sentence:
   \`s.target(name, { measure, atMost, atLeast, unit, breaks, timeout })\`, with
   \`countInput(page)\` counting the real taps, keys and gestures it takes. Both come from
   \`harness/index.js\`. Make it fail once (break the thing, watch the number cross the bar) and
   report the number beside its bar.
5. **Never grade the shared tree.** Numbers come from the QA worktree pinned to a commit, on its
   own port: \`rig qa <sha> --run "<your test command>"\`. Report the sha and the exit line it
   prints. Always give the sha: without one, \`rig qa\` pins the MAIN checkout's branch, not yours.
   Don't pipe a test run through \`tail\` or \`head\` and then read the exit code: write the
   output to a file instead. Your own working tree is half-finished by definition.
6. **Fresh eyes before done.** Your tests share your blind spots, and every real defect crosses a
   boundary between two people's work. Ask for a review of your diff early (\`rig review ${agent.id}\`),
   while it is still cheap to change, and review others' diffs when asked: read-only, findings only.
7. **Show it.** Anything a person sees gets screenshots of the real thing, phone and desktop where
   it matters, and you look at them before you call it done. Never an empty screen: seed demo data.
8. **The bar is a floor.** Put the work beside the references: screenshots side by side for anything
   visible. Say in your report where it holds up against them and where it does not yet. Matching
   them is the start; the job is to go past them.
9. **Drive with real input; hit-test, don't measure.** Real pointer and wheel events, not
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
