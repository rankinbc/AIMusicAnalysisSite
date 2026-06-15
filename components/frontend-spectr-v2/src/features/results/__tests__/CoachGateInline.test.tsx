import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Sonner toast is imported eagerly by CoachGateInline; stub it out so the
// jsdom-free node test env doesn't blow up trying to find window globals.
vi.mock('sonner', () => ({
  toast: { info: vi.fn() },
}));

import { CoachGateInline } from '../CoachGateInline';

// Story 1.9 / Task 5.5 — input-replacement gate. Renders headline + body
// + primary Get Pro + ghost "or buy credits" CTAs in the same DOM slot
// the input row normally occupies. role="region" gives screen-reader
// users a discrete landmark for the swap.

describe('CoachGateInline', () => {
  it('renders the canonical headline + body copy', () => {
    const html = renderToStaticMarkup(<CoachGateInline />);
    expect(html).toContain('Follow-ups used for this analysis');
    expect(html).toContain('Pro = pooled monthly coach access');
  });

  it('renders the primary Get Pro CTA with btn.primary class', () => {
    const html = renderToStaticMarkup(<CoachGateInline />);
    // .btn.primary cyan glow — the single money action on this view.
    expect(html).toContain('class="btn primary"');
    expect(html).toContain('>Get Pro<');
  });

  it('renders the secondary "or buy credits" ghost link', () => {
    const html = renderToStaticMarkup(<CoachGateInline />);
    expect(html).toContain('class="btn ghost"');
    expect(html).toContain('>or buy credits<');
  });

  it('carries role="region" + aria-label for screen-reader landmark', () => {
    const html = renderToStaticMarkup(<CoachGateInline />);
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Coach follow-up limit reached"');
  });
});
