/* F1b — first-party analytics transport. Every `capture()` (lib/analytics.ts)
 * is also POSTed to our own BFF (`/api/events` → analytics_events table), so
 * the acquisition funnel is measured without any third party.
 *
 * What is sent: the event name, a random per-TAB session id (sessionStorage —
 * gone when the tab closes, never a cross-visit identifier), the current path
 * with ids collapsed (no query string, no hash), the event's small props, and
 * the first-touch attribution. When the visitor is signed in (a guest is a
 * real account) the bearer token rides along so the server can stamp user_id.
 * Nothing here may throw or block: analytics is optional, the app is not. */
import { getAccessToken } from '../api/fetcher';
import { getAttribution } from './attribution';

const SID_KEY = 'spectr_sid';
const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
let memorySid: string | null = null;

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `s-${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
  }
}

function sessionId(): string {
  try {
    const existing = window.sessionStorage.getItem(SID_KEY);
    if (existing) return existing;
    const created = newId();
    window.sessionStorage.setItem(SID_KEY, created);
    return created;
  } catch {
    // Storage blocked — one id for the lifetime of this page load.
    memorySid ??= newId();
    return memorySid;
  }
}

/** Path only, with GUID segments collapsed so reports group by page. */
export function normalizePath(pathname: string): string {
  return pathname.replace(GUID_RE, ':id');
}

export function sendEvent(event: string, props?: Record<string, unknown>): void {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return;
  try {
    const attribution = getAttribution();
    const body = JSON.stringify({
      event,
      sessionId: sessionId(),
      path: normalizePath(window.location.pathname),
      ...(props ? { props } : {}),
      ...(Object.keys(attribution).length > 0 ? { attribution } : {}),
    });
    const token = getAccessToken();
    void fetch('/api/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
      // Survives the page unloading (checkout redirect, sign-up navigation).
      keepalive: true,
      credentials: 'omit',
    }).catch(() => {
      /* offline / blocked — drop */
    });
  } catch {
    /* never let analytics break the caller */
  }
}
