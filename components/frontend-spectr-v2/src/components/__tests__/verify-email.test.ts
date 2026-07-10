import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Story 12.1 (AC2/AC5) — verify-email helpers: gate detection keys off the
// AR38 machine `code` (never message text), the resend action debounces, and
// the dispatch-error handler picks the actionable toast for the gate.

const h = vi.hoisted(() => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
  fetcherMock: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('../../api/fetcher', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../api/fetcher')>();
  return { ...orig, fetcher: h.fetcherMock };
});

import { ApiError } from '../../api/fetcher';
import {
  __resetResendStateForTests,
  VERIFY_BANNER_DISMISS_KEY,
  isVerifyGateError,
  resendVerificationEmail,
  resetVerifyResendState,
  showAnalysisDispatchError,
} from '../verify-email';

function stubBrowserGlobals() {
  const removeItem = vi.fn();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem,
    clear: () => undefined,
    key: () => null,
    length: 0,
  } as unknown as Storage;
  const dispatchEvent = vi.fn();
  (globalThis as unknown as { window: unknown }).window = { dispatchEvent };
  (globalThis as unknown as { Event: unknown }).Event = class {
    constructor(public type: string) {}
  };
  return { removeItem, dispatchEvent };
}

describe('isVerifyGateError (AC5 — keyed on code, never message)', () => {
  it('matches an ApiError carrying email_verification_required', () => {
    const err = new ApiError(403, {
      error: { code: 'email_verification_required', message: 'Verify your email.' },
    });
    expect(isVerifyGateError(err)).toBe(true);
  });

  it('rejects a different code even when the MESSAGE mentions verification', () => {
    const err = new ApiError(403, {
      error: { code: 'account_banned', message: 'email verification required' },
    });
    expect(isVerifyGateError(err)).toBe(false);
  });

  it('rejects plain errors and empty bodies', () => {
    expect(isVerifyGateError(new Error('HTTP 403'))).toBe(false);
    expect(isVerifyGateError(new ApiError(403, undefined))).toBe(false);
    expect(isVerifyGateError(undefined)).toBe(false);
  });
});

describe('resendVerificationEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetResendStateForTests();
    stubBrowserGlobals();
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  });

  it('POSTs the resend endpoint and toasts success', async () => {
    h.fetcherMock.mockResolvedValueOnce(undefined);
    const sent = await resendVerificationEmail();
    expect(sent).toBe(true);
    expect(h.fetcherMock).toHaveBeenCalledWith({
      url: '/auth/resend-verification',
      method: 'POST',
    });
    expect(h.toast.success).toHaveBeenCalled();
  });

  it('debounces: an immediate second call is a no-op with an info toast', async () => {
    h.fetcherMock.mockResolvedValue(undefined);
    await resendVerificationEmail();
    const second = await resendVerificationEmail();
    expect(second).toBe(false);
    expect(h.fetcherMock).toHaveBeenCalledTimes(1);
    expect(h.toast.info).toHaveBeenCalled();
  });

  it('resetVerifyResendState clears the cooldown (account switch on a shared tab)', async () => {
    h.fetcherMock.mockResolvedValue(undefined);
    await resendVerificationEmail(); // arms the cooldown for account A
    // A logout/login resets the module state; account B must not inherit the
    // cooldown (else B sees a false "already sent" with no email dispatched).
    resetVerifyResendState();
    const afterReset = await resendVerificationEmail();
    expect(afterReset).toBe(true);
    expect(h.fetcherMock).toHaveBeenCalledTimes(2);
    expect(h.toast.info).not.toHaveBeenCalled();
  });

  it('toasts the failure and allows retry (no cooldown burned)', async () => {
    h.fetcherMock.mockRejectedValueOnce(new ApiError(429, {
      error: { code: 'rate_limited', message: 'Too many attempts — slow down.' },
    }, 'Too many attempts — slow down.'));
    const sent = await resendVerificationEmail();
    expect(sent).toBe(false);
    expect(h.toast.error).toHaveBeenCalled();
    // Failure must not start the cooldown — the next attempt goes through.
    h.fetcherMock.mockResolvedValueOnce(undefined);
    expect(await resendVerificationEmail()).toBe(true);
  });
});

describe('showAnalysisDispatchError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetResendStateForTests();
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  });

  it('verify gate → actionable toast with a resend action + banner re-show', () => {
    const { removeItem, dispatchEvent } = stubBrowserGlobals();
    const err = new ApiError(403, {
      error: { code: 'email_verification_required', message: 'Verify your email.' },
    });
    showAnalysisDispatchError(err, 'Could not start re-analysis');
    expect(h.toast.error).toHaveBeenCalledWith(
      'Verify your email to run another analysis.',
      expect.objectContaining({
        action: expect.objectContaining({ label: 'Resend email' }),
      }),
    );
    expect(removeItem).toHaveBeenCalledWith(VERIFY_BANNER_DISMISS_KEY);
    expect(dispatchEvent).toHaveBeenCalled();
  });

  it('other ApiErrors → plain toast with the envelope message', () => {
    stubBrowserGlobals();
    const err = new ApiError(409, {
      error: { code: 'entitlement_exhausted', message: 'No analyses left.' },
    }, 'No analyses left.');
    showAnalysisDispatchError(err, 'Could not start re-analysis');
    expect(h.toast.error).toHaveBeenCalledWith('No analyses left.');
  });

  it('non-Error values → the fallback copy', () => {
    stubBrowserGlobals();
    showAnalysisDispatchError('boom', 'Could not start re-analysis');
    expect(h.toast.error).toHaveBeenCalledWith('Could not start re-analysis');
  });
});
