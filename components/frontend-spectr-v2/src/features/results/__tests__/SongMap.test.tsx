import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SongMap } from '../SongMap';
import type { Phase1Data } from '../../../api/types';

function makePhase1(over: Partial<Phase1Data> = {}): Phase1Data {
  return {
    bpm: 143,
    duration_seconds: 60,
    structure: {
      available: true,
      bpm: 143,
      downbeats: [0, 2, 4, 6, 8, 10, 12, 14, 16], // 8 bars covered by [0,16)
      beats: [0, 0.5, 1, 1.5, 2],
      segments: [
        { label: 'intro', start: 0, end: 16 },
        { label: 'inst', start: 16, end: 60 },
      ],
    },
    ...over,
  };
}

describe('SongMap', () => {
  it('renders an empty state when no segments exist', () => {
    const html = renderToStaticMarkup(
      <SongMap phase1={{ bpm: 120, duration_seconds: 30, structure: { segments: [] } }} />,
    );
    expect(html).toContain('No section structure detected');
  });

  it('renders a pending state while structure is deferred', () => {
    const html = renderToStaticMarkup(
      <SongMap phase1={{ structure: { deferred: true, segments: [] } }} />,
    );
    expect(html).toContain('Detecting section structure');
  });

  it('renders merged section labels and bar counts once structure is present', () => {
    const html = renderToStaticMarkup(<SongMap phase1={makePhase1()} />);
    expect(html).toContain('intro');
    expect(html).toContain('inst');
    expect(html).toContain('bars'); // bar-count caption
  });

  it('flags the tempo octave error when phase1 BPM is half the structure BPM', () => {
    const html = renderToStaticMarkup(
      <SongMap phase1={makePhase1({ bpm: 71.5 })} />, // 71.5 / 143 ≈ 0.50
    );
    expect(html).toContain('half-time');
  });

  it('does NOT flag a tempo error when the two BPMs agree', () => {
    const html = renderToStaticMarkup(<SongMap phase1={makePhase1({ bpm: 143 })} />);
    expect(html).not.toContain('half-time');
    expect(html).not.toContain('double-time');
  });
});
