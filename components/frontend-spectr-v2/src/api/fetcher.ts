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
let refreshInFlight: Promise<AuthResponse | null> | null = null;
let onAuthClearedCallback: (() => void) | null = null;
let onTokenRefreshedCallback: ((token: string) => void) | null = null;

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
export async function refreshSession(): Promise<AuthResponse | null> {
  refreshInFlight ??= (async () => {
    try {
      const r = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      if (!r.ok) return null;
      const data = (await r.json()) as AuthResponse;
      accessToken = data.accessToken;
      onTokenRefreshedCallback?.(data.accessToken);
      return data;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function refreshToken(): Promise<string | null> {
  return (await refreshSession())?.accessToken ?? null;
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

export async function fetcher<T>(config: FetcherConfig): Promise<T> {
  let res = await doFetch(config, accessToken);

  if (res.status === 401 && !config.url.startsWith('/auth/')) {
    // Try once: silent refresh, then retry.
    const fresh = await refreshToken();
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
  return (await res.json()) as T;
}
