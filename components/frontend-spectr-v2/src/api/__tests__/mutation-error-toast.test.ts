// Wave-3 Task 1 — the global mutation error handler's opt-in + message rules.
// Integration coverage (a real useMutation firing exactly one toast through
// the MutationCache) lives in
// features/listen/__tests__/mutation-error-meta.test.tsx.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../lib/analytics', () => ({ capture: vi.fn() }));

import { toast } from 'sonner';

import { ApiError } from '../fetcher';
import { capture } from '../../lib/analytics';
import { mutationErrorToast, handleGuestRestricted, isGuestRestrictedError } from '../mutation-error-toast';
import { onGuestUpgrade } from '../../features/demo/guest-upgrade-bus';

const errorSpy = vi.mocked(toast.error);
const captureSpy = vi.mocked(capture);

describe('mutationErrorToast (opt-in global handler)', () => {
  beforeEach(() => errorSpy.mockClear());

  it('does nothing when the mutation has no meta.errorToast (opt-in rule)', () => {
    mutationErrorToast(new ApiError(403, { error: { code: 'x', message: 'Nope.' } }), {});
    mutationErrorToast(new Error('boom'), { meta: {} });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('prefers the server wording from an ApiError body (envelope shape)', () => {
    mutationErrorToast(
      new ApiError(403, { error: { code: 'forbidden', message: 'Suggestions are closed here.' } }),
      { meta: { errorToast: 'Could not accept the suggestion.' } },
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('Suggestions are closed here.');
  });

  it('prefers the server wording for the legacy {error:"text"} shape', () => {
    mutationErrorToast(new ApiError(404, { error: 'Bookmark not found' }), {
      meta: { errorToast: 'Could not delete the bookmark.' },
    });
    expect(errorSpy).toHaveBeenCalledWith('Bookmark not found');
  });

  it('falls back to the meta copy when the ApiError body carries no message (never raw "HTTP 500")', () => {
    mutationErrorToast(new ApiError(500, undefined), {
      meta: { errorToast: 'Could not save the preset.' },
    });
    expect(errorSpy).toHaveBeenCalledWith('Could not save the preset.');
  });

  it('falls back to the meta copy for non-ApiError failures (network TypeError)', () => {
    mutationErrorToast(new TypeError('Failed to fetch'), {
      meta: { errorToast: 'Could not follow.' },
    });
    expect(errorSpy).toHaveBeenCalledWith('Could not follow.');
  });
});

// D10 fix1 (item 1) — the ONE shared envelope-parsing helper every
// hand-written catch around a raw fetcher()/XHR call routes through, so
// `UnifiedUploadDialog` and friends never re-implement this check.
describe('isGuestRestrictedError', () => {
  it('is true only for an ApiError carrying the guest_restricted code', () => {
    expect(
      isGuestRestrictedError(
        new ApiError(403, { error: { code: 'guest_restricted', message: 'm' } }),
      ),
    ).toBe(true);
  });

  it('is false for guest_busy, any other code, and non-ApiError failures', () => {
    expect(
      isGuestRestrictedError(new ApiError(429, { error: { code: 'guest_busy', message: 'm' } })),
    ).toBe(false);
    expect(
      isGuestRestrictedError(new ApiError(403, { error: { code: 'forbidden', message: 'm' } })),
    ).toBe(false);
    expect(isGuestRestrictedError(new Error('boom'))).toBe(false);
    expect(isGuestRestrictedError(undefined)).toBe(false);
  });
});

describe('handleGuestRestricted', () => {
  beforeEach(() => {
    captureSpy.mockClear();
  });

  it('opens the bus with the reason + server message, fires the analytics event once, returns true', () => {
    const seen: Array<[string, string | undefined]> = [];
    const off = onGuestUpgrade((r, m) => seen.push([r, m]));
    const handled = handleGuestRestricted(
      new ApiError(403, {
        error: { code: 'guest_restricted', message: 'M', details: { reason: 'analysis_limit' } },
      }),
    );
    off();
    expect(handled).toBe(true);
    expect(seen).toEqual([['analysis_limit', 'M']]);
    expect(captureSpy).toHaveBeenCalledTimes(1);
    expect(captureSpy).toHaveBeenCalledWith('demo_guest_restricted', { reason: 'analysis_limit' });
  });

  it('an unrecognized reason falls back to not_allowed', () => {
    const seen: string[] = [];
    const off = onGuestUpgrade((r) => seen.push(r));
    handleGuestRestricted(
      new ApiError(403, {
        error: { code: 'guest_restricted', message: 'nope', details: { reason: 'something_new' } },
      }),
    );
    off();
    expect(seen).toEqual(['not_allowed']);
  });

  it('does nothing and returns false for guest_busy (429) — stays a plain toast elsewhere', () => {
    const seen: string[] = [];
    const off = onGuestUpgrade((r) => seen.push(r));
    const handled = handleGuestRestricted(
      new ApiError(429, { error: { code: 'guest_busy', message: 'Still working on your last upload.' } }),
    );
    off();
    expect(handled).toBe(false);
    expect(seen).toEqual([]);
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it('does nothing and returns false for a non-guest_restricted error', () => {
    const seen: string[] = [];
    const off = onGuestUpgrade((r) => seen.push(r));
    const handled = handleGuestRestricted(
      new ApiError(403, { error: { code: 'forbidden', message: 'no' } }),
    );
    off();
    expect(handled).toBe(false);
    expect(seen).toEqual([]);
  });
});
