// @vitest-environment jsdom
// Fix wave FW3 (final review I3, frontend half) — the opening brief always
// finishes and is always asked for:
//   - an `error` brief in the loaded conversation is re-asked ONCE per mount
//     (the server answers `retried`) and the returned message is followed;
//   - pressing Stop mid-brief no longer abandons the turn — the server keeps
//     generating, so the frontend reconciles by polling until the row is
//     terminal (closing line included for a guest);
//   - unmounting mid-poll aborts the in-flight conversation fetch.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CoachConversationDto } from '../../../api/types';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

import { CoachChat } from '../CoachChat';
import { useCoachSession } from '../useCoachSession';

const BRIEF_ID = 'brief-1';
const BODY = 'Kick and bass are clashing around 80-120 Hz.';
const CLOSING_LINE = "Create a free account and let's save our progress — so we can make this mix awesome.";

function briefConversation(status: 'pending' | 'error' | 'complete'): CoachConversationDto {
  return {
    conversationId: 'conv-1',
    analysisId: 'analysis-1',
    messages: [
      {
        id: BRIEF_ID,
        role: 'assistant',
        status,
        content: status === 'complete' ? BODY : status === 'error' ? 'The coach hit a transient error.' : '',
        evidence: status === 'complete' ? [] : null,
        refusalReason: null,
        createdAt: new Date().toISOString(),
        completedAt: status === 'pending' ? null : new Date().toISOString(),
        mode: 'brief',
        isBrief: true,
        closingLine: status === 'complete' ? CLOSING_LINE : null,
      },
    ],
    caps: { used: 0, limit: 5, capReached: false },
  };
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input.toString();
}

function sse(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(f));
      c.close();
    },
  });
}

// Like a real fetch body: aborting the request's signal errors the stream.
function openStream() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => { ctrl = c; } });
  const enc = new TextEncoder();
  return {
    body,
    push: (f: string) => ctrl.enqueue(enc.encode(f)),
    bind: (signal?: AbortSignal | null) =>
      signal?.addEventListener('abort', () => ctrl.error(new DOMException('aborted', 'AbortError'))),
  };
}

function sessionHook() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(
    () =>
      useCoachSession({
        analysisId: 'analysis-1',
        wireMode: 'qa',
        input: '',
        clearInput: vi.fn(),
        scheduleAriaLive: vi.fn(),
        flushAriaLive: vi.fn(),
        resetAriaLive: vi.fn(),
        cancelAriaLiveTimer: vi.fn(),
      }),
    { wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> },
  );
}

describe('the coach brief recovers (FW3)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('an error brief in the loaded conversation is re-asked exactly once and followed', async () => {
    let briefPosts = 0;
    let conversationCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      if (url.endsWith('/brief') && init?.method === 'POST') {
        briefPosts += 1;
        return Promise.resolve({
          ok: true, status: 202, json: async () => ({ status: 'retried', messageId: BRIEF_ID }),
        } as Response);
      }
      if (url.includes('/conversation')) {
        conversationCalls += 1;
        const dto = conversationCalls === 1 ? briefConversation('error') : briefConversation('complete');
        return Promise.resolve({ ok: true, json: async () => dto } as Response);
      }
      if (url.includes(`/messages/${BRIEF_ID}/stream`)) {
        return Promise.resolve({
          ok: true, status: 200,
          body: sse([
            `event: token\ndata: {"type":"token","text":"${BODY}"}\n\n`,
            'event: done\ndata: {"type":"done","evidence":[]}\n\n',
          ]),
        } as Response);
      }
      return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <div className="rdx">
          <CoachChat trackName="Night Drive" analysisId="analysis-1" verdicts={[]} measurementsCount={12} triageDone />
        </div>
      </QueryClientProvider>,
    );

    await screen.findByText(CLOSING_LINE);
    expect(briefPosts).toBe(1);
    expect(fetchMock.mock.calls.some((c) => urlOf(c[0]).includes(`/messages/${BRIEF_ID}/stream`))).toBe(true);
  });

  it('Stop mid-brief still ends with the finished brief and its closing line', async () => {
    const stream = openStream();
    let conversationCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      if (url.includes('/conversation')) {
        conversationCalls += 1;
        // hydration + ensure-fetch see it pending; the server finishes it
        // (it no longer honours a cancel for a brief) by the 2nd poll.
        const dto = conversationCalls <= 3 ? briefConversation('pending') : briefConversation('complete');
        return Promise.resolve({ ok: true, json: async () => dto } as Response);
      }
      if (url.includes(`/messages/${BRIEF_ID}/stream`)) {
        stream.bind(init?.signal);
        return Promise.resolve({ ok: true, status: 200, body: stream.body } as Response);
      }
      return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = sessionHook();
    await waitFor(() => expect(result.current.caps).not.toBeNull());
    act(() => result.current.followMessage(BRIEF_ID));
    await waitFor(() => expect(result.current.streaming).toBe(true));
    await act(async () => {
      stream.push('event: token\ndata: {"type":"token","text":"Kick and "}\n\n');
      await Promise.resolve();
    });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    act(() => result.current.handleStop());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    const brief = result.current.turns.find((t) => t.isBrief);
    expect(brief?.finalized).toBe(true);
    expect(brief?.text).toBe(BODY);
    expect(brief?.closingLine).toBe(CLOSING_LINE);
  });

  it('unmounting mid-poll aborts the in-flight conversation fetch', async () => {
    const signals: AbortSignal[] = [];
    let conversationCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      if (url.includes('/conversation')) {
        conversationCalls += 1;
        if (conversationCalls === 1) {
          return Promise.resolve({ ok: true, json: async () => briefConversation('pending') } as Response);
        }
        if (init?.signal) signals.push(init.signal);
        return new Promise<Response>(() => {}); // never resolves — an in-flight poll
      }
      if (url.includes(`/messages/${BRIEF_ID}/stream`)) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) } as Response);
      }
      return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result, unmount } = sessionHook();
    await waitFor(() => expect(result.current.caps).not.toBeNull());
    act(() => result.current.followMessage(BRIEF_ID));
    await waitFor(() => expect(signals.length).toBeGreaterThan(0));

    unmount();
    expect(signals.every((s) => s.aborted)).toBe(true);
  });
});
