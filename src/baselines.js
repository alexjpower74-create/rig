// Contract stub for Rig 5.5 (owned by r55u; see PLAN.md "Contract between slices").

/**
 * Snapshot baselines whose RECORDED_FROM sha the base has moved past.
 * @returns {{ file: string, recordedFrom: string, behind: number }[]}
 */
export function staleBaselines(_root, { base: _base = 'origin/main' } = {}) {
  return []
}
