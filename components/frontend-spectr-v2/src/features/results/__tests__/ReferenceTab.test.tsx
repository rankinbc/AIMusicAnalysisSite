// Story 12.5 (AC5): the genre percentile is REAL or ABSENT — never fabricated
// from overall_score. These pin the honest empty state.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Phase6Data } from '../../../api/types';
import { ReferenceTab } from '../ReferenceTab';

const gaps: Phase6Data['gaps'] = {
  lufs: {
    user_val: -9.2,
    genre_mean: -8.5,
    genre_std: 1.1,
    acceptable_range: [-10.7, -6.3],
    in_range: true,
    delta: -0.7,
    percentile: 44,
    description: 'Integrated loudness vs genre',
  },
};

describe('ReferenceTab percentile honesty', () => {
  it('renders the ring when phase6.percentile is REAL', () => {
    const phase6 = { genre: 'trance', percentile: 72, gaps } as unknown as Phase6Data;
    const html = renderToStaticMarkup(<ReferenceTab genre="trance" phase6={phase6} />);
    expect(html).toContain('72');
    expect(html).toContain('th percentile');
    expect(html).toContain('top 28%');
  });

  it('never invents a percentile when phase6.percentile is absent', () => {
    const phase6 = { genre: 'trance', gaps } as unknown as Phase6Data;
    const html = renderToStaticMarkup(<ReferenceTab genre="trance" phase6={phase6} />);
    // The old fabrication produced a ring + "Nth percentile" headline from
    // score*0.95 (or a hardcoded 60). Neither may appear now.
    expect(html).toContain('available for this analysis');
    expect(html).not.toContain('rv-ring');
    expect(html).not.toContain('rv-num'); // no headline percentile figure (per-gap rows keep theirs)
  });

  it('handles no phase6 at all without fabricating', () => {
    const html = renderToStaticMarkup(<ReferenceTab genre="trance" phase6={undefined} />);
    expect(html).toContain('available for this analysis');
    expect(html).not.toContain('rv-ring');
  });
});
