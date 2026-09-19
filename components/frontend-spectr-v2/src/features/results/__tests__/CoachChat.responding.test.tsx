// @vitest-environment jsdom
// "Coach is responding" animation. Three visual phases of the last assistant
// bubble while a reply is in flight:
//   1. waiting  — no token yet            → animated typing dots
//   2. writing  — tokens are streaming in → the text + a blinking caret
//   3. finished — `done` frame            → neither
// Drives the REAL send() → POST → SSE reader path with a controllable stream,
// so the phases are asserted off genuine state transitions, not props.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CoachConversationDto } from '../../../api/types';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

import { CoachChat } from '../CoachChat';

const emptyConversation: CoachConversationDto = {
  conversationId: 'conv-1',
  analysisId: 'analysis-1',
  messages: [],
  caps: { used: 0, limit: 5, capReached: false },
};

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

async function renderAndAsk() {
  const stream = makeStream();
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/conversation')) {
      return Promise.resolve({ ok: true, json: async () => emptyConversation } as Response);
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
      return Promise.resolve({ ok: true, status: 200, body: stream.body } as Response);
    }
    return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
  });
  vi.stubGlobal('fetch', fetchMock);

  render(
    <div className="rdx">
      <CoachChat trackName="Night Drive" analysisId="analysis-1" verdicts={[]} measurementsCount={12} />
    </div>,
  );
  const input = await screen.findByLabelText('Coach question input');
  await waitFor(() =>
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/conversation'))).toBe(true),
  );
  fireEvent.change(input, { target: { value: 'What frequencies are clashing?' } });
  fireEvent.click(screen.getByLabelText('Send question'));
  return { stream };
}

describe('CoachChat — responding animation', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows animated typing dots while waiting for the first token', async () => {
    await renderAndAsk();
    const typing = await screen.findByTestId('coach-typing');
    expect(typing.getAttribute('aria-hidden')).toBe('true');
    expect(typing.querySelectorAll('span').length).toBe(3);
    // The old static placeholder is gone.
    expect(screen.queryByText('…')).toBeNull();
    expect(screen.queryByTestId('coach-caret')).toBeNull();
  });

  it('swaps the dots for the text + a caret once tokens stream, and clears both on done', async () => {
    const { stream } = await renderAndAsk();
    await screen.findByTestId('coach-typing');

    await act(async () => {
      stream.push('event: token\ndata: {"type":"token","text":"Kick and bass "}\n\n');
    });
    // `.bub` scopes past the sr-only aria-live mirror of the same tokens.
    await screen.findByText(/Kick and bass/, { selector: '.bub' });
    expect(screen.queryByTestId('coach-typing')).toBeNull();
    const caret = screen.getByTestId('coach-caret');
    expect(caret.getAttribute('aria-hidden')).toBe('true');

    await act(async () => {
      stream.push('event: done\ndata: {"type":"done","evidence":[]}\n\n');
      stream.close();
    });
    await waitFor(() => expect(screen.queryByTestId('coach-caret')).toBeNull());
    expect(screen.queryByTestId('coach-typing')).toBeNull();
    expect(screen.getByText(/Kick and bass/, { selector: '.bub' })).toBeTruthy();
  });
});
