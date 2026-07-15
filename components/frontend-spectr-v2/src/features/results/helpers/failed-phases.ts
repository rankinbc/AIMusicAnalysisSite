import type { FinalJson, PhaseResult } from '../../../api/types';

/** Story 5.7 (FR6): degraded state is DERIVED from final_json.phases[] —
 *  no server rollup, so every historical analysis row qualifies. */
export function failedPhases(fj: FinalJson): PhaseResult[] {
  return (fj.phases ?? []).filter((p) => p.status === 'failed');
}
