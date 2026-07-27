import { describe, expect, it } from 'vitest';

import type { VerdictDto } from '../../../api/types';
import { faultCount, formatWhere, groupProblems } from '../problems-helpers';

function v(over: Partial<VerdictDto>): VerdictDto {
  return {
    id: 'v' + Math.random(), analysisId: 'a', specialist: 'rule_engine.x', promptVersion: '1',
    model: 'rules', severity: 'moderate', category: 'low_end', confidence: 0.9, priorityScore: 50,
    priorityBase: null,
    priorityCategoryWeight: null,
    priorityScopeMultiplier: null,
    scope: null,
    impact: null, chartType: null, headline: 'h', summary: null, body: null, metricLine: null,
    whyItMatters: null, presetName: null, evidence: null, fix: null, sources: null,
    problemId: 'low_end.x.0', kind: 'fault', source: 'rule_engine', dataTier: 'audio_only',
    fixable: true, suspected: false, where: null, refines: null,
    createdAt: '2026-06-26T00:00:00Z', userState: { dismissed: false, applied: false, feedback: null },
    ...over,
  };
}

describe('groupProblems', () => {
  it('groups by dataTier in fixed order', () => {
    const groups = groupProblems([
      v({ problemId: 'a.a.0', dataTier: 'audio_only' }),
      v({ problemId: 's.s.0', dataTier: 'stems' }),
    ]);
    expect(groups.map((g) => g.tier)).toEqual(['audio_only', 'stems', 'project_midi']);
    expect(groups[0].nodes).toHaveLength(1);
    expect(groups[2].nodes).toHaveLength(0);
  });

  it('orders by severity then priorityScore', () => {
    const groups = groupProblems([
      v({ problemId: 'a.1.0', severity: 'minor', priorityScore: 90 }),
      v({ problemId: 'a.2.0', severity: 'critical', priorityScore: 10 }),
      v({ problemId: 'a.3.0', severity: 'moderate', priorityScore: 80 }),
      v({ problemId: 'a.4.0', severity: 'moderate', priorityScore: 95 }),
    ]);
    const ids = groups[0].nodes.map((n) => n.problem.problemId);
    expect(ids).toEqual(['a.2.0', 'a.4.0', 'a.3.0', 'a.1.0']);
  });

  it('nests refines children under their parent and excludes them from the flat list', () => {
    const groups = groupProblems([
      v({ problemId: 'p.parent.0', refines: null }),
      v({ problemId: 'p.child.0', refines: 'p.parent.0', source: 'llm_identifier' }),
    ]);
    expect(groups[0].nodes).toHaveLength(1);
    expect(groups[0].nodes[0].problem.problemId).toBe('p.parent.0');
    expect(groups[0].nodes[0].children.map((c) => c.problemId)).toEqual(['p.child.0']);
  });

  it('treats a child whose parent is absent as a top-level problem', () => {
    const groups = groupProblems([v({ problemId: 'x.0', refines: 'missing.parent.0' })]);
    expect(groups[0].nodes).toHaveLength(1);
  });
});

describe('faultCount', () => {
  it('counts only kind=fault', () => {
    expect(faultCount([v({ kind: 'fault' }), v({ kind: 'observation' }), v({ kind: 'fault' })])).toBe(2);
  });
});

describe('formatWhere', () => {
  it('formats a section + time range', () => {
    expect(formatWhere({ section_type: 'drop', start_seconds: 153, end_seconds: 215 })).toBe('drop · 2:33–3:35');
  });
  it('returns null when absent', () => {
    expect(formatWhere(null)).toBeNull();
  });
});
