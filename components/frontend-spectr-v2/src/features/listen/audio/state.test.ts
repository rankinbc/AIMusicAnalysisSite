import { describe, expect, it } from 'vitest';
import {
  COMPRESSOR_DEFAULT,
  EQ_BANDS_DEFAULT,
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
  DEFAULT_ORDER,
} from './state';

describe('effect defaults are identity/neutral', () => {
  it('compressor default has mix=1 (full wet) and is disabled', () => {
    expect(COMPRESSOR_DEFAULT.mix).toBe(1);
    expect(COMPRESSOR_DEFAULT.enabled).toBe(false);
  });

  it('saturator default is tanh with no asymmetry/tone/trim', () => {
    expect(SATURATION_DEFAULT.curve).toBe('tanh');
    expect(SATURATION_DEFAULT.oversample).toBe('2x');
    expect(SATURATION_DEFAULT.asymmetry).toBe(0);
    expect(SATURATION_DEFAULT.tone).toBe(0);
    expect(SATURATION_DEFAULT.outputTrimDb).toBe(0);
  });

  it('width default has unity trims and mono-maker off', () => {
    expect(WIDTH_DEFAULT.width).toBe(1);
    expect(WIDTH_DEFAULT.midGainDb).toBe(0);
    expect(WIDTH_DEFAULT.sideGainDb).toBe(0);
    expect(WIDTH_DEFAULT.monoMakerHz).toBe(0);
    expect(WIDTH_DEFAULT.mono).toBe(false);
  });

  it('every EQ band defaults to an enabled flat peaking filter at Q 1.4', () => {
    expect(EQ_BANDS_DEFAULT).toHaveLength(8);
    for (const b of EQ_BANDS_DEFAULT) {
      expect(b.type).toBe('peaking');
      expect(b.gainDb).toBe(0);
      expect(b.q).toBe(1.4);
      expect(b.enabled).toBe(true);
    }
    expect(EQ_BANDS_DEFAULT.map((b) => b.freq)).toEqual([60, 170, 350, 700, 1400, 3500, 7000, 14000]);
  });
});

describe('phase-4 module defaults are transparent', () => {
  it('djfilter/delay/reverb/pan/tremolo default disabled', () => {
    expect(DJFILTER_DEFAULT.enabled).toBe(false);
    expect(DELAY_DEFAULT.enabled).toBe(false);
    expect(REVERB_DEFAULT.enabled).toBe(false);
    expect(PAN_DEFAULT.enabled).toBe(false);
    expect(TREMOLO_DEFAULT.enabled).toBe(false);
  });

  it('trim defaults enabled at unity (0 dB)', () => {
    expect(TRIM_DEFAULT.enabled).toBe(true);
    expect(TRIM_DEFAULT.gainDb).toBe(0);
  });

  it('identity numeric defaults (mix/pan/morph all neutral)', () => {
    expect(DJFILTER_DEFAULT.morph).toBe(0);
    expect(PAN_DEFAULT.pan).toBe(0);
    expect(DELAY_DEFAULT.mix).toBe(0);
    expect(REVERB_DEFAULT.mix).toBe(0);
  });
});

describe('phase-5 worklet defaults are transparent', () => {
  it('gate/bitcrusher/limiter default disabled', () => {
    expect(GATE_DEFAULT.enabled).toBe(false);
    expect(BITCRUSHER_DEFAULT.enabled).toBe(false);
    expect(LIMITER_DEFAULT.enabled).toBe(false);
  });

  it('identity-ish numeric defaults (bitcrusher transparent, limiter at -1 dBTP)', () => {
    expect(BITCRUSHER_DEFAULT.mix).toBe(0);
    expect(BITCRUSHER_DEFAULT.bitDepth).toBe(16);
    expect(BITCRUSHER_DEFAULT.downsample).toBe(1);
    expect(LIMITER_DEFAULT.ceilingDb).toBe(-1.0);
  });
});

describe('DEFAULT_ORDER (phase 5)', () => {
  it('is the 13-unit chain with worklets in their master-design slots', () => {
    expect(DEFAULT_ORDER).toEqual([
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
    ]);
  });
});
