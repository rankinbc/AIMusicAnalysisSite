/* SPECTR · Listen V3 (PRP-6) — author bookmark signal (D5.4). Owner-only: the
 * aggregate count (anon counted anonymously) + the named bookmarkers who opted
 * into visibility. A 403 from the endpoint means the caller isn't the owner. */
import { useQuery } from '@tanstack/react-query';

import { fetcher } from '../../api/fetcher';
import type { BookmarkSignalDto } from '../../api/types';

const signalKey = (versionId: string) => ['versions', versionId, 'bookmarks', 'signal'] as const;

export function useBookmarkSignal(versionId: string, enabled = true) {
  return useQuery({
    queryKey: signalKey(versionId),
    queryFn: () =>
      fetcher<BookmarkSignalDto>({ url: `/versions/${versionId}/bookmarks/signal`, method: 'GET' }),
    enabled: Boolean(versionId) && enabled,
    retry: false,
  });
}
