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

export interface VerdictsListResponse {
  verdicts: VerdictDto[];
  specialists: SpecialistStatus[];
}

export interface RunSpecialistResponse {
  status: 'queued' | 'exists';
}
