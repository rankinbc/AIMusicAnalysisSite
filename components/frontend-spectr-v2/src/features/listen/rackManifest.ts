// rackManifest.ts — UI-DESIGN HANDOFF ARTIFACT (prep, not wired into the engine).
//
// A machine-readable description of every Listen-page rack module + parameter:
// label, control kind, range, step, unit, default, enum options, tier, metering.
// The UI maps over this to render controls instead of reverse-engineering state.ts.
//
// SOURCE OF TRUTH: ranges come from `audio/state.ts` (the comments there), defaults
// are imported from the `*_DEFAULT` consts (so they can never drift). If you change
// a default in state.ts, this file follows automatically; if you change a RANGE in
// state.ts, update the matching min/max here.
//
// HOW TO DRIVE EACH MODULE (the engine contract — see useAudioGraph.ts):
//   graph.setEffectParams(id, patch)   // generic, type-safe, for ALL 13 ids
//   graph.reorder(order) / graph.getOrder()
//   graph.readEffectMeter(id)          // comp | gate | limiter return live data
//   graph.setMasterBypass(b) / graph.resetAll()
// EXCEPTIONS:
//   - 'eq' takes a full band array: setEffectParams('eq', { enabled, bands }) where
//     bands is EqBand[] (each band: type/freq/gainDb/q/enabled). It has a real unit
//     bypass like the other modules (enabled:false → bypassed). It defaults enabled
//     with flat bands (transparent). Own the band array in the UI; see EQ_BAND_PARAMS.
//   - 'pitch' is NOT an insert effect (not in EffectId / not reorderable). Drive it
//     via the pitch handle methods (enterPitchMode/setPitchDetune/...). It is listed
//     here only so the UI can lay out a pitch panel.
//   - setCompressor/setSaturation/setWidth are exact aliases of setEffectParams —
//     prefer setEffectParams everywhere.

import type { EffectId } from './audio/EffectUnit';
import {
  COMPRESSOR_DEFAULT,
  SATURATION_DEFAULT,
  WIDTH_DEFAULT,
  DJFILTER_DEFAULT,
  DELAY_DEFAULT,
  REVERB_DEFAULT,
  PAN_DEFAULT,
  TREMOLO_DEFAULT,
  TRIM_DEFAULT,
  GATE_DEFAULT,
  BITCRUSHER_DEFAULT,
  LIMITER_DEFAULT,
} from './audio/state';

export type ControlKind =
  | 'knob' // continuous bounded
  | 'knobBipolar' // centered at 0 with a detent
  | 'slider'
  | 'toggle'
  | 'select'
  | 'segmented'
  | 'meter';

export type ParamUnit =
  | 'dB'
  | 'dBTP'
  | 'Hz'
  | 'ms'
  | 's'
  | 'percent' // a 0..1 value the UI shows as 0..100 %
  | 'ratio'
  | 'x'
  | 'st'
  | 'cents'
  | 'division'
  | 'bits'
  | 'none';

// mastering = useful on a full mixed song (primary rack); creative = per-element
// effect, less useful on a whole mix (tuck behind a disclosure); transport = pitch.
export type RackTier = 'mastering' | 'creative' | 'transport';

export interface ParamDescriptor {
  /** state field name = the key you put in the setEffectParams patch */
  key: string;
  label: string;
  control: ControlKind;
  min?: number;
  max?: number;
  step?: number;
  unit?: ParamUnit;
  /** enum options for select/segmented (values match the state union exactly) */
  options?: readonly string[];
  default: number | string | boolean;
  hint?: string;
}

export interface ModuleDescriptor {
  id: EffectId | 'pitch';
  label: string;
  tier: RackTier;
  /** exposes a dry/wet `mix` blend */
  hasMix: boolean;
  /** emits live data via graph.readEffectMeter(id) */
  hasMeter: boolean;
  /** runs on an AudioWorklet — has a brief post-load init before usable */
  worklet?: boolean;
  summary: string;
  params: readonly ParamDescriptor[];
}

const DIVISIONS = ['1/4', '1/8', '1/8.', '1/8T', '1/16'] as const;

// One EqBand descriptor set, applied per band ×8. Drive via
// setEffectParams('eq', { bands: EqBand[] }). Default freqs: 60/170/350/700/1400/3500/7000/14000.
export const EQ_BAND_PARAMS: readonly ParamDescriptor[] = [
  {
    key: 'type',
    label: 'Type',
    control: 'select',
    options: ['peaking', 'lowshelf', 'highshelf', 'lowpass', 'highpass', 'bandpass', 'notch', 'allpass'],
    default: 'peaking',
  },
  { key: 'freq', label: 'Frequency', control: 'knob', min: 20, max: 20000, unit: 'Hz', default: 1000, hint: 'log scale; per-band default differs' },
  { key: 'gainDb', label: 'Gain', control: 'knob', min: -24, max: 24, step: 0.1, unit: 'dB', default: 0 },
  { key: 'q', label: 'Q', control: 'knob', min: 0.1, max: 18, step: 0.1, unit: 'none', default: 1.4 },
  { key: 'enabled', label: 'Band on', control: 'toggle', default: true },
];

export const RACK_MANIFEST: readonly ModuleDescriptor[] = [
  {
    id: 'djfilter',
    label: 'DJ Filter',
    tier: 'creative',
    hasMix: false,
    hasMeter: false,
    summary: 'Single bipolar sweep knob: left = lowpass down, right = highpass up, center = open.',
    params: [
      { key: 'morph', label: 'Morph', control: 'knobBipolar', min: -1, max: 1, step: 0.01, unit: 'none', default: DJFILTER_DEFAULT.morph, hint: 'center = bypass/open' },
      { key: 'resonance', label: 'Resonance', control: 'knob', min: 0.1, max: 20, step: 0.1, unit: 'none', default: DJFILTER_DEFAULT.resonance },
      { key: 'enabled', label: 'On', control: 'toggle', default: DJFILTER_DEFAULT.enabled },
    ],
  },
  {
    id: 'eq',
    label: 'EQ (8-band)',
    tier: 'mastering',
    hasMix: false,
    hasMeter: false,
    summary: '8 fully-parametric bands. Drive via setEffectParams("eq",{enabled,bands}); each band is type/freq/gainDb/q/enabled. Has a unit bypass (defaults enabled, transparent via flat bands). See EQ_BAND_PARAMS.',
    params: EQ_BAND_PARAMS, // applied per band ×8
  },
  {
    id: 'gate',
    label: 'Gate',
    tier: 'creative',
    hasMix: false,
    hasMeter: true,
    worklet: true,
    summary: 'Noise gate / downward expander. Meter: { reductionDb, open }.',
    params: [
      { key: 'thresholdDb', label: 'Threshold', control: 'knob', min: -80, max: 0, step: 1, unit: 'dB', default: GATE_DEFAULT.thresholdDb },
      { key: 'attackMs', label: 'Attack', control: 'knob', min: 0, max: 50, step: 0.1, unit: 'ms', default: GATE_DEFAULT.attackMs },
      { key: 'holdMs', label: 'Hold', control: 'knob', min: 0, max: 500, step: 1, unit: 'ms', default: GATE_DEFAULT.holdMs },
      { key: 'releaseMs', label: 'Release', control: 'knob', min: 0, max: 1000, step: 1, unit: 'ms', default: GATE_DEFAULT.releaseMs },
      { key: 'floorDb', label: 'Floor', control: 'knob', min: -80, max: 0, step: 1, unit: 'dB', default: GATE_DEFAULT.floorDb, hint: 'closed-state attenuation' },
      { key: 'enabled', label: 'On', control: 'toggle', default: GATE_DEFAULT.enabled },
    ],
  },
  {
    id: 'comp',
    label: 'Compressor',
    tier: 'mastering',
    hasMix: true,
    hasMeter: true,
    summary: 'Dynamics + parallel (NY) mix + makeup. Meter: { reductionDb }.',
    params: [
      { key: 'thresholdDb', label: 'Threshold', control: 'knob', min: -60, max: 0, step: 0.5, unit: 'dB', default: COMPRESSOR_DEFAULT.thresholdDb },
      { key: 'ratio', label: 'Ratio', control: 'knob', min: 1, max: 20, step: 0.1, unit: 'ratio', default: COMPRESSOR_DEFAULT.ratio },
      { key: 'attackMs', label: 'Attack', control: 'knob', min: 0, max: 250, step: 1, unit: 'ms', default: COMPRESSOR_DEFAULT.attackMs },
      { key: 'releaseMs', label: 'Release', control: 'knob', min: 0, max: 1000, step: 1, unit: 'ms', default: COMPRESSOR_DEFAULT.releaseMs },
      { key: 'kneeDb', label: 'Knee', control: 'knob', min: 0, max: 40, step: 1, unit: 'dB', default: COMPRESSOR_DEFAULT.kneeDb },
      { key: 'makeupDb', label: 'Makeup', control: 'knob', min: -12, max: 24, step: 0.5, unit: 'dB', default: COMPRESSOR_DEFAULT.makeupDb },
      { key: 'mix', label: 'Mix', control: 'slider', min: 0, max: 1, step: 0.01, unit: 'percent', default: COMPRESSOR_DEFAULT.mix },
      { key: 'enabled', label: 'On', control: 'toggle', default: COMPRESSOR_DEFAULT.enabled },
    ],
  },
  {
    id: 'sat',
    label: 'Saturator',
    tier: 'mastering',
    hasMix: true,
    hasMeter: false,
    summary: 'Harmonic drive: 6 curves, oversample, asymmetry, tone tilt, output trim.',
    params: [
      { key: 'drive', label: 'Drive', control: 'knob', min: 0, max: 1, step: 0.01, unit: 'percent', default: SATURATION_DEFAULT.drive },
      { key: 'mix', label: 'Mix', control: 'knob', min: 0, max: 1, step: 0.01, unit: 'percent', default: SATURATION_DEFAULT.mix },
      { key: 'curve', label: 'Curve', control: 'select', options: ['tanh', 'softclip', 'hardclip', 'arctan', 'sinefold', 'tube'], default: SATURATION_DEFAULT.curve },
      { key: 'oversample', label: 'Oversample', control: 'segmented', options: ['none', '2x', '4x'], default: SATURATION_DEFAULT.oversample },
      { key: 'asymmetry', label: 'Asymmetry', control: 'knobBipolar', min: -1, max: 1, step: 0.01, unit: 'none', default: SATURATION_DEFAULT.asymmetry },
      { key: 'tone', label: 'Tone', control: 'knobBipolar', min: -1, max: 1, step: 0.01, unit: 'none', default: SATURATION_DEFAULT.tone, hint: 'tilt' },
      { key: 'outputTrimDb', label: 'Out trim', control: 'knob', min: -24, max: 12, step: 0.5, unit: 'dB', default: SATURATION_DEFAULT.outputTrimDb },
      { key: 'enabled', label: 'On', control: 'toggle', default: SATURATION_DEFAULT.enabled },
    ],
  },
  {
    id: 'bitcrusher',
    label: 'Bitcrusher',
    tier: 'creative',
    hasMix: true,
    hasMeter: false,
    worklet: true,
    summary: 'Bit-depth quantization + sample-rate decimation. mix is the dry/wet.',
    params: [
      { key: 'bitDepth', label: 'Bit depth', control: 'knob', min: 1, max: 16, step: 1, unit: 'bits', default: BITCRUSHER_DEFAULT.bitDepth },
      { key: 'downsample', label: 'Downsample', control: 'knob', min: 1, max: 50, step: 1, unit: 'x', default: BITCRUSHER_DEFAULT.downsample },
      { key: 'mix', label: 'Mix', control: 'slider', min: 0, max: 1, step: 0.01, unit: 'percent', default: BITCRUSHER_DEFAULT.mix },
      { key: 'enabled', label: 'On', control: 'toggle', default: BITCRUSHER_DEFAULT.enabled },
    ],
  },
  {
    id: 'ms',
    label: 'M/S Width',
    tier: 'mastering',
    hasMix: false,
    hasMeter: false,
    summary: 'Mid/side width + independent M/S gains + bass mono-maker. Pairs with a goniometer.',
    params: [
      { key: 'width', label: 'Width', control: 'knob', min: 0, max: 2, step: 0.01, unit: 'x', default: WIDTH_DEFAULT.width, hint: '1 = identity, 0 = mono, 2 = wide' },
      { key: 'midGainDb', label: 'Mid gain', control: 'knob', min: -12, max: 12, step: 0.5, unit: 'dB', default: WIDTH_DEFAULT.midGainDb },
      { key: 'sideGainDb', label: 'Side gain', control: 'knob', min: -12, max: 12, step: 0.5, unit: 'dB', default: WIDTH_DEFAULT.sideGainDb },
      { key: 'monoMakerHz', label: 'Mono-maker', control: 'knob', min: 0, max: 400, step: 5, unit: 'Hz', default: WIDTH_DEFAULT.monoMakerHz, hint: '0 = off' },
      { key: 'mono', label: 'Mono', control: 'toggle', default: WIDTH_DEFAULT.mono },
      { key: 'enabled', label: 'On', control: 'toggle', default: WIDTH_DEFAULT.enabled },
    ],
  },
  {
    id: 'pan',
    label: 'Stereo Pan',
    tier: 'creative',
    hasMix: false,
    hasMeter: false,
    summary: 'Stereo balance. Rarely useful on a finished stereo mix; more for stems.',
    params: [
      { key: 'pan', label: 'Pan', control: 'knobBipolar', min: -1, max: 1, step: 0.01, unit: 'none', default: PAN_DEFAULT.pan, hint: 'L ← center → R' },
      { key: 'enabled', label: 'On', control: 'toggle', default: PAN_DEFAULT.enabled },
    ],
  },
  {
    id: 'tremolo',
    label: 'Tremolo / Auto-pan',
    tier: 'creative',
    hasMix: false,
    hasMeter: false,
    summary: 'LFO modulates amplitude (tremolo) or pan (auto-pan). BPM-syncable.',
    params: [
      { key: 'mode', label: 'Mode', control: 'segmented', options: ['tremolo', 'autopan'], default: TREMOLO_DEFAULT.mode },
      { key: 'sync', label: 'Sync', control: 'toggle', default: TREMOLO_DEFAULT.sync, hint: 'to BPM' },
      { key: 'division', label: 'Division', control: 'select', options: DIVISIONS, default: TREMOLO_DEFAULT.division },
      { key: 'rateHz', label: 'Rate', control: 'knob', min: 0.1, max: 20, step: 0.1, unit: 'Hz', default: TREMOLO_DEFAULT.rateHz, hint: 'used when sync is off' },
      { key: 'depth', label: 'Depth', control: 'knob', min: 0, max: 1, step: 0.01, unit: 'percent', default: TREMOLO_DEFAULT.depth },
      { key: 'shape', label: 'Shape', control: 'select', options: ['sine', 'triangle', 'square'], default: TREMOLO_DEFAULT.shape },
      { key: 'enabled', label: 'On', control: 'toggle', default: TREMOLO_DEFAULT.enabled },
    ],
  },
  {
    id: 'delay',
    label: 'Delay / Echo',
    tier: 'creative',
    hasMix: true,
    hasMeter: false,
    summary: 'BPM-synced echo + feedback tone filter + ping-pong.',
    params: [
      { key: 'sync', label: 'Sync', control: 'toggle', default: DELAY_DEFAULT.sync, hint: 'to BPM' },
      { key: 'division', label: 'Division', control: 'select', options: DIVISIONS, default: DELAY_DEFAULT.division },
      { key: 'timeMs', label: 'Time', control: 'knob', min: 1, max: 2000, step: 1, unit: 'ms', default: DELAY_DEFAULT.timeMs, hint: 'used when sync is off' },
      { key: 'feedback', label: 'Feedback', control: 'knob', min: 0, max: 0.95, step: 0.01, unit: 'percent', default: DELAY_DEFAULT.feedback },
      { key: 'toneHz', label: 'Tone', control: 'knob', min: 200, max: 18000, unit: 'Hz', default: DELAY_DEFAULT.toneHz, hint: 'feedback-loop lowpass' },
      { key: 'pingPong', label: 'Ping-pong', control: 'toggle', default: DELAY_DEFAULT.pingPong },
      { key: 'mix', label: 'Mix', control: 'slider', min: 0, max: 1, step: 0.01, unit: 'percent', default: DELAY_DEFAULT.mix },
      { key: 'bpm', label: 'BPM', control: 'knob', min: 40, max: 240, step: 1, unit: 'none', default: DELAY_DEFAULT.bpm, hint: 'usually set from track analysis, not a user control' },
      { key: 'enabled', label: 'On', control: 'toggle', default: DELAY_DEFAULT.enabled },
    ],
  },
  {
    id: 'reverb',
    label: 'Reverb',
    tier: 'creative',
    hasMix: true,
    hasMeter: false,
    summary: 'Convolution reverb with synthesized IRs (no assets). Heaviest native node.',
    params: [
      { key: 'ir', label: 'Space', control: 'select', options: ['room', 'hall', 'plate', 'spring', 'ambience'], default: REVERB_DEFAULT.ir },
      { key: 'decaySec', label: 'Decay', control: 'knob', min: 0.2, max: 8, step: 0.1, unit: 's', default: REVERB_DEFAULT.decaySec },
      { key: 'preDelayMs', label: 'Pre-delay', control: 'knob', min: 0, max: 200, step: 1, unit: 'ms', default: REVERB_DEFAULT.preDelayMs },
      { key: 'dampingHz', label: 'Damping', control: 'knob', min: 1000, max: 18000, unit: 'Hz', default: REVERB_DEFAULT.dampingHz },
      { key: 'mix', label: 'Mix', control: 'slider', min: 0, max: 1, step: 0.01, unit: 'percent', default: REVERB_DEFAULT.mix },
      { key: 'enabled', label: 'On', control: 'toggle', default: REVERB_DEFAULT.enabled },
    ],
  },
  {
    id: 'limiter',
    label: 'Limiter',
    tier: 'mastering',
    hasMix: false,
    hasMeter: true,
    worklet: true,
    summary: 'True brickwall lookahead limiter — the "-1 dBTP" loudness preview. Meter: { reductionDb }.',
    params: [
      { key: 'ceilingDb', label: 'Ceiling', control: 'knob', min: -12, max: 0, step: 0.1, unit: 'dBTP', default: LIMITER_DEFAULT.ceilingDb },
      { key: 'releaseMs', label: 'Release', control: 'knob', min: 1, max: 500, step: 1, unit: 'ms', default: LIMITER_DEFAULT.releaseMs },
      { key: 'lookaheadMs', label: 'Lookahead', control: 'knob', min: 0, max: 10, step: 0.5, unit: 'ms', default: LIMITER_DEFAULT.lookaheadMs },
      { key: 'enabled', label: 'On', control: 'toggle', default: LIMITER_DEFAULT.enabled },
    ],
  },
  {
    id: 'trim',
    label: 'Output Trim',
    tier: 'mastering',
    hasMix: false,
    hasMeter: false,
    summary: 'Chain-level make-up gain (separate from player volume). Defaults on; reorderable.',
    params: [
      { key: 'gainDb', label: 'Gain', control: 'knob', min: -24, max: 12, step: 0.5, unit: 'dB', default: TRIM_DEFAULT.gainDb },
      { key: 'enabled', label: 'On', control: 'toggle', default: TRIM_DEFAULT.enabled },
    ],
  },
  {
    id: 'pitch',
    label: 'Pitch',
    tier: 'transport',
    hasMix: false,
    hasMeter: false,
    summary: 'Separate BufferSource lane (NOT in the insert chain). Drive via the pitch handle methods. Pitch + tempo are coupled.',
    params: [
      { key: 'semitones', label: 'Semitones', control: 'knob', min: -12, max: 12, step: 1, unit: 'st', default: 0 },
      { key: 'cents', label: 'Cents', control: 'slider', min: -50, max: 50, step: 1, unit: 'cents', default: 0 },
      { key: 'tempo', label: 'Tempo', control: 'knob', min: 0.5, max: 2, step: 0.01, unit: 'x', default: 1, hint: 'coupled with pitch' },
      { key: 'enabled', label: 'On', control: 'toggle', default: false },
    ],
  },
];

/** Modules tiered for a full-song "mastering preview" (surface prominently). */
export const MASTERING_IDS = RACK_MANIFEST.filter((m) => m.tier === 'mastering').map((m) => m.id);
/** Per-element / creative modules (tuck behind a disclosure for full-song use). */
export const CREATIVE_IDS = RACK_MANIFEST.filter((m) => m.tier === 'creative').map((m) => m.id);
