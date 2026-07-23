/* SPECTR · Listen V3 (PRP-2) — version sharing hooks (owner settings + anon view).
 * Owner settings/token are version-keyed; the anon View entry reads /v/{token}.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetcher } from '../../api/fetcher';
import type {
  RotateTokenResponse,
  ShareSettingsDto,
  UpdateShareSettingsRequest,
  VersionViewDto,
} from '../../api/types';

const settingsKey = (versionId: string) => ['versions', versionId, 'share'] as const;
const accessKey = (versionId: string) => ['versions', versionId, 'access'] as const;

export function useShareSettings(versionId: string) {
  return useQuery({
    queryKey: settingsKey(versionId),
    queryFn: () => fetcher<ShareSettingsDto>({ url: `/versions/${versionId}/share`, method: 'GET' }),
    enabled: Boolean(versionId),
  });
}

export function useUpdateShareSettings(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateShareSettingsRequest) =>
      fetcher<ShareSettingsDto>({ url: `/versions/${versionId}/share`, method: 'PUT', data: body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKey(versionId) });
      qc.invalidateQueries({ queryKey: accessKey(versionId) });
    },
    meta: { errorToast: 'Could not update sharing.' },
  });
}

export function useRotateToken(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetcher<RotateTokenResponse>({ url: `/versions/${versionId}/share/rotate`, method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKey(versionId) }),
    meta: { errorToast: 'Could not rotate the share link.' },
  });
}

// Anonymous View entry — resolves the opaque share token to a viewable version
// (within the owner's gates). retry:false so a revoked/invalid token fails fast.
export function useVersionView(token: string) {
  return useQuery({
    queryKey: ['v', token],
    queryFn: () => fetcher<VersionViewDto>({ url: `/v/${token}`, method: 'GET' }),
    enabled: Boolean(token),
    retry: false,
  });
}
