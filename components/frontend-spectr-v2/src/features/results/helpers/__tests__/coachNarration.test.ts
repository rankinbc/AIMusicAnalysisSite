import { describe, expect, it } from 'vitest';

import type { FinalJson, RoutingPlanDto, VerdictDto } from '../../../../api/types';
import {
  REASON_MAX,
  messageText,
  narrate,
  shortReason,
  skipText,
  trimWords,
  type ChatMessage,
  type NarrationInput,
} from '../coachNarration';
import { ordinal } from '../coachPhaseLines';
import type { SpecialistStage, StageRow } from '../specialist-stage';

const byId = (ls: ChatMessage[], id: string) => ls.find((l) => l.id === id);
const txt = (ls: ChatMessage[], id: string) => messageText(byId(ls, id)!);

const fj = (phases: Array<Record<string, unknown>>) => ({ phases }) as unknown as FinalJson;
const p1 = { lufs: -11.94, true_peak_db: -1.6, bpm: 128.2, key_estimate: { key: 'B', mode: 'minor', confidence: 0.72 } };
const full = fj([
  { phase: 1, status: 'ok', data: p1 },
  { phase: 2, status: 'ok', data: { genre: 'trance', confidence: 0.8 } },
  { phase: 3, status: 'ok', data: { genre: 'trance', total_score: 71.6, sub_scores: { low_end: 54, groove: 80 } } },
  { phase: 4, status: 'ok', data: { clashes: [{ stems: 'kick / bass', frequency_range: '40–120 Hz' }] } },
  { phase: 5, status: 'ok', data: { status: 'skipped' } },
  { phase: 6, status: 'ok', data: { percentile: 63.7 } },
  { phase: 7, status: 'ok', data: { arrangement_status: 'pending' } },
  { phase: 9, status: 'ok', data: { surround: { mono_compatibility: 82 }, playback: { speaker_score: 75, headphone_score: 80, bass_translation: 'ok' } } },
  { phase: 8, status: 'skipped', data: {} },
]);

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
// Real stored shape: specialist verdicts carry specialist=<slug>, source=rule_engine.
const v = (specialist: string, headline: string, severity: string) =>
  ({ specialist, headline, severity, source: 'rule_engine', priorityScore: 50 }) as unknown as VerdictDto;
const plan = (rationale?: string): RoutingPlanDto =>
  ({ specialistsToRun: [], skip: [], rationale, estimatedTotalTokens: 0 }) as unknown as RoutingPlanDto;

const run = (over: Partial<NarrationInput> = {}) =>
  narrate({ status: 'complete', fj: full, p1, stage: pending, ...over } as NarrationInput);

describe('narrate — the run, as it lands', () => {
  it('always opens with "Let’s take a look at your mix."', () => {
    expect(narrate({ status: 'queued', fj: {}, stage: pending })[0]).toMatchObject({
      id: 'open',
      speaker: { kind: 'coach' },
    });
    expect(messageText(run()[0]!)).toBe('Let’s take a look at your mix.');
  });

  it('a queued job says so (and only while queued)', () => {
    expect(byId(narrate({ status: 'queued', fj: {}, stage: pending }), 'queued')).toBeDefined();
    expect(byId(narrate({ status: 'analyzing', fj: {}, stage: pending }), 'queued')).toBeUndefined();
  });

  it('narrates phase 1’s early measurements before phase 1 finishes', () => {
    const ls = narrate({ status: 'analyzing', fj: {}, p1: { lufs: -9.2 }, stage: pending });
    expect(ls.map((l) => l.id)).toEqual(['open', 'p1:lufs']);
    expect(txt(ls, 'p1:lufs')).toBe('Integrated loudness: −9.2 LUFS. A loud, club-ready level.');
    const more = narrate({ status: 'analyzing', fj: {}, p1: { lufs: -9.2, true_peak_db: 0.3, clipping_detected: true, clipped_sample_count: 42, bpm: 140 }, stage: pending });
    expect(more.map((l) => l.id)).toEqual(['open', 'p1:lufs', 'p1:peak', 'p1:tempo']);
    expect(txt(more, 'p1:peak')).toBe('True peak 0.3 dBTP — and it’s clipping (42 samples).');
    expect(byId(more, 'p1:peak')!.tone).toBe('warn');
  });

  it('shows off every phase result in run order with real minus signs', () => {
    const ls = run();
    const ids = ls.map((l) => l.id);
    expect(ids.slice(0, 10)).toEqual(['open', 'p1:lufs', 'p1:peak', 'p1:tempo', 'p1:key', 'p2', 'p3', 'p4', 'p6', 'p7:pending']);
    expect(ids).toContain('p9');
    expect(txt(ls, 'p1:key')).toBe('Key: B minor (72% confident).');
    expect(txt(ls, 'p2')).toBe('This reads as trance — 80% confident.');
    expect(txt(ls, 'p3')).toBe('Against the trance profile it scores 72/100. Weakest area: low end (54).');
    expect(txt(ls, 'p4')).toBe('I found 1 frequency clash — the biggest: kick / bass around 40–120 Hz.');
    expect(txt(ls, 'p6')).toBe('That puts you in the 64th percentile against pro trance tracks.');
    expect(txt(ls, 'p9')).toBe('Translation check — mono 82, speakers 75, headphones 80.');
    // No reference / no .als → no line for them.
    expect(byId(ls, 'p5')).toBeUndefined();
    expect(byId(ls, 'p8')).toBeUndefined();
  });

  it('arrangement: a pending line, then a separate settled line (couldn’t detect / graded)', () => {
    const settled = (data: Record<string, unknown>) => run({ fj: fj([{ phase: 7, status: 'ok', data }]) });
    expect(byId(settled({ arrangement_status: 'unavailable' }), 'p7:pending')).toBeUndefined();
    expect(txt(settled({ arrangement_status: 'unavailable' }), 'p7:settled')).toBe(
      'I couldn’t detect a clear structure, so the arrangement isn’t graded.',
    );
    expect(txt(settled({ arrangement_status: 'failed' }), 'p7:settled')).toContain('couldn’t detect');
    expect(txt(settled({ arrangement_status: 'scored', grade: 'B', section_count: 8 }), 'p7:settled')).toBe(
      'Arrangement: grade B across 8 sections.',
    );
  });

  it('a failed phase gets a short "carrying on" line', () => {
    const ls = run({ fj: fj([{ phase: 2, status: 'failed', error: 'boom' }]) });
    expect(txt(ls, 'fail:2')).toBe('Genre didn’t finish — I’ll carry on with the rest.');
  });

  it('stops at the analysis while it runs — no triage talk yet', () => {
    const ls = narrate({ status: 'analyzing', fj: full, p1, stage: pending });
    expect(byId(ls, 'triage')).toBeUndefined();
    expect(byId(ls, 'big-one')).toBeUndefined();
  });
});

describe('narrate — triage, plan, specialists', () => {
  const focusLow =
    'Phase 4 flags high-severity low-end buildup at 20–200 Hz (sub_bass −21.0 dB vs 0.12 mean) and low-mid congestion. The rule engine confirms it.';

  it('when complete: names the biggest rule-engine finding, then "enough information…"', () => {
    const vs = [
      v('rule_engine.a', 'Minor thing', 'minor'),
      v('rule_engine.mud_buildup', 'Severe low-mid buildup', 'severe'),
      v('low_end', 'Specialist critical', 'critical'),
    ];
    const ls = run({ verdicts: vs });
    expect(txt(ls, 'big-one')).toBe('The big one so far: Severe low-mid buildup.');
    expect(ls.at(-1)!.id).toBe('triage');
    expect(txt(ls, 'triage')).toBe('I have enough information to consult some specialists…');
    // A specialist's verdict (specialist=<slug>) is never "the big one".
    expect(byId(run({ verdicts: [vs[2]!] }), 'big-one')).toBeUndefined();
  });

  it('the plan: "I’m going to bring in <names>" then one trimmed reason each, in priority order', () => {
    const ls = run({
      routingPlan: plan(),
      stage: stage([row('stereo_phase', 'Stereo Phase', 'running', 'Correlation 0.12 is critical.'), row('low_end', 'Low End', 'running', focusLow)]),
    });
    expect(txt(ls, 'plan')).toBe('I’m going to bring in Stereo Phase and Low End.');
    const whys = ls.filter((l) => l.id.startsWith('why:'));
    expect(whys.map((l) => l.id)).toEqual(['why:stereo_phase', 'why:low_end']);
    expect(messageText(whys[0]!)).toBe('Stereo Phase — Correlation 0.12 is critical');
    expect(messageText(whys[1]!).length).toBeLessThanOrEqual('Low End — '.length + REASON_MAX + 1);
    expect(messageText(whys[1]!).endsWith('…')).toBe(true);
  });

  it('extracts the skip clause from the rationale, and omits it when absent', () => {
    const r =
      'Critical stereo correlation leads. Skip dynamics (crest 12.9 dB, no clipping), sections (structure detection still pending), and every stem specialist (no stems or .als). Done.';
    const s1 = stage([row('low_end', 'Low End', 'running')]);
    expect(txt(run({ routingPlan: plan(r), stage: s1 }), 'skip').startsWith('Skipping dynamics (crest 12.9 dB, no clipping)')).toBe(true);
    expect(byId(run({ routingPlan: plan('No skips here.'), stage: s1 }), 'skip')).toBeUndefined();
  });

  it('each specialist reports back in its own voice: issue count + top headline (bug A shape)', () => {
    const ls = run({
      verdicts: [
        v('low_end', 'Sub too hot', 'moderate'),
        v('low_end', 'Mud at 300 Hz', 'severe'),
        v('low_end', 'Specialist failed', 'minor'),
        v('rule_engine.mud_buildup', 'Rule mud', 'critical'),
      ],
      routingPlan: plan(),
      stage: stage([row('low_end', 'Low End', 'done'), row('loudness', 'Loudness', 'failed'), row('stereo', 'Stereo', 'done', '', 0)]),
      settleOrder: ['low_end', 'loudness', 'stereo'],
    });
    const back = byId(ls, 'back:low_end')!;
    expect(back.speaker).toEqual({ kind: 'specialist', slug: 'low_end', label: 'Low End', group: 'Spectrum' });
    expect(messageText(back)).toBe('I found 2 issues. Top: “Mud at 300 Hz”');
    expect(txt(ls, 'back:loudness')).toBe('I couldn’t finish — you can re-run me from the full report.');
    expect(byId(ls, 'back:loudness')).toMatchObject({ tone: 'warn', speaker: { kind: 'specialist' } });
    expect(txt(ls, 'back:stereo')).toBe('I found no issues — this part of your mix holds up.');
    expect(ls.at(-1)).toMatchObject({ id: 'all-done', speaker: { kind: 'coach' } });
  });

  it('specialists report back in arrival order (settleOrder), not priority order', () => {
    const s = stage([row('a', 'A', 'done', '', 0), row('b', 'B', 'done', '', 0), row('c', 'C', 'running')]);
    const ls = run({ routingPlan: plan(), stage: s, settleOrder: ['b', 'a'] });
    expect(ls.filter((l) => l.id.startsWith('back:')).map((l) => l.id)).toEqual(['back:b', 'back:a']);
    expect(byId(ls, 'all-done')).toBeUndefined();
  });

  it('a zero-specialist plan says so and has no all-done line', () => {
    const ls = run({ routingPlan: plan(), stage: stage([]) });
    expect(txt(ls, 'plan')).toContain('No specialist deep-dive needed');
    expect(byId(ls, 'all-done')).toBeUndefined();
  });

  it('is stable: the same state yields the same messages', () => {
    const input = { routingPlan: plan(), stage: stage([row('low_end', 'Low End', 'running', focusLow)]) };
    expect(run(input)).toEqual(run(input));
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
  it('ordinal', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 63.7].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '64th']);
  });
});
