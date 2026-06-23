import { describe, expect, it } from 'vitest';

import type { VerdictDto } from '../../../api/types';
import {
  buildMoves,
  groupMoves,
  impactBand,
  isCleanMix,
  moveToMarkdown,
  ruleFixToMove,
  toMoveSev,
  verdictToMove,
} from '../move-model';

function makeVerdict(over: Partial<VerdictDto> = {}): VerdictDto {
  return {
    id: 'v1',
    analysisId: 'a1',
    specialist: 'low_end',
    promptVersion: '1',
    model: 'test',
    severity: 'severe',
    category: 'low_end',
    confidence: 0.91,
    priorityScore: 70,
    impact: null,
    chartType: 'spectrum',
    headline: 'Let the kick breathe',
    summary: 'Sidechain the sub under the kick.',
    body: null,
    metricLine: 'Sub 60 Hz: +4 dB vs kick',
    whyItMatters: 'The sub is masking the kick attack.',
    presetName: null,
    evidence: null,
    fix: {
      target: { type: 'bus', name: 'Sub bass' },
      dsp_chain: [{ type: 'sidechain', params: { attack_ms: 8, release_ms: 80, depth_db: -6 } }],
      expected_outcome: 'Duck the sub 6 dB under each kick so the low end punches through.',
    },
    sources: null,
    createdAt: '2026-06-16T00:00:00Z',
    userState: { dismissed: false, applied: false, feedback: null },
    ...over,
  };
}

describe('toMoveSev', () => {
  it('folds the 5-level vocab into 4 tones', () => {
    expect(toMoveSev('critical')).toBe('crit');
    expect(toMoveSev('severe')).toBe('warn');
    expect(toMoveSev('moderate')).toBe('warn');
    expect(toMoveSev('minor')).toBe('info');
    expect(toMoveSev('win')).toBe('low');
    expect(toMoveSev('weird')).toBe('info');
  });
});

describe('verdictToMove', () => {
  it('maps a specialist verdict with a concrete fix into a precise Move', () => {
    const m = verdictToMove(makeVerdict());
    expect(m.title).toBe('Let the kick breathe');
    expect(m.scope).toBe('Sub bass');
    expect(m.hasParams).toBe(true);
    expect(m.steps).toHaveLength(1);
    expect(m.steps[0]).toEqual({ where: 'sidechain', detail: 'attack_ms=8, release_ms=80, depth_db=-6' });
    expect(m.directive).toMatch(/Duck the sub/);
    expect(m.confidence).toBeCloseTo(0.91);
    expect(m.source).toBe('Low End');
    expect(m.sev).toBe('warn');
    expect(m.group).toBe('quick');
    expect(m.verdictId).toBe('v1');
  });

  it('carries impact + AI provenance for the persona chip', () => {
    const m = verdictToMove(makeVerdict({ priorityScore: 70, specialist: 'low_end' }));
    expect(m.impact).toBe(70);
    expect(m.isRule).toBe(false);
    expect(m.specialist).toBe('low_end');
  });

  it('renders directional (no steps) when the fix has no dsp_chain', () => {
    const m = verdictToMove(makeVerdict({ fix: { target: { name: 'Master bus' } } }));
    expect(m.hasParams).toBe(false);
    expect(m.steps).toHaveLength(0);
  });

  it('buckets arrangement specialists into deeper work', () => {
    const m = verdictToMove(makeVerdict({ specialist: 'trance_arrangement', category: 'sections' }));
    expect(m.group).toBe('deep');
  });

  it('reads triage status from userState', () => {
    expect(verdictToMove(makeVerdict({ userState: { applied: true, dismissed: false, feedback: null } })).status).toBe('committed');
    expect(verdictToMove(makeVerdict({ userState: { applied: false, dismissed: true, feedback: null } })).status).toBe('dismissed');
  });
});

describe('ruleFixToMove', () => {
  it('produces a directional, param-free Move from a plain string', () => {
    const m = ruleFixToMove('Master bus: lower the limiter ceiling to leave headroom', 0);
    expect(m.scope).toBe('Master bus');
    expect(m.title).toMatch(/Lower the limiter/);
    expect(m.hasParams).toBe(false);
    expect(m.source).toBe('rule engine');
    expect(m.group).toBe('quick');
  });

  it('falls back to whole-string title when there is no scope prefix', () => {
    const m = ruleFixToMove('tighten your low end before the drop', 1);
    expect(m.scope).toBe('');
    expect(m.title).toBe('Tighten your low end before the drop');
  });

  it('flags rule provenance (RULE chip) with no specialist and a derived impact', () => {
    const m = ruleFixToMove('Master bus: leave headroom', 0);
    expect(m.isRule).toBe(true);
    expect(m.specialist).toBeNull();
    expect(m.impact).toBeGreaterThan(0);
  });
});

describe('impactBand', () => {
  it('maps a 0..100 score to high/med/low bands', () => {
    expect(impactBand(82).label).toBe('HIGH IMPACT');
    expect(impactBand(50).label).toBe('MED IMPACT');
    expect(impactBand(30).label).toBe('LOW IMPACT');
  });
});

describe('buildMoves', () => {
  it('combines rule + AI moves, drops dismissed, sorts quick-before-deep', () => {
    const moves = buildMoves({
      verdicts: [
        makeVerdict({ id: 'a', specialist: 'trance_arrangement', category: 'sections', severity: 'minor' }),
        makeVerdict({ id: 'b', severity: 'critical', confidence: 0.8 }),
        makeVerdict({ id: 'c', severity: 'severe', userState: { applied: false, dismissed: true, feedback: null } }),
      ],
      topFixes: ['Master bus: pull the level back to streaming target'],
    });
    expect(moves.find((m) => m.id === 'c')).toBeUndefined(); // dismissed dropped
    // Quick group leads; within it crit before the rule-engine info.
    expect(moves[0].group).toBe('quick');
    expect(moves[moves.length - 1].group).toBe('deep');
  });

  it('drops fail-marker verdicts', () => {
    const moves = buildMoves({ verdicts: [makeVerdict({ headline: 'Specialist failed' })] });
    expect(moves).toHaveLength(0);
  });

  it('dedupes restated rule fixes', () => {
    const moves = buildMoves({
      verdicts: [],
      topFixes: ['Tighten the low end'],
      coachedFixes: ['Tighten the low end!!'],
    });
    expect(moves).toHaveLength(1);
  });
});

describe('isCleanMix', () => {
  it('is true only when every move is info/low', () => {
    expect(isCleanMix([verdictToMove(makeVerdict({ severity: 'minor' }))])).toBe(true);
    expect(isCleanMix([verdictToMove(makeVerdict({ severity: 'critical' }))])).toBe(false);
    expect(isCleanMix([])).toBe(false);
  });
});

describe('moveToMarkdown', () => {
  it('emits a grouped checklist with params nested under committed moves', () => {
    const { quick } = groupMoves([verdictToMove(makeVerdict({ userState: { applied: true, dismissed: false, feedback: null } }))]);
    const md = moveToMarkdown(quick, 'Aurora');
    expect(md).toContain('# Game Plan — Aurora');
    expect(md).toContain('## ⚡ Quick wins');
    expect(md).toContain('- [ ] **Sub bass** — Duck the sub');
    expect(md).toContain('  - sidechain: `attack_ms=8, release_ms=80, depth_db=-6`');
  });

  it('handles an empty plan', () => {
    expect(moveToMarkdown([], 'Aurora')).toContain('No moves committed yet');
  });
});
