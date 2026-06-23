import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Story 2.9 / UX-DR33 — DunningBanner. vitest env is `node` (CLAUDE.md),
// so we assert against static markup rather than a live DOM (mirrors the
// BlurLock / CancelDialog test style).

import type { BillingSummaryResponse } from '../../../api/types';
import { DunningBanner } from '../DunningBanner';

const BASE: BillingSummaryResponse = {
  tier: 'pro',
  status: 'active',
  cadence: 'monthly',
  priceId: 'price_test_monthly',
  currentPeriodEnd: '2026-09-15T00:00:00Z',
  cancelAt: null,
  cancelAtPeriodEnd: false,
  nextChargeAt: '2026-09-15T00:00:00Z',
  nextChargeCents: 1299,
  currency: 'USD',
  retryAt: null,
};

// 2026-09-04T00:00:00Z — the fixture retry date shared with the BFF tests.
// The banner formats the weekday in UTC (a midnight-UTC instant would render
// the previous weekday in negative-UTC-offset locales), so assert in UTC too —
// this keeps the test tz-independent.
const RETRY_ISO = '2026-09-04T00:00:00Z';
const expectedWeekday = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  timeZone: 'UTC',
}).format(new Date(RETRY_ISO));

function markup(summary: BillingSummaryResponse, pending = false): string {
  return renderToStaticMarkup(
    <DunningBanner summary={summary} onUpdatePayment={vi.fn()} pending={pending} />,
  );
}

describe('DunningBanner', () => {
  it('renders the verbatim retry copy with the weekday when past_due', () => {
    const html = markup({ ...BASE, status: 'past_due', retryAt: RETRY_ISO });
    expect(html).toContain(
      `Payment failed — retrying ${expectedWeekday} · update card`,
    );
  });

  it('exposes the status role + a single Update card CTA', () => {
    const html = markup({ ...BASE, status: 'past_due', retryAt: RETRY_ISO });
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Payment past due"');
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)];
    expect(buttons.length).toBe(1);
    expect(html).toContain('Update card');
  });

  it('falls back to no-day copy when retryAt is null', () => {
    const html = markup({ ...BASE, status: 'past_due', retryAt: null });
    expect(html).toContain('Payment failed — update your card to keep Pro');
    // No half-rendered "retrying {day}" template.
    expect(html).not.toContain('retrying');
  });

  it.each(['active', 'trialing', 'canceled', 'unpaid', null] as const)(
    'renders nothing when status is %s',
    (status) => {
      expect(markup({ ...BASE, status, retryAt: RETRY_ISO })).toBe('');
    },
  );

  it('disables the CTA and shows progress copy while pending', () => {
    const html = markup({ ...BASE, status: 'past_due', retryAt: RETRY_ISO }, true);
    expect(html).toContain('Opening…');
    expect(html).toContain('disabled');
  });
});
