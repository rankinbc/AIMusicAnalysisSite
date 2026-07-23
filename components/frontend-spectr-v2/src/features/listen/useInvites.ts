/* SPECTR · Listen V3 (PRP-2) — version invite hooks (owner CRUD + accept). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetcher } from '../../api/fetcher';
import type { CreateInviteRequest, InviteDto } from '../../api/types';

const invitesKey = (versionId: string) => ['versions', versionId, 'invites'] as const;
const accessKey = (versionId: string) => ['versions', versionId, 'access'] as const;

export function useInvites(versionId: string) {
  return useQuery({
    queryKey: invitesKey(versionId),
    queryFn: () => fetcher<InviteDto[]>({ url: `/versions/${versionId}/invites`, method: 'GET' }),
    enabled: Boolean(versionId),
  });
}

export function useCreateInvite(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInviteRequest) =>
      fetcher<InviteDto>({ url: `/versions/${versionId}/invites`, method: 'POST', data: body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: invitesKey(versionId) });
      qc.invalidateQueries({ queryKey: accessKey(versionId) });
    },
    meta: { errorToast: 'Could not create the invite.' },
  });
}

export function useRevokeInvite(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) =>
      fetcher<void>({ url: `/invites/${inviteId}`, method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: invitesKey(versionId) });
      qc.invalidateQueries({ queryKey: accessKey(versionId) });
    },
    meta: { errorToast: 'Could not revoke the invite.' },
  });
}

// Accept by token — the invitee may be on any version, so callers refetch their
// own access view after accepting. NO meta.errorToast — the accept ROUTE
// (/invite/{token}) renders a visible error state instead of a toast.
export function useAcceptInvite() {
  return useMutation({
    mutationFn: (token: string) =>
      fetcher<InviteDto>({ url: `/invites/${token}/accept`, method: 'POST' }),
  });
}
