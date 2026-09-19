// @vitest-environment jsdom
// Ad-hoc task (2026-09-19): "Ask the Coach" expand-to-modal — see
// .superpowers/sdd/solo-fork-strip-social-plan/adhoc-coach-modal-brief.md.
//
// Renders the REAL CoachChat + CoachChatDialog (no Radix mocking) so the
// interactive assertions — dialog role, Esc-to-close, focus return — are
// genuine DOM behavior rather than a passthrough stub. The single most
// important property under test (brief req 2): expanding/collapsing must
// NOT remount CoachChat or refetch the conversation — the same message
// hydrated inline must still be visible inside the dialog, and the
// conversation GET must fire exactly once across the whole interaction.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CoachConversationDto } from '../../../api/types';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

import { CoachChat } from '../CoachChat';

const SEEDED_MESSAGE = 'Your low end is muddy around 200 Hz.';

const conversation: CoachConversationDto = {
  conversationId: 'conv-1',
  analysisId: 'analysis-1',
  messages: [
    {
      id: 'm1',
      role: 'assistant',
      status: 'complete',
      content: SEEDED_MESSAGE,
      evidence: null,
      refusalReason: null,
      createdAt: '2026-09-19T00:00:00Z',
      completedAt: '2026-09-19T00:00:01Z',
    },
  ],
  caps: { used: 0, limit: 5, capReached: false },
};

function conversationCallCount(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter((call) => {
    const input: unknown = call[0];
    const url = typeof input === 'string' ? input : String(input);
    return url.includes('/conversation');
  }).length;
}

async function renderCoachChat() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/conversation')) {
      return Promise.resolve({ ok: true, json: async () => conversation } as Response);
    }
    return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
  });
  vi.stubGlobal('fetch', fetchMock);

  render(
    <CoachChat
      trackName="Night Drive"
      analysisId="analysis-1"
      verdicts={[]}
      measurementsCount={12}
    />,
  );
  // Wait for the conversation hydration to land before interacting.
  await screen.findByText(SEEDED_MESSAGE);
  return { fetchMock };
}

describe('CoachChat expand-to-modal (adhoc, 2026-09-19)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the expand button with its accessible name', async () => {
    await renderCoachChat();
    expect(screen.getByRole('button', { name: 'Expand coach chat' })).toBeTruthy();
  });

  it('clicking it opens a dialog containing the thread + input, and the inline card swaps to the placeholder', async () => {
    await renderCoachChat();
    fireEvent.click(screen.getByRole('button', { name: 'Expand coach chat' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(SEEDED_MESSAGE)).toBeTruthy();
    expect(within(dialog).getByLabelText('Coach question input')).toBeTruthy();

    // Exactly one message input in the whole document — it's the dialog's.
    expect(screen.getByLabelText('Coach question input')).toBe(
      within(dialog).getByLabelText('Coach question input'),
    );
    // Inline card shows the quiet placeholder instead of a second thread/input.
    expect(screen.getByText(/expanded view/i)).toBeTruthy();
  });

  it('on open, focuses the composer input inside the dialog', async () => {
    await renderCoachChat();
    fireEvent.click(screen.getByRole('button', { name: 'Expand coach chat' }));
    const dialog = await screen.findByRole('dialog');
    const dialogInput = within(dialog).getByLabelText('Coach question input');
    await waitFor(() => expect(document.activeElement).toBe(dialogInput));
  });

  it('is the SAME chat state — no refetch of the conversation on expand', async () => {
    const { fetchMock } = await renderCoachChat();
    expect(conversationCallCount(fetchMock)).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Expand coach chat' }));
    const dialog = await screen.findByRole('dialog');

    // The message hydrated inline before expanding is the SAME state,
    // visible inside the dialog now — not a second, independently-fetched copy.
    expect(within(dialog).getByText(SEEDED_MESSAGE)).toBeTruthy();
    expect(conversationCallCount(fetchMock)).toBe(1);
  });

  it('the Collapse button closes the dialog, restores the inline thread+input, and returns focus to Expand', async () => {
    await renderCoachChat();
    const expandBtn = screen.getByRole('button', { name: 'Expand coach chat' });
    fireEvent.click(expandBtn);
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Collapse coach chat' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByLabelText('Coach question input')).toBeTruthy();
    expect(screen.getByText(SEEDED_MESSAGE)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(expandBtn));
  });

  it('Esc closes the dialog, restores the inline thread+input, and returns focus to Expand', async () => {
    await renderCoachChat();
    const expandBtn = screen.getByRole('button', { name: 'Expand coach chat' });
    fireEvent.click(expandBtn);
    await screen.findByRole('dialog');

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByLabelText('Coach question input')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(expandBtn));
  });
});
