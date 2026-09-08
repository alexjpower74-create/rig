/** The standing orders every agent gets, plus its own slice. */
export function briefFor (plan, agent, ctx) {
  const others = plan.agents.filter(a => a.id !== agent.id)
  return `# Brief — ${agent.id}${agent.title ? ' · ' + agent.title : ''}

Project: **${plan.title}**
Your branch: \`${ctx.branch}\`   Your worktree: \`${ctx.path}\`
The contract is \`${ctx.planPath}\` at the repo root. Read it before you touch anything.

## You own
${agent.owns.map(o => '- `' + o + '`').join('\n')}

Nothing else. If your task seems to need a change outside this list, **stop and say so in your
report** — do not reach into another agent's files. \`rig guard\` will refuse the commit anyway,
and a silent cross-slice edit is the defect that costs the most to find later.

## Also on this build
${others.length ? others.map(a => `- \`${a.id}\`${a.title ? ' — ' + a.title : ''} owns ${a.owns.map(o => '`' + o + '`').join(', ')}`).join('\n') : '- (you are alone on this one)'}

## Your task
${agent.task || '(none stated in the plan — ask before inventing one)'}

## How this build is run

1. **Verify, then commit, then report.** Never leave a verified step uncommitted. A usage-limit
   pause lands mid-task with no warning, and whoever picks up your tree inherits the mess.
   Commit only your own paths: \`git commit -- <paths>\`.
2. **A check that cannot fail measured nothing.** Before you call anything green, state what would
   make it red, then make it red once to prove the check is wired up. \`rig-harness\` has
   \`check()\` for exactly this — it marks an assertion VOID if its negative control also passes.
3. **Never grade the shared tree.** Numbers come from the QA worktree (\`rig qa\`) pinned to a
   commit, on its own port. Your own working tree is half-finished by definition.
4. **Drive with real input.** If you are testing a page, use real wheel/pointer events through the
   debugger, not programmatic scrolls. Eased synthetic motion is exactly what input-speed bugs
   outrun — four green suites once missed a visibly broken site that way.
5. **Hit-test, don't measure rectangles.** \`document.elementFromPoint\` tells you what a user
   actually hits. \`getBoundingClientRect\` will tell you a covered button is fine.
6. **Cross-review early, not as a final polish.** Your tests share your blind spots. Ask for
   another agent's eyes while the work is still cheap to change.
7. **You will not be messaged by keystrokes.** Nobody types into your pane. If you need something,
   put it in your report.
8. **Keep scratch files inside your own worktree.** Debug screenshots, scratch HTML, throwaway
   scripts — put them under your slice, not in \`/tmp\`. Reading or writing outside the working
   directory triggers a permission prompt, and a prompt stops you dead until a human notices.
   The foreman cannot answer it for you, and if nobody is at the desk you will wait all night.

## Reporting
Write to \`${ctx.reportPath}\` — what you built, what you verified and how it could have failed,
what you left undone, and anything you need from another slice. Mark items DONE or REJECTED in
place. This file is a record, not a queue.

**Commit it along with your work.** It is a tracked file, deliberately: your reasoning is worth
more than your diff to whoever picks this up, and it should survive your worktree being removed.
`
}
