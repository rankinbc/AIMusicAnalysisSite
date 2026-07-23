import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Story 2.8 — UsageSummary renders the analyses + coach pool grammar from the
// entitlements snapshot. We mock @tanstack/react-query's useQuery (the vitest
// env is `node`, no jsdom — mirrors buy-credits-card.test.tsx).

const h = vi.hoisted(() => ({ ent: null as unknown, isError: false }));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: h.ent, isLoading: false, isError: h.isError, refetch: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { UsageSummary } from '../UsageSummary';

describe('UsageSummary (story 2.8)', () => {
  beforeEach(() => {
    h.ent = null;
    h.isError = false;
  });

  it('free tier: analyses "{used} of {limit} · resets {date}" + coach per-analysis', () => {
    h.ent = {
      tier: 'free',
      analysesRemaining: 2,
      analysesUsed: 1,
      analysesLimit: 3,
      analysesResetsAt: '2026-07-01T00:00:00Z',
      coachRemaining: 3,
      coach: { used: 0, limit: 3, capReached: false, scope: 'analysis', resetsAt: null },
      stemsEnabled: false,
      alsEnabled: false,
      fullVerdictsEnabled: false,
      historyDepth: 10,
    };
    const html = renderToStaticMarkup(<UsageSummary creditBalance={0} />);
    expect(html).toContain('1 of 3');
    expect(html).toContain('resets');
    expect(html).toContain('3 per analysis');
    expect(html).toContain('Free');
  });

  it('pro tier: analyses "Unlimited" + coach pooled monthly', () => {
    h.ent = {
      tier: 'pro',
      analysesRemaining: null,
      analysesUsed: 0,
      analysesLimit: null,
      analysesResetsAt: null,
      coachRemaining: 288,
      coach: { used: 12, limit: 300, capReached: false, scope: 'month', resetsAt: '2026-07-01T00:00:00Z' },
      stemsEnabled: true,
      alsEnabled: true,
      fullVerdictsEnabled: true,
      historyDepth: null,
    };
    const html = renderToStaticMarkup(<UsageSummary creditBalance={0} />);
    expect(html).toContain('Unlimited');
    expect(html).toContain('12 of 300 this month');
    expect(html).toContain('Pro');
  });

  it('credits tier: coach "Unlimited" + balance shown', () => {
    h.ent = {
      tier: 'credits',
      analysesRemaining: 4,
      analysesUsed: 0,
      analysesLimit: null,
      analysesResetsAt: null,
      coachRemaining: 2147483647,
      coach: { used: 0, limit: 2147483647, capReached: false, scope: 'unlimited', resetsAt: null },
      stemsEnabled: true,
      alsEnabled: true,
      fullVerdictsEnabled: true,
      historyDepth: 30,
    };
    const html = renderToStaticMarkup(<UsageSummary creditBalance={4} />);
    // coach line is Unlimited
    expect(html).toContain('Unlimited');
    expect(html).toContain('Credits');
    // analyses line must NOT claim "Unlimited" for credits — it's à la carte
    expect(html).toContain('1 credit each');
    // balance value rendered
    expect(html).toContain('>4<');
  });

  it('renders nothing before entitlements hydrate', () => {
    h.ent = null;
    const html = renderToStaticMarkup(<UsageSummary creditBalance={0} />);
    expect(html).toBe('');
  });

  // Audit wave-3 (E8.3) — entitlements DOWN is distinguishable from loading:
  // the card shell renders an explicit unavailable message + Retry instead of
  // vanishing (which read as "nothing to show").
  it('renders the unavailable message + Retry when entitlements errored', () => {
    h.ent = null;
    h.isError = true;
    const html = renderToStaticMarkup(<UsageSummary creditBalance={0} />);
    expect(html).toContain('Plan info is unavailable right now');
    expect(html).toContain('your plan and limits are');
    expect(html).toContain('Retry');
    expect(html).toContain('Your plan'); // card shell still present
  });
});
