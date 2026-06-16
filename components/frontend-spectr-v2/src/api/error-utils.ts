// Story 2.2 review-fix P26 — single source of truth for extracting the
// human-readable `message` out of an AR38 error envelope:
//   { error: { code: string, message: string, details?: unknown } }
// Used by every feature that calls fetcher<T>() and wants to surface a
// toast message that prefers the BFF's wording over a generic fallback.

export function extractApiMessage(body: unknown): string | undefined {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const err = (body as { error?: { message?: string } }).error;
    return err?.message;
  }
  return undefined;
}
