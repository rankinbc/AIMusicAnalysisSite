import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Story 12.1 (AC3) — VerifyEmailBanner shows ONLY for a positively-unverified
// free-tier profile, respects the localStorage dismissal, and stays hidden
// for paid tiers / loading states. Mirrors the honest-math-banner test style:
// node env, hooks mocked, static render.

const h = vi.hoisted(() => ({
  profile: null as unknown,
  entitlements: null as unknown,
}));

vi.mock('../../api/hooks', () => ({
  useMeProfile: () => ({ data: h.profile }),
  useEntitlements: () => ({ data: h.entitlements }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import { VerifyEmailBanner } from '../VerifyEmailBanner';

const UNVERIFIED_PROFILE = { emailVerifiedAt: null };
const FREE = { tier: 'free' };

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

describe('VerifyEmailBanner (story 12.1)', () => {
  beforeEach(() => {
    h.profile = null;
    h.entitlements = null;
    setLocalStorage(() => null);
  });

  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  });

  it('renders verify copy + resend button for an unverified free user', () => {
    h.profile = UNVERIFIED_PROFILE;
    h.entitlements = FREE;
    const html = renderToStaticMarkup(<VerifyEmailBanner />);
    expect(html).toContain('Verify your email to unlock more analyses');
    expect(html).toContain('Resend email');
    expect(html).toContain('role="status"');
  });

  it('renders nothing for a verified user', () => {
    h.profile = { emailVerifiedAt: '2026-07-01T00:00:00Z' };
    h.entitlements = FREE;
    expect(renderToStaticMarkup(<VerifyEmailBanner />)).toBe('');
  });

  it('renders nothing while the profile is still loading (no false flash)', () => {
    h.profile = null;
    h.entitlements = FREE;
    expect(renderToStaticMarkup(<VerifyEmailBanner />)).toBe('');
  });

  it('renders nothing when the profile predates the field (undefined)', () => {
    h.profile = {}; // stale cache shape without emailVerifiedAt
    h.entitlements = FREE;
    expect(renderToStaticMarkup(<VerifyEmailBanner />)).toBe('');
  });

  it('renders nothing while entitlements are still loading (no paid-tier flash)', () => {
    // An unverified pro/credits user is gate-exempt; showing the banner before
    // the tier resolves would flash it at them. Wait for entitlements.
    h.profile = UNVERIFIED_PROFILE;
    h.entitlements = null;
    expect(renderToStaticMarkup(<VerifyEmailBanner />)).toBe('');
  });

  it.each(['pro', 'credits'])('renders nothing on the %s tier (gate exempts it)', (tier) => {
    h.profile = UNVERIFIED_PROFILE;
    h.entitlements = { tier };
    expect(renderToStaticMarkup(<VerifyEmailBanner />)).toBe('');
  });

  it('respects the localStorage dismissal', () => {
    h.profile = UNVERIFIED_PROFILE;
    h.entitlements = FREE;
    setLocalStorage((k) => (k === 'spectr.verifyEmailBanner.dismissed' ? '1' : null));
    expect(renderToStaticMarkup(<VerifyEmailBanner />)).toBe('');
  });
});
