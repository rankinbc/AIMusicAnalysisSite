// @vitest-environment jsdom
// F1b — the first-party analytics transport and its wiring into capture().
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAccessToken } from '../../api/fetcher';
import { ATTRIBUTION_KEY } from '../attribution';
import { normalizePath, sendEvent } from '../first-party-events';

const fetchMock = vi.fn();

function lastBody(): Record<string, unknown> {
  const init = fetchMock.mock.calls.at(-1)![1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 204 });
  vi.stubGlobal('fetch', fetchMock);
  setAccessToken(null);
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('sendEvent', () => {
  it('posts the event, a session id and the current path to /api/events', () => {
    window.history.replaceState({}, '', '/pricing?utm_source=x#top');
    sendEvent('pricing_viewed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/events');
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect(init.credentials).toBe('omit');
    const body = lastBody();
    expect(body['event']).toBe('pricing_viewed');
    expect(body['path']).toBe('/pricing'); // no query string, no hash
    expect(typeof body['sessionId']).toBe('string');
    expect(body).not.toHaveProperty('props');
    expect(body).not.toHaveProperty('attribution');
  });

  it('reuses one session id within a tab', () => {
    sendEvent('landing_viewed');
    const first = lastBody()['sessionId'];
    sendEvent('pricing_viewed');
    expect(lastBody()['sessionId']).toBe(first);
  });

  it('sends props and the first-touch attribution when present', () => {
    window.localStorage.setItem(
      ATTRIBUTION_KEY,
      JSON.stringify({ source: 'youtube', campaign: 'launch', at: Date.now() }),
    );
    sendEvent('purchase_completed', { product: 'credits' });
    const body = lastBody();
    expect(body['props']).toEqual({ product: 'credits' });
    expect(body['attribution']).toEqual({ source: 'youtube', campaign: 'launch' });
  });

  it('attaches the bearer token only when signed in', () => {
    sendEvent('landing_viewed');
    let headers = (fetchMock.mock.calls.at(-1)![1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();

    setAccessToken('tok-123');
    sendEvent('report_viewed', { job_id: 'j1' });
    headers = (fetchMock.mock.calls.at(-1)![1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok-123');
  });

  it('collapses id segments in the path', () => {
    expect(normalizePath('/songs/3f2504e0-4f89-11d3-9a0c-0305e82c3301/results/3F2504E0-4F89-11D3-9A0C-0305E82C3301'))
      .toBe('/songs/:id/results/:id');
    expect(normalizePath('/pricing')).toBe('/pricing');
  });

  it('never throws when the request fails or storage is blocked', () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => sendEvent('landing_viewed')).not.toThrow();
    expect(typeof lastBody()['sessionId']).toBe('string'); // in-memory fallback
  });
});

describe('capture → first-party sink', () => {
  async function loadAnalytics(mode: string) {
    vi.resetModules();
    vi.stubEnv('MODE', mode);
    vi.stubEnv('VITE_POSTHOG_KEY', '');
    return import('../analytics');
  }

  it('sends every captured event outside test mode, with no PostHog key needed', async () => {
    const a = await loadAnalytics('production');
    a.capture('signup_completed', { path: 'direct', pending: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastBody()).toMatchObject({
      event: 'signup_completed',
      props: { path: 'direct', pending: true },
    });
  });

  it('stays off the network under vitest', async () => {
    const a = await loadAnalytics('test');
    a.capture('landing_viewed');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('event-name parity with the BFF allowlist', () => {
  const FE = resolve(__dirname, '../../..');
  const analytics = readFileSync(resolve(FE, 'src/lib/analytics.ts'), 'utf8');
  const bffPath = resolve(FE, '../bff/src/Spectr.Bff/Endpoints/EventEndpoints.cs');

  it('every EventName is accepted by POST /api/events, and nothing else is', () => {
    expect(existsSync(bffPath)).toBe(true);
    const union = analytics.slice(analytics.indexOf('type EventName ='), analytics.indexOf('export function capture'));
    // Line-anchored: a member starts its line (comments also contain `| 'x'`).
    const frontend = [...union.matchAll(/^\s*\|\s*'([a-z_]+)'/gm)].map((m) => m[1]!).sort();

    const cs = readFileSync(bffPath, 'utf8');
    const set = cs.slice(cs.indexOf('KnownEvents'), cs.indexOf('};', cs.indexOf('KnownEvents')));
    const backend = [...set.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!).sort();

    expect(frontend.length).toBeGreaterThan(20);
    expect(backend).toEqual(frontend);
  });
});
