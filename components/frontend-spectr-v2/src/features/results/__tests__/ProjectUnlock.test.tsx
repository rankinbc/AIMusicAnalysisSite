import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ProjectUnlock } from '../ProjectUnlock';

// AC3 — no-.als state shows an unlock invitation + benefit chip, not a flat placeholder.
describe('ProjectUnlock', () => {
  it('renders a benefit chip and an invitation to upload the .als', () => {
    const html = renderToStaticMarkup(<ProjectUnlock />);
    expect(html).toContain('Track-named fixes'); // benefit chip
    expect(html).toContain('.als'); // the invitation names the asset
    expect(html.toLowerCase()).not.toContain('no ableton project was uploaded'); // not the old placeholder
  });

  // Story 12.5 (AC4): instruction-with-no-button is over — a real CTA opens
  // the AlsUploadDialog when the parent provides the opener.
  it('renders the Upload .als CTA when the opener is provided', () => {
    const html = renderToStaticMarkup(<ProjectUnlock onUploadAls={() => {}} />);
    expect(html).toContain('Upload .als');
  });

  it('renders no dead button when no opener exists (no version attached)', () => {
    const html = renderToStaticMarkup(<ProjectUnlock />);
    expect(html).not.toContain('<button');
  });
});
