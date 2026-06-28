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
});
