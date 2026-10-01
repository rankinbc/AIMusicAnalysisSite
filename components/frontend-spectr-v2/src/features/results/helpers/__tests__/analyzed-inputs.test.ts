import { describe, expect, it } from 'vitest';

import type { FinalJson } from '../../../../api/types';
import { analyzedInputs } from '../analyzed-inputs';

// Shape of a mix-only analysis as the pipeline really writes it: phase 4 always
// carries a (possibly empty) `stems` object, phase 5 is "skipped" without a
// reference, phase 6's `gaps` is the GENRE comparison every analysis has, and
// phase 8 is present-but-skipped without an .als.
const mixOnly = {
  phases: [
    { phase: 4, status: 'ok', data: { stems: {}, clashes: [], band_energy: {} } },
    { phase: 5, status: 'ok', data: { status: 'skipped', deltas: {} } },
    { phase: 6, status: 'ok', data: { gaps: { lufs: 1 }, genre: 'trance' } },
    { phase: 8, status: 'skipped', data: {} },
  ],
} as unknown as FinalJson;

describe('analyzedInputs', () => {
  it('a mix-only analysis ticks only the mix', () => {
    expect(analyzedInputs([], mixOnly)).toEqual({ mix: true, stems: false, als: false, reference: false });
  });

  it('uploaded files tick their own input', () => {
    const files = [{ type: 'mix' }, { type: 'stem' }, { type: 'als' }, { type: 'reference' }];
    expect(analyzedInputs(files, mixOnly)).toEqual({ mix: true, stems: true, als: true, reference: true });
  });

  it('analysis evidence ticks an input when the files list is unavailable', () => {
    const full = {
      phases: [
        { phase: 4, status: 'ok', data: { stems: { status: 'ok', roles: {} } } },
        { phase: 5, status: 'ok', data: { status: 'ok', deltas: { lufs: {} } } },
        { phase: 8, status: 'ok', data: { tracks: [] } },
      ],
    } as unknown as FinalJson;
    expect(analyzedInputs([], full)).toEqual({ mix: true, stems: true, als: true, reference: true });
  });

  it('a missing final_json never invents inputs', () => {
    expect(analyzedInputs([], undefined)).toEqual({ mix: true, stems: false, als: false, reference: false });
  });
});
