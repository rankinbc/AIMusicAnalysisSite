// Extracted out of register.tsx so a pure helper doesn't sit in a route
// component file (react-refresh/only-export-components — same pattern as
// features/results/*-helpers.ts).
//
// Story 2.1 review-fix P13 — accept `?next=/path` so that anonymous users
// bounced from the pricing page (or any other "must-be-authed" flow) return
// to the same page after registration. Sanitized: only same-origin
// path-relative values are accepted; absolute or scheme-bearing values are
// silently dropped to defeat open-redirect via `?next=http://evil.com`.
export function safeNext(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return undefined; // malformed percent-encoding
  }
  // Must start with a single `/` and not be a protocol-relative URL
  // (`//evil.com`). Reject anything containing `:` to drop scheme-based
  // attacks. Path may include `?` query, but no scheme/host.
  if (!decoded.startsWith('/')) return undefined;
  if (decoded.startsWith('//')) return undefined;
  if (decoded.includes(':')) return undefined;
  // G5 fix1 item 6 — a backslash is browser-normalized to a forward slash by
  // some URL parsers, so `/\evil.example` becomes protocol-relative
  // (`//evil.example`) even though it passed the `//` check above. Checked
  // against the DECODED value so `/%5Cevil.example` is caught too. Control
  // characters are rejected the same way.
  // eslint-disable-next-line no-control-regex -- deliberately matching C0 control chars
  if (/[\\\x00-\x1f]/.test(decoded)) return undefined;
  return raw;
}
