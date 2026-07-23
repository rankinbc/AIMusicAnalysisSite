// Wave-3 Task 1 — the global mutation error handler's opt-in + message rules.
// Integration coverage (a real useMutation firing exactly one toast through
// the MutationCache) lives in
// features/listen/__tests__/mutation-error-meta.test.tsx.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from 'sonner';

import { ApiError } from '../fetcher';
import { mutationErrorToast } from '../mutation-error-toast';

const errorSpy = vi.mocked(toast.error);

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
