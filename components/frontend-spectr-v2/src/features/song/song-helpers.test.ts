import { describe, it, expect } from 'vitest';
import {
  METRICS, metricDelta, personalVerdict, noteKey, versionStatus,
  sortVersionsDesc, defaultSlots, scoredAsc, trendSummary,
} from './song-helpers';
import type { VersionDto } from '../../api/types';

const v = (over: Partial<VersionDto>): VersionDto => ({
  id: 'x', songId: 's', versionNumber: 1, label: null, isCurrent: false,
  filePath: 'f', createdAt: '2026-05-01', alsFilePath: null, referencePath: null,
  ...over,
});

describe('metricDelta', () => {
  const score = METRICS.find(m => m.key === 'score')!;
  const lufs = METRICS.find(m => m.key === 'lufs')!;
  it('higher-is-better: A above B is good', () => {
    expect(metricDelta(87, 80, score)).toMatchObject({ deltaStr: '+7', tone: 'good' });
  });
  it('higher-is-better: A below B is bad', () => {
    expect(metricDelta(70, 80, score).tone).toBe('bad');
  });
  it('target metric (LUFS ~ -9): closeness wins, not magnitude', () => {
    // A=-9 is closer to -9 than B=-6 → good
    expect(metricDelta(-9, -6, lufs).tone).toBe('good');
  });
  it('near-equal within epsilon → neutral ±0', () => {
    expect(metricDelta(80.01, 80, score)).toMatchObject({ deltaStr: '±0', tone: 'neutral' });
  });
  it('missing side → em dash, neutral', () => {
    expect(metricDelta(null, 80, score)).toMatchObject({ aStr: '—', tone: 'neutral' });
  });
  it('target metric: A farther from target than B is bad', () => {
    expect(metricDelta(-6, -9, lufs).tone).toBe('bad');
  });
  it('neutral dir: large gap still neutral (no winner)', () => {
    const bass = METRICS.find(m => m.key === 'bass')!;
    expect(metricDelta(90, 50, bass).tone).toBe('neutral');
  });
});

describe('personalVerdict', () => {
  it('A higher', () => expect(personalVerdict(90, 78)).toMatchObject({ deltaStr: '+12', tone: 'good' }));
  it('B higher', () => expect(personalVerdict(70, 80)).toMatchObject({ deltaStr: '-10', tone: 'bad' }));
  it('level', () => expect(personalVerdict(80, 80)).toMatchObject({ tone: 'neutral' }));
  it('unset → prompt', () => expect(personalVerdict(null, 80).label).toMatch(/score/i));
});

describe('noteKey', () => {
  it('is order-independent (sorted)', () => {
    expect(noteKey('b', 'a')).toBe(noteKey('a', 'b'));
    expect(noteKey('a', 'b')).toBe('a-b');
  });
});

describe('versionStatus', () => {
  it('analyzed when scored result present', () =>
    expect(versionStatus(v({ latestResult: { score: 87, lufs: null, dynamicRangeLu: null, bass: null, air: null, stereoWidth: null } }))).toBe('analyzed'));
  it('unscored when no result', () => expect(versionStatus(v({}))).toBe('unscored'));
});

describe('sortVersionsDesc / defaultSlots', () => {
  const vs = [v({ id: '1', versionNumber: 1, createdAt: '2026-05-01' }),
              v({ id: '3', versionNumber: 3, isCurrent: true }),
              v({ id: '2', versionNumber: 2 })];
  it('sorts newest first', () => expect(sortVersionsDesc(vs).map(x => x.versionNumber)).toEqual([3, 2, 1]));
  it('defaultSlots: A=current, B=previous', () =>
    expect(defaultSlots(vs)).toEqual({ a: '3', b: '2' }));
});

describe('trend', () => {
  const vs = [v({ id: '1', versionNumber: 1, latestResult: { score: 62, lufs: null, dynamicRangeLu: null, bass: null, air: null, stereoWidth: null } }),
              v({ id: '2', versionNumber: 2, latestResult: { score: 87, lufs: null, dynamicRangeLu: null, bass: null, air: null, stereoWidth: null } })];
  it('scoredAsc filters + sorts ascending', () => expect(scoredAsc(vs).map(x => x.versionNumber)).toEqual([1, 2]));
  it('trendSummary reports delta', () => expect(trendSummary(vs)).toMatch(/\+25/));
});
