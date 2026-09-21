import { describe, expect, it } from 'vitest';

import { buildProgressPlan } from '../progress-phases';

// Task G0 — the checklist must not claim optional analyses (stems, reference,
// .als) ran when the visitor never supplied that input. buildProgressPlan is
// the pure row-building function; ProgressStoryline.test.tsx covers the
// component's rendering of these rows against currentPhase.

const STEM_BENEFIT =
  'Upload your stems to see which instruments are fighting each other, with balance and width advice for each one.';
const REFERENCE_BENEFIT =
  'Add a reference track to see how your mix measures up to a record you love: loudness, tone and width, side by side.';
const ALS_BENEFIT =
  'Add your Ableton project (.als) to get advice that names your actual tracks and devices.';

describe('buildProgressPlan', () => {
  it('all-false (mix only): stems/reference/als all not-included with benefits', () => {
    const plan = buildProgressPlan({ hasStems: false, hasReference: false, hasAls: false });
    expect(plan.map((r) => r.label)).toEqual([
      'Universal Mix Analysis',
      'Genre Detection',
      'Genre-Specific Scoring',
      'Frequency Clash Check',
      'Per-Stem Analysis',
      'Reference Comparison',
      'Gap Analysis',
      'Arrangement Advice',
      'Ableton Project Analysis',
    ]);
    expect(plan.map((r) => r.kind)).toEqual([
      'runs', 'runs', 'runs', 'runs', 'not-included', 'not-included', 'runs', 'runs', 'not-included',
    ]);
    const byLabel = Object.fromEntries(plan.map((r) => [r.label, r]));
    expect(byLabel['Per-Stem Analysis']!.benefit).toBe(STEM_BENEFIT);
    expect(byLabel['Reference Comparison']!.benefit).toBe(REFERENCE_BENEFIT);
    expect(byLabel['Ableton Project Analysis']!.benefit).toBe(ALS_BENEFIT);
    // phaseIndex ties display rows back to the worker's phase sequence —
    // absent on not-included rows, present (and stable) on runs rows.
    expect(byLabel['Universal Mix Analysis']!.phaseIndex).toBe(0);
    expect(byLabel['Genre Detection']!.phaseIndex).toBe(1);
    expect(byLabel['Genre-Specific Scoring']!.phaseIndex).toBe(2);
    expect(byLabel['Frequency Clash Check']!.phaseIndex).toBe(3);
    expect(byLabel['Gap Analysis']!.phaseIndex).toBe(5);
    expect(byLabel['Arrangement Advice']!.phaseIndex).toBe(6);
    expect(byLabel['Per-Stem Analysis']!.phaseIndex).toBeUndefined();
    expect(byLabel['Reference Comparison']!.phaseIndex).toBeUndefined();
    expect(byLabel['Ableton Project Analysis']!.phaseIndex).toBeUndefined();
  });

  it('all-true: every optional row runs, no Per-Stem Analysis row inserted', () => {
    const plan = buildProgressPlan({ hasStems: true, hasReference: true, hasAls: true });
    expect(plan.map((r) => r.label)).toEqual([
      'Universal Mix Analysis',
      'Genre Detection',
      'Genre-Specific Scoring',
      'Stem Analysis & Clash',
      'Reference Comparison',
      'Gap Analysis',
      'Arrangement Advice',
      'Ableton Project Analysis',
    ]);
    expect(plan.every((r) => r.kind === 'runs')).toBe(true);
    const byLabel = Object.fromEntries(plan.map((r) => [r.label, r]));
    expect(byLabel['Stem Analysis & Clash']!.phaseIndex).toBe(3);
    expect(byLabel['Reference Comparison']!.phaseIndex).toBe(4);
    expect(byLabel['Ableton Project Analysis']!.phaseIndex).toBe(7);
  });

  it('hasStems only: phase 4 becomes Stem Analysis & Clash, no Per-Stem row; reference + als not-included', () => {
    const plan = buildProgressPlan({ hasStems: true, hasReference: false, hasAls: false });
    expect(plan.map((r) => r.label)).toEqual([
      'Universal Mix Analysis',
      'Genre Detection',
      'Genre-Specific Scoring',
      'Stem Analysis & Clash',
      'Reference Comparison',
      'Gap Analysis',
      'Arrangement Advice',
      'Ableton Project Analysis',
    ]);
    const byLabel = Object.fromEntries(plan.map((r) => [r.label, r]));
    expect(byLabel['Stem Analysis & Clash']!.kind).toBe('runs');
    expect(byLabel['Reference Comparison']!.kind).toBe('not-included');
    expect(byLabel['Reference Comparison']!.benefit).toBe(REFERENCE_BENEFIT);
    expect(byLabel['Ableton Project Analysis']!.kind).toBe('not-included');
    expect(byLabel['Ableton Project Analysis']!.benefit).toBe(ALS_BENEFIT);
  });

  it('hasReference only: Reference Comparison runs; stems + als not-included', () => {
    const plan = buildProgressPlan({ hasStems: false, hasReference: true, hasAls: false });
    expect(plan.map((r) => r.label)).toEqual([
      'Universal Mix Analysis',
      'Genre Detection',
      'Genre-Specific Scoring',
      'Frequency Clash Check',
      'Per-Stem Analysis',
      'Reference Comparison',
      'Gap Analysis',
      'Arrangement Advice',
      'Ableton Project Analysis',
    ]);
    const byLabel = Object.fromEntries(plan.map((r) => [r.label, r]));
    expect(byLabel['Per-Stem Analysis']!.kind).toBe('not-included');
    expect(byLabel['Per-Stem Analysis']!.benefit).toBe(STEM_BENEFIT);
    expect(byLabel['Reference Comparison']!.kind).toBe('runs');
    expect(byLabel['Reference Comparison']!.phaseIndex).toBe(4);
    expect(byLabel['Ableton Project Analysis']!.kind).toBe('not-included');
  });

  it('hasAls only: Ableton Project Analysis runs; stems + reference not-included', () => {
    const plan = buildProgressPlan({ hasStems: false, hasReference: false, hasAls: true });
    expect(plan.map((r) => r.label)).toEqual([
      'Universal Mix Analysis',
      'Genre Detection',
      'Genre-Specific Scoring',
      'Frequency Clash Check',
      'Per-Stem Analysis',
      'Reference Comparison',
      'Gap Analysis',
      'Arrangement Advice',
      'Ableton Project Analysis',
    ]);
    const byLabel = Object.fromEntries(plan.map((r) => [r.label, r]));
    expect(byLabel['Per-Stem Analysis']!.kind).toBe('not-included');
    expect(byLabel['Reference Comparison']!.kind).toBe('not-included');
    expect(byLabel['Ableton Project Analysis']!.kind).toBe('runs');
    expect(byLabel['Ableton Project Analysis']!.phaseIndex).toBe(7);
  });
});

// Fix round 1 (C1) — a row's `matchKey` is the LITERAL worker progress_cb
// string; its `label` is display copy. They must never be conflated: the
// worker always emits "ALS Analysis" (audio_analysis/pipeline.py ~260, ~266,
// ~314, ~321), never the display label "Ableton Project Analysis".
describe('buildProgressPlan — match keys are the worker\'s literal strings, not labels', () => {
  it('runs rows carry the literal worker phase-callback string as matchKey', () => {
    const plan = buildProgressPlan({ hasStems: false, hasReference: false, hasAls: false });
    const byKey = Object.fromEntries(plan.map((r) => [r.key, r]));
    expect(byKey['universal-mix']!.matchKey).toBe('Universal Mix Analysis');
    expect(byKey['genre-detection']!.matchKey).toBe('Genre Detection');
    expect(byKey['genre-scoring']!.matchKey).toBe('Genre-Specific Scoring');
    expect(byKey['clash']!.matchKey).toBe('Stem Separation & Clash');
    expect(byKey['gap-analysis']!.matchKey).toBe('Gap Analysis');
    expect(byKey['arrangement']!.matchKey).toBe('Arrangement Advice');
    // not-included rows never carry a matchKey — they're never "current".
    expect(byKey['per-stem']!.matchKey).toBeUndefined();
    expect(byKey['reference']!.matchKey).toBeUndefined();
    expect(byKey['als']!.matchKey).toBeUndefined();
  });

  it('the ALS row: matchKey is "ALS Analysis", label stays "Ableton Project Analysis" — they differ on purpose', () => {
    const plan = buildProgressPlan({ hasStems: false, hasReference: false, hasAls: true });
    const als = plan.find((r) => r.key === 'als')!;
    expect(als.label).toBe('Ableton Project Analysis');
    expect(als.matchKey).toBe('ALS Analysis');
    expect(als.matchKey).not.toBe(als.label);
  });

  it('the clash row: matchKey is always "Stem Separation & Clash" regardless of hasStems', () => {
    const withStems = buildProgressPlan({ hasStems: true, hasReference: false, hasAls: false });
    const withoutStems = buildProgressPlan({ hasStems: false, hasReference: false, hasAls: false });
    expect(withStems.find((r) => r.key === 'clash')!.matchKey).toBe('Stem Separation & Clash');
    expect(withoutStems.find((r) => r.key === 'clash')!.matchKey).toBe('Stem Separation & Clash');
  });
});

// Fix round 1 (I2) — each 'runs' row carries its own one-line explainer so
// the anon /analyze rotation and the "How analysis works" block both
// describe phase 4 correctly for THIS upload, not a hard-coded stem copy.
describe('buildProgressPlan — per-row explainers', () => {
  it('phase 4 explainer is mix-wide without stems, stem-specific with stems', () => {
    const withStems = buildProgressPlan({ hasStems: true, hasReference: false, hasAls: false });
    const withoutStems = buildProgressPlan({ hasStems: false, hasReference: false, hasAls: false });
    expect(withoutStems.find((r) => r.key === 'clash')!.explainer).toBe(
      'where parts of your mix compete for the same frequencies.',
    );
    expect(withStems.find((r) => r.key === 'clash')!.explainer).toBe(
      'where instruments fight for the same frequencies.',
    );
  });

  it('not-included rows never carry an explainer (they carry a benefit instead)', () => {
    const plan = buildProgressPlan({ hasStems: false, hasReference: false, hasAls: false });
    const notIncluded = plan.filter((r) => r.kind === 'not-included');
    expect(notIncluded.length).toBeGreaterThan(0);
    for (const row of notIncluded) expect(row.explainer).toBeUndefined();
  });
});
