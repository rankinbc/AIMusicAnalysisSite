import { describe, expect, it } from 'vitest';

import type { VerdictDto } from '../../../api/types';
import { deriveCoachSuggestions } from '../coach-suggestion-templates';

// Story 1.8 / Task 4 / AC1 — suggestion chips are derived from THIS
// report's verdict categories, ranked by severity. Edge cases: null /
// empty verdicts → generic fallback; >6 categories → trim to 6; dismissed
// / applied verdicts → filtered out.

function makeVerdict(partial: Partial<VerdictDto>): VerdictDto {
  return {
    id: 'v-' + Math.random().toString(36).slice(2),
    analysisId: 'a',
    specialist: 'spec',
    promptVersion: '1',
    model: 'm',
    severity: 'severe',
    category: 'low_end',
    confidence: 0.8,
    priorityScore: 50,
    priorityBase: null,
    priorityCategoryWeight: null,
    priorityScopeMultiplier: null,
    scope: null,
    impact: null,
    chartType: null,
    headline: 'h',
    summary: null,
    body: null,
    metricLine: null,
    whyItMatters: null,
    presetName: null,
    evidence: null,
    fix: null,
    sources: null,
    problemId: null,
    kind: 'fault',
    source: 'rule_engine',
    dataTier: 'audio_only',
    fixable: true,
    suspected: false,
    where: null,
    refines: null,
    createdAt: '2026-06-15T00:00:00Z',
    userState: { dismissed: false, applied: false } as VerdictDto['userState'],
    ...partial,
  };
}

describe('deriveCoachSuggestions', () => {
  it('returns the generic fallback when verdicts is null', () => {
    const out = deriveCoachSuggestions(null);
    expect(out).toHaveLength(6);
    expect(out[0]).toBe("What's the single biggest issue right now?");
  });

  it('returns the generic fallback when verdicts is empty', () => {
    expect(deriveCoachSuggestions([])).toHaveLength(6);
  });

  it('returns the generic fallback when all verdicts are dismissed/applied', () => {
    const out = deriveCoachSuggestions([
      makeVerdict({
        category: 'low_end',
        userState: { dismissed: true, applied: false } as VerdictDto['userState'],
      }),
      makeVerdict({
        category: 'loudness',
        userState: { dismissed: false, applied: true } as VerdictDto['userState'],
      }),
    ]);
    expect(out).toHaveLength(6);
    expect(out[0]).toBe("What's the single biggest issue right now?");
  });

  it('maps a known category to its template prompt', () => {
    const out = deriveCoachSuggestions([
      makeVerdict({ category: 'low_end', severity: 'severe' }),
    ]);
    expect(out[0]).toBe("What's making my low-end muddy?");
    // Tops up to 6 with generics
    expect(out).toHaveLength(6);
  });

  it('ranks higher-severity categories first', () => {
    const out = deriveCoachSuggestions([
      makeVerdict({ category: 'low_end', severity: 'minor' }),
      makeVerdict({ category: 'loudness', severity: 'critical' }),
    ]);
    expect(out[0]).toBe('Will this pass Spotify normalization?'); // loudness wins
    expect(out[1]).toBe("What's making my low-end muddy?");
  });

  it('falls back to a humanised category name for unknown slugs', () => {
    const out = deriveCoachSuggestions([
      makeVerdict({ category: 'mystery_specialist', severity: 'severe' }),
    ]);
    expect(out[0]).toContain('mystery specialist');
  });

  it('trims to 6 suggestions even with more categories', () => {
    const cats = ['low_end', 'loudness', 'stereo', 'frequency', 'dynamics', 'reference', 'arrangement', 'stems'];
    const out = deriveCoachSuggestions(
      cats.map((category) => makeVerdict({ category, severity: 'severe' })),
    );
    expect(out).toHaveLength(6);
  });

  it('does not double-up identical templates', () => {
    const out = deriveCoachSuggestions([
      makeVerdict({ category: 'low_end' }),
      makeVerdict({ category: 'low_end' }),
    ]);
    const unique = new Set(out);
    expect(unique.size).toBe(out.length);
  });
});
