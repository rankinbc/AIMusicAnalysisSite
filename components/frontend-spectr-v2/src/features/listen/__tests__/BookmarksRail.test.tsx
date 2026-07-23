// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../api/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/fetcher')>();
  return { ...actual, fetcher: vi.fn() };
});

import { fetcher } from '../../../api/fetcher';
import type { BookmarkDto, BookmarkSignalDto } from '../../../api/types';
import { BookmarksRail } from '../BookmarksRail';

const fetcherMock = vi.mocked(fetcher);

function bm(over: Partial<BookmarkDto>): BookmarkDto {
  return {
    id: 'b1',
    targetShareToken: null,
    targetPublishedTrack: null,
    targetVersionId: 'v1',
    t: 30,
    note: 'the drop',
    identityVisible: false,
    title: null,
    artist: null,
    createdAt: '2026-06-28T00:00:00Z',
    ...over,
  };
}

function render(
  bookmarks: BookmarkDto[],
  isOwner: boolean,
  signal: BookmarkSignalDto | null = null,
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['me', 'bookmarks'], bookmarks);
  if (signal) qc.setQueryData(['versions', 'v1', 'bookmarks', 'signal'], signal);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <BookmarksRail versionId="v1" durationSeconds={120} position={42} onSeek={() => {}} isOwner={isOwner} />
    </QueryClientProvider>,
  );
}

describe('BookmarksRail (story 11.3)', () => {
  it('renders this version’s bookmarks (markers + list), filtering out other versions', () => {
    const html = render(
      [bm({ id: 'a', t: 30, note: 'the drop' }), bm({ id: 'other', targetVersionId: 'v2', note: 'nope' })],
      false,
    );
    expect(html).toContain('the drop');
    expect(html).not.toContain('nope');
    expect(html).toContain('@0:30'); // timestamp chip for t=30
    expect(html).toContain('Bookmark @ 0:42'); // add-at-playhead button
  });

  it('shows the owner bookmark signal (count) only for the owner', () => {
    const signal: BookmarkSignalDto = {
      count: 7,
      identified: [{ type: 'user', userId: 'u', handle: 'kojo', displayName: null, hue: 1 }],
    };
    const asOwner = render([bm({})], true, signal);
    expect(asOwner).toContain('7 saved');

    const asViewer = render([bm({})], false, signal);
    expect(asViewer).not.toContain('7 saved'); // non-owner never surfaces the owner signal
  });

  it('renders the empty state when no bookmark targets this version', () => {
    const html = render([bm({ targetVersionId: 'v2' })], false);
    expect(html).toContain('No bookmarks yet');
  });
});

// ── Audit wave-3 (E7.4) — note edit is ONE upsert POST, never DELETE+POST ────

function renderLive(bookmarks: BookmarkDto[]) {
  // staleTime Infinity: the seeded ['me','bookmarks'] data must not trigger a
  // background GET on mount (would pollute the call-count assertions).
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  qc.setQueryData(['me', 'bookmarks'], bookmarks);
  return rtlRender(
    <QueryClientProvider client={qc}>
      <BookmarksRail versionId="v1" durationSeconds={120} position={42} onSeek={() => {}} isOwner={false} />
    </QueryClientProvider>,
  );
}

function callsByMethod(method: string) {
  return fetcherMock.mock.calls.filter(([arg]) => arg.method === method);
}

describe('BookmarksRail — note edit upsert (audit wave-3 E7.4)', () => {
  afterEach(() => {
    cleanup();
    fetcherMock.mockReset();
  });

  it('edits a note with a single POST and no DELETE', async () => {
    const updated = bm({ id: 'a', t: 30, note: 'new words', identityVisible: true });
    fetcherMock.mockImplementation((args) =>
      Promise.resolve(args.method === 'GET' ? [updated] : updated) as never,
    );
    renderLive([bm({ id: 'a', t: 30, note: 'the drop', identityVisible: true })]);

    fireEvent.click(screen.getByText('the drop'));
    const input = screen.getByDisplayValue('the drop');
    fireEvent.change(input, { target: { value: 'new words' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(callsByMethod('POST')).toHaveLength(1));
    expect(callsByMethod('DELETE')).toHaveLength(0);
    expect(callsByMethod('POST')[0][0]).toEqual({
      url: '/me/bookmarks',
      method: 'POST',
      data: { targetVersionId: 'v1', t: 30, note: 'new words', identityVisible: true },
    });
  });

  it('clearing a note sends note "" (the explicit clear signal)', async () => {
    fetcherMock.mockImplementation((args) =>
      Promise.resolve(args.method === 'GET' ? [] : bm({ note: null })) as never,
    );
    renderLive([bm({ id: 'a', t: 30, note: 'the drop' })]);

    fireEvent.click(screen.getByText('the drop'));
    const input = screen.getByDisplayValue('the drop');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(callsByMethod('POST')).toHaveLength(1));
    expect(callsByMethod('POST')[0][0]).toEqual({
      url: '/me/bookmarks',
      method: 'POST',
      data: { targetVersionId: 'v1', t: 30, note: '', identityVisible: false },
    });
  });

  it('a failed edit leaves the bookmark rendered with its old note', async () => {
    fetcherMock.mockRejectedValue(new Error('offline'));
    renderLive([bm({ id: 'a', t: 30, note: 'the drop' })]);

    fireEvent.click(screen.getByText('the drop'));
    const input = screen.getByDisplayValue('the drop');
    fireEvent.change(input, { target: { value: 'new words' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(callsByMethod('POST')).toHaveLength(1));
    // No DELETE ever fires, and the failed POST never touches the cache —
    // the bookmark survives with its old note (was: silently destroyed).
    expect(callsByMethod('DELETE')).toHaveLength(0);
    expect(screen.getByText('the drop')).toBeTruthy();
  });

  it('an unchanged note commit skips the network entirely', () => {
    renderLive([bm({ id: 'a', t: 30, note: 'the drop' })]);

    fireEvent.click(screen.getByText('the drop'));
    const input = screen.getByDisplayValue('the drop');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(fetcherMock).not.toHaveBeenCalled();
    expect(screen.getByText('the drop')).toBeTruthy();
  });
});
