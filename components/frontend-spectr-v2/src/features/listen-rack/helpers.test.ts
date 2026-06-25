import { describe, it, expect } from 'vitest';

import {
  cssVar,
  hslToHex,
  freqToX,
  fmtTime,
  nudgeValue,
  LASER_COLORS,
  SECTION_COLORS,
} from './helpers';

describe('hslToHex', () => {
  it('maps primary hues to pure RGB at full sat / mid lightness', () => {
    expect(hslToHex(0, 100, 50)).toBe('#ff0000');
    expect(hslToHex(120, 100, 50)).toBe('#00ff00');
    expect(hslToHex(240, 100, 50)).toBe('#0000ff');
  });

  it('always returns a 7-char #rrggbb string', () => {
    for (const h of [0, 45, 90, 195, 270, 359]) {
      expect(hslToHex(h)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('defaults (s=80,l=60) desaturate away from pure primaries', () => {
    expect(hslToHex(0)).not.toBe('#ff0000');
    expect(hslToHex(0)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('freqToX', () => {
  it('pins the 20 Hz – 20 kHz log axis to [0, 1]', () => {
    expect(freqToX(20)).toBeCloseTo(0, 6);
    expect(freqToX(20000)).toBeCloseTo(1, 6);
  });

  it('is monotonically increasing across the band', () => {
    const xs = [20, 100, 1000, 5000, 20000].map(freqToX);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1]!);
    }
  });

  it('places the geometric midpoint (~632 Hz) near x=0.5', () => {
    expect(freqToX(Math.sqrt(20 * 20000))).toBeCloseTo(0.5, 6);
  });
});

describe('fmtTime', () => {
  it('formats seconds as m:ss with zero-padding', () => {
    expect(fmtTime(0)).toBe('0:00');
    expect(fmtTime(5)).toBe('0:05');
    expect(fmtTime(64)).toBe('1:04');
    expect(fmtTime(125)).toBe('2:05');
    expect(fmtTime(600)).toBe('10:00');
  });

  it('truncates fractional seconds (floor, not round)', () => {
    expect(fmtTime(59.9)).toBe('0:59');
  });
});

describe('cssVar', () => {
  it('passes through a literal color untouched (no DOM read)', () => {
    expect(cssVar('#00e5b0')).toBe('#00e5b0');
    expect(cssVar('rgba(0,0,0,0.5)')).toBe('rgba(0,0,0,0.5)');
  });
});

describe('nudgeValue (keyboard operability for drag controls)', () => {
  const range = { min: 0, max: 10, step: 1 };

  it('arrows step by `step` in both directions', () => {
    expect(nudgeValue('ArrowUp', 5, range)).toBe(6);
    expect(nudgeValue('ArrowRight', 5, range)).toBe(6);
    expect(nudgeValue('ArrowDown', 5, range)).toBe(4);
    expect(nudgeValue('ArrowLeft', 5, range)).toBe(4);
  });

  it('Page keys take a ~10% coarse step', () => {
    expect(nudgeValue('PageUp', 0, range)).toBe(1);     // (max-min)/10 = 1
    expect(nudgeValue('PageDown', 10, range)).toBe(9);
  });

  it('Home/End jump to the rails', () => {
    expect(nudgeValue('Home', 7, range)).toBe(0);
    expect(nudgeValue('End', 2, range)).toBe(10);
  });

  it('clamps at the rails — never past min/max', () => {
    expect(nudgeValue('ArrowDown', 0, range)).toBe(0);
    expect(nudgeValue('ArrowUp', 10, range)).toBe(10);
  });

  it('returns null for keys that are not value adjustments (lets them bubble)', () => {
    expect(nudgeValue('Tab', 5, range)).toBeNull();
    expect(nudgeValue('Enter', 5, range)).toBeNull();
    expect(nudgeValue('a', 5, range)).toBeNull();
  });

  it('falls back to a 1% sweep when no step is given', () => {
    expect(nudgeValue('ArrowUp', 0, { min: 0, max: 100 })).toBe(1);
    expect(nudgeValue('ArrowUp', 0, { min: -1, max: 1 })).toBeCloseTo(0.02, 6);
  });

  it('snaps to the step grid (matches useDragValue rounding)', () => {
    expect(nudgeValue('ArrowUp', 4, { min: 0, max: 10, step: 2 })).toBe(6);
    expect(nudgeValue('ArrowUp', 0, { min: 0, max: 1, step: 0.1 })).toBeCloseTo(0.1, 6);
  });
});

describe('palette constants', () => {
  it('LASER_COLORS are all hex triplets', () => {
    expect(LASER_COLORS.length).toBeGreaterThan(0);
    for (const c of LASER_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('SECTION_COLORS covers the arrangement sections the timeline tints', () => {
    for (const k of ['intro', 'buildup', 'drop', 'breakdown', 'outro']) {
      expect(SECTION_COLORS[k]).toBeTruthy();
    }
  });
});
