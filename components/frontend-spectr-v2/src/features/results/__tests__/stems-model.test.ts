import { describe, expect, it } from 'vitest';

import {
  bandIntensity,
  bandRange,
  clashesForStem,
  deltasByRole,
  parseStemsAnalysis,
} from '../stems-model';

// Mirrors the golden fixture shape (phase4_with_stems.json) — grouped mode,
// per_stem keyed by ROLE, band keys `sub` (NOT the top-level `sub_bass`).
const grouped = {
  status: 'ok',
  mode: 'grouped',
  balance_flags: [
    {
      role: 'bass',
      metric: 'rms_db',
      observed: -9.1,
      expected_range: [-16, -12],
      direction: 'too_high',
      severity_tier: 'warning',
    },
  ],
  clash_matrix: [
    { band: 'bass', overlap_severity: 0.63, severity_tier: 'warning', stem_a: 'kick', stem_b: 'bass' },
  ],
  per_stem: {
    bass: {
      band_energy_db: { air: -7.28, bass: 86.69, high_mid: -11.02, low_mid: -19.6, mid: -14.64, presence: -9.5, sub: -35.96 },
      dominant_frequencies_hz: [110.0, 109.75],
      duration_s: 4.0,
      dynamic_range_db: 3.01,
      is_mono: true,
      lufs_integrated: -12.64,
      pan_estimate: 0.0,
      peak_db: -7.96,
      rms_db: -10.97,
      spectral_centroid_hz: 116.19,
      stereo_width: 0.0,
    },
    kick: {
      band_energy_db: { air: -20, bass: 60, high_mid: -30, low_mid: -10, mid: -20, presence: -25, sub: 40 },
      dominant_frequencies_hz: [54],
      duration_s: 4.0,
      dynamic_range_db: 11,
      is_mono: true,
      lufs_integrated: -14,
      pan_estimate: 0,
      peak_db: -3,
      rms_db: -12,
      spectral_centroid_hz: 300,
      stereo_width: 0.05,
    },
  },
};

describe('parseStemsAnalysis (grouped)', () => {
  it('normalizes roles into ordered entries', () => {
    const a = parseStemsAnalysis(grouped)!;
    expect(a.mode).toBe('grouped');
    // kick sorts before bass (role order), regardless of object key order.
    expect(a.entries.map((e) => e.key)).toEqual(['kick', 'bass']);
    expect(a.entries[1]?.metrics.lufs_integrated).toBe(-12.64);
    expect(a.entries[1]?.metrics.band_energy_db.sub).toBe(-35.96);
  });

  it('parses clashes and balance flags', () => {
    const a = parseStemsAnalysis(grouped)!;
    expect(a.clashes).toHaveLength(1);
    expect(clashesForStem(a.clashes, 'kick')).toHaveLength(1);
    expect(clashesForStem(a.clashes, 'hats')).toHaveLength(0);
    expect(a.balanceFlags[0]).toMatchObject({ role: 'bass', direction: 'too_high' });
  });

  it('returns null unless status is ok', () => {
    expect(parseStemsAnalysis({ ...grouped, status: 'failed' })).toBeNull();
    expect(parseStemsAnalysis(undefined)).toBeNull();
    expect(parseStemsAnalysis('x')).toBeNull();
  });
});

describe('parseStemsAnalysis (per_stem)', () => {
  it('normalizes labelled rows and keeps the truncated flag', () => {
    const a = parseStemsAnalysis({
      status: 'ok',
      mode: 'per_stem',
      truncated: true,
      stem_count: 2,
      per_stem_list: [
        { id: 'kick 01', role: 'kick', rms_db: -12, band_energy_db: { sub: 30 } },
        { id: 'pad L', role: 'pad', rms_db: -20, band_energy_db: { mid: 10 } },
      ],
      clash_matrix: [
        { stem_a: 'kick 01', stem_b: 'pad L', band: 'mid', overlap_severity: 0.4, severity_tier: 'info' },
      ],
    })!;
    expect(a.mode).toBe('per_stem');
    expect(a.truncated).toBe(true);
    expect(a.entries.map((e) => e.key)).toEqual(['kick 01', 'pad L']);
    expect(clashesForStem(a.clashes, 'pad L')).toHaveLength(1);
  });
});

describe('deltasByRole / band helpers', () => {
  it('groups the flat phase5 delta list by role', () => {
    const m = deltasByRole([
      { role: 'kick', metric: 'lufs_integrated', delta: -3.3 },
      { role: 'kick', metric: 'band_energy_db.sub', delta: 2 },
      { role: 'bass', metric: 'rms_db', delta: 1 },
    ]);
    expect(m.get('kick')).toHaveLength(2);
    expect(m.get('bass')).toHaveLength(1);
    expect(m.get('hats')).toBeUndefined();
  });

  it('normalizes band intensity across the full grid range', () => {
    const a = parseStemsAnalysis(grouped)!;
    const [min, max] = bandRange(a.entries);
    expect(min).toBe(-35.96);
    expect(max).toBe(86.69);
    expect(bandIntensity(max, min, max)).toBe(1);
    expect(bandIntensity(min, min, max)).toBeCloseTo(0.04);
    expect(bandIntensity(undefined, min, max)).toBe(0);
  });
});
