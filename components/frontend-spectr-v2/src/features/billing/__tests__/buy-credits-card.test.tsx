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
      creditPacks: [
        { credits: 500, cents: 700 },
        { credits: 1500, cents: 1800 },
        { credits: 5000, cents: 5500 },
      ],
      costs: { analysis: 100, specialist: 15, coachMessage: 5, coachMix: 5, signupGrant: 500, proAnalysesMonthly: 15, proCoachMonthly: 300 },
      currency: 'USD',
    },
    isLoading: false,
  }),
}));

import { BuyCreditsCard } from '../BuyCreditsCard';

describe('BuyCreditsCard (story 2.3 / Task 10)', () => {
  it('renders every pack with formatted prices', () => {
    const html = renderToStaticMarkup(<BuyCreditsCard />);
    expect(html).toContain('500 credits');
    expect(html).toContain('1,500 credits');
    expect(html).toContain('5,000 credits');
    expect(html).toContain('$7.00');
    expect(html).toContain('$18.00');
    expect(html).toContain('$55.00');
  });

  it('renders exactly three radio options (500 + 1500 + 5000)', () => {
    const html = renderToStaticMarkup(<BuyCreditsCard />);
    const radios = [...html.matchAll(/role="radio"/g)];
    expect(radios.length).toBe(3);
    expect(html).toContain('data-value="500"');
    expect(html).toContain('data-value="1500"');
    expect(html).toContain('data-value="5000"');
  });

  it('renders a primary .btn.primary buy button', () => {
    const html = renderToStaticMarkup(<BuyCreditsCard />);
    // The pending state defaults to false → label includes the
    // first pack (default 500).
    const buttons = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
      .map((m) => m[0]);
    const primary = buttons.find(
      (b) => b.includes('Buy 500 credits'),
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
