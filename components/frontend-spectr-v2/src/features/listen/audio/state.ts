// state.ts — single source of truth for effect param types + neutral defaults.
import type { EffectId } from './EffectUnit';

export type BiquadType =
  | 'peaking'
  | 'lowshelf'
  | 'highshelf'
  | 'lowpass'
  | 'highpass'
  | 'bandpass'
  | 'notch'
  | 'allpass';

export type SatCurve = 'tanh' | 'softclip' | 'hardclip' | 'arctan' | 'sinefold' | 'tube';

export interface EqBand {
  type: BiquadType;
  freq: number;
  gainDb: number;
  q: number;
  enabled: boolean;
}

export interface CompressorState {
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  kneeDb: number;
  makeupDb: number;
  mix: number; // 0..1 parallel (NY) dry/wet; 1 = full compressed
  enabled: boolean;
}

export interface SaturationState {
  drive: number; // 0..1
  mix: number; // 0..1 dry->wet
  curve: SatCurve;
  oversample: OverSampleType; // 'none' | '2x' | '4x'
  asymmetry: number; // -1..1, even-harmonic bias
  tone: number; // -1..1 tilt
  outputTrimDb: number; // -24..+12
  enabled: boolean;
}

export interface WidthState {
  width: number; // 0..2 (1 = identity, 0 = mono, 2 = exaggerated)
  midGainDb: number; // -12..+12
  sideGainDb: number; // -12..+12
  monoMakerHz: number; // 0..400, 0 = off
  mono: boolean; // force width -> 0
  enabled: boolean;
}

export interface EqState {
  bands: EqBand[];
  enabled: boolean;
}

const EQ_FREQS = [60, 170, 350, 700, 1400, 3500, 7000, 14000];

export const EQ_BANDS_DEFAULT: ReadonlyArray<EqBand> = EQ_FREQS.map(
  (freq): EqBand => ({ type: 'peaking', freq, gainDb: 0, q: 1.4, enabled: true }),
);

export const COMPRESSOR_DEFAULT: CompressorState = {
  thresholdDb: 0,
  ratio: 1,
  attackMs: 3,
  releaseMs: 250,
  kneeDb: 30,
  makeupDb: 0,
  mix: 1,
  enabled: false,
};

export const SATURATION_DEFAULT: SaturationState = {
  drive: 0,
  mix: 0,
  curve: 'tanh',
  oversample: '2x',
  asymmetry: 0,
  tone: 0,
  outputTrimDb: 0,
  enabled: false,
};

export const WIDTH_DEFAULT: WidthState = {
  width: 1,
  midGainDb: 0,
  sideGainDb: 0,
  monoMakerHz: 0,
  mono: false,
  enabled: false,
};

export type Division = '1/4' | '1/8' | '1/8.' | '1/8T' | '1/16';
export type IrType = 'room' | 'hall' | 'plate' | 'spring' | 'ambience';

export interface DjFilterState {
  morph: number; // -1..1, 0 = open
  resonance: number; // 0.1..20
  wobbleRateHz: number; // 0.1..16 — LFO on the sweep cutoff
  wobbleDepth: number; // 0..1 (1 = ±2 octaves); 0 = wobble off
  wobbleShape: string; // 'sine' | 'triangle' | 'square'
  killLow: boolean; // isolator kills (DJ-mixer EQ kills)
  killMid: boolean;
  killHigh: boolean;
  enabled: boolean;
}

export interface DelayState {
  sync: boolean;
  division: Division;
  timeMs: number; // 1..2000
  feedback: number; // 0..0.95
  toneHz: number; // 200..18000
  pingPong: boolean;
  mix: number; // 0..1
  bpm: number; // 40..240
  enabled: boolean;
}

export interface ReverbState {
  ir: IrType;
  decaySec: number; // 0.2..8
  preDelayMs: number; // 0..200
  dampingHz: number; // 1000..18000
  mix: number; // 0..1
  enabled: boolean;
}

export interface PanState {
  pan: number; // -1..1
  enabled: boolean;
}

export interface TremoloState {
  mode: 'tremolo' | 'autopan';
  sync: boolean;
  division: Division;
  rateHz: number; // 0.1..20
  depth: number; // 0..1
  shape: 'sine' | 'triangle' | 'square';
  bpm: number; // 40..240
  enabled: boolean;
}

export interface TrimState {
  gainDb: number; // -24..+12
  enabled: boolean;
}

export const DJFILTER_DEFAULT: DjFilterState = {
  morph: 0, resonance: 0.7,
  wobbleRateHz: 2, wobbleDepth: 0, wobbleShape: 'sine',
  killLow: false, killMid: false, killHigh: false,
  enabled: false,
};

export const DELAY_DEFAULT: DelayState = {
  sync: true,
  division: '1/8',
  timeMs: 250,
  feedback: 0.35,
  toneHz: 8000,
  pingPong: false,
  mix: 0,
  bpm: 120,
  enabled: false,
};

export const REVERB_DEFAULT: ReverbState = {
  ir: 'hall',
  decaySec: 2.0,
  preDelayMs: 20,
  dampingHz: 8000,
  mix: 0,
  enabled: false,
};

export const PAN_DEFAULT: PanState = { pan: 0, enabled: false };

export const TREMOLO_DEFAULT: TremoloState = {
  mode: 'tremolo',
  sync: true,
  division: '1/8',
  rateHz: 5,
  depth: 0.5,
  shape: 'sine',
  bpm: 120,
  enabled: false,
};

export const TRIM_DEFAULT: TrimState = { gainDb: 0, enabled: true };

export interface GateState {
  thresholdDb: number; // -80..0
  attackMs: number; // 0..50
  holdMs: number; // 0..500
  releaseMs: number; // 0..1000
  floorDb: number; // -80..0
  enabled: boolean;
}

export interface BitcrusherState {
  bitDepth: number; // 1..16
  downsample: number; // 1..50
  mix: number; // 0..1
  enabled: boolean;
}

export interface LimiterState {
  ceilingDb: number; // -12..0
  releaseMs: number; // 1..500
  lookaheadMs: number; // 0..10
  enabled: boolean;
}

export const GATE_DEFAULT: GateState = {
  thresholdDb: -40,
  attackMs: 1,
  holdMs: 10,
  releaseMs: 100,
  floorDb: -80,
  enabled: false,
};

export const BITCRUSHER_DEFAULT: BitcrusherState = {
  bitDepth: 16,
  downsample: 1,
  mix: 0,
  enabled: false,
};

export const LIMITER_DEFAULT: LimiterState = {
  ceilingDb: -1.0,
  releaseMs: 50,
  lookaheadMs: 5,
  enabled: false,
};

// Phase-5 default insert order: 13-unit chain with worklets in their
// master-design slots (gate after eq, bitcrusher after sat, limiter before trim).
export const DEFAULT_ORDER: ReadonlyArray<EffectId> = [
  'djfilter',
  'eq',
  'gate',
  'comp',
  'sat',
  'bitcrusher',
  'ms',
  'pan',
  'tremolo',
  'delay',
  'reverb',
  'limiter',
  'trim',
];

export function defaultEqState(): EqState {
  return { bands: EQ_BANDS_DEFAULT.map((b) => ({ ...b })), enabled: false };
}
export function defaultCompState(): CompressorState {
  return { ...COMPRESSOR_DEFAULT };
}
export function defaultSatState(): SaturationState {
  return { ...SATURATION_DEFAULT };
}
export function defaultWidthState(): WidthState {
  return { ...WIDTH_DEFAULT };
}
