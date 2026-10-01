import type { EqBand } from './eq-response';

/* Hand-copied excerpts of the sample report for the landing hero. NOT an
 * import of the 40 kB generated fixture (sample-data.ts) — the landing entry
 * chunk has a CI size budget. landing.test.tsx asserts both objects still
 * match the fixture, so they can't drift from the real demo analysis. */

/** Excerpt of the sample report's sub-bass finding (loudness specialist) +
 *  the second specialist that flagged the same problem. Picked over the
 *  top-ranked finding because its fix is an EQ move the card can draw. */
export const HERO_FINDING = {
  category: 'Low end',
  severity: 'moderate',
  headline: 'Excessive sub-bass will overwhelm small speakers',
  measure: 'Sub-bass −20.0 dBFS, 24.9% of the energy sits below 30 Hz',
  alsoFlagged: 'Excessive sub-bass dominates entire frequency spectrum',
  /** The verdict's dB evidence row (value vs genre-expected range, dB). */
  evidence: [{ label: 'Sub-bass · 20–60 Hz', value: -20.0, range: [-30, -24] }],
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
  steps: ['High-pass at 35 Hz, 24 dB/oct', 'EQ bell −2 dB at 50 Hz, Q 1.2'],
  /** The same two ops as EQ bands, for the EqDevice curve + readout. */
  bands: [
    { n: 1, type: 'high_pass', freqHz: 35, slopeDb: 24 },
    { n: 2, type: 'bell', freqHz: 50, gainDb: -2, q: 1.2 },
  ],
  outcome:
    'Sub-bass tightens up. Mix translates cleanly to phone/laptop speakers without distortion. Kick remains powerful but controlled.',
};

/** The "Hear it" face: three of the sample report's suggested fixes, stacked
 *  into one Listen-rack preset. Headlines + devices are the fixture's verbatim
 *  (asserted in landing.test.tsx); `does` is a short gloss of each dsp_chain. */
export const HERO_LISTEN: {
  preset: string;
  fixes: readonly { headline: string; device: string; does: string }[];
} = {
  preset: 'Low end + air',
  fixes: [
    { headline: 'Excessive sub-bass will overwhelm small speakers', device: 'EQ Eight', does: 'HP 35 Hz · −2 dB @ 50 Hz' },
    { headline: 'Bass band overpowering mid frequencies', device: 'EQ Eight', does: '−4 dB @ 100 Hz · −3 dB @ 150 Hz' },
    { headline: 'Missing air and sparkle (6-20kHz band very low)', device: 'EQ Eight', does: 'High shelf +3 dB @ 10 kHz' },
  ],
};
