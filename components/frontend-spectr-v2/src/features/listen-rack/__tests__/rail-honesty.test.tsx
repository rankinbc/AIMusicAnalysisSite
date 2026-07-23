/* Wave-3 E6.2/E6.3/E6.4 — the rail tells the truth:
 * - StatsPanel: "not analyzed yet" instead of zeros-as-measurements; a
 *   mismatch note when the stats come from a different version's analysis.
 * - CoachPanel: real mode drops the fixture badge + canned reply input and
 *   points at the report's real coach. Mock/demo mode is UNCHANGED. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TRACK, type Track } from '../data';
import { CoachPanel, StatsPanel } from '../rail';
import type { RackState } from '../rackState';

const analyzedTrack: Track = { ...TRACK, analyzed: true };
const unanalyzedTrack: Track = {
  ...TRACK,
  analyzed: false,
  loudness: { integrated: 0, truePeak: 0, dynamicRange: 0, rms: 0 },
  stereo: { width: 0, correlation: 0, monoCompat: 0 },
};

const fakeRs = { applyCoach: () => {} } as unknown as RackState;

describe('StatsPanel honesty (E6.2/E6.3)', () => {
  it('says "not analyzed yet" instead of presenting zeros as measurements', () => {
    const html = renderToStaticMarkup(<StatsPanel track={unanalyzedTrack} />);
    expect(html).toContain('Not analyzed yet — run an analysis from the song page.');
    expect(html).not.toContain('LUFS');
    expect(html).not.toContain('VS SPOTIFY');
    expect(html).not.toContain('LU over');
  });

  it('renders the full stat rows for an analyzed track (unchanged)', () => {
    const html = renderToStaticMarkup(<StatsPanel track={analyzedTrack} />);
    expect(html).toContain('Integrated');
    expect(html).toContain('VS SPOTIFY');
    expect(html).not.toContain('Not analyzed yet');
  });

  it('labels stats that come from a different version, naming the analyzed version', () => {
    const html = renderToStaticMarkup(
      <StatsPanel track={analyzedTrack} statsSource={{ mismatch: true, versionNumber: 6 }} />,
    );
    expect(html).toContain('Stats are from the latest analysis');
    expect(html).toContain('(v6)');
    expect(html).toContain('not the version you');
  });

  it('shows no mismatch note when the versions match', () => {
    const html = renderToStaticMarkup(
      <StatsPanel track={analyzedTrack} statsSource={{ mismatch: false, versionNumber: 6 }} />,
    );
    expect(html).not.toContain('Stats are from the latest analysis');
  });
});

describe('CoachPanel honesty (E6.4)', () => {
  it('real mode: no fixture badge, no canned-reply input, honest hand-off copy', () => {
    const html = renderToStaticMarkup(<CoachPanel rs={fakeRs} real reportRef={null} />);
    expect(html).not.toContain('KNOWS THIS TRACK');
    expect(html).not.toContain('14/26 RUN');
    expect(html).not.toContain('Ask about your mix');
    expect(html).not.toContain('<input');
    expect(html).toContain('rack coach isn');
    expect(html).toContain('is on the report');
  });

  it('mock/demo mode is unchanged: badge + ask input still render', () => {
    const html = renderToStaticMarkup(<CoachPanel rs={fakeRs} />);
    expect(html).toContain('KNOWS THIS TRACK');
    expect(html).toContain('Ask about your mix');
  });
});
