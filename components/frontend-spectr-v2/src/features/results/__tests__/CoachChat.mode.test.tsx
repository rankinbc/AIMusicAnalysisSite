// @vitest-environment jsdom
// adhoc-concise — the Concise/Normal/Teach header toggle must drive the wire
// `mode` field on the POST /messages body: Teach → 'teach', Concise →
// 'concise', Normal (default) → 'qa'. Reuses the fetch-stubbing harness from
// CoachChat.responding.test.tsx (stubs `/conversation`, POST `.../messages`
// and the `/stream` body) and drives the real send() path via user events.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

// The stream body is never pushed to or closed — these tests only assert
// the POST body's `mode` field, not the streamed reply.
function makeStreamBody(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({ start() {} });
}

async function renderCoach() {
  const streamBody = makeStreamBody();
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
      return Promise.resolve({ ok: true, status: 200, body: streamBody } as Response);
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
  return { fetchMock, input };
}

function postedMode(fetchMock: ReturnType<typeof vi.fn>): unknown {
  const call = fetchMock.mock.calls.find((c) => {
    const url = typeof c[0] === 'string' ? c[0] : String(c[0]);
    const init = c[1] as RequestInit | undefined;
    return url.endsWith('/messages') && init?.method === 'POST';
  });
  const init = call?.[1] as RequestInit | undefined;
  const parsed = init?.body ? (JSON.parse(init.body as string) as { mode?: string }) : undefined;
  return parsed?.mode;
}

describe('CoachChat — mode toggle drives the wire `mode` field (adhoc-concise)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('defaults to Normal and sends mode "qa"', async () => {
    const { fetchMock, input } = await renderCoach();
    fireEvent.change(input, { target: { value: 'How loud is my track?' } });
    fireEvent.click(screen.getByLabelText('Send question'));
    await waitFor(() => expect(postedMode(fetchMock)).toBe('qa'));
  });

  it('Concise toggle sends mode "concise"', async () => {
    const { fetchMock, input } = await renderCoach();
    fireEvent.click(screen.getByRole('button', { name: 'Concise' }));
    fireEvent.change(input, { target: { value: 'How loud is my track?' } });
    fireEvent.click(screen.getByLabelText('Send question'));
    await waitFor(() => expect(postedMode(fetchMock)).toBe('concise'));
  });

  it('Teach toggle sends mode "teach"', async () => {
    const { fetchMock, input } = await renderCoach();
    fireEvent.click(screen.getByRole('button', { name: 'Teach' }));
    fireEvent.change(input, { target: { value: 'How loud is my track?' } });
    fireEvent.click(screen.getByLabelText('Send question'));
    await waitFor(() => expect(postedMode(fetchMock)).toBe('teach'));
  });
});
