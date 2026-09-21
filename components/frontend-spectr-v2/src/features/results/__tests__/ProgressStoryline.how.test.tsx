// Story 12.8 (AC3) / Task G0 fix round 1 (I3) — the "How analysis works"
// expandable now lists only the rows that actually run for THIS upload
// (plan-driven), plus a closing sentence naming what was skipped and why it
// would help. It used to hard-code the 7 base phases + an ALS footnote for
// every visitor, including phases (stems, reference) a mix-only upload never
// runs. Owner: "If stems aren't loaded, don't act like it's going to do stem
// analysis" — this pinned test is updated with that copy change.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProgressStorylineView } from '../ProgressStoryline';

const base = {
  status: 'pending',
  currentPhase: 'queued',
  phasePct: 0,
  elapsedMs: 0,
  workerOffline: false,
};

function howSection(html: string): string {
  return html.slice(html.indexOf('data-testid="how-analysis-works"'));
}

describe('How analysis works', () => {
  it('mix-only (default inputs): lists only the 6 rows that actually run, and names what was skipped', () => {
    const html = renderToStaticMarkup(<ProgressStorylineView {...base} />);
    expect(html).toContain('How analysis works');
    const how = howSection(html);
    for (const phase of [
      'Universal Mix Analysis', 'Genre Detection', 'Genre-Specific Scoring',
      'Frequency Clash Check', 'Gap Analysis', 'Arrangement Advice',
    ]) expect(how).toContain(phase);
    expect(how).not.toContain('Stem Separation');
    expect(how).not.toContain('Stem Analysis &amp; Clash');
    expect(how).not.toContain('Reference Comparison');
    expect(how).not.toContain('Ableton Project Analysis');
    expect(how).toContain(
      'Not included in this run: per-stem analysis, reference comparison, ableton project analysis. Each one needs an extra upload.',
    );
  });

  it('all-true inputs: every row runs, no closing "Not included" sentence', () => {
    const html = renderToStaticMarkup(
      <ProgressStorylineView
        {...base}
        inputs={{ hasStems: true, hasReference: true, hasAls: true }}
      />,
    );
    const how = howSection(html);
    expect(how).toContain('Stem Analysis &amp; Clash');
    expect(how).toContain('Reference Comparison');
    expect(how).toContain('Ableton Project Analysis');
    expect(how).not.toContain('Not included in this run');
  });

  it('inputs still loading: lists only the always-running rows, no closing sentence', () => {
    const html = renderToStaticMarkup(<ProgressStorylineView {...base} inputsLoading />);
    const how = howSection(html);
    for (const phase of [
      'Universal Mix Analysis', 'Genre Detection', 'Genre-Specific Scoring',
      'Gap Analysis', 'Arrangement Advice',
    ]) expect(how).toContain(phase);
    expect(how).not.toContain('Frequency Clash Check');
    expect(how).not.toContain('Reference Comparison');
    expect(how).not.toContain('Ableton Project Analysis');
    expect(how).not.toContain('Not included in this run');
  });
});
