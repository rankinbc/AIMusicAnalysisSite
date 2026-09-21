import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ProgressStorylineView } from '../ProgressStoryline';

// Story 12.2 (AC3) — the per-phase progress storyline. Static renders of the
// presentational core (the container only adds the elapsed tick + the shared
// useWorkerHealth poll).

const base = {
  status: 'processing',
  currentPhase: 'Genre Detection',
  phasePct: 0.2,
  elapsedMs: 90_000,
  workerOffline: false,
};

describe('ProgressStorylineView', () => {
  it('pending + healthy: lists all 7 phases, none current, no hints', () => {
    const html = renderToStaticMarkup(
      <ProgressStorylineView
        {...base}
        status="pending"
        currentPhase="queued"
        phasePct={0}
        elapsedMs={30_000}
      />,
    );
    expect(html).toContain('Universal Mix Analysis');
    expect(html).toContain('Arrangement Advice');
    expect(html).toContain('waiting for the analysis worker');
    expect(html).not.toContain('aria-current');
    expect(html).not.toContain('appears to be down');
    expect(html).not.toContain('Taking longer than usual');
    // A sentinel is a job state, not a phase — never an appended row.
    expect(html).not.toContain('>queued<');
  });

  it('processing mid-phase: earlier phases done, current highlighted, elapsed shown', () => {
    const html = renderToStaticMarkup(
      <ProgressStorylineView
        {...base}
        currentPhase="Genre-Specific Scoring"
        phasePct={0.35}
        elapsedMs={125_000}
      />,
    );
    // One aria-current step, on the in-flight phase.
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="step"[^>]*>[^<]*<[^>]*>[^<]*<\/span>Genre-Specific Scoring/);
    // 2:05 elapsed.
    expect(html).toContain('2:05');
  });

  it('worker offline: immediate hint, regardless of elapsed', () => {
    const html = renderToStaticMarkup(
      <ProgressStorylineView
        {...base}
        elapsedMs={10_000}
        workerOffline
      />,
    );
    expect(html).toContain('appears to be down');
  });

  it('long-elapsed: "taking longer than usual" after 10 min while processing', () => {
    const html = renderToStaticMarkup(
      <ProgressStorylineView {...base} elapsedMs={11 * 60_000} />,
    );
    expect(html).toContain('Taking longer than usual');
  });

  it('pending over 2 min also counts as slow', () => {
    const html = renderToStaticMarkup(
      <ProgressStorylineView
        {...base}
        status="pending"
        currentPhase="queued"
        elapsedMs={3 * 60_000}
      />,
    );
    expect(html).toContain('Taking longer than usual');
  });

  it('unknown phase name is tolerated as an appended current row', () => {
    const html = renderToStaticMarkup(
      <ProgressStorylineView
        {...base}
        currentPhase="Mix Translation"
        phasePct={0.95}
      />,
    );
    expect(html).toContain('Mix Translation');
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    // High overall pct checks off the base phases.
    expect(html).toContain('✓');
  });

  it('C1 fix round 1: currentPhase is the worker\'s REAL string "ALS Analysis" + hasAls true — Ableton row is current, no duplicate row', () => {
    // Task G0 folded the ALS phase into the plan as a real row (phaseIndex 7)
    // instead of an appended "unknown phase" row. The worker never emits the
    // display label "Ableton Project Analysis" — it always emits the literal
    // "ALS Analysis" (audio_analysis/pipeline.py ~260/~266/~314/~321), so the
    // match must key off that string, not the label.
    const html = renderToStaticMarkup(
      <ProgressStorylineView
        {...base}
        currentPhase="ALS Analysis"
        phasePct={7 / 8}
        inputs={{ hasStems: false, hasReference: false, hasAls: true }}
      />,
    );
    const phaseList = html.slice(0, html.indexOf('</ol>'));
    // 6 earlier runs-rows done + the ALS row itself current — no ○ left among
    // runs rows (the 2 not-included rows render their own "Not included" tag,
    // never a ○/●/✓ mark).
    expect(phaseList.match(/✓/g)).toHaveLength(6);
    expect(phaseList.match(/aria-current="step"/g)).toHaveLength(1);
    expect(phaseList).not.toContain('○');
    // No duplicate/appended row for the phase — exactly one Ableton row, and
    // it is the current one.
    expect(phaseList.match(/Ableton Project Analysis/g)).toHaveLength(1);
    expect(phaseList).not.toContain('>ALS Analysis<');
    const alsRow = rowContaining(html, 'Ableton Project Analysis');
    expect(alsRow).toContain('aria-current="step"');
  });

  it('C1 fix round 1: currentPhase "ALS Analysis" + all-false inputs — no appended row, Ableton row stays Not included, nearest preceding runs row reads current', () => {
    // The worker emits "ALS Analysis" for EVERY job, .als or not (it's
    // unconditional in run_pipeline). When it lands on a not-included row,
    // that row must never read active/failed, nothing gets appended, and the
    // nearest earlier RUNS row (Arrangement Advice) reads current instead —
    // otherwise the page looks stalled with no spinner anywhere.
    const html = renderToStaticMarkup(
      <ProgressStorylineView {...base} currentPhase="ALS Analysis" phasePct={0.97} />,
    );
    const phaseList = html.slice(0, html.indexOf('</ol>'));
    expect(phaseList).not.toContain('>ALS Analysis<');
    expect(phaseList.match(/Ableton Project Analysis/g)).toHaveLength(1);
    expect(phaseList.match(/aria-current="step"/g)).toHaveLength(1);
    const alsRow = rowContaining(html, 'Ableton Project Analysis');
    expect(alsRow).toContain('Not included');
    expect(alsRow).not.toContain('aria-current');
    const arrangementRow = rowContaining(html, 'Arrangement Advice');
    expect(arrangementRow).toContain('aria-current="step"');
  });

  it('structure_actor "Arrangement" aliases to the base row, no duplicate', () => {
    const html = renderToStaticMarkup(
      <ProgressStorylineView {...base} currentPhase="Arrangement" phasePct={0.9} />,
    );
    // Scope the duplicate-row check to the phase list — the 12.8 "How
    // analysis works" explainer below it legitimately repeats phase names.
    const phaseList = html.slice(0, html.indexOf('</ol>'));
    expect(phaseList.match(/Arrangement Advice/g)).toHaveLength(1);
    expect(phaseList).not.toContain('>Arrangement<');
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
  });

  it('completed job never shows hints, even with huge elapsed time', () => {
    const html = renderToStaticMarkup(
      <ProgressStorylineView
        {...base}
        status="complete"
        currentPhase="complete"
        phasePct={1}
        elapsedMs={3 * 24 * 60 * 60_000}
        workerOffline
      />,
    );
    expect(html).not.toContain('Taking longer than usual');
    expect(html).not.toContain('appears to be down');
  });
});

// Task G0 — the checklist must not claim optional analyses ran when the
// visitor never supplied that input. These cover ProgressStorylineView's
// rendering of buildProgressPlan's not-included rows.

/** Extracts the single <li>…</li> block containing `label`, from the phase
 *  list portion of the rendered HTML — avoids brittle fixed-offset slicing. */
function rowContaining(html: string, label: string): string {
  const phaseList = html.slice(0, html.indexOf('</ol>'));
  const textIdx = phaseList.indexOf(label);
  if (textIdx === -1) throw new Error(`row for "${label}" not found`);
  const liStart = phaseList.lastIndexOf('<li', textIdx);
  const liEndTag = phaseList.indexOf('</li>', textIdx);
  return phaseList.slice(liStart, liEndTag + '</li>'.length);
}

describe('ProgressStorylineView — optional-input rows (Task G0)', () => {
  it('not-included row never shows active/done, even if currentPhase lands exactly on it', () => {
    // Defensive case: currentPhase literally equals "Reference Comparison"
    // (its slot in the worker's phase sequence) even though the row is
    // not-included — the row must still never render as active or done.
    const atPhase = renderToStaticMarkup(
      <ProgressStorylineView {...base} currentPhase="Reference Comparison" phasePct={0.5} />,
    );
    const atRow = rowContaining(atPhase, 'Reference Comparison');
    expect(atRow).toContain('Not included');
    expect(atRow).toContain('aria-disabled="true"');
    expect(atRow).not.toContain('aria-current');

    // Completed job: not-included rows must still never read as done.
    const completed = renderToStaticMarkup(
      <ProgressStorylineView {...base} status="complete" currentPhase="complete" phasePct={1} />,
    );
    const completedRow = rowContaining(completed, 'Reference Comparison');
    expect(completedRow).toContain('Not included');
    expect(completedRow).not.toContain('✓');
  });

  it('mapping is not shifted by inserted not-included rows: the ACTUAL current phase is still the active row', () => {
    // currentPhase is past phase 5 (Reference Comparison, not-included here)
    // — Gap Analysis (phaseIndex 5) must be the one and only active row.
    const html = renderToStaticMarkup(
      <ProgressStorylineView {...base} currentPhase="Gap Analysis" phasePct={0.7} />,
    );
    const phaseList = html.slice(0, html.indexOf('</ol>'));
    expect(phaseList.match(/aria-current="step"/g)).toHaveLength(1);
    const gapRow = rowContaining(html, 'Gap Analysis');
    expect(gapRow).toContain('aria-current="step"');
    // Reference Comparison (before Gap Analysis in worker order, but rendered
    // after Per-Stem Analysis in the checklist) is still not-included, not
    // mistaken for a "done" phase just because Gap Analysis is current.
    const refRow = rowContaining(html, 'Reference Comparison');
    expect(refRow).toContain('Not included');
    expect(refRow).not.toContain('aria-current');
  });

  it('the benefit line is real text, readable without relying on style', () => {
    const html = renderToStaticMarkup(<ProgressStorylineView {...base} currentPhase="Gap Analysis" />);
    expect(html).toContain(
      'Add a reference track to see how your mix measures up to a record you love',
    );
    expect(html).toContain(
      'Upload your stems to see which instruments are fighting each other',
    );
    expect(html).toContain(
      'Add your Ableton project (.als) to get advice that names your actual tracks and devices.',
    );
  });

  it('hasReference: true makes Reference Comparison behave like a normal row', () => {
    const html = renderToStaticMarkup(
      <ProgressStorylineView
        {...base}
        currentPhase="Reference Comparison"
        phasePct={0.5}
        inputs={{ hasStems: false, hasReference: true, hasAls: false }}
      />,
    );
    const refRow = rowContaining(html, 'Reference Comparison');
    expect(refRow).not.toContain('Not included');
    expect(refRow).toContain('aria-current="step"');
    const phaseList = html.slice(0, html.indexOf('</ol>'));
    expect(phaseList.match(/aria-current="step"/g)).toHaveLength(1);
  });
});
