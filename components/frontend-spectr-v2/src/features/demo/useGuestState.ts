import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query';

import { fetcher } from '../../api/fetcher';
import type { GuestStateDto } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';

/**
 * D10 — guest quota state for the banner / upload gate / upgrade dialog.
 * Guest-ness itself lives on AuthContext (`user.isGuest`, set by D9) and is
 * NEVER re-derived here — this hook only fetches the numeric quotas behind
 * it, and only for a guest (`enabled: isGuest`; GET /api/me/guest 404s for
 * a real user).
 *
 * Finite staleTime (mirrors useEntitlements' 30s) PLUS explicit invalidation
 * from every mutation that changes these numbers (UnifiedUploadDialog's
 * three dispatch paths) — this repo has shipped the "staleTime: Infinity
 * query nobody writes to" bug twice already; see MEMORY.md
 * never-stale-query-client-writes.
 */
/** Shared by the hook and the /library route guard (which fetches it via
 *  `queryClient.fetchQuery` in beforeLoad) — one key, one cache entry. */
export const guestStateQueryOptions = queryOptions({
  queryKey: ['me', 'guest'] as const,
  queryFn: () => fetcher<GuestStateDto>({ url: '/me/guest', method: 'GET' }),
  staleTime: 30_000,
  retry: false,
});

/**
 * Owner ruling 2026-10-01 — a guest may use the library once they have
 * uploaded a track of their OWN. The seeded demo song doesn't count: the
 * server's `uploadsUsed` already excludes it (it counts the guest's
 * song_versions whose file_path is NOT under `audio/demo/` — see
 * GuestLimits.GetStateAsync), so this is just `uploadsUsed > 0`. Unknown
 * state (loading / failed fetch) ⇒ false: the library stays closed rather
 * than flashing open.
 */
export function guestHasOwnUploads(state: GuestStateDto | undefined): boolean {
  return (state?.uploadsUsed ?? 0) > 0;
}

export function useGuestState(): {
  isGuest: boolean;
  canUpload: boolean;
  /** Guest-only meaning: has uploaded their own track, so the library
   *  (route + nav entry) is open to them. Always false for a real user —
   *  callers gate real users on `!isGuest`, not this. */
  hasOwnUploads: boolean;
  state: GuestStateDto | undefined;
} {
  const { user } = useAuth();
  const isGuest = user?.isGuest === true;

  const query = useQuery({ ...guestStateQueryOptions, enabled: isGuest });

  const state = query.data;
  // Optimistic true while loading/unresolved: the server is the real gate
  // (a proactive block here is only a UI nicety), so a slow/failed fetch
  // must never itself block the upload form.
  const canUpload = state ? state.uploadsUsed < state.uploadsMax : true;

  return { isGuest, canUpload, hasOwnUploads: isGuest && guestHasOwnUploads(state), state };
}

/**
 * D10 fix1 (item 2/3) — the ONE place that knows the guest-state query key.
 * Every mutation that changes a number `GET /api/me/guest` reports (upload,
 * analyze, reference, fix-rack generation, coach message, song/version
 * delete + restore, …) must call this in its `onSuccess`/`onSettled` — a
 * no-op for a real user, since the query above is `enabled: isGuest` and
 * never fetches for them regardless of invalidation.
 */
export function invalidateGuestState(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ['me', 'guest'] });
}
