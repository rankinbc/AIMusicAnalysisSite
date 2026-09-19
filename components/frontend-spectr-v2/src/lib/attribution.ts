/* Story 6.5 (AC4) — inbound attribution capture. The anon-funnel (`/analyze`)
 * register card reads this ONCE for a signup-class event: a `?via=` / `?ref=`
 * URL param, or a `spectr_attribution` stash left in localStorage. Drains the
 * stash so a later unrelated signup can't inherit a stale source. SSR/no-window
 * safe.
 *
 * PRIVACY (review): the raw value is uncontrolled `?ref=` free text (e.g.
 * `?ref=jane@x.com`) and must never reach PostHog verbatim — `sanitizeSource`
 * slugifies it to `[a-z0-9-]` capped at 32 chars, dropping anything that
 * isn't a plausible campaign slug. */
export const ATTRIBUTION_KEY = 'spectr_attribution';

export function sanitizeSource(raw: string | null | undefined): string | null {
  if (!raw) return null;
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
