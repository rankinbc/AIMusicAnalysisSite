/* Story 12.3 — shared fallback predicate for the presigned upload paths. */
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../api/fetcher';
import { PresignedPutError, shouldFallBackToProxy } from '../presigned-fallback';

describe('shouldFallBackToProxy', () => {
  it.each([501, 503, 500, 502, 504])('true for ApiError %i (presigned path down)', (status) => {
    expect(shouldFallBackToProxy(new ApiError(status, null))).toBe(true);
  });

  it.each([400, 403, 404, 409, 429])(
    'false for ApiError %i (product gates must propagate, never proxy-bypass)',
    (status) => {
      expect(shouldFallBackToProxy(new ApiError(status, null))).toBe(false);
    },
  );

  it('true for a fetch-level network failure (TypeError)', () => {
    expect(shouldFallBackToProxy(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('true for a PresignedPutError (attachment single-PUT to a down store; zero bytes committed)', () => {
    expect(shouldFallBackToProxy(new PresignedPutError('Attachment upload network error'))).toBe(true);
  });

  it('false for a plain Error (mix part PUT failures must surface, not re-upload)', () => {
    expect(shouldFallBackToProxy(new Error('Part 1 failed (500)'))).toBe(false);
  });

  it('false for non-error junk', () => {
    expect(shouldFallBackToProxy(undefined)).toBe(false);
    expect(shouldFallBackToProxy('boom')).toBe(false);
    expect(shouldFallBackToProxy(null)).toBe(false);
  });
});
