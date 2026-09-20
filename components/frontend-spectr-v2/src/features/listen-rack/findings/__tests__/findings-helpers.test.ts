/* Spec D4 + D8: the seek affordance only exists where the data does, and a
 * carried preset locks per-fix applying until it is cleared. */
import { describe, expect, it } from 'vitest';

import type { VerdictDto } from '../../../../api/types';
import type { Move } from '../../../results/move-model';
import { applyGate, boardListenFixes, timeRangeOf } from '../findings-helpers';

function verdict(patch: Partial<VerdictDto> = {}): VerdictDto {
  return {
    id: 'v1', analysisId: 'a1', specialist: 'low_end', promptVersion: '1', model: 'test',
    severity: 'critical', category: 'low_end', confidence: 0.8, priorityScore: 120,
    impact: null, chartType: null, headline: 'Sub is masking the kick',
    summary: 'Too much 40 Hz under the kick.', body: null, metricLine: null,
    whyItMatters: null, presetName: null, evidence: null, fix: null, sources: null,
    problemId: 'p1', kind: 'fault', source: 'rule_engine', dataTier: 'audio_only',
    fixable: true, suspected: false, where: null, refines: null,
    priorityBase: null, priorityCategoryWeight: null, priorityScopeMultiplier: null,
    scope: null, createdAt: '2026-09-19T00:00:00Z',
    userState: { dismissed: false, applied: false, feedback: null },
    ...patch,
  };
}

describe('timeRangeOf', () => {
  it('reads a start+end from `where` and labels it in the transport clock', () => {
    const t = timeRangeOf(verdict({ where: { start_seconds: 83, end_seconds: 101 } }), 240);
    expect(t).toEqual({ start: 83, end: 101, label: '1:23–1:41' });
  });

  it('falls back to fix.section when `where` has no seconds', () => {
    const t = timeRangeOf(
      verdict({ where: { section_type: 'drop' }, fix: { section: { start_seconds: 30 } } }),
      240,
    );
    expect(t).toEqual({ start: 30, end: null, label: '0:30' });
  });

  it('drops an end that is not after the start, keeping the start', () => {
    const t = timeRangeOf(verdict({ where: { start_seconds: 50, end_seconds: 50 } }), 240);
    expect(t).toEqual({ start: 50, end: null, label: '0:50' });
  });

  it('returns null when there is no range at all', () => {
    expect(timeRangeOf(verdict(), 240)).toBeNull();
    expect(timeRangeOf(verdict({ where: { section_type: 'drop' } }), 240)).toBeNull();
  });

  it('refuses a start past the end of the track or a non-finite one', () => {
    expect(timeRangeOf(verdict({ where: { start_seconds: 9999 } }), 240)).toBeNull();
    expect(timeRangeOf(verdict({ where: { start_seconds: -3 } }), 240)).toBeNull();
    expect(timeRangeOf(verdict({ where: { start_seconds: Number.NaN } }), 240)).toBeNull();
  });

  it('accepts any start when the duration is not known yet', () => {
    expect(timeRangeOf(verdict({ where: { start_seconds: 9999 } }), 0)?.start).toBe(9999);
  });
});

describe('applyGate', () => {
  it('is open with no carry and after a failed carry', () => {
    expect(applyGate('none')).toEqual({ enabled: true, reason: null, showClearPreset: false });
    expect(applyGate('failed').enabled).toBe(true);
  });

  it('is shut while a carried preset is loading, with no clear button yet', () => {
    expect(applyGate('pending')).toEqual({
      enabled: false, reason: 'Loading the carried fix rack…', showClearPreset: false,
    });
  });

  it('is shut with a clear button once a preset is on the rack', () => {
    expect(applyGate('applied')).toEqual({
      enabled: false,
      reason: 'A fix preset is loaded — clear it to A/B single fixes.',
      showClearPreset: true,
    });
  });
});

describe('boardListenFixes', () => {
  function move(patch: Partial<Move> = {}): Move {
    return {
      id: 'm1', title: 'Cut 45 Hz', group: 'quick', sev: 'crit', scope: 'Master bus',
      directive: 'Cut 3 dB at 45 Hz.', directional: 'Tame the sub.', steps: [],
      hasParams: true, why: '', evidence: { type: 'none', metric: '', chartType: null },
      confidence: 0.8, impact: 90, source: 'Low End', isRule: false, specialist: 'low_end',
      status: 'suggested', verdictId: 'v1',
      // Task-3 adaptation: `fixToRackPatch.ts`'s real op vocabulary uses
      // 'peaking_eq' + `frequency_hz` (verified against its own tests), not
      // the brief's 'eq' + `freq` (which `fixToRackPatch` treats as an
      // unrecognized leftover op, making `isApplyable` false and breaking
      // this test's own "notApplicable is false" assertion below).
      ops: [{ type: 'peaking_eq', params: { frequency_hz: 45, gain_db: -3, q: 1 } }],
      ...patch,
    };
  }

  it('keeps every AI move with ops, regardless of what the report queued', () => {
    const fixes = boardListenFixes([move(), move({ id: 'm2', verdictId: 'v2' })]);
    expect(fixes.map((f) => f.fixId)).toEqual(['m1', 'm2']);
    expect(fixes[0].notApplicable).toBe(false);
  });

  it('drops rule-engine prose moves, which have no verdict and no ops', () => {
    expect(boardListenFixes([move({ id: 'r1', verdictId: null, ops: [] })])).toEqual([]);
  });
});
