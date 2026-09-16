/** The standing orders every agent gets, plus the plan's brief and its own slice. */
export function briefFor (plan, agent, ctx) {
  const others = plan.agents.filter(a => a.id !== agent.id)
  const section = (title, body) => body && body.trim() && !/^<.*>$/.test(body.trim()) ? `## ${title}\n${body.trim()}\n\n` : ''
  const mustNot = (plan.mustNotRules || []).filter(r => !/^<.*>$/.test(r))
  return `# Brief — ${agent.id}${agent.title ? ' · ' + agent.title : ''}

Project: **${plan.title}**
Your branch: \`${ctx.branch}\`   Your worktree: \`${ctx.path}\`
The contract is \`${ctx.planPath}\` at the repo root. Read it before you touch anything.
${ctx.issue ? `Your issue: #${ctx.issue.number}${ctx.issue.url ? ' ' + ctx.issue.url : ''} — the lead closes it at \`rig finish\`; put what is waiting on a person there.\n` : ''}
${section("What it's for", plan.purpose)}${section('Who uses it, on what', plan.users)}${section('What done looks like', plan.done)}${mustNot.length ? `## What must not happen — hard rules, from the plan
${mustNot.map(r => '- ' + r).join('\n')}

If your task seems to need one of these to happen, stop and say so in your report. These outrank
your task.

` : ''}## You own
${agent.owns.map(o => '- `' + o + '`').join('\n')}

Nothing else. If your task seems to need a change outside this list, **stop and say so in your
report** — do not reach into another agent's files. \`rig guard\` will refuse the commit anyway,
and a silent cross-slice edit is the defect that costs the most to find later.

## Also on this build
${others.length ? others.map(a => `- \`${a.id}\`${a.title ? ' — ' + a.title : ''} owns ${a.owns.map(o => '`' + o + '`').join(', ')}`).join('\n') : '- (you are alone on this one)'}

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
