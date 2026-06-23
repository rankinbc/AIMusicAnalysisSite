import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { UsageMeter } from '../UsageMeter';

// Story 2.8 / UX-DR31 — passive usage meter.
describe('UsageMeter (story 2.8)', () => {
  it('renders "{used} of {limit}" with a track when bounded', () => {
    const html = renderToStaticMarkup(<UsageMeter used={1} limit={3} label="Analyses" />);
    expect(html).toContain('1 of 3');
    // a fill bar (width style) is present for a bounded meter
    expect(html).toMatch(/width:\s*\d+%/);
  });

  it('renders "Unlimited" with no track when limit is null', () => {
    const html = renderToStaticMarkup(<UsageMeter used={0} limit={null} label="Analyses" />);
    expect(html).toContain('Unlimited');
    expect(html).not.toMatch(/width:\s*\d+%/);
  });

  it('flags near-cap (≤1 remaining) via data-near', () => {
    const html = renderToStaticMarkup(<UsageMeter used={2} limit={3} />);
    expect(html).toContain('data-near');
  });

  it('does not flag near-cap when comfortably under', () => {
    const html = renderToStaticMarkup(<UsageMeter used={0} limit={3} />);
    expect(html).not.toContain('data-near');
  });
});
