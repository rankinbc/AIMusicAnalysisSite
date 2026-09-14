// Hand-rolled API hooks for slice 1. orval-generated hooks will replace
// these once the BFF emits openapi.json against a live database.
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetcher } from './fetcher';
import { terminalPoll } from './poll-helpers';
import type {
  ActivityItemDto,
  AuthResponse,
  AuthedUser,
  BookmarkDto,
  CompareResponseDto,
  CreateBookmarkRequest,
  CreateShareResponse,
  CreateNoteRequest,
  CreateReferenceSetRequest,
  CreateSongRequest,
  CreateTagRequest,
  EntitlementsDto,
  FullHealthResponse,
  HonestMathDto,
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
  PlansResponse,
  PostShareCommentRequest,
  ReportListResponse,
  ReportsFilter,
  ShareCommentDto,
  SharedAnalysisDto,
  TagDto,
  PatchVersionRequest,
  AlsUploadResponse,
  ReanalyzeResponse,
  RetryResponse,
  StemUploadResponse,
  StemProposalsResponse,
  ConfirmStemsRequest,
  ConfirmStemsResponse,
  ReferenceDto,
  ReferenceSetDto,
  FixRackDto,
  RerunPhaseRequest,
  RerunPhaseResponse,
  RunSpecialistResponse,
  SongDto,
  UploadResponse,
  VerdictsListResponse,
  VersionDto,
  VersionFilesResponse,
  WorkerHealthResponse,
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

/** Story 2.8 — GET /api/me/honest-math — 90-day credit-spend vs Pro comparison
 *  behind the dismissible HonestMathBanner. Quasi-static; cache a few minutes. */
export function useHonestMath() {
  return useQuery<HonestMathDto>({
    queryKey: ['me', 'honest-math'],
    queryFn: () => fetcher<HonestMathDto>({ url: '/me/honest-math', method: 'GET' }),
    staleTime: 5 * 60_000,
  });
}

/** GET /api/billing/plans — quasi-static display prices (cents). Cached for
 *  the session so the UpgradeSheet and pricing surfaces don't refetch. */
export function usePlans() {
  return useQuery<PlansResponse>({
    queryKey: ['billing', 'plans'],
    queryFn: () => fetcher<PlansResponse>({ url: '/billing/plans', method: 'GET' }),
    staleTime: 5 * 60_000,
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
export function useSongs(enabled = true) {
  return useQuery({
    queryKey: ['songs'],
    queryFn: () =>
      fetcher<SongDto[]>({
        url: '/songs/?include=versions,latest_result',
        method: 'GET',
      }),
    // Story 5.10: the always-mounted CommandPalette passes `open` here so an
    // idle palette doesn't subscribe every product route to the songs fetch.
    enabled,
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

/** Restore an archived song (un-archive). Reversible counterpart to
 *  `useArchiveSong`. */
export function useRestoreSong() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (songId: string) =>
      fetcher<void>({ url: `/songs/${songId}/restore`, method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['songs'] }),
  });
}

/** Permanently delete a song and all its versions/analyses (hard delete).
 *  Distinct from `useArchiveSong` (reversible soft-delete). */
export function useDeleteSong() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (songId: string) =>
      fetcher<void>({ url: `/songs/${songId}/permanent`, method: 'DELETE' }),
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
 *  jobId; navigate to `/songs/{songId}/results/{jobId}` to watch it.
 *  Pass `{ referenceId }` to drive Phase 5 against a saved library reference. */
export function useReanalyzeVersion(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars?: { referenceId?: string }) =>
      fetcher<ReanalyzeResponse>({
        url: vars?.referenceId
          ? `/versions/${versionId}/analyze?referenceId=${encodeURIComponent(vars.referenceId)}`
          : `/versions/${versionId}/analyze`,
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['versions', versionId] });
      qc.invalidateQueries({ queryKey: ['songs'] });
    },
  });
}

/** Story 5.7 — free retry of a failed/degraded analysis. Eligibility is
 *  server-decided (409 retry_not_eligible / retry_already_used); a success
 *  consumes NO entitlement and returns the new jobId to navigate to. */
export function useFreeRetry(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetcher<RetryResponse>({ url: `/jobs/${jobId}/retry`, method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
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
    // Poll only while a classify job is genuinely in flight. Stop once the worker
    // reports classified OR there are no staged stems to classify — otherwise a
    // version with an empty stem_paths_raw (e.g. the Listen page) polls forever,
    // since the BFF returns classified=false when entries.Count == 0.
    // E3.1: maxPolls ~4 min mirrors the review-OFF waitClassified bound — a dead
    // worker must not spin "Classifying stems…" forever.
    refetchInterval: terminalPoll<StemProposalsResponse>({
      pollMs: 1500,
      active: (d) => !d.classified && d.stems.length > 0,
      maxPolls: 160,
    }),
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

// ── Worker health ───────────────────────────────────────────────────────────
/** Polls analysis-worker liveness for the global offline banner. Polls slowly
 *  while healthy and faster while offline so recovery clears the banner quickly.
 *  Anonymous endpoint — safe before auth. */
export function useWorkerHealth() {
  return useQuery<WorkerHealthResponse>({
    queryKey: ['health', 'worker'],
    queryFn: () =>
      fetcher<WorkerHealthResponse>({ url: '/health/worker', method: 'GET' }),
    refetchInterval: (query) =>
      query.state.data?.healthy === false ? 10_000 : 30_000,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
    retry: false,
  });
}

/** Story 12.2 — aggregated health for the dev-only shell dot. Poll ~30s;
 *  callers gate mounting on import.meta.env.DEV so prod builds never query. */
export function useFullHealth() {
  return useQuery<FullHealthResponse>({
    queryKey: ['health', 'full'],
    queryFn: () =>
      fetcher<FullHealthResponse>({ url: '/health/full', method: 'GET' }),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
    retry: false,
  });
}

// ── Jobs ────────────────────────────────────────────────────────────────────
export function useJob(jobId: string, opts?: { pollMs?: number }) {
  return useQuery<JobStatusDto>({
    queryKey: ['jobs', jobId],
    queryFn: () => fetcher<JobStatusDto>({ url: `/jobs/${jobId}`, method: 'GET' }),
    enabled: Boolean(jobId),
    // E5.6/E5.11: awaiting_stem_mapping is terminal for THIS poll (the stems
    // review on the song page owns the next step); 404/error caps via helper.
    refetchInterval: terminalPoll<JobStatusDto>({
      pollMs: opts?.pollMs ?? 2000,
      active: (d) =>
        d.status !== 'complete' &&
        d.status !== 'failed' &&
        d.status !== 'awaiting_stem_mapping',
    }),
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

/** True while Phase 7's arrangement score is still being filled in by the
 *  background structure-detection job (allin1). Used to keep polling the report
 *  until the real score lands. Defensive against the loosely-typed finalJson. */
function isArrangementPending(results: JobResultsDto | undefined): boolean {
  const phases = (results?.finalJson as { phases?: Array<{ phase?: number; data?: unknown }> } | undefined)?.phases;
  const phase7 = phases?.find((p) => p.phase === 7)?.data as
    | { arrangement_status?: string }
    | undefined;
  return phase7?.arrangement_status === 'pending';
}

export function useJobResults(jobId: string, enabled: boolean) {
  return useQuery<JobResultsDto>({
    queryKey: ['jobs', jobId, 'results'],
    queryFn: () => fetcher<JobResultsDto>({ url: `/jobs/${jobId}/results`, method: 'GET' }),
    enabled: enabled && Boolean(jobId),
    retry: false,
    // Structure detection (allin1) runs in the background — ~10-15 s on GPU but
    // many minutes on CPU for a full-length track. Poll on a relaxed interval
    // until the deferred Phase 7 fills in, then stop. E5.1: ~10 min backstop —
    // a crashed structure job now writes arrangement_status='failed', and the
    // cap covers the crash-before-write hole.
    refetchInterval: terminalPoll<JobResultsDto>({
      pollMs: 8000,
      active: isArrangementPending,
      maxPolls: 75,
    }),
  });
}

// Story 12.5: useRerunPhase was removed with its only consumer (the orphaned
// AnalysisTab — never mounted by ReportView, so the per-phase re-run UI was
// already unreachable). The BFF endpoint POST /reports/{jobId}/phases/{phase}/rerun
// and the rerun_phase worker actor REMAIN — re-home the UI when a live surface
// wants it (poll the returned job, then invalidate ['jobs', jobId, 'results']).

// Item 1 (genre confirm/correct chip) — Phase 2's own classifier categories.
// Kept as a fixed choice list (not free text) so every value the user can
// submit is one the classifier + verdict-layer genre_map already resolve.
export const GENRE_HINT_OPTIONS = ['trance', 'house', 'techno', 'dnb', 'other'] as const;
export type GenreHint = (typeof GENRE_HINT_OPTIONS)[number];

/** Item 1: correct the detected genre on a completed analysis. POSTs to the
 *  existing per-phase rerun endpoint (phase 2 + genreHint); the BFF cascades
 *  the rerun across phases 2/3/5/6 and refreshes rule-engine findings, so a
 *  single poll-to-completion + one results invalidation is enough here. */
export function useConfirmGenre(jobId: string) {
  return useMutation({
    mutationFn: (genreHint: GenreHint) =>
      fetcher<RerunPhaseResponse>({
        url: `/reports/${jobId}/phases/2/rerun`,
        method: 'POST',
        data: { genreHint } satisfies RerunPhaseRequest,
      }),
  });
}

/** Poll the lightweight re-run job returned by {@link useConfirmGenre}, then
 *  invalidate the report's results once it lands so the corrected genre,
 *  score and findings show up without a manual refresh. */
export function useRerunJobStatus(rerunJobId: string | undefined, reportJobId: string) {
  const qc = useQueryClient();
  const query = useQuery<JobStatusDto>({
    queryKey: ['jobs', rerunJobId],
    queryFn: () => fetcher<JobStatusDto>({ url: `/jobs/${rerunJobId}`, method: 'GET' }),
    enabled: Boolean(rerunJobId),
    refetchInterval: terminalPoll<JobStatusDto>({
      pollMs: 1500,
      active: (d) => d.status !== 'complete' && d.status !== 'failed',
    }),
    retry: false,
  });
  useEffect(() => {
    if (query.data?.status === 'complete') {
      qc.invalidateQueries({ queryKey: ['jobs', reportJobId, 'results'] });
    }
  }, [query.data?.status, qc, reportJobId]);
  return query;
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
    // Poll while (a) a specialist the user kicked off is still running, OR
    // (b) Triage hasn't landed its routing plan yet. The BFF lazy-fires
    // `run_triage` on the first GET and returns BEFORE the plan is written, so
    // without this the suggestions never surface on the initial upload. Bound
    // the triage wait so a permanently-empty plan doesn't poll forever.
    refetchInterval: (query) => {
      if (opts.optimisticRunning.size > 0) return 3000;
      const d = query.state.data;
      const triagePending = d != null && d.routingPlan == null && d.degradation == null;
      if (triagePending && query.state.dataUpdateCount < 25) return 3000;
      return false;
    },
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

/** Dispatch deterministic fix-rack generation (POST → 202 queued). Poll the
 *  result with `useFixRack`. */
export function useGenerateFixRack(jobId: string) {
  return useMutation({
    mutationFn: () =>
      fetcher<{ status: string }>({ url: `/reports/${jobId}/fix-rack`, method: 'POST' }),
  });
}

/** The generated analysis fix-rack, or `null` until ready. The BFF returns 204
 *  (→ null) until the worker writes it; this polls every 1.5 s while null,
 *  capped at 100 polls (150 s) so a worker that never persists a preset can't
 *  spin the UI forever. Enable it only after `useGenerateFixRack` has been
 *  fired; callers re-requesting (retry/regenerate) must `resetQueries` the
 *  ['fix-rack', jobId] key so the poll count and cached data start fresh. */
export function useFixRack(jobId: string, enabled: boolean) {
  return useQuery<FixRackDto | null>({
    queryKey: ['fix-rack', jobId],
    queryFn: async () =>
      (await fetcher<FixRackDto | null>({ url: `/reports/${jobId}/fix-rack`, method: 'GET' })) ?? null,
    enabled: enabled && Boolean(jobId),
    refetchInterval: (query) =>
      query.state.data == null && query.state.dataUpdateCount < 100 ? 1500 : false,
    retry: false,
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

// Results v4: dismiss/feedback re-homed to the Findings/Actions boards
// (ignore-row + Rate-this-Suggestion), mirroring useApplyVerdict.
export function useDismissVerdict(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (verdictId: string) =>
      fetcher<void>({ url: `/verdicts/${verdictId}/dismiss`, method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['verdicts', jobId] }),
  });
}

export function useFeedbackVerdict(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { verdictId: string; feedback: 'helpful' | 'wrong' | 'unclear' }) =>
      fetcher<void>({
        url: `/verdicts/${input.verdictId}/feedback`,
        method: 'POST',
        data: { feedback: input.feedback },
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reference-sets'] });
      qc.invalidateQueries({ queryKey: ['references'] });
    },
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
    onSuccess: () => {
      // setIds live on the reference rows, so both caches are stale.
      qc.invalidateQueries({ queryKey: ['reference-sets'] });
      qc.invalidateQueries({ queryKey: ['references'] });
    },
  });
}

export function useRemoveReferenceFromSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ setId, referenceId }: { setId: string; referenceId: string }) =>
      fetcher<void>({
        url: `/reference-sets/${setId}/members/${referenceId}`,
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reference-sets'] });
      qc.invalidateQueries({ queryKey: ['references'] });
    },
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

// Story 7.3 (AR28) — regenerate mints a fresh token; the old link is dead
// the moment this resolves.
export function useRegenerateShare(analysisId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetcher<CreateShareResponse>({
        url: `/analyses/${analysisId}/share/regenerate`,
        method: 'POST',
      }),
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
// UI-cleanup sweep: useCoachView removed with zero consumers (the live coach
// surface streams via CoachChat + CoachConversationEndpoints, not this combined
// view). The BFF endpoint GET /api/coach/{jobId} REMAINS — re-home the hook when
// a surface wants the combined view; CoachViewDto stays in types.ts as the
// contract mirror.

// ── Song tags ───────────────────────────────────────────────────────────────
export function useCreateTag(songId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTagRequest) =>
      fetcher<TagDto>({ url: `/songs/${songId}/tags`, method: 'POST', data: body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['songs'] });
      qc.invalidateQueries({ queryKey: ['songs', songId] });
    },
  });
}

export function useDeleteTag(songId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tagId: string) =>
      fetcher<void>({ url: `/songs/${songId}/tags/${tagId}`, method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['songs'] });
      qc.invalidateQueries({ queryKey: ['songs', songId] });
    },
  });
}

// ── Version delete ───────────────────────────────────────────────────────────
export function useDeleteVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) =>
      fetcher<void>({ url: `/versions/${versionId}`, method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['songs'] }),
  });
}

// ── Reports list ─────────────────────────────────────────────────────────────
export function useReports(filters: ReportsFilter = {}) {
  const params = new URLSearchParams();
  if (filters.songName) params.set('songName', filters.songName);
  if (filters.tags) params.set('tags', filters.tags);
  if (filters.genreHint) params.set('genreHint', filters.genreHint);
  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);
  if (filters.page != null) params.set('page', String(filters.page));
  if (filters.pageSize != null) params.set('pageSize', String(filters.pageSize));
  const qs = params.toString();
  return useQuery<ReportListResponse>({
    queryKey: ['reports', filters],
    queryFn: () =>
      fetcher<ReportListResponse>({
        url: `/reports/${qs ? `?${qs}` : ''}`,
        method: 'GET',
      }),
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

// ── Version rating (personal score) ─────────────────────────────────────────
export function useSetPersonalScore(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (score: number) =>
      fetcher<{ score: number }>({
        url: `/versions/${versionId}/rating`, method: 'PUT', data: { score },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['songs'] }),
  });
}

export function useClearPersonalScore(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fetcher<void>({ url: `/versions/${versionId}/rating`, method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['songs'] }),
  });
}

// ── Compare notes ────────────────────────────────────────────────────────────
export function useCompareNotes(songId: string, a: string | null, b: string | null) {
  return useQuery({
    queryKey: ['compare-notes', songId, ...[a, b].filter(Boolean).sort()],
    queryFn: () =>
      fetcher<{ body: string }>({
        url: `/compare/notes`, method: 'GET',
        params: { versionA: a as string, versionB: b as string },
      }),
    enabled: Boolean(a && b),
  });
}

export function useSaveCompareNotes(songId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { a: string; b: string; body: string }) =>
      fetcher<{ body: string }>({
        url: `/compare/notes`, method: 'PUT',
        params: { versionA: v.a, versionB: v.b }, data: { body: v.body },
      }),
    onSuccess: (_d, v) =>
      qc.invalidateQueries({ queryKey: ['compare-notes', songId, ...[v.a, v.b].sort()] }),
  });
}

export function useDeleteCompareNotes(songId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { a: string; b: string }) =>
      fetcher<void>({ url: `/compare/notes`, method: 'DELETE', params: { versionA: v.a, versionB: v.b } }),
    onSuccess: (_d, v) =>
      qc.invalidateQueries({ queryKey: ['compare-notes', songId, ...[v.a, v.b].sort()] }),
  });
}
