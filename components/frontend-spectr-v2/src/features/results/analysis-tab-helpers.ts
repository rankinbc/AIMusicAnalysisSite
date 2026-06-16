// Pure helpers for AnalysisTab — kept out of the .tsx so they're unit-testable
// and don't trip react-refresh/only-export-components.

/**
 * Which phase a pipeline row can re-run in place — or undefined for none.
 *
 * Re-run on demand for Stem clash (4) and Reference (5); Retry on any failed
 * phase from 2 up. Phase 1 is full-re-analyze only (everything depends on it),
 * so it's never individually re-runnable. Phase 8 (ALS) is handled by its own
 * row in derivePipeline, not here.
 */
export function rerunPhaseFor(phase: number, status: string): number | undefined {
  if (phase < 2) return undefined;
  if (phase === 4 || phase === 5 || status === 'failed') return phase;
  return undefined;
}
