// The demo track's real final fix, shown in "Take it back to your DAW".
//
// Hand-copied (not imported — the export is large and not in the repo) from
// the Coach Mix preset of the production demo analysis: snapshot
// ~/.spectr/mf-snapshot.json, exported 2026-10-01T04:02Z, rackPresets[0]
// (the demo's "Fix rack"), chain.order + chain.modules. Only the ENABLED,
// non-neutral modules are listed, in the rack's signal order (eq … limiter,
// trim): the seven other EQ bands sit disabled at 0 dB. coachMeta.change_log
// says why each module is there; coachMeta.arbiter_notes holds the one move the
// Coach Mix considered and dropped (bus compression).
//
// Device names: EQ Eight is the device the demo's rumble fix names
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

/** Rack EQ band 1: highpass @ 30 Hz, Q 0.7. The rack's EQ bands are single
 *  biquads, so the slope is a fixed 12 dB/oct (the change log notes the
 *  solver's 24 dB/oct "slope_db not applied"). */
export const DEMO_EQ_BANDS: readonly EqBand[] = [{ n: 1, type: 'high_pass', freqHz: 30, slopeDb: 12 }];

export const DEMO_CHAIN: readonly ChainDevice[] = [
  {
    id: 'eq',
    module: 'EQ',
    daw: 'EQ Eight',
    params: [
      { label: 'Q', value: '0.70' },
    ],
    why: 'Clears the sub-30 Hz rumble that was wasting headroom.',
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
    why: 'A release-ready ceiling, so peaks never touch 0 dB.',
  },
  {
    id: 'trim',
    module: 'Output Trim',
    daw: 'Utility',
    params: [{ label: 'Gain', value: '−1.76 dB' }],
    why: 'Loudness trim: the track measured −12.2 LUFS; −1.76 dB lands it at −14 LUFS.',
  },
];

/** The move the Coach Mix weighed and left out (coachMeta.arbiter_notes). */
export const DEMO_DROPPED = {
  device: 'Glue Compressor',
  rationale:
    'Considered and left out: the mix is already cohesive at −12.2 LUFS with a healthy 10.4 dB crest factor, so bus compression would reduce punch unnecessarily.',
} as const;

// Raw values pinned by the tests against sample-data.ts where they overlap.
export const DEMO_CHAIN_RAW = {
  highPassHz: 30,
  limiterCeilingDb: -1.0,
  trimDb: -1.76,
  measuredLufs: -12.2,
  crestFactorDb: 10.4,
} as const;
