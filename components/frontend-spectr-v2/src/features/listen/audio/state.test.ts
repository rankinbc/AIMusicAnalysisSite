import { describe, expect, it } from 'vitest';
import {
  COMPRESSOR_DEFAULT,
  EQ_BANDS_DEFAULT,
  SATURATION_DEFAULT,
  WIDTH_DEFAULT,
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
