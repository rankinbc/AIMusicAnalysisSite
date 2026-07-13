// Story 12.8 (AC3) — the "How analysis works" expandable fills the 12-2 slot.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProgressStorylineView } from '../ProgressStoryline';

describe('How analysis works', () => {
  it('renders the expandable with all 7 phases + the ALS note', () => {
    const html = renderToStaticMarkup(
      <ProgressStorylineView
        status="pending" currentPhase="queued" phasePct={0}
        elapsedMs={0} workerOffline={false} />,
    );
    expect(html).toContain('How analysis works');
    for (const phase of [
      'Universal Mix Analysis', 'Genre Detection', 'Genre-Specific Scoring',
      'Stem Separation &amp; Clash', 'Reference Comparison', 'Gap Analysis',
      'Arrangement Advice',
    ]) expect(html).toContain(phase);
    expect(html).toContain('8th phase');
  });
});
