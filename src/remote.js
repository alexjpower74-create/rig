// Contract stub for Rig 5.5 (owned by r55m; see PLAN.md "Contract between slices").

/**
 * Run `cmd` on a second machine at exactly `sha`, without pushing anything: the commit travels from
 * the lead's tree over SSH, into a per-session checkout on the host, with its own test DB name.
 *
 * @param {{ root: string, host: string, sha: string, cmd: string, session: string, env?: object,
 *           limitMs?: number, onOutput?: (chunk: string) => void }} opts
 * @returns {Promise<{ host: string, exit: number, ms: number, dir: string, db: string, log: string }>}
 *   exit follows rig qa's rules (124 timeout, 128+n signal, 255 ssh failure); log is the full output.
 */
export async function runOnHost(_opts) {
  throw new Error('runOnHost: not built yet')
}
