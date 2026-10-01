// Task G6 (item 5) — arrangement_status === 'unavailable' is a real,
// expected terminal state for most production tracks (no .als / too short
// for structure detection), not a missing-data default. Before this fix the
// phase-7 row fell through to the default branch and showed "Grade —" (an
// N/A grade pill) instead of an honest "not assessed" message.
import { describe, expect, it } from 'vitest';

import type { FinalJson } from '../../../../api/types';
import { derivePhaseRows } from '../analysisModalData';

function finalJsonWithPhase7(data: Record<string, unknown>): FinalJson {
  return {
    phases: [{ phase: 7, status: 'ok', data }],
  } as unknown as FinalJson;
}

describe('derivePhaseRows — phase 7 (arrangement)', () => {
  it('shows a terminal "couldn’t detect structure" and no grade when unavailable', () => {
    const rows = derivePhaseRows(finalJsonWithPhase7({ arrangement_status: 'unavailable' }));
    const phase7 = rows.find((r) => r.phase === 7);
    expect(phase7?.detail).toBe('Couldn’t detect structure');
    expect(phase7?.unavailable).toBe(true);
    expect(phase7?.pending).toBeUndefined();
    expect(phase7?.kv).toEqual([]);
    expect(phase7?.detail).not.toMatch(/grade/i);
    expect(phase7?.detail).not.toContain('N/A');
    expect(phase7?.detail).not.toContain('—');
  });

  it('maps a failed background job to the same terminal state (no spinner)', () => {
    const rows = derivePhaseRows(
      finalJsonWithPhase7({ arrangement_status: 'failed', arrangement_error: 'OOM' }),
    );
    const phase7 = rows.find((r) => r.phase === 7);
    expect(phase7?.detail).toBe('Couldn’t detect structure');
    expect(phase7?.unavailable).toBe(true);
    expect(phase7?.pending).toBeUndefined();
    expect(phase7?.note).toContain('OOM');
  });

  it('still shows a grade when the arrangement was actually scored', () => {
    const rows = derivePhaseRows(
      finalJsonWithPhase7({ arrangement_status: 'scored', grade: 'B+', section_count: 6 }),
    );
    const phase7 = rows.find((r) => r.phase === 7);
    expect(phase7?.detail).toBe('Grade B+ · 6 sections');
  });
});
