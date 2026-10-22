// Contract stub for Rig 5.5 (owned by r55m; see PLAN.md "Contract between slices").

/**
 * Take a lease on a shared resource ('host:<ssh-host>' or 'db:<name>') for `by` (a session id).
 * Refused while someone else holds an unexpired lease; the same holder may renew.
 * @returns {{ ok: boolean, holder: {by: string, at: string, until: string} | null, why: string | null }}
 */
export function acquire(_root, _resource, _by, { ttlMin: _ttl = 120 } = {}) {
  return { ok: false, holder: null, why: 'lease: not built yet' }
}

/** Give a lease back; only its holder can. @returns {{ ok: boolean, why: string | null }} */
export function release(_root, _resource, _by) {
  return { ok: false, why: 'lease: not built yet' }
}

/** Who holds it now, or null. */
export function holderOf(_root, _resource) {
  return null
}
