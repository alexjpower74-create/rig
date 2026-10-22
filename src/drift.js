// Contract stub for Rig 5.5 (owned by r55u; see PLAN.md "Contract between slices"). The signature and
// the shape of what it returns are the contract; the body is r55u's to write.

/**
 * What the live base did since this branch was cut: fetch (unless `fetch: false`), then compare.
 *
 * @param {string} root  the main checkout
 * @param {{ base?: string, remote?: string, head?: string, slices?: {id: string, owns: string[]}[], fetch?: boolean }} opts
 * @returns {{
 *   base: string,            // e.g. 'origin/main' (the live base that was compared)
 *   head: string,            // the ref whose stack is checked (default HEAD)
 *   moved: boolean,          // true when the live base has commits the head does not
 *   since: {sha: string, subject: string}[],   // those commits, newest first
 *   touched: {file: string, slices: string[]}[], // files those commits changed that a slice owns (or the head changed)
 *   safe: string[],          // owned files those commits did not touch
 *   merges: boolean | null,  // git merge-tree --write-tree verdict; null when it could not be computed
 *   conflicts: string[],     // files merge-tree reports as conflicting
 *   error: string | null,    // why the check could not run (no remote, fetch failed), never thrown
 * }}
 */
export function drift(_root, { base = 'origin/main', head = 'HEAD' } = {}) {
  return { base, head, moved: false, since: [], touched: [], safe: [], merges: null, conflicts: [], error: 'drift: not built yet' }
}
