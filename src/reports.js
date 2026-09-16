// Where an agent's report lives. One definition, used by everything that needs to know.
//
// This file exists because there were two: `up` wrote briefs pointing at a tracked path while
// `brief` pointed at the disposable one, so the same agent was told different things depending on
// which command briefed it — and the path that would win was whichever it read last. A constant
// duplicated across three files is not a constant.

/**
 * The report path for an agent, relative to the repo root. Tracked by git on purpose.
 *
 * Takes the agent, not the id, because a slice may declare `Report:` in the plan. Deriving it
 * from the id alone gave two sources of truth: `rig brief` promised one path in its boilerplate
 * while the plan's own task text named another, and `rig guard` — enforcing the derived one —
 * refused the agent for writing the file the contract asked for.
 */
export const reportPath = (agent) =>
  (typeof agent === 'string' ? null : agent?.report) || `docs/build-report-${typeof agent === 'string' ? agent : agent?.id}.md`

/**
 * True if this path is the given agent's own report.
 *
 * `guard` needs this because a report sits outside every sensible file-ownership slice — an agent
 * owning `src/collect/**` does not own `docs/`. Without the exemption, following the brief earns
 * a REFUSED at commit time on the one file the brief just called important, at the end of a long
 * session. Best case the agent reports the contradiction; worst case it decides the report does
 * not matter and drops it.
 *
 * It cannot be abused as a general escape hatch: it resolves to exactly one path per agent,
 * declared in the plan or derived from the id, and the plan refuses two agents sharing one.
 */
export const isOwnReport = (path, agent) => path === reportPath(agent)

/** Every report path this plan declares — used to recognise one being deleted. */
export const allReportPaths = (plan) => plan.agents.map(reportPath)
