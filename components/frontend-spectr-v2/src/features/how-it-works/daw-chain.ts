// The demo track's real final fix, shown in "Take it back to your DAW".
//
// Hand-copied (not imported — the export is large and not in the repo) from
// the Coach Mix preset of the production demo analysis: demo snapshot
// exported 2026-10-01T16:5xZ, rackPresets[0] (the demo's "Fix rack"),
// chain.order + chain.modules. Only the ENABLED, non-neutral modules are
// listed, in the rack's signal order (eq … limiter, trim): the seven other EQ
// bands sit disabled at 0 dB. coachMeta.change_log says why each module is
// there; coachMeta.arbiter_notes holds the one move the Coach Mix considered
// and dropped (bus compression).
//
// Device names: EQ Eight is the device the demo's EQ fixes name
// (ableton_hint); Limiter and Utility are the matching stock Ableton devices
// for the rack's Limiter and Output Trim modules.
import type { EqBand } from '../landing/eq-response';

export interface ChainParam {
  label: string;
  value: string;
}

export interface ChainDevice {
  id: 'eq' | 'limiter' | 'trim';
  /** The Listen-rack module name. */
  module: string;
  /** The device to reach for in Ableton Live. */
  daw: string;
  params: ChainParam[];
  why: string;
}

/** Rack EQ band 1: a −3.96 dB bell at 300 Hz, Q 1 — the low-mid mud cut
 *  (change_log: the merged mud_buildup fix). */
export const DEMO_EQ_BANDS: readonly EqBand[] = [{ n: 1, type: 'bell', freqHz: 300, gainDb: -3.96, q: 1 }];

export const DEMO_CHAIN: readonly ChainDevice[] = [
  {
    id: 'eq',
    module: 'EQ',
    daw: 'EQ Eight',
    params: [{ label: 'Q', value: '1.00' }],
    why: 'Carves the low-mid mud that sat 7.9 dB above the mid band.',
  },
  {
    id: 'limiter',
    module: 'Limiter',
    daw: 'Limiter',
    params: [
      { label: 'Ceiling', value: '−1.0 dB' },
      { label: 'Release', value: '100 ms' },
      { label: 'Lookahead', value: '2 ms' },
    ],
    why: 'A release-ready ceiling: the master was clipping at +0.4 dBTP.',
  },
  {
    id: 'trim',
    module: 'Output Trim',
    daw: 'Utility',
    params: [{ label: 'Gain', value: '−5.13 dB' }],
    why: 'Loudness trim: the track measured −8.9 LUFS; −5.13 dB lands it at −14 LUFS.',
  },
];

/** The move the Coach Mix weighed and left out (coachMeta.arbiter_notes). */
export const DEMO_DROPPED = {
  device: 'Glue Compressor',
  rationale:
    'Considered and left out: the mix is already hot at −8.9 LUFS with a 10.1 dB crest factor, so bus compression would only make it denser.',
} as const;

// Raw values pinned by the tests against sample-data.ts where they overlap.
export const DEMO_CHAIN_RAW = {
  eqFreqHz: 300,
  limiterCeilingDb: -1.0,
  trimDb: -5.13,
  measuredLufs: -8.9,
  crestFactorDb: 10.1,
} as const;
