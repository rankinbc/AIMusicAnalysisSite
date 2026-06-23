// state.ts — single source of truth for effect param types + neutral defaults.
import type { EffectId } from './EffectUnit';

export interface EqBand {
  freq: number;
  gainDb: number;
}

export interface CompressorState {
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  kneeDb: number;
  makeupDb: number;
  enabled: boolean;
}

export interface SaturationState {
  drive: number; // 0..1
  mix: number; // 0..1 dry->wet
  enabled: boolean;
}

export interface WidthState {
  width: number; // 0..2 (1 = identity, 0 = mono, 2 = exaggerated)
  enabled: boolean;
}

export interface EqState {
  bands: EqBand[];
  enabled: boolean;
}

export const EQ_BANDS_DEFAULT: ReadonlyArray<EqBand> = [
  { freq: 60, gainDb: 0 },
  { freq: 170, gainDb: 0 },
  { freq: 350, gainDb: 0 },
  { freq: 700, gainDb: 0 },
  { freq: 1400, gainDb: 0 },
  { freq: 3500, gainDb: 0 },
  { freq: 7000, gainDb: 0 },
  { freq: 14000, gainDb: 0 },
];

export const COMPRESSOR_DEFAULT: CompressorState = {
  thresholdDb: 0,
  ratio: 1,
  attackMs: 3,
  releaseMs: 250,
  kneeDb: 30,
  makeupDb: 0,
  enabled: false,
};

export const SATURATION_DEFAULT: SaturationState = {
  drive: 0,
  mix: 0,
  enabled: false,
};

export const WIDTH_DEFAULT: WidthState = {
  width: 1,
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
