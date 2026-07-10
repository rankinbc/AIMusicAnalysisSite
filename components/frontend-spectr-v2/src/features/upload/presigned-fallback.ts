// Story 12.3 (AC1) — shared decision: should a failed presigned upload
// attempt fall back to the legacy proxy path?
//
// True when the presigned path itself is unavailable:
// - ApiError 501 `presigned_unavailable` (S3 unconfigured — the 3.1 contract)
// - ApiError 503 `storage_unreachable` / any 5xx (S3 configured but MinIO/R2
//   down; the BFF answers a typed 503 instead of an unhandled 500 since 12.3)
// - a fetch-level network failure (fetch rejects with TypeError)
// - a PresignedPutError from a single-object attachment PUT (12.3 review-fix):
//   the attachment init only SIGNS a URL (CPU-only, no round-trip), so a down
//   MinIO isn't caught at init — the raw XHR PUT is where it surfaces. A single
//   attachment PUT commits zero bytes on failure, so falling back is safe.
//
// False for every 4xx: 400 validation, 403 verify-gate (12-1), 409
// entitlement, 429 rate limit are product gates — falling back would bypass
// or blur them. Also false for plain Errors (mix part-PUT failures): callers
// must only consult this predicate where zero bytes have moved (init stage /
// single-PUT attachments); a mid-multipart failure surfaces as an error,
// never a silent proxy re-upload.
import { ApiError } from '../../api/fetcher';

// Thrown by the attachment single-PUT helper when the PUT itself fails (network
// error or a non-2xx from the object store). Distinct from a mix part-PUT's
// plain Error so this predicate can tell "presigned path is down, zero bytes
// committed → fall back" from "mid-multipart failure → surface".
export class PresignedPutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PresignedPutError';
  }
}

export function shouldFallBackToProxy(e: unknown): boolean {
  if (e instanceof ApiError) return e.status === 501 || e.status >= 500;
  return e instanceof TypeError || e instanceof PresignedPutError;
}
