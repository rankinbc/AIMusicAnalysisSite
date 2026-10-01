import { describe, expect, it } from 'vitest';

import type { RoutingPlanDto, VerdictDto } from '../../../../api/types';
import { deriveSpecialistStage, findingsLabel } from '../specialist-stage';

const plan = (names: string[]): RoutingPlanDto => ({
  specialistsToRun: names.map((name, i) => ({ name, priority: i + 1, focus: '' })),
  skip: [],
  rationale: '',
  estimatedTotalTokens: 0,
});
const llm = (specialist: string, headline = 'x') =>
  ({ specialist, headline, source: 'llm_identifier' }) as unknown as VerdictDto;

describe('deriveSpecialistStage', () => {
  it('is not ready (and not complete) before triage produces a plan', () => {
    const st = deriveSpecialistStage({
      routingPlan: undefined,
      specialists: [],
      running: new Set(),
      verdicts: [],
      hasStems: false,
    });
    expect(st).toMatchObject({ planReady: false, complete: false, total: 0 });
  });

  it('skips stem-only specialists without stems, keeps them with stems', () => {
    const base = { specialists: [], running: new Set<string>(), verdicts: [] };
    const without = deriveSpecialistStage({ ...base, routingPlan: plan(['low_end', 'stem_balance']), hasStems: false });
    expect(without.rows.map((r) => r.slug)).toEqual(['low_end']);
    const withStems = deriveSpecialistStage({ ...base, routingPlan: plan(['low_end', 'stem_balance']), hasStems: true });
    expect(withStems.rows.map((r) => r.slug)).toEqual(['low_end', 'stem_balance']);
  });

  it('counts failed as settled and derives findings for done rows (fail marker excluded)', () => {
    const st = deriveSpecialistStage({
      routingPlan: plan(['low_end', 'loudness']),
      specialists: [
        { slug: 'low_end', status: 'cached' },
        { slug: 'loudness', status: 'failed' },
      ],
      running: new Set(),
      verdicts: [llm('low_end'), llm('low_end'), llm('loudness', 'Specialist failed')],
      hasStems: false,
    });
    expect(st.rows.map((r) => r.state)).toEqual(['done', 'failed']);
    expect(st.rows[0]!.findings).toBe(2);
    expect(st).toMatchObject({ settled: 2, total: 2, complete: true });
  });

  it('drops idle, non-running specialists once AI verdicts exist (auto-run skipped)', () => {
    const st = deriveSpecialistStage({
      routingPlan: plan(['low_end', 'loudness']),
      specialists: [{ slug: 'low_end', status: 'cached' }],
      running: new Set(),
      verdicts: [llm('low_end')],
      hasStems: false,
    });
    expect(st.rows.map((r) => r.slug)).toEqual(['low_end']);
    expect(st.complete).toBe(true);
  });

  it('does not count rule-engine Problems that share the specialist slug as findings', () => {
    const rule = { specialist: 'low_end', headline: 'Low-end buildup', source: 'rule_engine' } as unknown as VerdictDto;
    const st = deriveSpecialistStage({
      routingPlan: plan(['low_end']),
      specialists: [{ slug: 'low_end', status: 'cached' }],
      running: new Set(),
      verdicts: [rule, rule, llm('low_end')],
      hasStems: false,
    });
    expect(st.rows[0]!.findings).toBe(1);
  });

  it('an empty plan is complete immediately', () => {
    const st = deriveSpecialistStage({
      routingPlan: plan([]),
      specialists: [],
      running: new Set(),
      verdicts: [],
      hasStems: false,
    });
    expect(st).toMatchObject({ planReady: true, total: 0, complete: true });
  });
});

describe('findingsLabel', () => {
  it('pluralises', () => {
    expect(findingsLabel(undefined)).toBe('');
    expect(findingsLabel(0)).toBe('no issues');
    expect(findingsLabel(1)).toBe('1 finding');
    expect(findingsLabel(3)).toBe('3 findings');
  });
});
