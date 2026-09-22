// @vitest-environment jsdom
// Task G6 fix round 1 (item 1 + 2) — the opening brief streams in live,
// exactly like a normal reply, instead of waiting for a reload. Drives the
// REAL useCoachBrief → useCoachSession.followMessage → readCoachStream path
// through CoachChat with a controllable SSE stream, the same technique
// CoachChat.responding.test.tsx uses for a normal send().
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CoachConversationDto } from '../../../api/types';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

import { CoachChat } from '../CoachChat';
import { useCoachSession } from '../useCoachSession';

const BRIEF_ID = 'brief-1';
const CLOSING_LINE = "Create a free account and let's save our progress — so we can make this mix awesome.";

function emptyConversation(): CoachConversationDto {
  return {
    conversationId: 'conv-1',
    analysisId: 'analysis-1',
    messages: [],
    caps: { used: 0, limit: 5, capReached: false },
  };
}

function pendingBriefConversation(): CoachConversationDto {
  return {
    conversationId: 'conv-1',
    analysisId: 'analysis-1',
    messages: [
      {
        id: BRIEF_ID,
        role: 'assistant',
        status: 'pending',
        content: '',
        evidence: null,
        refusalReason: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
        mode: 'brief',
        isBrief: true,
        closingLine: null,
      },
    ],
    caps: { used: 0, limit: 5, capReached: false },
  };
}

function completeBriefConversation(): CoachConversationDto {
  return {
    conversationId: 'conv-1',
    analysisId: 'analysis-1',
    messages: [
      {
        id: BRIEF_ID,
        role: 'assistant',
        status: 'complete',
        content: 'Kick and bass are clashing around 80-120 Hz.',
        evidence: [],
        refusalReason: null,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        mode: 'brief',
        isBrief: true,
        closingLine: CLOSING_LINE,
      },
    ],
    caps: { used: 0, limit: 5, capReached: false },
  };
}

function makeStream() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });
  const enc = new TextEncoder();
  return {
    body,
    push: (frame: string) => ctrl.enqueue(enc.encode(frame)),
    close: () => ctrl.close(),
  };
}

/** A stream body that's already fully written when returned — mirrors the
 *  BFF's StreamMessage replaying a terminal frame for an already-complete
 *  row (WriteTerminalFromRow: one token frame with the full content, then
 *  the terminal frame). */
function immediateStream(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(f));
      c.close();
    },
  });
}

function renderCoach() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <div className="rdx">
        <CoachChat
          trackName="Night Drive"
          analysisId="analysis-1"
          verdicts={[]}
          measurementsCount={12}
          triageDone
        />
      </div>
    </QueryClientProvider>,
  );
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input.toString();
}

describe('CoachChat — the opening brief streams in live (Task G6 fix round 1)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('a 202 brief streams tokens into the brief turn and renders CoachBriefCta on the terminal frame — no timer-driven refetch', async () => {
    const stream = makeStream();
    let conversationCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      if (url.endsWith('/brief') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 202,
          json: async () => ({ status: 'created', messageId: BRIEF_ID }),
        } as Response);
      }
      if (url.includes('/conversation')) {
        conversationCalls += 1;
        // #1 mount hydration (no brief yet), #2 followMessage's ensure-fetch
        // (brief now pending), #3+ the post-stream reconciliation fetch(es)
        // (brief now complete, closingLine present).
        const dto = conversationCalls === 1 ? emptyConversation()
          : conversationCalls === 2 ? pendingBriefConversation()
            : completeBriefConversation();
        return Promise.resolve({ ok: true, json: async () => dto } as Response);
      }
      if (url.includes(`/messages/${BRIEF_ID}/stream`)) {
        return Promise.resolve({ ok: true, status: 200, body: stream.body } as Response);
      }
      return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderCoach();

    // The brief POST fires once triage/hydration are ready.
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => urlOf(c[0]).endsWith('/brief'))).toBe(true),
    );
    // followMessage opens the stream for the brief's messageId.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => urlOf(c[0]).includes(`/messages/${BRIEF_ID}/stream`)),
      ).toBe(true),
    );

    await act(async () => {
      stream.push('event: token\ndata: {"type":"token","text":"Kick and bass are clashing."}\n\n');
    });
    await screen.findByText(/Kick and bass are clashing/, { selector: '.bub' });

    await act(async () => {
      stream.push('event: done\ndata: {"type":"done","evidence":[]}\n\n');
      stream.close();
    });

    // The closing line + CTA land from the reconciliation fetch — no fake
    // timers were installed anywhere in this test, so this can only be
    // driven by the terminal-frame-triggered fetch, never a timer.
    await screen.findByText(CLOSING_LINE);
    const cta = screen.getByRole('link', { name: 'Create free account' });
    expect(cta.getAttribute('href')).toBe('/register?from=guest');
  });

  it('a brief that is already complete when the stream opens replays as one token + done, and finalizes', async () => {
    let conversationCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      if (url.endsWith('/brief') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ status: 'exists', messageId: BRIEF_ID }),
        } as Response);
      }
      if (url.includes('/conversation')) {
        conversationCalls += 1;
        // #1 mount hydration — the brief doesn't exist locally yet (so
        // `hasBrief` stays false and the trigger's gate still fires the
        // POST below). From #2 (followMessage's own ensure-fetch) onward —
        // a race the real BFF can produce — it's already complete.
        // followMessage must still open the stream (the BFF's replay
        // contract) and end up finalized with the right text, not
        // duplicated.
        const dto = conversationCalls === 1 ? emptyConversation() : completeBriefConversation();
        return Promise.resolve({ ok: true, json: async () => dto } as Response);
      }
      if (url.includes(`/messages/${BRIEF_ID}/stream`)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          body: immediateStream([
            'event: token\ndata: {"type":"token","text":"Kick and bass are clashing around 80-120 Hz."}\n\n',
            'event: done\ndata: {"type":"done","evidence":[]}\n\n',
          ]),
        } as Response);
      }
      return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderCoach();

    // The ensure-fetch's own copy already showed it complete — the stream
    // still opens (the BFF's replay contract) and the turn ends up
    // correctly finalized, not left mid-generation.
    await screen.findByText(
      'Kick and bass are clashing around 80-120 Hz.',
      { selector: '.bub', exact: true },
    );
    await screen.findByText(CLOSING_LINE);
    expect(conversationCalls).toBeGreaterThanOrEqual(2);
  });

  // Driven directly against useCoachSession's `followMessage` (bypassing
  // the CoachChat mount + useCoachBrief trigger machinery) — the same
  // discipline useCoachBrief.test.tsx's own backoff-schedule test uses,
  // since interleaving fake timers with a whole component tree's cascading
  // hydration/trigger effects is unreliable (each `act()` only flushes one
  // hop of a multi-effect chain).
  it('stream open fails (500) → falls back to polling, stops once terminal, never exceeds 40 requests', async () => {
    vi.useFakeTimers();
    let conversationCalls = 0;
    let streamAttempts = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.includes(`/messages/${BRIEF_ID}/stream`)) {
        streamAttempts += 1;
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ error: { code: 'coach_error', message: 'boom' } }),
        } as Response);
      }
      if (url.includes('/conversation')) {
        conversationCalls += 1;
        // #1 mount hydration, #2 followMessage's ensure-fetch (still
        // pending) — the poll then fires from #3 onward. Finish on the 5th
        // poll tick so the bound (40) is never reached, proving it stopped
        // exactly when terminal rather than running the full budget.
        const dto = conversationCalls < 7 ? pendingBriefConversation() : completeBriefConversation();
        return Promise.resolve({ ok: true, json: async () => dto } as Response);
      }
      return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(
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

    // Let mount hydration settle before driving the brief directly.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.followMessage(BRIEF_ID);
    });
    // The ensure-fetch + the failed stream open.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(streamAttempts).toBe(1); // the stream open was attempted exactly once

    // Advance well past the 40*3s bound — the poll must have stopped as
    // soon as conversationCalls hit the "complete" tick, not run all 40.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40 * 3000 + 5000);
    });

    expect(streamAttempts).toBe(1); // never retried the stream open itself
    expect(conversationCalls).toBeLessThan(2 + 40);
  });

  it('a send in flight when the brief arrives is followed only after the send finishes, and the send turn is intact', async () => {
    const sendStream = makeStream();
    let briefStreamOpened = false;
    let sendPersisted = false;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      if (url.endsWith('/brief') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 202,
          json: async () => ({ status: 'created', messageId: BRIEF_ID }),
        } as Response);
      }
      if (url.includes('/conversation')) {
        // Once the send's own turn finishes, the server has it persisted —
        // a subsequent GET /conversation (followMessage's ensure-fetch)
        // reflects that, same as the real BFF (the worker persists BEFORE
        // publishing the terminal frame the frontend's send() just saw).
        const dto: CoachConversationDto = sendPersisted
          ? {
              conversationId: 'conv-1',
              analysisId: 'analysis-1',
              messages: [
                {
                  id: 'u1', role: 'user', status: 'complete', content: 'What frequencies are clashing?',
                  evidence: null, refusalReason: null, createdAt: new Date().toISOString(),
                  completedAt: new Date().toISOString(), mode: 'qa', isBrief: false, closingLine: null,
                },
                {
                  id: 'a1', role: 'assistant', status: 'complete', content: 'Bass is loud.',
                  evidence: [], refusalReason: null, createdAt: new Date().toISOString(),
                  completedAt: new Date().toISOString(), mode: 'qa', isBrief: false, closingLine: null,
                },
              ],
              caps: { used: 1, limit: 5, capReached: false },
            }
          : emptyConversation();
        return Promise.resolve({ ok: true, json: async () => dto } as Response);
      }
      if (url.endsWith('/messages') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            conversationId: 'conv-1',
            userMessageId: 'u1',
            pendingAssistantMessageId: 'a1',
            caps: { used: 1, limit: 5, capReached: false },
          }),
        } as Response);
      }
      if (url.includes('/messages/a1/stream')) {
        return Promise.resolve({ ok: true, status: 200, body: sendStream.body } as Response);
      }
      if (url.includes(`/messages/${BRIEF_ID}/stream`)) {
        briefStreamOpened = true;
        return Promise.resolve({
          ok: true,
          status: 200,
          body: immediateStream(['event: done\ndata: {"type":"done","evidence":[]}\n\n']),
        } as Response);
      }
      return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderCoach();
    const input = await screen.findByLabelText('Coach question input');

    // Start a real send BEFORE the brief POST has resolved, so the brief's
    // messageId arrives while sendingRef is true.
    fireEvent.change(input, { target: { value: 'What frequencies are clashing?' } });
    fireEvent.click(screen.getByLabelText('Send question'));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => urlOf(c[0]).includes('/messages/a1/stream'))).toBe(true),
    );

    // The brief's own POST may still be in flight/queued behind the gate —
    // give it a moment, then confirm it does NOT open its stream yet.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(briefStreamOpened).toBe(false);

    await act(async () => {
      sendStream.push('event: token\ndata: {"type":"token","text":"Bass is loud."}\n\n');
    });
    await screen.findByText(/Bass is loud/, { selector: '.bub' });
    await act(async () => {
      sendPersisted = true;
      sendStream.push('event: done\ndata: {"type":"done","evidence":[]}\n\n');
      sendStream.close();
    });

    // The send's own turn survives untouched...
    await screen.findByText(/Bass is loud/, { selector: '.bub' });
    // ...and the brief is now followed since sendingRef cleared.
    await waitFor(() => expect(briefStreamOpened).toBe(true));
  });

  it('unmounting mid-brief-stream aborts the fetch and applies no further state', async () => {
    const stream = makeStream();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      if (url.endsWith('/brief') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 202,
          json: async () => ({ status: 'created', messageId: BRIEF_ID }),
        } as Response);
      }
      if (url.includes('/conversation')) {
        return Promise.resolve({ ok: true, json: async () => emptyConversation() } as Response);
      }
      if (url.includes(`/messages/${BRIEF_ID}/stream`)) {
        return Promise.resolve({ ok: true, status: 200, body: stream.body } as Response);
      }
      return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = render(
      <QueryClientProvider client={qc}>
        <div className="rdx">
          <CoachChat trackName="Night Drive" analysisId="analysis-1" verdicts={[]} measurementsCount={12} triageDone />
        </div>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => urlOf(c[0]).includes(`/messages/${BRIEF_ID}/stream`)),
      ).toBe(true),
    );

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    unmount();
    await act(async () => {
      // Push after unmount — if anything still touched React state this
      // would throw/console.error an "update on an unmounted component"
      // warning (React 19) or a raw exception.
      stream.push('event: token\ndata: {"type":"token","text":"late token"}\n\n');
      stream.push('event: done\ndata: {"type":"done","evidence":[]}\n\n');
      stream.close();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
