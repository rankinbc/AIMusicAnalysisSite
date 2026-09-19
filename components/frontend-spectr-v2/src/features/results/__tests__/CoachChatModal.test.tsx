// @vitest-environment jsdom
// "Ask the Coach" expand-to-modal (2026-09-19): ONE CoachChat state; the
// header (mode toggle + headerActions) and the body both travel with
// `expanded`, and the inline placeholder has no Collapse button of its own.
//
// Renders the REAL CoachChat + CoachChatDialog (no Radix mocking) so the
// interactive assertions — dialog role, Esc-to-close, focus return — are
// genuine DOM behavior rather than a passthrough stub. The single most
// important property under test (brief req 2): expanding/collapsing must
// NOT remount CoachChat or refetch the conversation — the same message
// hydrated inline must still be visible inside the dialog, and the
// conversation GET must fire exactly once across the whole interaction.
import type { ReactNode } from 'react';
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

async function renderCoachChat(headerActions?: ReactNode) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/conversation')) {
      return Promise.resolve({ ok: true, json: async () => conversation } as Response);
    }
    return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
  });
  vi.stubGlobal('fetch', fetchMock);

  // adhoc2 (2026-09-19) — mirror production nesting: ReportView.tsx wraps
  // the whole results page (including CoachChat) in `<div className="rdx">`.
  // Every coach style is a GLOBAL `.rdx .coach-*` rule, so a render that
  // omits this wrapper can't prove — or disprove — the scoping fix below.
  render(
    <div className="rdx">
      <CoachChat
        trackName="Night Drive"
        analysisId="analysis-1"
        verdicts={[]}
        measurementsCount={12}
        {...(headerActions ? { headerActions } : {})}
      />
    </div>,
  );
  // Wait for the conversation hydration to land before interacting.
  await screen.findByText(SEEDED_MESSAGE);
  return { fetchMock };
}

/** The inline card's own container while the dialog is expanded — the
 *  static placeholder (title row + quiet line), never the header/body. */
function getInlinePlaceholder() {
  const text = screen.getByText('Coach is open in the expanded view.');
  const container = text.parentElement;
  if (!container) throw new Error('inline placeholder container not found');
  return container;
}

describe('CoachChat expand-to-modal (adhoc, 2026-09-19 / fix round 1)', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Expand coach chat' }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Collapse coach chat' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByLabelText('Coach question input')).toBeTruthy();
    expect(screen.getByText(SEEDED_MESSAGE)).toBeTruthy();
    // Fix round 1: the header (and its Expand button) now unmounts while
    // expanded and remounts fresh on collapse, so the restored button is a
    // NEW DOM node — assert focus by accessible name, not object identity.
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Expand coach chat'),
    );
  });

  it('Esc closes the dialog, restores the inline thread+input, and returns focus to Expand', async () => {
    await renderCoachChat();
    fireEvent.click(screen.getByRole('button', { name: 'Expand coach chat' }));
    await screen.findByRole('dialog');

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByLabelText('Coach question input')).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Expand coach chat'),
    );
  });

  // ── Fix round 1 — requirement-6 regression coverage ──────────────────

  it('with the dialog open, the mode toggle is reachable inside it and exactly one set exists in the document', async () => {
    await renderCoachChat();
    fireEvent.click(screen.getByRole('button', { name: 'Expand coach chat' }));
    const dialog = await screen.findByRole('dialog');

    // Exactly one "Teach" toggle button in the whole document — not one
    // inline (unreachable behind the overlay) and one in the dialog.
    const teachButtons = screen.getAllByRole('button', { name: 'Teach' });
    expect(teachButtons).toHaveLength(1);
    const teachButton = within(dialog).getByRole('button', { name: 'Teach' });
    expect(teachButton).toBe(teachButtons[0]);
    expect(teachButton.className).not.toMatch(/\bon\b/);

    fireEvent.click(teachButton);

    // Clicking it inside the dialog flips the active-mode signal (the same
    // `ch-mode${mode === m ? ' on' : ''}` class CoachChat.tsx renders).
    expect(teachButton.className).toMatch(/\bon\b/);
    expect(within(dialog).getByRole('button', { name: 'Normal' }).className).not.toMatch(/\bon\b/);
  });

  it('with the dialog open, headerActions is reachable inside it, exactly once, and fires its onClick', async () => {
    const onSpecialists = vi.fn();
    await renderCoachChat(<button type="button" onClick={onSpecialists}>Specialists</button>);
    fireEvent.click(screen.getByRole('button', { name: 'Expand coach chat' }));
    const dialog = await screen.findByRole('dialog');

    const specialistButtons = screen.getAllByRole('button', { name: 'Specialists' });
    expect(specialistButtons).toHaveLength(1);
    const specialistButton = within(dialog).getByRole('button', { name: 'Specialists' });
    expect(specialistButton).toBe(specialistButtons[0]);

    fireEvent.click(specialistButton);
    expect(onSpecialists).toHaveBeenCalledTimes(1);
  });

  it('with the dialog open, the inline placeholder is static — no buttons at all', async () => {
    await renderCoachChat();
    fireEvent.click(screen.getByRole('button', { name: 'Expand coach chat' }));
    await screen.findByRole('dialog');

    const placeholder = getInlinePlaceholder();
    expect(within(placeholder).queryAllByRole('button')).toHaveLength(0);
    expect(within(placeholder).getByText('Ask the Coach')).toBeTruthy();
    expect(within(placeholder).getByText('Coach is open in the expanded view.')).toBeTruthy();
  });

  // ── adhoc2 (2026-09-19) — regression guard for "modal renders unstyled" ──
  // Every coach-* class is a GLOBAL rule scoped `.rdx .coach-*`
  // (redesign-v3-tabs.css). CoachChatDialog used a bare `Dialog.Portal`,
  // which mounts into `document.body` — OUTSIDE `.rdx` — so none of those
  // rules matched and the expanded dialog rendered as raw unstyled text.
  // This asserts the dialog's DOM actually lives inside `.rdx` so the fix
  // can't silently regress back to a body portal.
  it('renders the dialog content inside the .rdx scope, not a bare document.body portal', async () => {
    await renderCoachChat();
    fireEvent.click(screen.getByRole('button', { name: 'Expand coach chat' }));
    const dialog = await screen.findByRole('dialog');

    expect(dialog.closest('.rdx')).not.toBeNull();
  });
});
