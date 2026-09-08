// Where an agent's report lives. One definition, used by everything that needs to know.
//
// This file exists because there were two: `up` wrote briefs pointing at a tracked path while
// `brief` pointed at the disposable one, so the same agent was told different things depending on
// which command briefed it — and the path that would win was whichever it read last. A constant
// duplicated across three files is not a constant.

/** The report path for an agent, relative to the repo root. Tracked by git on purpose. */
export const reportPath = id => `docs/build-report-${id}.md`

/**
 * True if this path is the given agent's own report.
 *
 * `guard` needs this because a report sits outside every sensible file-ownership slice — an agent
 * owning `src/collect/**` does not own `docs/`. Without the exemption, following the brief earns
 * a REFUSED at commit time on the one file the brief just called important, at the end of a long
 * session. Best case the agent reports the contradiction; worst case it decides the report does
 * not matter and drops it.
 *
 * It cannot be abused as a general escape hatch: the path contains the agent's own id, so `c1`
 * can only ever reach `docs/build-report-c1.md` through it.
 */
export const isOwnReport = (path, id) => path === reportPath(id)
