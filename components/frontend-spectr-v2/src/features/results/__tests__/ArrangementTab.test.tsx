import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ArrangementTab } from '../ArrangementTab';
import type { Phase7Data } from '../../../api/types';

// Deferred structure detection (allin1 runs in the background): the tab shows a
// "pending" state until Phase 7 fills in, a distinct "not assessed" state when
// the detector is unavailable, and the real timeline once scored.

describe('ArrangementTab', () => {
  it('shows a pending state while structure detection runs', () => {
    const phase7: Phase7Data = { arrangement_status: 'pending' };
    const html = renderToStaticMarkup(<ArrangementTab phase7={phase7} />);
    expect(html).toContain('analyzing…');
    expect(html).toContain('Detecting section structure');
  });

  it('shows "not assessed" (not a failure) when detection is unavailable', () => {
    const phase7: Phase7Data = { arrangement_status: 'unavailable', section_scores: [] };
    const html = renderToStaticMarkup(<ArrangementTab phase7={phase7} />);
    expect(html).toContain('not assessed');
    expect(html).toContain('not available on this server');
    expect(html).not.toContain('analyzing…');
  });

  it('renders the timeline once scored', () => {
    const phase7: Phase7Data = {
      arrangement_status: 'scored',
      overall_score: 82,
      grade: 'B',
      section_scores: [
        { section_type: 'intro', start_time: 0, end_time: 60, duration: 60, bars: 32, score: 90, time_range: '0:00-1:00', eight_bar_compliant: true, issues: [] },
        { section_type: 'drop', start_time: 60, end_time: 120, duration: 60, bars: 32, score: 88, time_range: '1:00-2:00', eight_bar_compliant: true, issues: [] },
      ],
    };
    const html = renderToStaticMarkup(<ArrangementTab phase7={phase7} />);
    expect(html).toContain('intro');
    expect(html).toContain('drop');
    expect(html).not.toContain('analyzing…');
    expect(html).not.toContain('no structure detected');
  });

  it('falls back to "no structure detected" when section data is simply empty', () => {
    const phase7: Phase7Data = { arrangement_status: 'scored', section_scores: [] };
    const html = renderToStaticMarkup(<ArrangementTab phase7={phase7} />);
    expect(html).toContain('no structure detected');
  });
});
