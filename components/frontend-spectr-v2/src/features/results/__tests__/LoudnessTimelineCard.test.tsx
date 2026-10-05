import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Phase1Data } from '../../../api/types';
import { LoudnessTimelineCard } from '../panels/LoudnessTimelineCard';

const phase1 = (stMax: number | undefined) =>
  ({
    duration_seconds: 10,
    short_term_max_lufs: stMax,
    loudness_timeline: { short_term: { t: [0, 5, 10], lufs: [-14, -9, -11] } },
  }) as unknown as Phase1Data;

describe('LoudnessTimelineCard', () => {
  it('rounds the short-term max label to one decimal', () => {
    const html = renderToStaticMarkup(<LoudnessTimelineCard phase1={phase1(-7.123456789)} />);
    expect(html).toContain('>ST max -7.1<');
    expect(html).not.toContain('-7.12');
  });

  it('omits the max line when the value is absent', () => {
    const html = renderToStaticMarkup(<LoudnessTimelineCard phase1={phase1(undefined)} />);
    expect(html).not.toContain('ST max');
  });

  it('renders nothing without a timeline', () => {
    expect(renderToStaticMarkup(<LoudnessTimelineCard phase1={undefined} />)).toBe('');
  });
});
