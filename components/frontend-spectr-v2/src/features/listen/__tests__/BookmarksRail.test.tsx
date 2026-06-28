import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { BookmarkDto, BookmarkSignalDto } from '../../../api/types';
import { BookmarksRail } from '../BookmarksRail';

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
