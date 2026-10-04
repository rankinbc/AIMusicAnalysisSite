/* F1 (analytics + attribution) — FIRST-TOUCH inbound attribution.
 *
 * `captureAttribution()` runs once at boot (main.tsx), BEFORE PostHog loads:
 * it reads `utm_source/medium/campaign`, `?via=` / `?ref=` and the referring
 * host, and stashes them in localStorage unless a fresh stash already exists
 * (first touch wins for 30 days). `getAttribution()` is a non-draining read —
 * the same source rides every PostHog event (`registerAttribution`) and the
 * three account-creating calls (register, guest mint, guest convert), where
 * the BFF persists it on the users row.
 *
 * PRIVACY (story 6.5 review, kept): `?ref=` is uncontrolled free text (e.g.
 * `?ref=jane@x.com`) and must never be stored or sent verbatim —
 * `sanitizeSource` slugifies to `[a-z0-9_-]` capped at 64, and `ref`/`via`
 * are stripped from the address bar so PostHog's `$current_url` never carries
 * them. Only the referrer's HOST is kept (a full URL can hold search terms or
 * tokens). The BFF re-sanitizes everything. SSR/no-window safe. */
export const ATTRIBUTION_KEY = 'spectr_attribution';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const HOST_RE = /^[a-z0-9.-]{1,128}$/;

export interface Attribution {
  source?: string;
  medium?: string;
  campaign?: string;
  referrer?: string;
}

export function sanitizeSource(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const slug = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);
  return slug.length > 0 ? slug : null;
}

function referrerHost(): string | null {
  try {
    if (!document.referrer) return null;
    const host = new URL(document.referrer).hostname.toLowerCase();
    if (!host || host === window.location.hostname || !HOST_RE.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

function pick(value: unknown, clean: (v: string) => string | null): string | undefined {
  return typeof value === 'string' ? (clean(value) ?? undefined) : undefined;
}

/** The stored first touch, or null when absent, expired or malformed (incl.
 *  the pre-F1 bare-string stash, which fails JSON.parse). */
function readStash(): Attribution | null {
  try {
    const raw = window.localStorage.getItem(ATTRIBUTION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const rec = parsed as Record<string, unknown>;
    const at = rec['at'];
    if (typeof at !== 'number' || Date.now() - at > MAX_AGE_MS) return null;
    // Re-validated on read: localStorage is user-writable.
    const out: Attribution = {};
    const source = pick(rec['source'], sanitizeSource);
    const medium = pick(rec['medium'], sanitizeSource);
    const campaign = pick(rec['campaign'], sanitizeSource);
    const referrer = pick(rec['referrer'], (v) => (HOST_RE.test(v) ? v : null));
    if (source) out.source = source;
    if (medium) out.medium = medium;
    if (campaign) out.campaign = campaign;
    if (referrer) out.referrer = referrer;
    return out;
  } catch {
    return null;
  }
}

/** Drop `ref`/`via` from the address bar (path, other params and hash kept). */
function stripRefParams(params: URLSearchParams): void {
  if (!params.has('ref') && !params.has('via')) return;
  try {
    params.delete('ref');
    params.delete('via');
    const qs = params.toString();
    const url = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
    window.history.replaceState(window.history.state, '', url);
  } catch { /* history unavailable — nothing to strip */ }
}

/** Boot-time capture. Idempotent; never throws. */
export function captureAttribution(): void {
  if (typeof window === 'undefined') return;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return;
  }

  if (!readStash()) {
    // `||` not `??` so an empty ?utm_source= / ?via= falls through (review).
    const source = sanitizeSource(
      params.get('utm_source') || params.get('via') || params.get('ref'),
    );
    const medium = sanitizeSource(params.get('utm_medium'));
    const campaign = sanitizeSource(params.get('utm_campaign'));
    const referrer = referrerHost();
    if (source || medium || campaign || referrer) {
      const stash: Attribution & { at: number } = { at: Date.now() };
      if (source) stash.source = source;
      if (medium) stash.medium = medium;
      if (campaign) stash.campaign = campaign;
      if (referrer) stash.referrer = referrer;
      try {
        window.localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(stash));
      } catch { /* private mode — attribution is best-effort */ }
    }
  }

  stripRefParams(params);
}

/** Non-draining read of the first touch; `{}` when there is none. */
export function getAttribution(): Attribution {
  if (typeof window === 'undefined') return {};
  return readStash() ?? {};
}

/** `{ attribution }` to spread into a request body, or `{}` when there is
 *  nothing — so callers never send an empty object. */
export function attributionPayload(): { attribution?: Attribution } {
  const attribution = getAttribution();
  return Object.keys(attribution).length > 0 ? { attribution } : {};
}
