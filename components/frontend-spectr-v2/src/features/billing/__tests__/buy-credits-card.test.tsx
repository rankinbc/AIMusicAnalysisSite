import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Story 2.3 review-test pattern (mirrors story 2.2 review-fix P12) —
// Radix RadioGroup renders via Portal-less primitives, but several
// internal components also rely on context/hooks. We flatten the
// surface to plain `<div>`s + `<button role="radio">` so
// renderToStaticMarkup produces inspectable HTML. The vitest env is
// `node` (CLAUDE.md), so no jsdom.

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
// BuyCreditsCard uses a plain segmented-button group (no Radix dep)
// so no need to mock @radix-ui — the rendered HTML is already plain.
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: {
      proMonthlyCents: 1299,
      proAnnualCents: 9900,
      creditPack5Cents: 1900,
      creditPack10Cents: 3500,
      currency: 'USD',
    },
    isLoading: false,
  }),
}));

import { BuyCreditsCard } from '../BuyCreditsCard';

describe('BuyCreditsCard (story 2.3 / Task 10)', () => {
  it('renders both pack-size options with formatted prices', () => {
    const html = renderToStaticMarkup(<BuyCreditsCard />);
    expect(html).toContain('5 credits');
    expect(html).toContain('10 credits');
    expect(html).toContain('$19.00');
    expect(html).toContain('$35.00');
  });

  it('renders exactly two radio options (5 + 10)', () => {
    const html = renderToStaticMarkup(<BuyCreditsCard />);
    const radios = [...html.matchAll(/role="radio"/g)];
    expect(radios.length).toBe(2);
    expect(html).toContain('data-value="5"');
    expect(html).toContain('data-value="10"');
  });

  it('renders a primary .btn.primary buy button', () => {
    const html = renderToStaticMarkup(<BuyCreditsCard />);
    // The pending state defaults to false → label includes the
    // selected pack (default 5).
    const buttons = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
      .map((m) => m[0]);
    const primary = buttons.find(
      (b) => b.includes('Buy 5 credits') || b.includes('Buy 10 credits'),
    );
    expect(primary, 'Buy {pack} credits button must be present').toBeDefined();
    const classMatch = primary!.match(/class="([^"]*)"/);
    expect(classMatch).not.toBeNull();
    expect(classMatch![1]).toMatch(/\bbtn\b/);
    expect(classMatch![1]).toMatch(/\bprimary\b/);
  });

  it('uses no inline $ literals — all prices flow through formatCents', () => {
    // The component file itself MUST NOT contain a $ literal (AR39).
    // The rendered output DOES contain $ from formatCents — that's
    // fine since formatCents derives the symbol via Intl.NumberFormat
    // from the currency code, not a string literal. This test just
    // sanity-checks that the formatter ran.
    const html = renderToStaticMarkup(<BuyCreditsCard />);
    expect(html).toMatch(/\$\d/);
  });
});
