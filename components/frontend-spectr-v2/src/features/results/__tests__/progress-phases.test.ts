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
