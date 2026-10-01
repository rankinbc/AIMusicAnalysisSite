import { describe, expect, it } from 'vitest';

import type { FinalJson, RoutingPlanDto, VerdictDto } from '../../../../api/types';
import {
  REASON_MAX,
  narrate,
  shortReason,
  skipText,
  trimWords,
  type CoachLine,
  type LinePart,
} from '../coachNarration';
import type { SpecialistStage, StageRow } from '../specialist-stage';

const text = (l: CoachLine) =>
  l.parts.map((p: LinePart) => (typeof p === 'string' ? p : 'b' in p ? p.b : p.i)).join('');
const byId = (ls: CoachLine[], id: string) => ls.find((l) => l.id === id);

const fj = (p1: Record<string, unknown>) =>
  ({ phases: [{ phase: 1, status: 'ok', data: p1 }] }) as unknown as FinalJson;
const calm = fj({ lufs: -11.94, true_peak_db: -1.6, bpm: 128.2, key_estimate: { key: 'B', mode: 'minor' } });

const row = (slug: string, label: string, state: StageRow['state'], focus = '', findings?: number): StageRow => ({
  slug,
  label,
  group: 'Spectrum',
  focus,
  state,
  findings,
});
const stage = (rows: StageRow[], planReady = true): SpecialistStage => {
  const settled = rows.filter((r) => r.state === 'done' || r.state === 'failed').length;
  return { planReady, rows, settled, total: rows.length, complete: planReady && settled === rows.length };
};
const pending: SpecialistStage = { planReady: false, rows: [], settled: 0, total: 0, complete: false };
const v = (specialist: string, headline: string, severity: string, source = 'llm_identifier') =>
  ({ specialist, headline, severity, source, priorityScore: 50 }) as unknown as VerdictDto;
const plan = (rationale?: string): RoutingPlanDto =>
  ({ specialistsToRun: [], skip: [], rationale, estimatedTotalTokens: 0 }) as unknown as RoutingPlanDto;

describe('narrate — static + triage', () => {
  it('summarises the key measurements with real minus signs', () => {
    const ls = narrate({ fj: calm, verdicts: [], routingPlan: undefined, stage: pending });
    expect(text(byId(ls, 'static')!)).toBe(
      'Your mix sits at −11.9 LUFS, peaks at −1.6 dBTP and is in B minor @ 128 BPM.',
    );
  });

  it('puts flagged measurements (clipping, hot peak) first', () => {
    const hot = fj({ lufs: -7, true_peak_db: 0.3, clipping_detected: true, clipped_sample_count: 42, bpm: 140 });
    const t = text(byId(narrate({ fj: hot, verdicts: [], routingPlan: undefined, stage: pending }), 'static')!);
    expect(t.startsWith('Your mix is clipping (42 samples), peaks hot at 0.3 dBTP')).toBe(true);
  });

  it('omits the static line when phase 1 did not run', () => {
    const none = { phases: [{ phase: 1, status: 'failed' }] } as unknown as FinalJson;
    expect(byId(narrate({ fj: none, verdicts: [], routingPlan: undefined, stage: pending }), 'static')).toBeUndefined();
  });

  it('names the biggest rule-engine finding by severity, and omits it without one', () => {
    const vs = [
      v('rule_engine.a', 'Minor thing', 'minor', 'rule_engine'),
      v('rule_engine.b', 'Severe low-mid buildup', 'severe', 'rule_engine'),
      v('low_end', 'LLM critical', 'critical'),
    ];
    expect(text(byId(narrate({ fj: calm, verdicts: vs, routingPlan: undefined, stage: pending }), 'big-one')!)).toBe(
      'The big one: Severe low-mid buildup.',
    );
    expect(byId(narrate({ fj: calm, verdicts: [vs[2]!], routingPlan: undefined, stage: pending }), 'big-one')).toBeUndefined();
  });

  it('shows a pending "picking" line until the plan lands, then replaces it', () => {
    const before = narrate({ fj: calm, verdicts: [], routingPlan: undefined, stage: pending });
    expect(before.at(-1)).toMatchObject({ id: 'picking', tone: 'pending' });
    const after = narrate({ fj: calm, verdicts: [], routingPlan: plan(), stage: stage([row('low_end', 'Low End', 'running')]) });
    expect(byId(after, 'picking')).toBeUndefined();
    expect(text(byId(after, 'plan')!)).toBe('I’m bringing in 1 specialist:');
  });
});

describe('narrate — plan + specialists', () => {
  const focusLow =
    'Phase 4 flags high-severity low-end buildup at 20–200 Hz (sub_bass −21.0 dB vs 0.12 mean) and low-mid congestion. The rule engine confirms it.';

  it('lists specialists in stage (priority) order with a trimmed first-sentence reason', () => {
    const ls = narrate({
      fj: calm,
      verdicts: [],
      routingPlan: plan(),
      stage: stage([row('stereo_phase', 'Stereo Phase', 'running', 'Correlation 0.12 is critical.'), row('low_end', 'Low End', 'running', focusLow)]),
    });
    const whys = ls.filter((l) => l.id.startsWith('why:'));
    expect(whys.map((l) => l.id)).toEqual(['why:stereo_phase', 'why:low_end']);
    expect(text(whys[0]!)).toBe('Stereo Phase: Correlation 0.12 is critical');
    expect(text(whys[1]!).length).toBeLessThanOrEqual('Low End: '.length + REASON_MAX + 1);
    expect(text(whys[1]!).endsWith('…')).toBe(true);
  });

  it('falls back to just the name when focus is missing', () => {
    const ls = narrate({ fj: calm, verdicts: [], routingPlan: plan(), stage: stage([row('loudness', 'Loudness', 'running')]) });
    expect(text(byId(ls, 'why:loudness')!)).toBe('Loudness');
  });

  it('extracts the skip clause from the rationale, and omits it when absent', () => {
    const r =
      'Critical stereo correlation leads. Skip dynamics (crest 12.9 dB, no clipping), sections (structure detection still pending), and every stem specialist (no stems or .als). Done.';
    const ls = narrate({ fj: calm, verdicts: [], routingPlan: plan(r), stage: stage([row('low_end', 'Low End', 'running')]) });
    expect(text(byId(ls, 'skip')!).startsWith('Skipping dynamics (crest 12.9 dB, no clipping)')).toBe(true);
    const none = narrate({ fj: calm, verdicts: [], routingPlan: plan('No skips here.'), stage: stage([row('low_end', 'Low End', 'running')]) });
    expect(byId(none, 'skip')).toBeUndefined();
    const missing = narrate({ fj: calm, verdicts: [], routingPlan: plan(undefined), stage: stage([row('low_end', 'Low End', 'running')]) });
    expect(byId(missing, 'skip')).toBeUndefined();
  });

  it('reports each specialist back with its findings and top headline, failures with a re-run hint', () => {
    const ls = narrate({
      fj: calm,
      verdicts: [v('low_end', 'Sub too hot', 'moderate'), v('low_end', 'Mud at 300 Hz', 'severe')],
      routingPlan: plan(),
      stage: stage([row('low_end', 'Low End', 'done', '', 2), row('loudness', 'Loudness', 'failed')]),
    });
    expect(text(byId(ls, 'back:low_end')!)).toBe('Low End is back: 2 findings — top: “Mud at 300 Hz”');
    expect(byId(ls, 'back:loudness')).toMatchObject({ tone: 'warn' });
    expect(text(byId(ls, 'back:loudness')!)).toBe('Loudness couldn’t finish — you can re-run it from the full report.');
    expect(ls.at(-1)).toMatchObject({ id: 'all-done', tone: 'done' });
    expect(text(ls.at(-1)!)).toBe('That’s everyone. Here’s the full picture →');
  });

  it('appends settled lines in arrival order (settleOrder), not priority order', () => {
    const s = stage([row('a', 'A', 'done', '', 0), row('b', 'B', 'done', '', 0), row('c', 'C', 'running')]);
    const ls = narrate({ fj: calm, verdicts: [], routingPlan: plan(), stage: s, settleOrder: ['b', 'a'] });
    expect(ls.filter((l) => l.id.startsWith('back:')).map((l) => l.id)).toEqual(['back:b', 'back:a']);
    expect(byId(ls, 'all-done')).toBeUndefined();
  });

  it('a zero-specialist plan says so and has no all-done line', () => {
    const ls = narrate({ fj: calm, verdicts: [], routingPlan: plan(), stage: stage([]) });
    expect(text(byId(ls, 'plan')!)).toContain('No specialist deep-dive needed');
    expect(byId(ls, 'all-done')).toBeUndefined();
  });

  it('is stable: the same state yields the same line ids', () => {
    const input = { fj: calm, verdicts: [], routingPlan: plan(), stage: stage([row('low_end', 'Low End', 'running', focusLow)]) };
    expect(narrate(input).map((l) => l.id)).toEqual(narrate(input).map((l) => l.id));
  });
});

describe('text helpers', () => {
  it('trimWords cuts at a word boundary with an ellipsis', () => {
    expect(trimWords('short', 10)).toBe('short');
    expect(trimWords('one two three four five', 12)).toBe('one two…');
  });
  it('shortReason keeps decimals intact and stops at the first sentence', () => {
    expect(shortReason('Width 0.12 is narrow. Second sentence.')).toBe('Width 0.12 is narrow');
    expect(shortReason(undefined)).toBe('');
  });
  it('skipText handles "Skipping" too', () => {
    expect(skipText('Skipping harmonic (B minor at 0.86 confidence).')).toBe('harmonic (B minor at 0.86 confidence)');
  });
});
