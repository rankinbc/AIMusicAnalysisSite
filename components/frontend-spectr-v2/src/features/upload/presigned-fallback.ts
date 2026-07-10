// Story 12.3 (AC1) — shared decision: should a failed presigned upload
// attempt fall back to the legacy proxy path?
//
// True when the presigned path itself is unavailable:
// - ApiError 501 `presigned_unavailable` (S3 unconfigured — the 3.1 contract)
// - ApiError 503 `storage_unreachable` / any 5xx (S3 configured but MinIO/R2
//   down; the BFF answers a typed 503 instead of an unhandled 500 since 12.3)
// - a fetch-level network failure (fetch rejects with TypeError)
//
// False for every 4xx: 400 validation, 403 verify-gate (12-1), 409
// entitlement, 429 rate limit are product gates — falling back would bypass
// or blur them. Also false for plain Errors (part PUT failures): callers must
// only consult this predicate where zero bytes have moved (init stage /
// single-PUT attachments); a mid-multipart failure surfaces as an error,
// never a silent proxy re-upload.
import { ApiError } from '../../api/fetcher';

export function shouldFallBackToProxy(e: unknown): boolean {
  if (e instanceof ApiError) return e.status === 501 || e.status >= 500;
  return e instanceof TypeError;
}
