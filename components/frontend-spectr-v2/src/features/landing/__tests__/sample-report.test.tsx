// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { SAMPLE_FINDINGS, SAMPLE_META } from '../sample/sample-data';
import { describeOp, isWin, planSteps, teamOf } from '../sample/sample-model';


const issues = SAMPLE_FINDINGS.filter((f) => !isWin(f));
const wins = SAMPLE_FINDINGS.filter(isWin);

describe('sample fixture (generated from the demo snapshot)', () => {
  it('is the curated demo report (real analyzer output), never naming the track', () => {
    expect(SAMPLE_META.title).toBe('Sample track');
    // Owner: the demo track is never named on the site (it will be replaced).
    expect(JSON.stringify(SAMPLE_META)).not.toMatch(/Magnetic|Artifact303|Velda|Melodic Mind/i);
    expect(SAMPLE_META.credit).toMatch(/demo track/);
    expect(issues.length).toBeGreaterThanOrEqual(10);
    // Wins come from specialists Triage didn't route — none in this sample.
    expect(wins.length).toBeGreaterThanOrEqual(0);
    expect(planSteps(SAMPLE_FINDINGS).length).toBeGreaterThanOrEqual(5);
    // Every finding rests on measured evidence.
    for (const f of SAMPLE_FINDINGS) {
      expect(Array.isArray(f.verdict.evidence)).toBe(true);
      expect((f.verdict.evidence as unknown[]).length).toBeGreaterThan(0);
    }
  });

  it('credits a team of specialists plus the measurement engine', () => {
    const team = teamOf(SAMPLE_FINDINGS);
    // The specialists Triage routed for the demo track (loudness, frequency balance, dynamics).
    expect(team.filter((t) => !t.isRule).length).toBeGreaterThanOrEqual(3);
    expect(team.some((t) => t.isRule)).toBe(true);
  });

  it('carries no coach conversation or user-authored text', () => {
    const blob = JSON.stringify({ SAMPLE_META, SAMPLE_FINDINGS });
    for (const banned of ['conversation', 'rackPresets', 'file_path', 'audioKey', 'userText', '"role"']) {
      expect(blob).not.toContain(banned);
    }
  });
});

describe('describeOp — plain DAW instructions from dsp ops', () => {
  it('formats the common ops', () => {
    expect(describeOp({ type: 'peaking_eq', params: { frequency_hz: 320, gain_db: -2.5, q: 1 } })).toBe(
      'EQ bell −2.5 dB at 320 Hz, Q 1',
    );
    expect(describeOp({ type: 'high_shelf', params: { frequency_hz: 10000, gain_db: 3 } })).toBe(
      'High shelf +3 dB at 10 kHz',
    );
    expect(describeOp({ type: 'high_pass', params: { frequency_hz: 30, slope_db: 24 } })).toBe(
      'High-pass at 30 Hz, 24 dB/oct',
    );
  });

  it('never drops an unknown op', () => {
    expect(describeOp({ type: 'tape_wobble', params: { depth: 2 } })).toBe('tape_wobble: depth=2');
    expect(describeOp({ type: 'mystery', params: {} })).toBe('mystery');
  });
});
