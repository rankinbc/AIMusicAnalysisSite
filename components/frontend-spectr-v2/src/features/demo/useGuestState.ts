import { useQuery } from '@tanstack/react-query';

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
export function useGuestState(): {
  isGuest: boolean;
  canUpload: boolean;
  state: GuestStateDto | undefined;
} {
  const { user } = useAuth();
  const isGuest = user?.isGuest === true;

  const query = useQuery<GuestStateDto>({
    queryKey: ['me', 'guest'],
    queryFn: () => fetcher<GuestStateDto>({ url: '/me/guest', method: 'GET' }),
    enabled: isGuest,
    staleTime: 30_000,
    retry: false,
  });

  const state = query.data;
  // Optimistic true while loading/unresolved: the server is the real gate
  // (a proactive block here is only a UI nicety), so a slow/failed fetch
  // must never itself block the upload form.
  const canUpload = state ? state.uploadsUsed < state.uploadsMax : true;

  return { isGuest, canUpload, state };
}
