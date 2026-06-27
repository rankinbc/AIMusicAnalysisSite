import { describe, expect, it } from 'vitest';
import type { EqBand } from './data';
import { composeRack, fixToRackPatch, isApplyable } from './fixToRackPatch';

describe('fixToRackPatch', () => {
  it('maps a peaking_eq op to an enabled eq band (camelCase)', () => {
    const { eqBands, modules } = fixToRackPatch([
      { type: 'peaking_eq', params: { frequency_hz: 300, gain_db: -2.5, q: 1 } },
    ]);
    expect(modules).toEqual({});
    expect(eqBands).toEqual([{ type: 'peaking', freq: 300, gainDb: -2.5, q: 1, enabled: true }]);
  });

  it('maps a limiter op to the limiter module', () => {
    expect(fixToRackPatch([{ type: 'limiter', params: { ceiling_db: -1, release_ms: 100, lookahead_ms: 2 } }]).modules)
      .toEqual({ limiter: { enabled: true, ceilingDb: -1, releaseMs: 100, lookaheadMs: 2 } });
  });

  it('maps stereo_width width_pct to a 0-2 ratio and mono maker', () => {
    expect(fixToRackPatch([{ type: 'stereo_width', params: { width_pct: 90, mono_below_hz: 120 } }]).modules)
      .toEqual({ ms: { enabled: true, width: 0.9, monoMakerHz: 120 } });
  });

  it('routes unknown / per-stem ops to leftover', () => {
    const op = { type: 'sidechain', params: {} };
    const out = fixToRackPatch([op]);
    expect(out.leftover).toEqual([op]);
    expect(out.modules).toEqual({});
    expect(out.eqBands).toEqual([]);
  });

  it('isApplyable is false for empty / non-rack chains', () => {
    expect(isApplyable([])).toBe(false);
    expect(isApplyable([{ type: 'sidechain', params: {} }])).toBe(false);
    expect(isApplyable([{ type: 'gain', params: { gain_db: -3 } }])).toBe(true);
  });
});

describe('composeRack', () => {
  const eqOp = (hz: number) => [{ type: 'peaking_eq', params: { frequency_hz: hz, gain_db: -2, q: 1 } }];

  it('returns defaults when no fixes applied', () => {
    const r = composeRack([]);
    expect(r.eq.enabled).toBe(false);
    expect(r.limiter.enabled).toBe(false);
  });

  it('places two EQ fixes on two distinct band slots and enables eq', () => {
    const r = composeRack([eqOp(120), eqOp(10000)]);
    const bands = r.eq.bands as EqBand[];
    expect(r.eq.enabled).toBe(true);
    expect(bands[0]).toMatchObject({ freq: 120, gainDb: -2 });
    expect(bands[1]).toMatchObject({ freq: 10000, gainDb: -2 });
  });

  it('applies module fixes and leaves untouched modules at defaults', () => {
    const r = composeRack([[{ type: 'limiter', params: { ceiling_db: -1 } }]]);
    expect(r.limiter).toMatchObject({ enabled: true, ceilingDb: -1 });
    expect(r.comp.enabled).toBe(false);
  });
});
