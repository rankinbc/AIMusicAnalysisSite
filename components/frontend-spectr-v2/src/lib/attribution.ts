/* Story 6.5 (AC4) — inbound attribution capture. Share pages (7.4) stash
 * `spectr_attribution` write-only in localStorage; a share/register link also
 * carries a `?via=` / `?ref=` param. This reads the source ONCE for a
 * signup-class event and drains the stash so a later unrelated signup can't
 * inherit a stale share source. PII-free (a share token / ref slug is not
 * personal). SSR/no-window safe. */
const KEY = 'spectr_attribution';

/** Read + drain the attribution source. Returns `{ source }` to spread into an
 *  event's props, or `{}` when there's nothing (so callers can spread freely). */
export function readAttribution(): { source?: string } {
  if (typeof window === 'undefined') return {};

  // URL param wins (freshest signal): ?via=share_x or ?ref=x.
  let source: string | null = null;
  try {
    const params = new URLSearchParams(window.location.search);
    source = params.get('via') ?? params.get('ref');
  } catch { /* malformed URL — fall through to the stash */ }

  if (!source) {
    try { source = window.localStorage.getItem(KEY); } catch { /* private mode */ }
  }

  // Drain the stash regardless — it attaches at most once.
  try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }

  return source ? { source } : {};
}
