// Contract stub for Rig 5.5 (owned by r55m; see PLAN.md "Contract between slices").

/** Append one stage's wall time to .rig/timings.jsonl (through rigDir). stage: 'qa:test', 'qa:negative', 'qa:ci', 'qa:host', 'fold', 'review', … */
export function recordTiming(_root, { stage: _stage, ms: _ms, sha: _sha = null, host: _host = 'local', ok: _ok = true } = {}) {}

/** Every recorded timing, oldest first. */
export function readTimings(_root) {
  return []
}

/**
 * The estimate `rig status --eta` prints: the median of past runs per stage.
 * @returns {{ stages: {stage: string, medianMs: number|null, n: number}[], totalMs: number|null, note: string|null }}
 *   totalMs is null, and note says so, when a stage has no data.
 */
export function estimate(_root, stages = []) {
  return { stages: stages.map((stage) => ({ stage, medianMs: null, n: 0 })), totalMs: null, note: 'no timings recorded yet' }
}
