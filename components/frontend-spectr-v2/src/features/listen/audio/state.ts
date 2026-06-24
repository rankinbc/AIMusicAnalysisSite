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

// Phase-1 default insert order. Matches the legacy chain EQ -> Comp -> Sat -> M/S.
export const DEFAULT_ORDER: ReadonlyArray<EffectId> = ['eq', 'comp', 'sat', 'ms'];

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
