import type { QueryClient } from '@tanstack/react-query';

import type { AuthedUser } from '../../api/types';
import { guestHasOwnUploads, guestStateQueryOptions } from '../demo/useGuestState';

/**
 * Owner ruling 2026-10-01 — the /library route guard, kept out of the route
 * file so it is unit-testable (and so the route file only exports its Route).
 *
 * - Real user (or no user yet — `_app`'s own guard handles anon/boot): open.
 * - Guest: open only when they have uploaded a track of their own. The seeded
 *   demo song never counts — `GET /api/me/guest`'s `uploadsUsed` excludes
 *   versions under `audio/demo/` server-side.
 *
 * `fetchQuery` (not `ensureQueryData`) so a cached-but-invalidated
 * ['me','guest'] entry — every upload path calls invalidateGuestState —
 * is refetched instead of answering from the pre-upload snapshot (see
 * MEMORY never-stale-query-client-writes). A failed fetch keeps the library
 * closed: the guest lands on the landing page, never on a broken library.
 */
export async function guestMayOpenLibrary(context: {
  queryClient: QueryClient;
  auth: { user: AuthedUser | null };
}): Promise<boolean> {
  if (!context.auth.user?.isGuest) return true;
  try {
    const state = await context.queryClient.fetchQuery(guestStateQueryOptions);
    return guestHasOwnUploads(state);
  } catch {
    return false;
  }
}
