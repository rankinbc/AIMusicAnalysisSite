/* Story 6.5 (AC4) — inbound attribution capture. Share pages (7.4) stash
 * `spectr_attribution` write-only in localStorage; a share/register link also
 * carries a `?via=` / `?ref=` param. This reads the source ONCE for a
 * signup-class event and drains the stash so a later unrelated signup can't
 * inherit a stale share source. SSR/no-window safe.
 *
 * PRIVACY (review): the raw value can be a SHARE TOKEN (resolves to a specific
 * account) or uncontrolled `?ref=` free text (`?ref=jane@x.com`). Neither may
 * reach PostHog. `sanitizeSource` reduces a `share_*` token to the CHANNEL
 * `"share"` (the per-share/viral join stays server-side via the /register
 * `?via=` handler) and slugifies a ref to `[a-z0-9-]` capped at 32 chars,
 * dropping anything that isn't a plausible campaign slug. */
export const ATTRIBUTION_KEY = 'spectr_attribution';

export function sanitizeSource(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Share tokens de-anonymize — keep only the channel, never the token.
  if (raw.startsWith('share_')) return 'share';
  const slug = raw.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);
  return slug.length > 0 ? slug : null;
}

/** Read + drain the attribution source. Returns `{ source }` to spread into an
 *  event's props, or `{}` when there's nothing (so callers can spread freely). */
export function readAttribution(): { source?: string } {
  if (typeof window === 'undefined') return {};

  // URL param wins (freshest signal). `||` not `??` so an empty ?via= falls
  // through to ?ref= instead of shadowing it (review).
  let raw: string | null = null;
  try {
    const params = new URLSearchParams(window.location.search);
    raw = params.get('via') || params.get('ref');
  } catch { /* malformed URL — fall through to the stash */ }

  if (!raw) {
    try { raw = window.localStorage.getItem(ATTRIBUTION_KEY); } catch { /* private mode */ }
  }

  // Drain the stash regardless — it attaches at most once.
  try { window.localStorage.removeItem(ATTRIBUTION_KEY); } catch { /* ignore */ }

  const source = sanitizeSource(raw);
  return source ? { source } : {};
}
