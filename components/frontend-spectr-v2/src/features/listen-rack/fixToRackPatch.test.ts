import { describe, expect, it } from 'vitest';
import type { EqBand, ModuleState } from './data';
import { composeRack, fixToRackPatch, isApplyable, overlayChain } from './fixToRackPatch';

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

  // ── Story 12.4 (AC4): live-base overlay ─────────────────────────────────────
  it('overlays onto a live base — manual knob moves on untouched modules survive', () => {
    const live = composeRack([]);
    live.trim = { ...live.trim, enabled: true, gainDb: -6 }; // manual tweak
    const r = composeRack([[{ type: 'limiter', params: { ceiling_db: -1 } }]], live);
    expect(r.limiter).toMatchObject({ enabled: true, ceilingDb: -1 });
    expect(r.trim).toMatchObject({ enabled: true, gainDb: -6 }); // preserved
    expect(live.limiter.enabled).toBe(false); // base not mutated (cloned)
  });

  it('never touches pitch, even when the base has pitch engaged', () => {
    const live = composeRack([]);
    live.pitch = { enabled: true, semitones: 3 } as unknown as ModuleState;
    const r = composeRack([[{ type: 'gain', params: { gain_db: -3 } }]], live);
    expect(r.pitch).toEqual({ enabled: true, semitones: 3 });
  });

  it('without a base behaves exactly as before (defaults rebuild)', () => {
    const a = composeRack([[{ type: 'limiter', params: { ceiling_db: -1 } }]]);
    const b = composeRack([[{ type: 'limiter', params: { ceiling_db: -1 } }]], undefined);
    expect(b).toEqual(a);
  });
});

describe('overlayChain (story 12.4 carried-preset apply)', () => {
  it('merges carried modules onto live, preserving untouched manual tweaks', () => {
    const live = composeRack([]);
    live.trim = { ...live.trim, enabled: true, gainDb: -6 };
    const next = overlayChain(live, { limiter: { enabled: true, ceilingDb: -0.5 } as unknown as ModuleState });
    expect(next.limiter).toMatchObject({ enabled: true, ceilingDb: -0.5 });
    expect(next.trim).toMatchObject({ enabled: true, gainDb: -6 });
    expect(live.limiter.enabled).toBe(false); // input not mutated
  });

  it('never writes pitch from the carried chain', () => {
    const live = composeRack([]);
    live.pitch = { enabled: false } as unknown as ModuleState;
    const next = overlayChain(live, { pitch: { enabled: true } as unknown as ModuleState });
    expect(next.pitch).toEqual({ enabled: false });
  });

  it('DISABLED carried modules never clobber live tweaks (full compiled chains enumerate everything)', () => {
    const live = composeRack([]);
    live.trim = { ...live.trim, enabled: true, gainDb: -6 }; // manual tweak
    // A compiled analysis chain carries EVERY module; disabled ones at defaults.
    const next = overlayChain(live, {
      trim: { enabled: false, gainDb: 0 } as unknown as ModuleState,
      limiter: { enabled: true, ceilingDb: -1 } as unknown as ModuleState,
    });
    expect(next.trim).toMatchObject({ enabled: true, gainDb: -6 }); // untouched
    expect(next.limiter).toMatchObject({ enabled: true, ceilingDb: -1 });
  });
});

describe('composeRack eq-band resilience (review)', () => {
  it('falls back to default band slots when the live base lacks eq bands', () => {
    const live = composeRack([]);
    live.eq = { enabled: false, bands: [] } as unknown as ModuleState;
    const r = composeRack(
      [[{ type: 'peaking_eq', params: { frequency_hz: 300, gain_db: -2, q: 1 } }]], live);
    const bands = r.eq.bands as EqBand[];
    expect(r.eq.enabled).toBe(true);
    expect(bands[0]).toMatchObject({ freq: 300, gainDb: -2 });
  });
});
