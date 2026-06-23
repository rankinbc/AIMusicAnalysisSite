import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Story 2.8 / AC2 — HonestMathBanner: shows only when `qualifies`, renders the
// verbatim comparison copy, is a banner (not a dialog), and respects a
// persisted localStorage dismissal. vitest env is `node`; we mock react-query
// and stub localStorage per test.

const h = vi.hoisted(() => ({ hm: null as unknown }));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: h.hm, isLoading: false }),
  useMutation: () => ({ mutate: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { HonestMathBanner } from '../HonestMathBanner';

const QUALIFIES = {
  qualifies: true,
  creditsSpentCents: 7000,
  proEquivalentCents: 3897,
  periodDays: 90,
  currency: 'USD',
};

function setLocalStorage(getItem: (k: string) => string | null) {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  } as Storage;
}

describe('HonestMathBanner (story 2.8)', () => {
  beforeEach(() => {
    h.hm = null;
    setLocalStorage(() => null); // not dismissed by default
  });

  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  });

  it('renders the comparison copy with formatted cents when qualifying', () => {
    h.hm = QUALIFIES;
    const html = renderToStaticMarkup(<HonestMathBanner />);
    expect(html).toContain('on credits in 90 days');
    expect(html).toContain('$70.00'); // 7000c spent
    expect(html).toContain('$38.97'); // 3897c pro-equivalent
  });

  it('is a banner (role=status), not a dialog', () => {
    h.hm = QUALIFIES;
    const html = renderToStaticMarkup(<HonestMathBanner />);
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="dialog"');
  });

  it('renders nothing when it does not qualify', () => {
    h.hm = { ...QUALIFIES, qualifies: false };
    const html = renderToStaticMarkup(<HonestMathBanner />);
    expect(html).toBe('');
  });

  it('renders nothing once the localStorage dismissal flag is set', () => {
    h.hm = QUALIFIES;
    setLocalStorage((k) => (k === 'spectr.honestMath.dismissed' ? 'true' : null));
    const html = renderToStaticMarkup(<HonestMathBanner />);
    expect(html).toBe('');
  });
});
