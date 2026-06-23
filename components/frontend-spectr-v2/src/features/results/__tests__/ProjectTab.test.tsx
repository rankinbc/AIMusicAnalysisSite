import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { AlsProjectJson } from '../../../api/types';
import { ProjectTab } from '../ProjectTab';

// Renders to static markup so the project stays jsdom-free (results-tab pattern).

const PROJECT: AlsProjectJson = {
  schemaVersion: 1,
  source: 'client-als-preview',
  tempo: 128,
  timeSignature: '4/4',
  timeSignatureNumerator: 4,
  timeSignatureDenominator: 4,
  abletonVersion: 'Ableton Live 11.3.13',
  trackCount: 2,
  tracks: [
    { index: 0, name: 'Kick', type: 'audio', color: 13, devices: ['EQ Eight', 'Glue Compressor'] },
    { index: 1, name: 'Bass', type: 'midi', color: null, devices: ['Operator'] },
  ],
  devices: ['EQ Eight', 'Glue Compressor', 'Operator', 'Serum'],
  plugins: ['Serum'],
};

describe('ProjectTab', () => {
  it('renders project stats, track names, types and per-track devices', () => {
    const html = renderToStaticMarkup(<ProjectTab project={PROJECT} />);

    // Stats
    expect(html).toContain('128');
    expect(html).toContain('4/4');
    expect(html).toContain('Ableton Live 11.3.13');

    // Track names + types
    expect(html).toContain('Kick');
    expect(html).toContain('Bass');
    expect(html).toContain('audio');
    expect(html).toContain('midi');

    // Per-track devices + project-wide plugin
    expect(html).toContain('EQ Eight');
    expect(html).toContain('Glue Compressor');
    expect(html).toContain('Operator');
    expect(html).toContain('Serum');
  });

  it('shows a "no devices" hint for tracks with an empty device chain', () => {
    const project: AlsProjectJson = {
      ...PROJECT,
      tracks: [{ index: 0, name: 'Empty', type: 'audio', color: null, devices: [] }],
      trackCount: 1,
    };
    const html = renderToStaticMarkup(<ProjectTab project={project} />);
    expect(html).toContain('no devices');
  });
});
