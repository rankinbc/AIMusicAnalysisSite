// @vitest-environment jsdom
// Solo fork guard: the Notes tab renders ONLY the owner's own notes — no
// listener comments, bookmarks, or reaction surface (see the repo-root
// CLAUDE.md solo-strip notes + src/routes/__tests__/no-social-surface.test.ts).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../api/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/fetcher')>();
  return { ...actual, fetcher: vi.fn() };
});

import { fetcher } from '../../../api/fetcher';
import type { NoteDto } from '../../../api/types';
import { NotesTab } from '../NotesTab';

const fetcherMock = vi.mocked(fetcher);

function renderNotesTab(notes: NoteDto[], durationSec: number | undefined = 200) {
  fetcherMock.mockResolvedValue(notes);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NotesTab versionId="v1" durationSec={durationSec} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  fetcherMock.mockReset();
});

describe('NotesTab (solo)', () => {
  it("renders the owner's own notes and nothing about comments/bookmarks/reactions", async () => {
    const notes: NoteDto[] = [
      {
        id: 'n1',
        versionId: 'v1',
        tSeconds: 12,
        text: 'kick could use more punch',
        pinned: false,
        createdAt: '2026-07-26T00:00:00Z',
        updatedAt: '2026-07-26T00:00:00Z',
      },
    ];
    renderNotesTab(notes);

    expect(await screen.findByText('kick could use more punch')).toBeTruthy();
    expect(screen.getByText('Your notes')).toBeTruthy();
    expect(screen.getByText('only you see these')).toBeTruthy();
    expect(screen.getByText('Notes timeline')).toBeTruthy();

    // No listener/comment/bookmark/reaction surface anywhere in this tab.
    expect(screen.queryByText(/comment/i)).toBeNull();
    expect(screen.queryByText(/bookmark/i)).toBeNull();
    expect(screen.queryByText(/listener/i)).toBeNull();
    expect(screen.queryByText(/reaction/i)).toBeNull();
  });

  it('shows the honest empty states when there are no notes', async () => {
    renderNotesTab([]);
    expect(
      await screen.findByText('No notes yet — jot what you hear while reviewing.'),
    ).toBeTruthy();
    expect(screen.getByText('Timestamped notes will land on this strip.')).toBeTruthy();
  });

  it('shows a placeholder when no version is attached (no network call)', () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <NotesTab versionId={null} durationSec={undefined} />
      </QueryClientProvider>,
    );
    expect(screen.getByText('No version attached')).toBeTruthy();
    expect(fetcherMock).not.toHaveBeenCalled();
  });
});
