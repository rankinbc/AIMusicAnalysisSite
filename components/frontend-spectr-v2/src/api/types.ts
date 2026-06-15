// Hand-mirrored from components/bff/src/Spectr.Bff/DTOs/*.cs.
// Until orval codegen is wired against a running BFF, these are the source
// of truth for the frontend's view of the API. Keep them in sync.

export interface AuthedUser {
  id: string;
  email: string;
  handle: string | null;
  displayName: string | null;
}

export interface AuthResponse {
  accessToken: string;
  user: AuthedUser;
}

export interface VersionDto {
  id: string;
  songId: string;
  versionNumber: number;
  label: string | null;
  isCurrent: boolean;
  filePath: string;
  createdAt: string;
}

export interface AnalysisSummaryDto {
  id: string;
  jobId: string;
  createdAt: string;
  grade: string | null;
  score: number | null;
}

export interface SongDto {
  id: string;
  name: string;
  genreHint: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  versions: VersionDto[];
  latestResult: AnalysisSummaryDto | null;
}

export interface CreateSongRequest {
  name: string;
  genreHint?: string | null;
}

export interface PatchSongRequest {
  name?: string | null;
  genreHint?: string | null;
}

export interface UploadResponse {
  songId: string;
  versionId: string;
  jobId: string;
}

export interface NoteDto {
  id: string;
  versionId: string;
  tSeconds: number;
  text: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNoteRequest {
  tSeconds: number;
  text: string;
  pinned: boolean;
}

export interface PatchNoteRequest {
  tSeconds?: number;
  text?: string;
  pinned?: boolean;
}

export interface PatchVersionRequest {
  label?: string | null;
}

export interface ReanalyzeResponse {
  jobId: string;
}

export interface StemUploadResponse {
  versionId: string;
  stemPaths: Record<string, string>;
  reanalysisJobId: string;
}

export interface AlsUploadResponse {
  versionId: string;
  alsPath: string;
  reanalysisJobId: string;
}

export type StemRole =
  | 'drums'
  | 'kick'
  | 'snare'
  | 'hats'
  | 'bass'
  | 'vocals'
  | 'lead'
  | 'pad'
  | 'fx'
  | 'other';

export const STEM_ROLES: readonly StemRole[] = [
  'kick',
  'snare',
  'hats',
  'drums',
  'bass',
  'vocals',
  'lead',
  'pad',
  'fx',
  'other',
] as const;

// /api/me/profile + /api/me/stats + /api/me/activity
export interface MeProfileDto {
  id: string;
  email: string;
  handle: string | null;
  displayName: string | null;
  bio: string | null;
  avatarHue: number | null;
  bannerHue: number | null;
  accent: string | null;
  publicLink: string | null;
}

export interface PatchMeProfileRequest {
  displayName?: string | null;
  handle?: string | null;
  bio?: string | null;
  avatarHue?: number | null;
  bannerHue?: number | null;
  accent?: string | null;
  publicLink?: string | null;
}

export interface MeStatsDto {
  songs: number;
  versions: number;
  analyses: number;
  thisMonthAnalyses: number;
  plays: number;
}

export interface ActivityItemDto {
  kind: 'analysis' | 'song' | 'version' | string;
  text: string;
  occurredAt: string;
  songId: string | null;
  versionId: string | null;
  jobId: string | null;
}

// References — saved reference tracks for genre comparison.
export interface ReferenceDto {
  id: string;
  title: string;
  artist: string | null;
  source: string;
  filePath: string | null;
  genre: string | null;
  bpm: number | null;
  detectedKey: string | null;
  durationSeconds: number | null;
  lufs: number | null;
  truePeakDb: number | null;
  dynamicRangeLu: number | null;
  stereoWidth: number | null;
  stereoCorrelation: number | null;
  bandLevels: unknown;
  tags: unknown;
  analyzed: boolean;
  usedCount: number;
  notes: string | null;
  createdAt: string;
}

export interface PatchReferenceRequest {
  title?: string;
  artist?: string | null;
  genre?: string | null;
  notes?: string | null;
  tags?: unknown;
}

export interface ReferenceSetDto {
  id: string;
  name: string;
  hue: number | null;
  memberCount: number;
  createdAt: string;
}

export interface CreateReferenceSetRequest {
  name: string;
  hue?: number | null;
}

// Bookmarks — saved pointers to share-links (and, future, Discover tracks).
export interface BookmarkDto {
  id: string;
  targetShareToken: string | null;
  targetPublishedTrack: string | null;
  title: string | null;
  artist: string | null;
  createdAt: string;
}

export interface CreateBookmarkRequest {
  targetShareToken?: string | null;
  targetPublishedTrack?: string | null;
}

export interface CompareSideDto {
  versionId: string;
  versionNumber: number;
  label: string | null;
  createdAt: string;
  grade: string | null;
  score: number | null;
  lufs: number | null;
  truePeakDb: number | null;
  rmsDb: number | null;
  bpm: number | null;
  detectedKey: string | null;
  stereoWidth: number | null;
  stereoCorrelation: number | null;
  monoCompatibility: number | null;
  bands: Record<string, number> | null;
}

export interface CompareResponseDto {
  songId: string;
  a: CompareSideDto;
  b: CompareSideDto;
  source: string;
}

// Share
export interface CreateShareResponse {
  shareToken: string;
  shareShowVerdicts: boolean;
  shareEnabledAt: string;
  publicUrl: string;
}

export interface PatchShareRequest {
  showVerdicts: boolean;
}

export interface SharedAnalysisDto {
  token: string;
  songName: string | null;
  producerHandle: string | null;
  producerDisplayName: string | null;
  createdAt: string;
  finalJson: unknown;
  verdicts: unknown;
}

export interface ShareCommentDto {
  id: string;
  authorDisplayName: string | null;
  timestampSeconds: number | null;
  body: string;
  createdAt: string;
}

export interface PostShareCommentRequest {
  body: string;
  timestampSeconds?: number | null;
  authorDisplayName?: string | null;
}

// Coach combined-view (analysis + verdicts + counts). Chat-stream lands later.
export interface CoachViewDto {
  jobId: string;
  songName: string | null;
  finalJson: unknown;
  specialistsRun: number;
  specialistsTotal: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  verdicts: unknown;
}

export type JobStatus =
  | 'pending'
  | 'processing'
  | 'complete'
  | 'failed'
  | 'awaiting_stem_mapping';

export interface JobStatusDto {
  id: string;
  status: JobStatus;
  currentPhase: string;
  phasePct: number;
  versionId: string | null;
  songId: string | null;
  errorMessage: string | null;
  dispatchedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
}

export interface JobSummaryDto {
  id: string;
  status: JobStatus;
  currentPhase: string;
  phasePct: number;
  versionId: string | null;
  songId: string | null;
  songName: string | null;
  dispatchedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
}

export interface JobResultsDto {
  jobId: string;
  analysisId: string;
  versionId: string | null;
  songId: string | null;
  songName: string | null;
  finalJson: unknown;
  shareToken: string | null;
}

// ── final_json typed view (narrowed at the Results page boundary) ──────────
// The Python pipeline writes this blob to `analyses.final_json`. Fields
// here mirror what `audio_analysis.run_pipeline()` actually emits. Every
// nested field is optional — phase failures or skips leave gaps.

export interface Phase1Bands {
  sub_bass?: number;
  bass?: number;
  low_mid?: number;
  mid?: number;
  upper_mid?: number;
  presence?: number;
  air?: number;
}

export interface Phase1Data {
  bpm?: number;
  lufs?: number;
  rms?: number;
  peak_dbfs?: number;
  true_peak_db?: number;
  detected_key?: string;
  duration_seconds?: number;
  mono_compatibility?: number;
  stereo_width?: number;
  stereo_correlation?: number;
  clipping_detected?: boolean;
  clipped_sample_count?: number;
  low_energy?: number;
  bands?: Phase1Bands;
  structure?: { sections?: unknown[]; beats?: unknown[] };
}

export interface Phase2Data {
  bpm?: number;
  genre?: string;
  confidence?: number;
}

/** Phase 3 — genre-specific scoring. `sub_scores` keys vary per genre. */
export interface Phase3Data {
  genre?: string;
  total_score?: number;
  sub_scores?: Record<string, number>;
  notes?: string[];
}

/** Phase 4 — spectral fallback path (the active default). Demucs-based
 *  outputs (`per_stem`, `clash_matrix`, `balance_flags`) only appear when
 *  USE_DEMUCS is true; treat them as optional. */
export interface Phase4Clash {
  stems?: string;
  frequency_range?: string;
  severity?: 'high' | 'moderate' | 'low' | string;
}

export interface Phase4Data {
  stems?: Record<string, unknown>;
  band_energy?: Record<string, number>;
  clashes?: Phase4Clash[];
  per_stem?: Record<string, unknown>;
  clash_matrix?: unknown[];
  balance_flags?: unknown[];
  error?: string;
}

/** Phase 5 — preset-based reference comparison. */
export interface Phase5Check {
  status: 'ok' | 'warn' | 'fail' | string;
  message: string;
  value?: number;
}

export interface Phase5Data {
  genre?: string;
  preset_name?: string;
  checks?: Record<string, Phase5Check>;
}

/** Phase 6 — gap analysis vs. genre profile. */
export interface Phase6Gap {
  user_val: number;
  genre_mean: number;
  genre_std: number;
  acceptable_range: [number, number];
  delta: number;
  percentile: number;
  description: string;
  in_range: boolean;
}

export interface Phase6Data {
  genre?: string;
  percentile?: number;
  profile_source?: string;
  gaps?: Record<string, Phase6Gap>;
}

/** Phase 7 — arrangement scoring. Mirrors `ArrangementScore.to_dict()`. */
export interface Phase7SectionScore {
  section_type: string;
  start_time: number;
  end_time: number;
  duration: number;
  bars: number;
  score: number;
  time_range: string;
  eight_bar_compliant: boolean;
  checks?: { name: string; passed: boolean }[];
  issues?: string[];
}

export interface Phase7Issue {
  severity: string;
  message: string;
  section: string | null;
  fix_suggestion?: string;
}

export interface Phase7Metadata {
  total_bars?: number;
  section_count?: number;
  detected_tempo?: number | null;
  has_intro?: boolean;
  has_buildup?: boolean;
  has_drop?: boolean;
  has_breakdown?: boolean;
  has_outro?: boolean;
  energy_contrast_db?: number | null;
}

export interface Phase7Data {
  overall_score?: number;
  grade?: string;
  total_duration?: number;
  component_scores?: Record<string, number>;
  structure_score?: number;
  length_score?: number;
  eight_bar_score?: number;
  energy_contrast_score?: number;
  flow_score?: number;
  section_scores?: Phase7SectionScore[];
  issues?: Phase7Issue[];
  suggestions?: string[];
  fixes?: string[];
  violations?: string[];
  section_count?: number;
  metadata?: Phase7Metadata;
}

/** Phase 8 — Ableton project parse. Only populated when user uploaded .als. */
export interface Phase8Track {
  name: string;
  type: string;
  device_count: number;
  disabled_count: number;
  muted: boolean;
}

export interface Phase8MidiIssue {
  track: string;
  clip: string | null;
  type: string;
  severity: string;
  description: string;
  fix?: string;
}

export interface Phase8Data {
  health_score?: number;
  grade?: string;
  tempo?: number;
  ableton_version?: string;
  time_signature?: string;
  total_devices?: number;
  disabled_devices?: number;
  clutter_pct?: number;
  plugin_list?: string[];
  has_humanized_midi?: boolean;
  quantization_issues_count?: number;
  total_chord_count?: number;
  midi_note_count?: number;
  audio_clip_count?: number;
  total_duration_seconds?: number;
  tracks?: Phase8Track[];
  midi?: {
    total_clips: number;
    total_notes: number;
    empty_clips: number;
    short_clips: number;
    duplicate_clips: number;
    tracks_without_content: number;
    issues: Phase8MidiIssue[];
  };
  arrangement?: {
    has_markers: boolean;
    total_sections: number;
    pattern: string | null;
    sections: { name: string; start_beat: number; end_beat: number; duration_bars: number }[];
  };
}

export interface PhaseResult<TData = unknown> {
  phase: number;
  name: string;
  status: 'ok' | 'skipped' | 'failed' | string;
  error?: string | null;
  data?: TData;
}

export interface FinalJson {
  grade?: string | null;
  overall_score?: number;
  danceability_score?: number;
  coach_name?: string;
  coach_intro?: string;
  coached_fixes?: string[];
  top_fixes?: string[];
  phases?: PhaseResult[];
}

/** Runtime guard. Pipeline failures may leave `finalJson` as something other
 *  than an object — the report renders an empty shell in that case. */
export function isFinalJson(x: unknown): x is FinalJson {
  return typeof x === 'object' && x !== null;
}

// ── Verdicts (slice 2.5) ───────────────────────────────────────────────────

export type Severity = 'critical' | 'severe' | 'moderate' | 'minor' | 'win';
export type FeedbackKind = 'helpful' | 'wrong' | 'unclear';

/** BFF specialist tile status. The frontend additionally tracks a local
 *  'running' state between click and the next successful poll. */
export type SpecialistStatusKind = 'idle' | 'cached' | 'failed' | 'running';

export interface VerdictUserState {
  dismissed: boolean;
  applied: boolean;
  feedback: FeedbackKind | null;
}

export interface VerdictDto {
  id: string;
  analysisId: string;
  specialist: string;
  promptVersion: string;
  model: string;
  severity: Severity | string;
  category: string;
  confidence: number;
  priorityScore: number;
  impact: string | null;
  chartType: string | null;
  headline: string;
  summary: string | null;
  body: string | null;
  metricLine: string | null;
  whyItMatters: string | null;
  presetName: string | null;
  evidence: unknown;
  fix: VerdictFix | null;
  sources: unknown;
  createdAt: string;
  userState: VerdictUserState;
}

export interface VerdictFix {
  fix_id?: string;
  target?: { type?: string; name?: string };
  section?: { start_seconds?: number; end_seconds?: number } | null;
  dsp_chain?: VerdictDspOp[];
  sidechain?: unknown;
  expected_outcome?: string;
  ableton_hint?: unknown;
}

export interface VerdictDspOp {
  type: string;
  params: Record<string, unknown>;
}

export interface SpecialistStatus {
  slug: string;
  /** BFF returns only idle | cached | failed. The frontend overlays 'running'. */
  status: 'idle' | 'cached' | 'failed';
}

export interface RoutingPlanEntry {
  name: string;
  priority: number;
  focus: string;
}

/** Mirrors `aimusic_shared.verdicts.models.SpecialistRoutingPlan`. The Triage
 *  step produces this before any specialist runs. Cached alongside verdicts
 *  on `analysis_results.verdicts_payload.routing_plan`. */
export interface RoutingPlanDto {
  specialists_to_run: RoutingPlanEntry[];
  skip: string[];
  rationale: string;
  estimated_total_tokens: number;
}

/** Story 1.4 / FR16: worker-set when LLM verdict generation is unavailable
 *  (per-tier or global monthly budget exhausted, or provider-outage circuit
 *  breaker tripped). Drives the "rule-based findings only" banner + the
 *  offline coach copy (UX-DR17). Absent on a healthy report.
 *
 *  BFF wire uses `JsonSerializerDefaults.Web` (camelCase) for response
 *  records, so the field names here are camelCase. The enum string literals
 *  (`reason`) are passed through verbatim from the Python gateway.
 */
export type DegradationReason = 'tier_budget' | 'global_budget' | 'circuit_breaker';

export interface DegradationNoticeDto {
  reason: DegradationReason;
  detail: string | null;
  /** ISO-8601 UTC string. */
  occurredAt: string;
}

export interface VerdictsListResponse {
  verdicts: VerdictDto[];
  specialists: SpecialistStatus[];
  /** Present once a batch generation has run. Absent on jobs where only the
   *  piecewise `/run/{slug}` flow has fired or where Triage failed. */
  routing_plan?: RoutingPlanDto;
  /** Present iff the report is degraded — read this BEFORE rendering verdicts
   *  to show the banner + offline-coach copy. The verdicts list still has
   *  rule-engine fallback rows; render them as normal cards under the banner. */
  degradation?: DegradationNoticeDto;
}

export interface RunSpecialistResponse {
  status: 'queued' | 'exists';
}
