/* SPECTR · Listen V3 (PRP-2) — the (version, actor) access resolver hook.
 * Drives the Work/View/Room switcher availability + capability gating. */
import { useQuery } from '@tanstack/react-query';

import { fetcher } from '../../api/fetcher';
import type { AccessDto } from '../../api/types';

export function useVersionAccess(versionId: string) {
  return useQuery({
    queryKey: ['versions', versionId, 'access'],
    queryFn: () => fetcher<AccessDto>({ url: `/versions/${versionId}/access`, method: 'GET' }),
    enabled: Boolean(versionId),
    staleTime: 30_000,
  });
}
