import { describe, expect, it } from 'vitest';

import type { VerdictDto } from '../../../api/types';
import type { Move } from '../move-model';
import {
  genreTargets,
  manualNotes,
  perDeviceGroups,
  timestampedMoments,
} from '../improvement-plan-model';

function move(over: Partial<Move>): Move {
  return {
    id: 'm1', title: 'Do the thing', group: 'quick', sev: 'warn', scope: 'Master bus',
    directive: 'd', directional: 'd', steps: [], hasParams: true, why: '',
    evidence: { type: 'none', metric: '', chartType: null }, confidence: 0.8,
    impact: 70, source: 'x', isRule: false, specialist: 'low_end',
    status: 'suggested', verdictId: 'vrd_1', ops: [], ...over,
  };
}

function verdict(over: Partial<VerdictDto>): VerdictDto {
  return {
    id: 'vrd_1', analysisId: 'a', specialist: 'low_end', promptVersion: 'p', model: 'm',
    severity: 'severe', category: 'low_end', confidence: 0.8, priorityScore: 109,
    impact: null, chartType: null, headline: 'h', summary: null, body: null,
    metricLine: null, whyItMatters: null, presetName: null, evidence: null,
    fix: null, sources: null, problemId: null, kind: 'fault', source: 'rule_engine',
    dataTier: 'audio_only', fixable: true, suspected: false, where: null, refines: null,
    priorityBase: null, priorityCategoryWeight: null, priorityScopeMultiplier: null,
    scope: null, createdAt: '', userState: { dismissed: false, applied: false, feedback: null },
    ...over,
  };
}

describe('perDeviceGroups', () => {
  it('groups Master first, then devices A–Z, priority-sorted within', () => {
    const groups = perDeviceGroups([
      move({ id: 'a', scope: 'Pad bus', impact: 50 }),
      move({ id: 'b', scope: 'Master bus', impact: 60 }),
      move({ id: 'c', scope: 'Bass stem', impact: 90 }),
      move({ id: 'd', scope: 'Master', impact: 90 }),
    ]);
    expect(groups.map((g) => g.device)).toEqual(['Master', 'Bass stem', 'Pad bus']);
    expect(groups[0]?.moves.map((m) => m.id)).toEqual(['d', 'b']);
  });
});

describe('timestampedMoments', () => {
  it('keeps only where-anchored findings, time-sorted', () => {
    const moments = timestampedMoments([
      verdict({ id: 'v1', where: { section_type: 'drop', start_seconds: 90, end_seconds: 120 } }),
      verdict({ id: 'v2', where: null }),
      verdict({ id: 'v3', where: { section_type: 'intro', start_seconds: 5 } }),
      verdict({ id: 'v4', headline: 'Specialist failed', where: { start_seconds: 1 } }),
    ]);
    expect(moments.map((m) => m.verdictId)).toEqual(['v3', 'v1']);
    expect(moments[1]?.label).toBe('drop · 1:30–2:00');
  });
});

describe('genreTargets', () => {
  it('derives measured-vs-expected rows from committed verdicts only, deduped', () => {
    const ev = [
      { metric: 'phase1.lufs', value: -8.2, expected_range: [-12, -9], label: 'LUFS' },
      { metric: 'phase1.lufs', value: -8.2, expected_range: [-12, -9], label: 'LUFS dup' },
      { metric: 'no.range', value: 1, label: 'no range' },
    ];
    const targets = genreTargets(
      [verdict({ id: 'v1', evidence: ev }), verdict({ id: 'v2', evidence: ev })],
      new Set(['v1']),
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]).toEqual({ metric: 'LUFS', yours: '-8.20', target: '-12 … -9' });
  });
});

describe('manualNotes', () => {
  it('returns checked, non-dismissed findings', () => {
    const notes = manualNotes(
      [
        verdict({ id: 'v1', fixable: false }),
        verdict({ id: 'v2', fixable: false, userState: { dismissed: true, applied: false, feedback: null } }),
        verdict({ id: 'v3' }),
      ],
      new Set(['v1', 'v2']),
    );
    expect(notes.map((n) => n.id)).toEqual(['v1']);
  });
});
