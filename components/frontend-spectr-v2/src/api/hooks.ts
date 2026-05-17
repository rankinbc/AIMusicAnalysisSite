// Hand-rolled API hooks for slice 1. orval-generated hooks will replace
// these once the BFF emits openapi.json against a live database.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetcher } from './fetcher';
import type {
  AuthResponse,
  AuthedUser,
  CreateSongRequest,
  FeedbackKind,
  JobResultsDto,
  JobStatusDto,
  PatchSongRequest,
  RunSpecialistResponse,
  SongDto,
  UploadResponse,
  VerdictsListResponse,
  VersionDto,
} from './types';

// ── Auth ────────────────────────────────────────────────────────────────────
export function useLoginMutation() {
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      fetcher<AuthResponse>({ url: '/auth/login', method: 'POST', data: body }),
  });
}

export function useRegisterMutation() {
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      fetcher<AuthResponse>({ url: '/auth/register', method: 'POST', data: body }),
  });
}

export function useLogoutMutation() {
  return useMutation({
    mutationFn: () => fetcher<void>({ url: '/auth/logout', method: 'POST' }),
  });
}

export interface PatchMeRequest {
  displayName?: string | null;
  handle?: string | null;
}

export function usePatchMe() {
  return useMutation({
    mutationFn: (body: PatchMeRequest) =>
      fetcher<AuthedUser>({ url: '/auth/me', method: 'PATCH', data: body }),
  });
}

export function useMe(enabled: boolean) {
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => fetcher<AuthedUser>({ url: '/auth/me', method: 'GET' }),
    enabled,
    retry: false,
  });
}

// ── Songs ───────────────────────────────────────────────────────────────────
export function useSongs() {
  return useQuery({
    queryKey: ['songs'],
    queryFn: () =>
      fetcher<SongDto[]>({
        url: '/songs/?include=versions,latest_result',
        method: 'GET',
      }),
  });
}

export function useSong(songId: string) {
  return useQuery({
    queryKey: ['songs', songId],
    queryFn: () => fetcher<SongDto>({ url: `/songs/${songId}`, method: 'GET' }),
    enabled: Boolean(songId),
  });
}

export function useCreateSong() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSongRequest) =>
      fetcher<SongDto>({ url: '/songs/', method: 'POST', data: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['songs'] }),
  });
}

export function usePatchSong(songId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PatchSongRequest) =>
      fetcher<void>({ url: `/songs/${songId}`, method: 'PATCH', data: body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['songs'] });
      qc.invalidateQueries({ queryKey: ['songs', songId] });
    },
  });
}

export function useArchiveSong() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (songId: string) =>
      fetcher<void>({ url: `/songs/${songId}`, method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['songs'] }),
  });
}

// ── Versions ────────────────────────────────────────────────────────────────
export function useVersion(versionId: string) {
  return useQuery({
    queryKey: ['versions', versionId],
    queryFn: () => fetcher<VersionDto>({ url: `/versions/${versionId}`, method: 'GET' }),
    enabled: Boolean(versionId),
  });
}

// ── Jobs ────────────────────────────────────────────────────────────────────
export function useJob(jobId: string, opts?: { pollMs?: number }) {
  return useQuery<JobStatusDto>({
    queryKey: ['jobs', jobId],
    queryFn: () => fetcher<JobStatusDto>({ url: `/jobs/${jobId}`, method: 'GET' }),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'complete' || status === 'failed') return false;
      return opts?.pollMs ?? 2000;
    },
    retry: false,
  });
}

export function useJobResults(jobId: string, enabled: boolean) {
  return useQuery<JobResultsDto>({
    queryKey: ['jobs', jobId, 'results'],
    queryFn: () => fetcher<JobResultsDto>({ url: `/jobs/${jobId}/results`, method: 'GET' }),
    enabled: enabled && Boolean(jobId),
    retry: false,
  });
}

export type { UploadResponse };

// ── Verdicts ────────────────────────────────────────────────────────────────

interface UseVerdictsOptions {
  /** Slugs the user clicked but for which the BFF hasn't yet returned a
   *  cached/failed status. The hook polls every 3 s while this is non-empty. */
  optimisticRunning: ReadonlySet<string>;
  enabled: boolean;
}

export function useVerdicts(jobId: string, opts: UseVerdictsOptions) {
  return useQuery<VerdictsListResponse>({
    queryKey: ['verdicts', jobId],
    queryFn: () =>
      fetcher<VerdictsListResponse>({
        url: `/reports/${jobId}/verdicts/`,
        method: 'GET',
      }),
    enabled: opts.enabled && Boolean(jobId),
    refetchInterval: () => (opts.optimisticRunning.size > 0 ? 3000 : false),
    retry: false,
  });
}

export function useRunSpecialist(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) =>
      fetcher<RunSpecialistResponse>({
        url: `/reports/${jobId}/verdicts/run/${slug}`,
        method: 'POST',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['verdicts', jobId] }),
  });
}

export function useDismissVerdict(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (verdictId: string) =>
      fetcher<void>({ url: `/verdicts/${verdictId}/dismiss`, method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['verdicts', jobId] }),
  });
}

export function useApplyVerdict(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (verdictId: string) =>
      fetcher<void>({ url: `/verdicts/${verdictId}/applied`, method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['verdicts', jobId] }),
  });
}

export function useFeedbackVerdict(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ verdictId, feedback }: { verdictId: string; feedback: FeedbackKind }) =>
      fetcher<void>({
        url: `/verdicts/${verdictId}/feedback`,
        method: 'POST',
        data: { feedback },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['verdicts', jobId] }),
  });
}
