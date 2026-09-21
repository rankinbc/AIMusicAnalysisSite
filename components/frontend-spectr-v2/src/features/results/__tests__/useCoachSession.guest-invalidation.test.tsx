// @vitest-environment jsdom
// D10 fix1 (item 3) — a coach message changes `coachMessagesUsed`, one of
// the numbers `GET /api/me/guest` reports. useCoachSession.send() is a
// hand-rolled fetch()/SSE flow (not useMutation), so it needs its own
// QueryClient + invalidateGuestState call rather than an onSuccess hook.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

import { useCoachSession } from '../useCoachSession';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidateSpy };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/conversation')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            conversationId: 'c1',
            analysisId: 'a1',
            messages: [],
            caps: { used: 0, limit: 5, capReached: false },
          }),
        } as Response);
      }
      if (url.endsWith('/messages') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            conversationId: 'c1',
            userMessageId: 'u1',
            pendingAssistantMessageId: 'p1',
            caps: { used: 1, limit: 5, capReached: false },
          }),
        } as Response);
      }
      if (url.includes('/stream')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.close(); // no tokens — this test only cares about the POST phase
            },
          }),
        } as Response);
      }
      return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('useCoachSession — a sent message invalidates guest state', () => {
  it('invalidates me/guest once the POST succeeds', async () => {
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(
      () =>
        useCoachSession({
          analysisId: 'a1',
          wireMode: 'qa',
          input: 'What frequencies are clashing?',
          clearInput: vi.fn(),
          scheduleAriaLive: vi.fn(),
          flushAriaLive: vi.fn(),
          resetAriaLive: vi.fn(),
          cancelAriaLiveTimer: vi.fn(),
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.send();
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['me', 'guest'] });
  });
});
