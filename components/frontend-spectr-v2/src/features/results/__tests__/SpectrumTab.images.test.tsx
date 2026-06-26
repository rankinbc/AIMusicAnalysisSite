import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SpectrumTab } from '../SpectrumTab';
import type { Phase1Data } from '../../../api/types';

// The server-rendered spectrogram/waveform images only appear when the BFF
// surfaced a URL (i.e. the worker actually produced them). Absent → no <img>,
// no broken-image placeholder.

const phase1: Phase1Data = { duration_seconds: 125 };

describe('SpectrumTab result images', () => {
  it('renders the spectrogram <img> when a URL is provided', () => {
    const html = renderToStaticMarkup(
      <SpectrumTab
        bands={undefined}
        phase1={phase1}
        phase3={undefined}
        phase4={undefined}
        phase9={undefined}
        spectrogramUrl="/api/jobs/abc/images/spectrogram"
        waveformUrl="/api/jobs/abc/images/waveform"
      />,
    );
    expect(html).toContain('Spectrogram');
    expect(html).toContain('/api/jobs/abc/images/spectrogram?t=');
    expect(html).toContain('/api/jobs/abc/images/waveform?t=');
    // Time axis shows the track end (2:05 for 125 s).
    expect(html).toContain('2:05');
  });

  it('renders no image card when URLs are absent', () => {
    const html = renderToStaticMarkup(
      <SpectrumTab
        bands={undefined}
        phase1={phase1}
        phase3={undefined}
        phase4={undefined}
        phase9={undefined}
        spectrogramUrl={null}
        waveformUrl={null}
      />,
    );
    expect(html).not.toContain('/images/spectrogram');
    expect(html).not.toContain('<img');
  });
});
