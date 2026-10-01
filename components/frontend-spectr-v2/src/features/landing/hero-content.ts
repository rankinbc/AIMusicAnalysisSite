import type { EqBand } from './eq-response';

/* Hand-copied excerpts of the sample report for the landing hero. NOT an
 * import of the 40 kB generated fixture (sample-data.ts) — the landing entry
 * chunk has a CI size budget. landing.test.tsx asserts both objects still
 * match the fixture, so they can't drift from the real demo analysis. */

/** Excerpt of SAMPLE_FINDINGS[0] (verdict `sample-03`) + its corroboration. */
export const HERO_FINDING = {
  category: 'Low end',
  severity: 'moderate',
  headline: 'Excessive sub-bass energy overwhelming the mix',
  measure: 'Sub-bass −18.3 dBFS, 12 dB above the bass band',
  alsoFlagged: 'Inverted low-end balance — sub louder than bass fundamental',
  /** The verdict's first two evidence rows (value vs genre-expected range, dB). */
  evidence: [
    { label: 'Sub-bass · 20–60 Hz', value: -18.3, range: [-30, -24] },
    { label: 'Bass · 60–250 Hz', value: -30.0, range: [-24, -18] },
  ],
} as const;

/** The same verdict's suggested fix: its dsp_chain as describeOp() prints
 *  it, the Ableton device hint, and the expected outcome — verbatim. */
export const HERO_FIX: {
  target: string;
  device: string;
  steps: readonly string[];
  bands: readonly EqBand[];
  outcome: string;
} = {
  target: 'Master',
  device: 'EQ Eight',
  steps: ['High-pass at 30 Hz, 24 dB/oct', 'EQ bell −3 dB at 40 Hz, Q 1'],
  /** The same two ops as EQ bands, for the EqDevice curve + readout. */
  bands: [
    { n: 1, type: 'high_pass', freqHz: 30, slopeDb: 24 },
    { n: 2, type: 'bell', freqHz: 40, gainDb: -3, q: 1 },
  ],
  outcome:
    'Sub-bass becomes felt rather than dominating, mix gains 3-4 dB headroom, low end translates to small speakers.',
};

/** The "Hear it" face: three of the sample report's suggested fixes, stacked
 *  into one Listen-rack preset. Headlines + devices are the fixture's verbatim
 *  (asserted in landing.test.tsx); `does` is a short gloss of each dsp_chain. */
export const HERO_LISTEN: {
  preset: string;
  fixes: readonly { headline: string; device: string; does: string }[];
} = {
  preset: 'Low end + mud + width',
  fixes: [
    { headline: 'Excessive sub-bass energy overwhelming the mix', device: 'EQ Eight', does: 'HP 30 Hz · −3 dB @ 40 Hz' },
    { headline: 'Low-mid mud zone congestion (250-500Hz)', device: 'EQ Eight', does: '−3 dB @ 300 Hz · −2 dB @ 400 Hz' },
    { headline: 'Mix is too narrow — sounds flat and unprofessional', device: 'Utility', does: 'Width 130%' },
  ],
};
