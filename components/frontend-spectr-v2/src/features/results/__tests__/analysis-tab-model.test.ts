import { describe, expect, it } from 'vitest';

import type {
  FinalJson,
  VerdictDto,
  VerdictsListResponse,
  VersionFileEntry,
} from '../../../api/types';
import {
  buildInProgress,
  buildInputRows,
  buildModuleRows,
  buildSpecialistRows,
  isBuiltInCheck,
  pickTopTips,
} from '../analysis-tab-model';

function makeVerdict(over: Partial<VerdictDto> = {}): VerdictDto {
  return {
    id: 'v1',
    analysisId: 'a1',
    specialist: 'loudness',
    promptVersion: '1',
    model: 'test',
    severity: 'moderate',
    category: 'loudness',
    confidence: 0.9,
    priorityScore: 50,
    priorityBase: null,
    priorityCategoryWeight: null,
    priorityScopeMultiplier: null,
    scope: null,
    impact: null,
    chartType: 'none',
    headline: 'A finding',
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
    // On-demand specialist rows default to 'rule_engine' in the worker — the
    // model must key on `specialist`, never `source`.
    source: 'rule_engine',
    dataTier: 'audio_only',
    fixable: true,
    suspected: false,
    where: null,
    refines: null,
    createdAt: '2026-09-21T00:00:00Z',
    userState: { dismissed: false, applied: false, feedback: null },
    ...over,
  } as VerdictDto;
}

function file(type: VersionFileEntry['type'], filename: string): VersionFileEntry {
  return { type, filename, sizeBytes: 1, available: true, stemId: null };
}

// What the pipeline writes for a mix-only run: stems `{}`, phase 8 skipped,
// phase 5 row ok with an INNER skipped status.
const mixOnly: FinalJson = {
  phases: [
    { phase: 1, name: 'p1', status: 'ok', data: { lufs: -14.2, bpm: 144, detected_key: 'G#' } },
    { phase: 4, name: 'p4', status: 'ok', data: { clashes: [], stems: {} } },
    { phase: 5, name: 'p5', status: 'ok', data: { status: 'skipped', deltas: {} } },
    { phase: 7, name: 'p7', status: 'ok', data: { arrangement_status: 'scored', grade: 'D' } },
    { phase: 8, name: 'p8', status: 'skipped', data: {} },
  ],
};

const noRunning: ReadonlySet<string> = new Set();

describe('buildInputRows', () => {
  it('treats the empty phase4.stems object and a skipped phase 8 as missing', () => {
    const rows = buildInputRows(mixOnly, [file('mix', 'paper-moon.wav')], 'Paper Moon');
    expect(rows.map((r) => [r.kind, r.state])).toEqual([
      ['mix', 'analyzed'],
      ['stems', 'missing'],
      ['als', 'missing'],
      ['reference', 'missing'],
    ]);
    expect(rows[0]!.detail).toBe('paper-moon.wav');
  });

  it('marks inputs analyzed from phase results, and uploaded-but-unused ones attached', () => {
    const fj: FinalJson = {
      phases: [
        { phase: 4, name: 'p4', status: 'ok', data: { stems: { status: 'ok', mode: 'grouped' } } },
        { phase: 5, name: 'p5', status: 'ok', data: { status: 'skipped' } },
        { phase: 8, name: 'p8', status: 'ok', data: { health_score: 80 } },
      ],
    };
    const rows = buildInputRows(
      fj,
      [file('stem', 'kick.wav'), file('stem', 'bass.wav'), file('als', 'song.als'), file('reference', 'ref.wav')],
      'Song',
    );
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]));
    expect(byKind.stems!.state).toBe('analyzed');
    expect(byKind.stems!.detail).toMatch(/^2 stems/);
    expect(byKind.als!.state).toBe('analyzed');
    expect(byKind.als!.detail).toBe('song.als');
    expect(byKind.reference!.state).toBe('attached');
  });

  it('reports failed stem and project analysis as failed, not missing', () => {
    const fj: FinalJson = {
      phases: [
        { phase: 4, name: 'p4', status: 'ok', data: { stems: { status: 'failed', error: 'boom' } } },
        { phase: 8, name: 'p8', status: 'failed', error: 'sandbox', data: {} },
      ],
    };
    const rows = buildInputRows(fj, undefined, 'Song');
    expect(rows.find((r) => r.kind === 'stems')!.state).toBe('failed');
    expect(rows.find((r) => r.kind === 'als')!.state).toBe('failed');
    // No version files loaded yet — the mix falls back to the song name.
    expect(rows[0]!.detail).toBe('Song');
  });
});

describe('buildModuleRows', () => {
  it('flags a pending background arrangement job as running', () => {
    const fj: FinalJson = {
      phases: [
        { phase: 1, name: 'p1', status: 'ok', data: {} },
        { phase: 7, name: 'p7', status: 'ok', data: { arrangement_status: 'pending' } },
      ],
    };
    const rows = buildModuleRows(fj);
    expect(rows.find((r) => r.phase === 7)).toMatchObject({ status: 'running', label: 'Arrangement' });
    expect(rows.find((r) => r.phase === 1)?.status).toBe('ok');
  });

  it('keeps skipped and failed phases distinct', () => {
    const rows = buildModuleRows(mixOnly);
    expect(rows.find((r) => r.phase === 5)?.status).toBe('skipped'); // inner skipped
    expect(rows.find((r) => r.phase === 8)?.status).toBe('skipped');
  });
});

describe('buildSpecialistRows', () => {
  const base: VerdictsListResponse = {
    verdicts: [
      makeVerdict({ id: 'r1', specialist: 'rule_engine.clipping_count', severity: 'severe' }),
      makeVerdict({ id: 'r2', specialist: 'rule_engine.true_peak', severity: 'minor' }),
      makeVerdict({ id: 's1', specialist: 'loudness', severity: 'minor' }),
      makeVerdict({ id: 's2', specialist: 'loudness', severity: 'critical' }),
      makeVerdict({ id: 's3', specialist: 'stereo_phase', severity: 'moderate' }),
      makeVerdict({ id: 'f1', specialist: 'clarity', headline: 'Specialist failed' }),
    ],
    specialists: [
      { slug: 'loudness', status: 'cached' },
      { slug: 'stereo_phase', status: 'cached' },
      { slug: 'clarity', status: 'failed' },
      { slug: 'frequency_balance', status: 'idle' },
      { slug: 'sections', status: 'idle' },
      { slug: 'stem_balance', status: 'idle' },
    ],
    routingPlan: {
      specialistsToRun: [
        { name: 'frequency_balance', priority: 1, focus: 'Low-mid buildup' },
        { name: 'sections', priority: 2, focus: 'Drop contrast' },
        { name: 'stem_balance', priority: 3, focus: 'Bass vs kick' },
      ],
      skip: [],
      rationale: 'r',
      estimatedTotalTokens: 0,
    },
  };

  it('counts findings per specialist and aggregates the rule engine as built-in checks', () => {
    const s = buildSpecialistRows({ data: base, running: noRunning, hasStems: false });
    expect(s.builtIn).toEqual({ count: 2, severities: ['severe', 'minor'] });
    const loud = s.rows.find((r) => r.slug === 'loudness')!;
    expect(loud).toMatchObject({ state: 'ran', count: 2, label: 'Loudness' });
    expect(loud.severities).toEqual(['critical', 'minor']); // most severe first
    expect(s.rows.find((r) => r.slug === 'stereo_phase')).toMatchObject({ state: 'ran', count: 1 });
    expect(s.triage).toBe('done');
    expect(s.ran).toBe(3); // loudness, stereo_phase, clarity (no findings)
  });

  it('excludes the fail marker and shows a failed specialist as no-findings', () => {
    const s = buildSpecialistRows({ data: base, running: noRunning, hasStems: false });
    expect(s.rows.find((r) => r.slug === 'clarity')).toMatchObject({ state: 'no-findings', count: 0 });
  });

  it('lets a running slug override idle, and gates stem specialists on stems', () => {
    const s = buildSpecialistRows({
      data: base,
      running: new Set(['frequency_balance']),
      hasStems: false,
    });
    const states = Object.fromEntries(s.rows.map((r) => [r.slug, r.state]));
    expect(states).toMatchObject({
      frequency_balance: 'running',
      sections: 'suggested',
      stem_balance: 'needs-stems',
    });
    // Order: running → ran (by count) → no-findings → suggested → needs-stems.
    expect(s.rows.map((r) => r.slug)).toEqual([
      'frequency_balance',
      'loudness',
      'stereo_phase',
      'clarity',
      'sections',
      'stem_balance',
    ]);
    expect(s.rows.find((r) => r.slug === 'sections')?.focus).toBe('Drop contrast');
    expect(s.suggested).toBe(2);
  });

  it('treats a stem specialist as suggested once stems are analyzed', () => {
    const s = buildSpecialistRows({ data: base, running: noRunning, hasStems: true });
    expect(s.rows.find((r) => r.slug === 'stem_balance')?.state).toBe('suggested');
  });

  it('reports triage pending, unavailable and loading', () => {
    const noPlan = { ...base, routingPlan: undefined } as unknown as VerdictsListResponse;
    expect(buildSpecialistRows({ data: noPlan, running: noRunning, hasStems: false }).triage).toBe('pending');
    const degraded = {
      ...noPlan,
      degradation: { reason: 'triage_failed', detail: null, occurredAt: '2026-09-21T00:00:00Z' },
    } as VerdictsListResponse;
    expect(buildSpecialistRows({ data: degraded, running: noRunning, hasStems: false }).triage).toBe(
      'unavailable',
    );
    const loading = buildSpecialistRows({ data: undefined, running: noRunning, hasStems: false });
    expect(loading.triage).toBe('loading');
    expect(loading.rows).toEqual([]);
    expect(loading.builtIn.count).toBe(0);
  });

  it('counts the catalog specialists nobody ran or suggested', () => {
    const s = buildSpecialistRows({ data: base, running: noRunning, hasStems: false });
    // 26 catalog specialists − 6 listed rows.
    expect(s.otherAvailable).toBe(20);
  });

  it('keys built-in checks on specialist, not source', () => {
    expect(isBuiltInCheck({ specialist: 'rule_engine' })).toBe(true);
    expect(isBuiltInCheck({ specialist: 'rule_engine.low_end_buildup' })).toBe(true);
    expect(isBuiltInCheck({ specialist: 'low_end' })).toBe(false);
  });
});

describe('pickTopTips', () => {
  it('returns the three most severe coaching fixes, worst first', () => {
    const fj: FinalJson = {
      coached_fixes: [
        'Your mix is a touch wide on top. Pull the hats in a little.',
        'I found 13 hard-clipped samples at the master output. Pull the limiter ceiling back 1–2 dB.',
        'The low end is muddy around 250 Hz. Cut 2 dB on the pads.',
        'Your integrated loudness is quiet. Nudge the limiter up.',
        'Stereo width is narrow. Widen the pads.',
      ],
    };
    const tips = pickTopTips(fj);
    expect(tips).toHaveLength(3);
    expect(tips[0]!.sev).toBe('crit');
    expect(tips[0]!.title).toMatch(/hard-clipped/);
    expect(tips.slice(1).every((t) => t.sev === 'mod')).toBe(true);
  });

  it('drops wins and the pipeline filler fix', () => {
    const fj: FinalJson = {
      coached_fixes: [],
      top_fixes: ['Optimize mix levels for streaming targets'],
      phases: [{ phase: 6, name: 'p6', status: 'ok', data: { percentile: 50 } }],
    };
    expect(pickTopTips(fj)).toEqual([]);
  });

  it('returns fewer than three when that is all there is', () => {
    expect(pickTopTips({ coached_fixes: ['Clipping at the master. Pull the ceiling back.'] })).toHaveLength(1);
    expect(pickTopTips({})).toEqual([]);
  });
});

describe('buildInProgress', () => {
  it('lists every live piece of work in a stable order', () => {
    const items = buildInProgress({
      triagePending: true,
      running: new Set(['frequency_balance', 'mystery_slug']),
      arrangementPending: true,
      coachMixCompiling: true,
    });
    expect(items.map((i) => i.label)).toEqual([
      'Picking specialists for this track',
      'Frequency Balance is listening',
      'Mystery slug is listening',
      'Detecting song sections',
      'Compiling your Coach Mix',
    ]);
  });

  it('is empty when nothing is running', () => {
    expect(
      buildInProgress({
        triagePending: false,
        running: noRunning,
        arrangementPending: false,
        coachMixCompiling: false,
      }),
    ).toEqual([]);
  });
});
