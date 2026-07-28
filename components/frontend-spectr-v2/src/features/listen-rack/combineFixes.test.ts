import { describe, expect, it } from 'vitest';

import { combineFixes, fixWeight, type WeightedFix } from './combineFixes';
import type { EqBand } from './data';
import type { VerdictDspOp } from '../../api/types';

const eq = (freq: number, gain: number, q = 1): VerdictDspOp => ({
  type: 'peaking_eq', params: { frequency_hz: freq, gain_db: gain, q },
});
const fix = (ops: VerdictDspOp[], weight = 1): WeightedFix => ({ ops, weight });

// Default bands are enabled at 0 dB (neutral) — "active" means a real move.
const bands = (mod: ReturnType<typeof combineFixes>['mod']): EqBand[] =>
  (mod.eq.bands as EqBand[]).filter(
    (b) => b.gainDb !== 0 || b.type === 'highpass' || b.type === 'lowpass',
  );

describe('combineFixes — EQ clustering', () => {
  it('far-apart moves always coexist (a low cut never evicts a high boost)', () => {
    const { mod } = combineFixes([fix([eq(100, -4)], 90), fix([eq(8000, 2)], 10)]);
    const on = bands(mod);
    expect(on).toHaveLength(2);
    expect(on[0].freq).toBeCloseTo(100);
    expect(on[0].gainDb).toBe(-4);
    expect(on[1].freq).toBeCloseTo(8000);
    expect(on[1].gainDb).toBe(2);
  });

  it('a high-pass and a separate high-frequency adjustment both survive', () => {
    const { mod } = combineFixes([
      fix([{ type: 'high_pass', params: { frequency_hz: 30, q: 0.7 } }], 100),
      fix([eq(9000, 1.5)], 5),
    ]);
    const on = bands(mod);
    expect(on).toHaveLength(2);
    expect(on[0].type).toBe('highpass');
    expect(on[1].freq).toBeCloseTo(9000);
  });

  it('same-region same-direction moves sum, capped at the cut budget', () => {
    const { mod, changeLog } = combineFixes([fix([eq(240, -5)]), fix([eq(280, -6)])]);
    const on = bands(mod);
    expect(on).toHaveLength(1);
    expect(on[0].gainDb).toBe(-9); // −11 summed, capped at −9
    expect(on[0].freq).toBeGreaterThan(240);
    expect(on[0].freq).toBeLessThan(280);
    expect(changeLog.some((l) => l.includes('summed') && l.includes('capped'))).toBe(true);
  });

  it('opposite directions in one region net by weight, logged', () => {
    const { mod, changeLog } = combineFixes([fix([eq(250, -4)], 3), fix([eq(260, 2)], 1)]);
    const on = bands(mod);
    expect(on).toHaveLength(1);
    // (−4·3 + 2·1)/4 = −2.5
    expect(on[0].gainDb).toBeCloseTo(-2.5, 1);
    expect(changeLog.some((l) => l.includes('netted'))).toBe(true);
  });

  it('merged bands widen Q to span the cluster', () => {
    const { mod } = combineFixes([fix([eq(200, -3, 6)]), fix([eq(270, -2, 6)])]);
    const on = bands(mod);
    expect(on).toHaveLength(1);
    expect(on[0].q).toBeLessThan(6); // widened past either source's narrow Q
  });

  it('past 8 regions the lowest-weight bands drop with a log entry', () => {
    const freqs = [40, 80, 160, 320, 640, 1280, 2560, 5120, 10240];
    const fixes = freqs.map((f, i) => fix([eq(f, -2)], i === 4 ? 0.1 : 1)); // 640Hz weakest
    const { mod, changeLog } = combineFixes(fixes);
    const on = bands(mod);
    expect(on).toHaveLength(8);
    expect(on.some((b) => Math.abs(b.freq - 640) < 1)).toBe(false);
    expect(changeLog.some((l) => l.includes('dropped') && l.includes('640'))).toBe(true);
  });
});

describe('combineFixes — modules', () => {
  const g = (db: number): VerdictDspOp => ({ type: 'gain', params: { gain_db: db } });

  it('same-direction trims keep the binding move, not the sum', () => {
    // Three fixes observing ONE too-hot master. Summing lands at -8.2 dB;
    // the binding requirement is -3.7 and it satisfies the other two.
    const { mod, changeLog } = combineFixes([fix([g(-2.5)], 108), fix([g(-3.7)], 180), fix([g(-2)], 81)]);
    expect(mod.trim.gainDb).toBe(-3.7);
    expect(changeLog.some((l) => l.includes('binding'))).toBe(true);
  });

  it('a lone trim passes through unchanged', () => {
    expect(combineFixes([fix([g(-3.1)])]).mod.trim.gainDb).toBe(-3.1);
  });

  it('opposing trims net by weight and are flagged', () => {
    const { mod, changeLog } = combineFixes([fix([g(-4)], 180), fix([g(2)], 45)]);
    expect(mod.trim.gainDb).toBeCloseTo(-2.8, 2);
    expect(changeLog.some((l) => l.includes('disagree on direction'))).toBe(true);
  });

  it('clamps to the ±24 dB cumulative budget', () => {
    expect(combineFixes([fix([g(-30)]), fix([g(-20)])]).mod.trim.gainDb).toBe(-24);
  });

  it('limiter keeps the LOWEST ceiling (safety, never averaged)', () => {
    const lim = (c: number): VerdictDspOp => ({ type: 'limiter', params: { ceiling_db: c, release_ms: 100, lookahead_ms: 2 } });
    const { mod, changeLog } = combineFixes([fix([lim(-0.3)], 100), fix([lim(-1)], 1)]);
    expect(mod.limiter.ceilingDb).toBe(-1);
    expect(changeLog.some((l) => l.includes('lowest ceiling'))).toBe(true);
  });

  it('compressor params weighted-average with the ratio capped at 4:1', () => {
    const comp = (ratio: number, thr: number): VerdictDspOp =>
      ({ type: 'compressor', params: { ratio, threshold_db: thr, attack_ms: 3, release_ms: 250 } });
    const { mod } = combineFixes([fix([comp(8, -20)], 1), fix([comp(2, -10)], 1)]);
    expect(mod.comp.ratio).toBe(4); // mean 5, capped
    expect(mod.comp.thresholdDb).toBeCloseTo(-15, 0);
  });

  it('stereo width averages by weight and clamps; monoMakerHz takes the max', () => {
    const w = (pct: number, mono?: number): VerdictDspOp =>
      ({ type: 'stereo_width', params: mono != null ? { width_pct: pct, mono_below_hz: mono } : { width_pct: pct } });
    const { mod } = combineFixes([fix([w(90, 100)], 1), fix([w(110, 150)], 1)]);
    expect(mod.ms.width).toBeCloseTo(1, 2);
    expect(mod.ms.monoMakerHz).toBe(150);
  });
});

describe('combineFixes — invariants', () => {
  it('is order-independent: same checkboxes, same rack', () => {
    const fixes = [
      fix([eq(120, -3)], 80),
      fix([eq(150, 2)], 20),
      fix([{ type: 'gain', params: { gain_db: -2 } }], 50),
      fix([{ type: 'limiter', params: { ceiling_db: -1 } }], 60),
    ];
    const a = combineFixes(fixes).mod;
    const b = combineFixes([...fixes].reverse()).mod;
    expect(b).toEqual(a);
  });

  it('never touches the pitch lane and keeps untouched modules at baseline', () => {
    const base = combineFixes([]).mod;
    base.pitch = { enabled: true, semitones: 5 };
    base.sat = { ...base.sat, drive: 0.5 };
    const { mod } = combineFixes([fix([eq(500, -2)])], base);
    expect(mod.pitch).toEqual({ enabled: true, semitones: 5 });
    expect(mod.sat.drive).toBe(0.5);
    expect(mod.sat.enabled).toBe(false);
  });

  it('empty input returns defaults with an empty log', () => {
    const { mod, changeLog } = combineFixes([]);
    expect(mod.eq.enabled).toBe(false);
    expect(changeLog).toEqual([]);
  });
});

describe('fixWeight', () => {
  it('is impact × confidence with neutral fallbacks', () => {
    expect(fixWeight({ impact: 80, confidence: 0.5 })).toBe(40);
    expect(fixWeight({})).toBe(50 * 0.75);
    expect(fixWeight({ impact: 80, confidence: 0.5 })).toBeGreaterThan(fixWeight({ impact: 20, confidence: 0.5 }));
  });
});
