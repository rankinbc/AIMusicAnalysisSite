import { describe, expect, it } from 'vitest';

import type { NoteDto, Phase1Data, Phase2Data, Phase7Data } from '../../api/types';
import { buildTrack } from './trackFromAnalysis';

describe('buildTrack', () => {
  it('maps phase1/2/7 + notes into the Track shape', () => {
    const phase1: Phase1Data = {
      bpm: 124, lufs: -9.4, rms: -13.2, true_peak_db: -0.8, peak_dbfs: -0.5,
      detected_key: 'A# minor', duration_seconds: 201.6, mono_compatibility: 0.82,
      stereo_width: 0.64, stereo_correlation: 0.69,
    };
    const phase2: Phase2Data = { genre: 'techno', confidence: 0.91 };
    const phase7: Phase7Data = {
      section_scores: [
        { section_type: 'intro', start_time: 0, end_time: 16, duration: 16, bars: 8, score: 1, time_range: '0:00', eight_bar_compliant: true },
        { section_type: 'main_drop', start_time: 16, end_time: 48, duration: 32, bars: 16, score: 1, time_range: '0:16', eight_bar_compliant: true },
      ],
    };
    const notes: NoteDto[] = [
      { id: 'n1', versionId: 'v1', tSeconds: 30, text: 'tighten the kick', pinned: true, createdAt: '', updatedAt: '' },
    ];

    const t = buildTrack({ name: 'Night Drive', phase1, phase2, phase7, notes });

    expect(t.name).toBe('Night Drive');
    expect(t.bpm).toBe(124);
    expect(t.key).toBe('A# minor');
    expect(t.durationSec).toBe(202);
    expect(t.genre).toEqual({ name: 'techno', confidence: 91 }); // 0.91 → 91%
    expect(t.loudness.integrated).toBe(-9.4);
    expect(t.loudness.truePeak).toBe(-0.8);
    expect(t.loudness.dynamicRange).toBeCloseTo(12.7, 1); // peak_dbfs(-0.5) − rms(-13.2)
    expect(t.stereo).toEqual({ width: 64, correlation: 0.69, monoCompat: 0.82 });
    expect(t.arrangement.sections).toEqual([
      { t: 'intro', l: 'Intro', bars: 8 },
      { t: 'main_drop', l: 'Main Drop', bars: 16 },
    ]);
    expect(t.notes).toEqual([{ id: 'n1', t: 30, text: 'tighten the kick', pinned: true }]);
  });

  it('treats an already-percent confidence as percent (no double scaling)', () => {
    const t = buildTrack({ name: 'x', phase2: { genre: 'house', confidence: 88 } });
    expect(t.genre.confidence).toBe(88);
  });

  // Wave-3 E6.2 — the Stats rail keys "not analyzed yet" off this flag.
  it('sets analyzed=true when phase1 is present, false when absent', () => {
    expect(buildTrack({ name: 'x', phase1: { bpm: 120 } }).analyzed).toBe(true);
    expect(buildTrack({ name: 'x' }).analyzed).toBe(false);
    expect(buildTrack({ name: 'x', phase2: { genre: 'house' } }).analyzed).toBe(false);
  });

  it('falls back to neutral values when analysis is absent', () => {
    const t = buildTrack({ name: '' });
    expect(t.name).toBe('—');
    expect(t.analyzed).toBe(false);
    expect(t.bpm).toBe(0);
    expect(t.key).toBe('—');
    expect(t.genre).toEqual({ name: '—', confidence: 0 });
    expect(t.durationSec).toBe(0);
    expect(t.loudness.dynamicRange).toBe(0);
    expect(t.arrangement.sections).toEqual([]);
    expect(t.notes).toEqual([]);
  });
});
