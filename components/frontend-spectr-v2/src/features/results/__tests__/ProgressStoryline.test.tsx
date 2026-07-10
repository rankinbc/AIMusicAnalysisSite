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

  it('worker offline: immediate hint with queue depth, regardless of elapsed', () => {
    const html = renderToStaticMarkup(
      <ProgressStorylineView
        {...base}
        elapsedMs={10_000}
        workerOffline
        queueDepth={3}
      />,
    );
    expect(html).toContain('appears to be down');
    expect(html).toContain('3 jobs queued.');
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
});
