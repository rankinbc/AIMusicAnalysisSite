// Hand-rolled API hooks for slice 1. orval-generated hooks will replace
// these once the BFF emits openapi.json against a live database.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetcher } from './fetcher';
import type {
  ActivityItemDto,
  AuthResponse,
  AuthedUser,
  BookmarkDto,
  CoachViewDto,
  CompareResponseDto,
  CreateBookmarkRequest,
  CreateShareResponse,
  CreateNoteRequest,
  CreateReferenceSetRequest,
  CreateSongRequest,
  EntitlementsDto,
  FeedbackKind,
  JobResultsDto,
  JobStatusDto,
  JobSummaryDto,
  MeProfileDto,
  MeStatsDto,
  NoteDto,
  PatchMeProfileRequest,
  PatchNoteRequest,
  PatchReferenceRequest,
  PatchShareRequest,
  PatchSongRequest,
  PostShareCommentRequest,
  ShareCommentDto,
  SharedAnalysisDto,
  PatchVersionRequest,
  AlsUploadResponse,
  ReanalyzeResponse,
  RerunPhaseResponse,
  StemUploadResponse,
  StemProposalsResponse,
  ConfirmStemsRequest,
  ConfirmStemsResponse,
  ReferenceDto,
  ReferenceSetDto,
  RunSpecialistResponse,
  SongDto,
  UploadResponse,
  VerdictsListResponse,
  VersionDto,
  VersionFilesResponse,
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

// ── Me / profile ────────────────────────────────────────────────────────────
export function useMeProfile() {
  return useQuery<MeProfileDto>({
    queryKey: ['me', 'profile'],
    queryFn: () => fetcher<MeProfileDto>({ url: '/me/profile', method: 'GET' }),
  });
}

export function usePatchMeProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PatchMeProfileRequest) =>
      fetcher<MeProfileDto>({ url: '/me/profile', method: 'PATCH', data: body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });
}

export function useMeStats() {
  return useQuery<MeStatsDto>({
    queryKey: ['me', 'stats'],
    queryFn: () => fetcher<MeStatsDto>({ url: '/me/stats', method: 'GET' }),
  });
}

export function useEntitlements() {
  return useQuery<EntitlementsDto>({
    queryKey: ['me', 'entitlements'],
    queryFn: () => fetcher<EntitlementsDto>({ url: '/me/entitlements', method: 'GET' }),
    staleTime: 30_000,
  });
}

export function useMeActivity() {
  return useQuery<ActivityItemDto[]>({
    queryKey: ['me', 'activity'],
    queryFn: () => fetcher<ActivityItemDto[]>({ url: '/me/activity', method: 'GET' }),
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

export function useVersionFiles(versionId: string) {
  return useQuery<VersionFilesResponse>({
    queryKey: ['versions', versionId, 'files'],
    queryFn: () =>
      fetcher<VersionFilesResponse>({ url: `/versions/${versionId}/files`, method: 'GET' }),
    enabled: Boolean(versionId),
    staleTime: 30_000,
  });
}

export function usePatchVersion(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PatchVersionRequest) =>
      fetcher<VersionDto>({ url: `/versions/${versionId}`, method: 'PATCH', data: body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['versions', versionId] });
      qc.invalidateQueries({ queryKey: ['songs'] });
    },
  });
}

/** Re-enqueue audio analysis for an existing version. Returns the new
 *  jobId; navigate to `/songs/{songId}/results/{jobId}` to watch it. */
export function useReanalyzeVersion(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetcher<ReanalyzeResponse>({
        url: `/versions/${versionId}/analyze`,
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['versions', versionId] });
      qc.invalidateQueries({ queryKey: ['songs'] });
    },
  });
}

/** Upload one or more stems for an existing version. Stems are POSTed as
 *  multipart fields where the field NAME is the role slug (kick/bass/…) and
 *  the field VALUE is the file. The server re-enqueues analysis on success;
 *  navigate to the returned `reanalysisJobId` to watch progress. */
export function useUploadStems(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (stems: Record<string, File>) => {
      const fd = new FormData();
      for (const [role, file] of Object.entries(stems)) {
        fd.append(role, file, file.name);
      }
      return fetcher<StemUploadResponse>({
        url: `/versions/${versionId}/stems`,
        method: 'POST',
        body: fd,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['versions', versionId] });
      qc.invalidateQueries({ queryKey: ['songs'] });
    },
  });
}

/** Bulk-stem flow: enqueue audio-content classification of staged stems. */
export function useClassifyStems(versionId: string) {
  return useMutation({
    mutationFn: () =>
      fetcher<unknown>({ url: `/versions/${versionId}/stems/classify`, method: 'POST' }),
  });
}

/** Poll staged-stem proposals; stops polling once the worker reports classified. */
export function useStemProposals(versionId: string, enabled: boolean) {
  return useQuery<StemProposalsResponse>({
    queryKey: ['stems', versionId],
    queryFn: () =>
      fetcher<StemProposalsResponse>({ url: `/versions/${versionId}/stems`, method: 'GET' }),
    enabled: enabled && Boolean(versionId),
    refetchInterval: (query) => (query.state.data?.classified ? false : 1500),
    retry: false,
  });
}

/** Confirm stem roles + analysis mode; dispatches re-analysis. */
export function useConfirmStems(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ConfirmStemsRequest) =>
      fetcher<ConfirmStemsResponse>({
        url: `/versions/${versionId}/stems/confirm`,
        method: 'POST',
        data: body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['versions', versionId] });
      qc.invalidateQueries({ queryKey: ['songs'] });
      qc.invalidateQueries({ queryKey: ['stems', versionId] });
    },
  });
}

/** Upload an Ableton .als project file for an existing version. Triggers
 *  re-analysis so phase 8 (ALS) populates project-health data. */
export function useUploadAls(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    // analyze omitted → BFF re-analyzes (existing behavior). The unified-upload
    // flow passes analyze=false to attach the project without dispatching a job.
    mutationFn: async (input: { file: File; analyze?: boolean }) => {
      const fd = new FormData();
      fd.append('file', input.file, input.file.name);
      if (input.analyze !== undefined) fd.append('analyze', String(input.analyze));
      return fetcher<AlsUploadResponse>({
        url: `/versions/${versionId}/als`,
        method: 'POST',
        body: fd,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['versions', versionId] });
      qc.invalidateQueries({ queryKey: ['songs'] });
    },
  });
}

export function useSetCurrentVersion(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetcher<void>({ url: `/versions/${versionId}/set-current`, method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['versions', versionId] });
      qc.invalidateQueries({ queryKey: ['songs'] });
    },
  });
}

// ── Session notes ───────────────────────────────────────────────────────────
export function useNotes(versionId: string) {
  return useQuery<NoteDto[]>({
    queryKey: ['notes', versionId],
    queryFn: () =>
      fetcher<NoteDto[]>({ url: `/versions/${versionId}/notes`, method: 'GET' }),
    enabled: Boolean(versionId),
  });
}

export function useCreateNote(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateNoteRequest) =>
      fetcher<NoteDto>({
        url: `/versions/${versionId}/notes`,
        method: 'POST',
        data: body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes', versionId] }),
  });
}

export function usePatchNote(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, body }: { noteId: string; body: PatchNoteRequest }) =>
      fetcher<NoteDto>({
        url: `/versions/${versionId}/notes/${noteId}`,
        method: 'PATCH',
        data: body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes', versionId] }),
  });
}

export function useDeleteNote(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) =>
      fetcher<void>({
        url: `/versions/${versionId}/notes/${noteId}`,
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes', versionId] }),
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

/** List the user's recent jobs. `status` is a comma-separated filter
 *  (e.g. "pending,processing") — omit to fetch all. */
export function useJobs(opts?: { status?: string; limit?: number }) {
  const query = new URLSearchParams();
  if (opts?.status) query.set('status', opts.status);
  if (opts?.limit != null) query.set('limit', String(opts.limit));
  const qs = query.toString();
  return useQuery<JobSummaryDto[]>({
    queryKey: ['jobs', 'list', opts?.status ?? '', opts?.limit ?? 50],
    queryFn: () =>
      fetcher<JobSummaryDto[]>({
        url: `/jobs/${qs ? `?${qs}` : ''}`,
        method: 'GET',
      }),
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

/** Re-run a single analysis phase (2–8) in place. Returns the lightweight re-run
 *  job id; poll it with `useJob` and invalidate `['jobs', jobId, 'results']` on
 *  completion to refresh the report. */
export function useRerunPhase(jobId: string) {
  return useMutation({
    mutationFn: (phase: number) =>
      fetcher<RerunPhaseResponse>({
        url: `/reports/${jobId}/phases/${phase}/rerun`,
        method: 'POST',
      }),
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

// ── References ──────────────────────────────────────────────────────────────
export function useReferences() {
  return useQuery<ReferenceDto[]>({
    queryKey: ['references'],
    queryFn: () => fetcher<ReferenceDto[]>({ url: '/references/', method: 'GET' }),
  });
}

export function useReference(referenceId: string) {
  return useQuery<ReferenceDto>({
    queryKey: ['references', referenceId],
    queryFn: () =>
      fetcher<ReferenceDto>({ url: `/references/${referenceId}`, method: 'GET' }),
    enabled: Boolean(referenceId),
  });
}

/** Multipart upload (FormData required so the file streams). Returns the
 *  freshly-created `ReferenceDto`; analysis is kicked off separately via
 *  `useAnalyzeReference`. */
export function useUploadReference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      file: File;
      title?: string;
      artist?: string;
      genre?: string;
    }) => {
      const fd = new FormData();
      fd.append('file', input.file);
      if (input.title) fd.append('title', input.title);
      if (input.artist) fd.append('artist', input.artist);
      if (input.genre) fd.append('genre', input.genre);
      return fetcher<ReferenceDto>({
        url: '/references/',
        method: 'POST',
        body: fd,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['references'] }),
  });
}

export function usePatchReference(referenceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PatchReferenceRequest) =>
      fetcher<ReferenceDto>({
        url: `/references/${referenceId}`,
        method: 'PATCH',
        data: body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['references'] });
      qc.invalidateQueries({ queryKey: ['references', referenceId] });
    },
  });
}

export function useDeleteReference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (referenceId: string) =>
      fetcher<void>({ url: `/references/${referenceId}`, method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['references'] }),
  });
}

export function useAnalyzeReference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (referenceId: string) =>
      fetcher<ReferenceDto>({
        url: `/references/${referenceId}/analyze`,
        method: 'POST',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['references'] }),
  });
}

// Reference sets
export function useReferenceSets() {
  return useQuery<ReferenceSetDto[]>({
    queryKey: ['reference-sets'],
    queryFn: () => fetcher<ReferenceSetDto[]>({ url: '/reference-sets/', method: 'GET' }),
  });
}

export function useCreateReferenceSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateReferenceSetRequest) =>
      fetcher<ReferenceSetDto>({
        url: '/reference-sets/',
        method: 'POST',
        data: body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reference-sets'] }),
  });
}

export function useDeleteReferenceSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (setId: string) =>
      fetcher<void>({ url: `/reference-sets/${setId}`, method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reference-sets'] }),
  });
}

export function useAddReferenceToSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ setId, referenceId }: { setId: string; referenceId: string }) =>
      fetcher<void>({
        url: `/reference-sets/${setId}/members`,
        method: 'POST',
        data: { referenceId },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reference-sets'] }),
  });
}

// ── Bookmarks ───────────────────────────────────────────────────────────────
export function useBookmarks() {
  return useQuery<BookmarkDto[]>({
    queryKey: ['bookmarks'],
    queryFn: () => fetcher<BookmarkDto[]>({ url: '/me/bookmarks/', method: 'GET' }),
  });
}

export function useCreateBookmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBookmarkRequest) =>
      fetcher<BookmarkDto>({ url: '/me/bookmarks/', method: 'POST', data: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookmarks'] }),
  });
}

export function useDeleteBookmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bookmarkId: string) =>
      fetcher<void>({ url: `/me/bookmarks/${bookmarkId}`, method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookmarks'] }),
  });
}

// ── Share (owner-side) ──────────────────────────────────────────────────────
export function useCreateShare(analysisId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetcher<CreateShareResponse>({
        url: `/analyses/${analysisId}/share/`,
        method: 'POST',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['analyses', analysisId] }),
  });
}

export function usePatchShare(analysisId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PatchShareRequest) =>
      fetcher<void>({
        url: `/analyses/${analysisId}/share/`,
        method: 'PATCH',
        data: body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['analyses', analysisId] }),
  });
}

export function useRevokeShare(analysisId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetcher<void>({ url: `/analyses/${analysisId}/share/`, method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['analyses', analysisId] }),
  });
}

// ── Share (public-side, no auth) ────────────────────────────────────────────
export function useSharedAnalysis(token: string) {
  return useQuery<SharedAnalysisDto>({
    queryKey: ['share', token],
    queryFn: () => fetcher<SharedAnalysisDto>({ url: `/share/${token}/`, method: 'GET' }),
    enabled: Boolean(token),
    retry: false,
  });
}

export function useShareComments(token: string) {
  return useQuery<ShareCommentDto[]>({
    queryKey: ['share', token, 'comments'],
    queryFn: () =>
      fetcher<ShareCommentDto[]>({ url: `/share/${token}/comments`, method: 'GET' }),
    enabled: Boolean(token),
  });
}

export function usePostShareComment(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PostShareCommentRequest) =>
      fetcher<ShareCommentDto>({
        url: `/share/${token}/comments`,
        method: 'POST',
        data: body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['share', token, 'comments'] }),
  });
}

// ── Coach ───────────────────────────────────────────────────────────────────
export function useCoachView(jobId: string) {
  return useQuery<CoachViewDto>({
    queryKey: ['coach', jobId],
    queryFn: () => fetcher<CoachViewDto>({ url: `/coach/${jobId}`, method: 'GET' }),
    enabled: Boolean(jobId),
  });
}

// ── Compare ─────────────────────────────────────────────────────────────────
export function useCompare(versionA: string | null, versionB: string | null) {
  return useQuery<CompareResponseDto>({
    queryKey: ['compare', versionA, versionB],
    queryFn: () =>
      fetcher<CompareResponseDto>({
        url: `/compare/?versionA=${versionA}&versionB=${versionB}`,
        method: 'GET',
      }),
    enabled: Boolean(versionA && versionB && versionA !== versionB),
    retry: false,
  });
}
