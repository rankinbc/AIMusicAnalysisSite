// Custom fetch wrapper that all API hooks route through.
// Owns: auth header injection, 401 -> silent refresh + retry, structured errors.
//
// Refresh is serialized via a module-level Promise so N concurrent 401s
// trigger exactly one /api/auth/refresh call.

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, message?: string) {
    super(message ?? `HTTP ${status}`);
  }
}

let accessToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;
let onAuthClearedCallback: (() => void) | null = null;
let onTokenRefreshedCallback: ((token: string) => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
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

async function refreshToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const r = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      if (!r.ok) return null;
      const data = (await r.json()) as { accessToken: string };
      accessToken = data.accessToken;
      onTokenRefreshedCallback?.(data.accessToken);
      return data.accessToken;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
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
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
