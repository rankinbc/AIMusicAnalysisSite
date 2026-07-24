import { describe, expect, it } from 'vitest';

import type { Phase1Data, Phase5Data, Phase6Data, Phase6Gap } from '../../../api/types';
import { buildGenreSection, buildReferenceSection } from '../reference-model';

const gap = (over: Partial<Phase6Gap>): Phase6Gap => ({
  user_val: 0.4,
  genre_mean: 0.46,
  genre_std: 0.1,
  acceptable_range: [0.28, 0.64],
  delta: -0.06,
  percentile: 44,
  description: '',
  in_range: true,
  ...over,
});

describe('buildGenreSection', () => {
  it('expected: whitelists to the 3 placed metrics, computes in-range + percentile', () => {
    const phase6: Phase6Data = {
      percentile: 74,
      gaps: {
        bpm: gap({ user_val: 138, genre_mean: 138, acceptable_range: [135, 141], in_range: true, percentile: 50 }),
        stereo_width: gap({ user_val: 0.62, in_range: true }),
        stereo_correlation: gap({ user_val: 0.41, in_range: true }),
        // a non-whitelisted key that must be ignored (no distribution exists):
        lufs: gap({ user_val: -8.2, in_range: false }),
      },
    };
    const sec = buildGenreSection(phase6, undefined);
    expect(sec.metrics.map((m) => m.key).sort()).toEqual(['bpm', 'stereo_correlation', 'stereo_width']);
    expect(sec.total).toBe(3);
    expect(sec.inRange).toBe(3);
    expect(sec.percentile).toBe(74);
    expect(sec.confident).toBe(true);
    // no reference attached → no ◇ overlay anywhere
    expect(sec.metrics.every((m) => m.ref === null)).toBe(true);
  });

  it('derives the ◇ ref only for stereo_correlation when a reference is attached', () => {
    const phase6: Phase6Data = {
      percentile: 50,
      gaps: {
        bpm: gap({ user_val: 138 }),
        stereo_width: gap({ user_val: 0.62 }),
        stereo_correlation: gap({ user_val: 0.41 }),
      },
    };
    const phase5: Phase5Data = {
      status: 'ok',
      deltas: { stereo_correlation: { value: -0.07, severity: 'minor' } },
    };
    const sec = buildGenreSection(phase6, phase5);
    const corr = sec.metrics.find((m) => m.key === 'stereo_correlation')!;
    // ref = user - delta = 0.41 - (-0.07) = 0.48
    expect(corr.ref).toBeCloseTo(0.48, 5);
    expect(sec.metrics.find((m) => m.key === 'bpm')!.ref).toBeNull();
    expect(sec.metrics.find((m) => m.key === 'stereo_width')!.ref).toBeNull();
  });

  it('failure: no percentile → not confident (honest "can\'t place you")', () => {
    const sec = buildGenreSection({ gaps: {} }, undefined);
    expect(sec.confident).toBe(false);
    expect(sec.percentile).toBeNull();
    expect(sec.metrics).toEqual([]);
  });
});

describe('buildReferenceSection', () => {
  const phase1: Phase1Data = {
    lufs: -8.2,
    stereo_correlation: 0.41,
    bands: { air: -31.8 },
  };

  it('expected: maps deltas to you/ref/Δ with warn from severity', () => {
    const phase5: Phase5Data = {
      status: 'ok',
      deltas: {
        lufs: { value: 0.9, severity: 'ok' },
        stereo_correlation: { value: -0.07, severity: 'minor' },
        band_air: { value: -5.6, severity: 'moderate' },
      },
      genre_context: { checks: { lufs: { status: 'warn', message: 'hot' } } },
    };
    const sec = buildReferenceSection(phase5, phase1);
    expect(sec.attached).toBe(true);
    const lufs = sec.deltas.find((d) => d.key === 'lufs')!;
    expect(lufs.user).toBe(-8.2);
    expect(lufs.ref).toBeCloseTo(-9.1, 5); // user - delta
    expect(lufs.warn).toBe(false);
    expect(sec.deltas.find((d) => d.key === 'band_air')!.warn).toBe(true); // moderate
    expect(sec.checks).toEqual([{ key: 'lufs', message: 'hot', tone: 'warn' }]);
  });

  it('maps per-stem deltas when present', () => {
    const phase5: Phase5Data = {
      status: 'ok',
      deltas: {},
      per_stem_reference_deltas: [
        { role: 'kick', metric: 'level', user_value: -6, reference_value: -8, delta: 2, interpretation: 'louder', severity_tier: 'moderate' },
      ],
    };
    const sec = buildReferenceSection(phase5, phase1);
    expect(sec.perStem).toHaveLength(1);
    expect(sec.perStem[0]).toMatchObject({ role: 'kick', metric: 'level', warn: true });
  });

  it('failure: skipped phase 5 → not attached', () => {
    expect(buildReferenceSection({ status: 'skipped', deltas: {} }, phase1).attached).toBe(false);
    expect(buildReferenceSection(undefined, phase1).attached).toBe(false);
  });
});
