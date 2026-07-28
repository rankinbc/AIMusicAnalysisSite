// Story 12.5 (AC5): the genre percentile is REAL or ABSENT — never fabricated
// from overall_score. These pin the honest empty state after the two-section
// rebuild (the "can't place you" copy replaced the old "not available" line).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Phase6Data } from '../../../api/types';
import { ReferenceTab } from '../ReferenceTab';

// A whitelisted metric (stereo_width) so the genre section has a placed row.
const gaps: Phase6Data['gaps'] = {
  stereo_width: {
    user_val: 0.62,
    genre_mean: 0.58,
    genre_std: 0.1,
    acceptable_range: [0.44, 0.72],
    in_range: true,
    delta: 0.04,
    percentile: 56,
    description: 'Stereo width vs genre',
  },
};

describe('ReferenceTab percentile honesty', () => {
  it('renders the percentile ring when phase6.percentile is REAL', () => {
    const phase6 = { genre: 'trance', percentile: 72, gaps } as unknown as Phase6Data;
    const html = renderToStaticMarkup(
      <ReferenceTab genre="trance" phase6={phase6} phase5={undefined} phase1={undefined} />,
    );
    expect(html).toContain('72');
    // Rev3 markup: "72th" ring + "N of M placed metrics in range" + "top 28%" take.
    expect(html).toContain('placed metrics in range');
    expect(html).toContain('top 28%');
  });

  it('never invents a percentile when phase6.percentile is absent', () => {
    const phase6 = { genre: 'trance', gaps } as unknown as Phase6Data;
    const html = renderToStaticMarkup(
      <ReferenceTab genre="trance" phase6={phase6} phase5={undefined} phase1={undefined} />,
    );
    // No fabricated ring/headline — the honest "can't place you" card instead.
    expect(html).toContain('Not enough to place you against the genre yet');
    expect(html).not.toContain('th percentile');
  });

  it('handles no phase6 at all without fabricating', () => {
    const html = renderToStaticMarkup(
      <ReferenceTab genre="trance" phase6={undefined} phase5={undefined} phase1={undefined} />,
    );
    expect(html).toContain('Not enough to place you against the genre yet');
    expect(html).not.toContain('th percentile');
  });
});
