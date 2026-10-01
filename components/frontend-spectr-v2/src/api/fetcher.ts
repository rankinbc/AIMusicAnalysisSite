// Custom fetch wrapper that all API hooks route through.
// Owns: auth header injection, 401 -> silent refresh + retry, structured errors.
//
// Refresh is serialized via a module-level Promise so N concurrent 401s
// trigger exactly one /api/auth/refresh call.

import { extractApiError } from './error-utils';
import type { AuthResponse } from './types';

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, message?: string) {
    super(message ?? `HTTP ${status}`);
  }
}

let accessToken: string | null = null;
// D9 fix round 2 (item 1): tagged with the generation it was started under,
// so a new caller arriving under a NEWER generation can tell its in-flight
// promise is stale (see refreshSession below) instead of blindly sharing it.
let refreshInFlight: { generation: number; promise: Promise<AuthResponse | null> } | null = null;
let onAuthClearedCallback: (() => void) | null = null;
let onTokenRefreshedCallback: ((token: string) => void) | null = null;

// D9 fix round 1 (item 1): a monotonically increasing session generation.
// AuthContext bumps it on startDemo/login/logout — refreshSession captures
// the generation live WHEN a refresh starts and re-checks it before
// installing the response, so a refresh that was already in flight when the
// session changed underneath it can never overwrite (or, on a 401, wipe) the
// new session's token. Single source of truth for both fetcher.ts's own 401
// retry path and AuthContext's boot/silent refresh.
let sessionGeneration = 0;

export function bumpSessionGeneration(): void {
  sessionGeneration++;
}

export function getSessionGeneration(): number {
  return sessionGeneration;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  // Session boundary (logout / auth clear): a stale traceId must not leak
  // into another user's problem report.
  if (token === null) lastTraceId = null;
}

export function getAccessToken(): string | null {
  return accessToken;
}

// Story 12.8: most recent internal_error traceId (500 envelope) — the only
// server correlation handle the client ever sees; consumed by the
// "Report a problem" prefill.
// Expires after 30 min so an old error from hours ago isn't attached to an
// unrelated report.
const TRACE_ID_TTL_MS = 30 * 60 * 1000;
let lastTraceId: string | null = null;
let lastTraceIdAt = 0;
export function getLastTraceId(): string | null {
  if (lastTraceId && Date.now() - lastTraceIdAt > TRACE_ID_TTL_MS) lastTraceId = null;
  return lastTraceId;
}

export function onAuthCleared(cb: (() => void) | null): void {
  onAuthClearedCallback = cb;
}

export function onTokenRefreshed(cb: ((token: string) => void) | null): void {
  onTokenRefreshedCallback = cb;
}

interface FetcherConfig {
  url: string;
  method: string;
  data?: unknown;
  body?: BodyInit | null;
  headers?: Record<string, string>;
  // Allow explicit `signal: undefined` (the shape orval-generated clients emit
  // under exactOptionalPropertyTypes).
  signal?: AbortSignal | undefined;
  // Query params dictionary — orval passes these through as a plain object.
  params?: Record<string, string | number | boolean | null | undefined> | undefined;
  /** Let the request outlive the page (a save fired from `pagehide`). Bodies
   *  are capped at 64 KB by the browser — small JSON only. */
  keepalive?: boolean | undefined;
}

/**
 * Story 12.7: THE single-flight /api/auth/refresh for the whole tab.
 * Both refresh mechanisms — the AuthContext boot silent-refresh and this
 * wrapper's 401 handler — MUST share one in-flight request: refresh tokens
 * ROTATE, so two concurrent calls guarantee the loser 401s and clears a
 * perfectly good session (React StrictMode's double mount effect made this
 * deterministic in dev). Returns the full AuthResponse so AuthContext can
 * hydrate the user without a second round-trip.
 */
export function refreshSession(): Promise<AuthResponse | null> {
  const requestGeneration = sessionGeneration;
  const existing = refreshInFlight;

  if (existing && existing.generation === requestGeneration) {
    // Same-generation dedupe: N concurrent callers share the one request.
    return existing.promise;
  }

  if (existing) {
    // D9 fix round 2 (item 1, bullet 3): `existing` was started under an
    // OLDER generation (e.g. the boot refresh, still open when startDemo or
    // login superseded it). The refresh cookie rotates on use, so firing a
    // second POST while that one is still in flight would present it twice.
    // Wait for it to settle — its result is irrelevant to us and is never
    // read here — then start a genuinely fresh request under the CURRENT
    // generation. Chained into `refreshInFlight` synchronously below so any
    // other same-generation caller that arrives during the wait dedupes onto
    // this one successor instead of each starting its own.
    const chained: { generation: number; promise: Promise<AuthResponse | null> } = {
      generation: requestGeneration,
      promise: existing.promise.catch(() => null).then(() => startRefresh()),
    };
    refreshInFlight = chained;
    return chained.promise;
  }

  return startRefresh();
}

// D9 fix round 2 (item 1, bullet 1): a superseded refresh must resolve
// `null` for EVERY awaiter, not just skip the module-token side effect —
// otherwise a caller that reads the token off the returned AuthResponse
// (rather than off `getAccessToken()`) still receives a bearer that belongs
// to a session this tab has already moved on from.
function startRefresh(): Promise<AuthResponse | null> {
  const startGeneration = sessionGeneration;
  const doRefresh = async (): Promise<AuthResponse | null> => {
    try {
      const r = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      // 204 = no session at all (P9: a logged-out visit is not an error).
      if (!r.ok || r.status === 204) return null;
      const data = (await r.json()) as AuthResponse;
      if (sessionGeneration !== startGeneration) return null; // superseded while in flight
      accessToken = data.accessToken;
      onTokenRefreshedCallback?.(data.accessToken);
      return data;
    } catch {
      return null;
    }
  };
  // E2.1: serialize rotation across tabs of the same browser. The server's
  // 60 s rotation grace is the correctness net (a loser tab's stale cookie
  // still resolves); the lock just cuts rotation churn. Feature-detect —
  // Safari <15.4 and some webviews lack Web Locks.
  const run =
    typeof navigator !== 'undefined' && navigator.locks?.request
      ? (navigator.locks.request('spectr_refresh', doRefresh) as Promise<AuthResponse | null>)
      : doRefresh();

  const entry: { generation: number; promise: Promise<AuthResponse | null> } = {
    generation: startGeneration,
    promise: run.finally(() => {
      if (refreshInFlight === entry) refreshInFlight = null;
    }),
  };
  refreshInFlight = entry;
  return entry.promise;
}

/**
 * For XHR upload paths (E3.9): returns an access token guaranteed to live at
 * least `minTtlSeconds` more, silently refreshing first when needed. XHR can't
 * ride the fetcher's 401-retry (re-sending a 200 MB body is the failure mode
 * we're avoiding), so uploads pre-flight their token freshness instead.
 */
export async function getFreshAccessToken(minTtlSeconds = 120): Promise<string | null> {
  let fresh = false;
  if (accessToken) {
    try {
      const seg = accessToken.split('.')[1] ?? '';
      const payload = JSON.parse(
        atob(seg.replace(/-/g, '+').replace(/_/g, '/')),
      ) as { exp?: number };
      fresh =
        typeof payload.exp === 'number' &&
        payload.exp * 1000 - Date.now() > minTtlSeconds * 1000;
    } catch {
      fresh = false; // undecodable → treat as stale
    }
  }
  if (!fresh) await refreshSession();
  return accessToken;
}

/**
 * D9 fix round 2 (item 1, bullet 2): what a 401 retry site should use after
 * awaiting a (possibly superseded) refresh. `refreshSession()` resolves
 * `null` whenever it settled for a generation that's no longer current — so
 * a genuinely fresh token from the refresh itself is used when there is one;
 * otherwise fall back to whatever is CURRENTLY in module state (a session
 * change, e.g. startDemo/login, may have installed a newer token while this
 * caller was waiting) as long as it differs from the token the failed
 * request already carried — retrying with the same still-401ing credential
 * would just loop. Shared by the fetcher's own 401 handler and the two XHR
 * upload hooks (useFileUpload, useStemStaging).
 */
export async function resolveRetryToken(failedToken: string | null): Promise<string | null> {
  const data = await refreshSession();
  if (data) return data.accessToken;
  const current = getAccessToken();
  return current && current !== failedToken ? current : null;
}

async function doFetch(config: FetcherConfig, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { ...(config.headers ?? {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (config.body !== undefined && config.body !== null) {
    body = config.body;
  } else if (config.data !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(config.data);
  }

  const init: RequestInit = {
    method: config.method,
    headers,
    credentials: 'include',
  };
  if (body !== undefined) init.body = body;
  if (config.signal) init.signal = config.signal;
  if (config.keepalive) init.keepalive = true;

  let url = `/api${config.url}`;
  if (config.params) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(config.params)) {
      if (v !== undefined && v !== null) usp.append(k, String(v));
    }
    const qs = usp.toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }

  return fetch(url, init);
}

// E2.2/E2.3: only credential-presenting endpoints are excluded from the 401
// refresh-retry. Everything else — logout, /auth/me GET+PATCH,
// resend-verification, verify-email — must survive an expired access token.
const NO_REFRESH_RETRY = ['/auth/refresh', '/auth/login', '/auth/register', '/auth/dev-login', '/auth/demo'];

export async function fetcher<T>(config: FetcherConfig): Promise<T> {
  const initialToken = accessToken;
  let res = await doFetch(config, initialToken);

  if (res.status === 401 && !NO_REFRESH_RETRY.some((p) => config.url.startsWith(p))) {
    // Try once: silent refresh, then retry.
    const fresh = await resolveRetryToken(initialToken);
    if (fresh) {
      res = await doFetch(config, fresh);
    } else {
      accessToken = null;
      onAuthClearedCallback?.();
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    // Story 12.8: stash the unhandled-500 traceId so "Report a problem" can
    // prefill it — the only correlation handle the client ever receives.
    const traceId = (body as { error?: { details?: { traceId?: string } } } | undefined)
      ?.error?.details?.traceId;
    if (traceId) {
      lastTraceId = traceId;
      lastTraceIdAt = Date.now();
    }
    // Story 12.1 (AC2) — prefer the AR38 envelope's human message so callers
    // that toast `err.message` show the server's wording, not "HTTP 403".
    throw new ApiError(res.status, body, extractApiError(body).message);
  }
  if (res.status === 204) return undefined as T;
  // Room-completion PRP: 202-Accepted endpoints (room event posts, /end) send
  // Content-Length: 0 — res.json() on an empty body REJECTS, which made every
  // successful fire-and-forget call look like a failure to its caller. Treat
  // any empty success body as void rather than keying on specific statuses.
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
