// Hand-mirrored from components/bff/src/Spectr.Bff/DTOs/*.cs.
// Until orval codegen is wired against a running BFF, these are the source
// of truth for the frontend's view of the API. Keep them in sync.

export interface AuthedUser {
  id: string;
  email: string;
  handle: string | null;
  displayName: string | null;
  /** Story 2.1 — derived from subscriptions.status ∈ {active, trialing}.
   *  "free" until the user subscribes; "pro" once a webhook delivers an
   *  active or trialing subscription. Story 2.4 will widen this to a
   *  richer Entitlements.For(user) shape. */
  tier: 'free' | 'pro';
}

/** Story 2.1 — POST /api/billing/checkout/subscription request body. */
export interface CreateCheckoutSessionRequest {
  cadence: 'monthly' | 'annual';
}

/** Story 2.1 — POST /api/billing/checkout/subscription success response. */
export interface CreateCheckoutSessionResponse {
  url: string;
  sessionId: string;
}

/** Story 2.1 — GET /api/billing/plans display values (integer cents).
 *  Story 2.3 — adds credit-pack cents so the BuyCreditsCard renders
 *  prices via formatCents (AR39 no-literals lint). */
export interface PlansResponse {
  proMonthlyCents: number;
  proAnnualCents: number;
  creditPack5Cents: number;
  creditPack10Cents: number;
  currency: string;
}

/** Story 2.2 — GET /api/billing/me summary for the Billing page. */
export interface BillingSummaryResponse {
  tier: 'free' | 'pro';
  status: string | null;
  cadence: 'monthly' | 'annual' | 'unknown' | null;
  priceId: string | null;
  currentPeriodEnd: string | null;
  cancelAt: string | null;
  cancelAtPeriodEnd: boolean;
  nextChargeAt: string | null;
  nextChargeCents: number | null;
  currency: string | null;
  /** Story 2.9 — Stripe retry date (ISO) for an open dunning cycle;
   *  non-null only when status === 'past_due'. Drives the amber
   *  DunningBanner "retrying {day}" copy (UX-DR33). */
  retryAt: string | null;
}

/** Story 2.2 — POST /api/billing/cancel optional reason. */
export interface CancelSubscriptionRequest {
  reason?: string | null;
}

/** Story 2.2 — POST /api/billing/change-cadence. */
export interface ChangeCadenceRequest {
  cadence: 'monthly' | 'annual';
}

/** Story 2.2 — POST /api/billing/portal — Customer Portal session URL. */
export interface CreatePortalSessionResponse {
  url: string;
}

// ── Story 2.3 — credit packs + ledger ──────────────────────────────

/** POST /api/billing/checkout/credits — pack size must be 5 or 10. */
export interface BuyCreditsRequest {
  packSize: 5 | 10;
}

/** Single row of the user's credit ledger. Amount is signed:
 *  +N (purchase), -1 (spend), +1 (reversal), arbitrary (adjustment). */
export interface CreditLedgerEntryDto {
  id: string;
  amount: number;
  reason: 'purchase' | 'spend' | 'reversal' | 'adjustment' | string;
  reference: string | null;
  createdAt: string;
}

/** GET /api/billing/credits — balance + most recent N entries.
 *  nextCursor is the ISO-8601 createdAt of the last returned row when
 *  more pages exist; null when the response is exhaustive. */
export interface CreditsResponse {
  balance: number;
  entries: CreditLedgerEntryDto[];
  nextCursor: string | null;
}

// ── Story 2.4 — entitlement snapshot ───────────────────────────────

/** GET /api/me/entitlements — caller's current entitlement snapshot.
 *  null means unlimited (pro tier). Cached 60 s server-side;
 *  staleTime 30 s on the client. AR12, AR15, AR38. */
export interface EntitlementsDto {
  analysesRemaining: number | null;
  coachRemaining: number;
  stemsEnabled: boolean;
  alsEnabled: boolean;
  fullVerdictsEnabled: boolean;
  historyDepth: number | null;
  tier: 'free' | 'credits' | 'pro';
  /** Story 2.7 — period allotment + consumption for the UpgradeSheet header
   *  ("{used} of {limit} used this month"). analysesLimit is null when
   *  unlimited (pro/credits). */
  analysesLimit: number | null;
  analysesUsed: number;
  /** Story 2.8 — coach pool snapshot for the usage page (UX-DR31/UX-DR32).
   *  Reuses CoachCapsDto (scope ∈ analysis|month|unlimited). Optional: older
   *  payloads omit it. */
  coach?: CoachCapsDto | null;
  /** Story 2.8 — first-of-next-month UTC the free analyses allowance resets;
   *  null when analyses are unlimited (pro/credits). */
  analysesResetsAt?: string | null;
}

/** Story 2.8 — GET /api/me/honest-math. The 90-day "credits vs Pro"
 *  comparison behind the dismissible HonestMathBanner (UX-DR32). `qualifies`
 *  is the single server-computed flag the banner keys off. Cents from config
 *  (AR39). */
export interface HonestMathDto {
  qualifies: boolean;
  creditsSpentCents: number;
  proEquivalentCents: number;
  periodDays: number;
  currency: string;
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
  alsFilePath: string | null;
  referencePath: string | null;
}

export type VersionFileType = 'mix' | 'als' | 'stem' | 'reference';

export interface VersionFileEntry {
  type: VersionFileType;
  filename: string;
  sizeBytes: number | null;
  available: boolean;
  stemId: string | null;
}

export interface VersionFilesResponse {
  versionId: string;
  files: VersionFileEntry[];
}

export interface AnalysisSummaryDto {
  id: string;
  jobId: string;
  createdAt: string;
  grade: string | null;
  score: number | null;
}

export interface TagDto {
  id: string;
  name: string;
  isPublic: boolean;
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
  tags: TagDto[];
  // ── New song metadata (see PRPs/design_handoffs/new-song-creation-backend-requirements.md).
  // All nullable for back-compat; absent visual falls back to hueFromId Aurora in CoverArt.
  description?: string | null;
  visualTemplate?: SongVisualTemplate | null;
  visualPrimary?: string | null; // serialized oklch, e.g. "oklch(0.72 0.19 352)"
  visualSecondary?: string | null;
  referenceProfileKind?: ReferenceProfileKind | null;
  referenceProfileId?: string | null;
}

export interface CreateSongRequest {
  name: string;
  genreHint?: string | null;
  description?: string | null;
  visualTemplate?: SongVisualTemplate | null;
  visualPrimary?: string | null;
  visualSecondary?: string | null;
  referenceProfileKind?: ReferenceProfileKind | null;
  referenceProfileId?: string | null;
}

export interface PatchSongRequest {
  name?: string | null;
  genreHint?: string | null;
  description?: string | null;
  visualTemplate?: SongVisualTemplate | null;
  visualPrimary?: string | null;
  visualSecondary?: string | null;
  referenceProfileKind?: ReferenceProfileKind | null;
  referenceProfileId?: string | null;
}

// ── Song cover-art visual ─────────────────────────────────────────────────────
export type SongVisualTemplate =
  | 'aurora'
  | 'vinyl'
  | 'spin'
  | 'eq'
  | 'skyline'
  | 'robot'
  | 'booth'
  | 'cassette'
  | 'boombox';

/** A cover color as an OKLCH triple — lets the palette carry vivid AND dark tones. */
export interface SongVisualColor {
  l: number;
  c: number;
  h: number;
}

/** The chosen, persisted cover-art visual for a song. */
export interface SongVisual {
  template: SongVisualTemplate;
  primary: SongVisualColor;
  secondary: SongVisualColor;
}

// ── Song reference profile (default analysis comparison target) ───────────────
export type ReferenceProfileKind = 'set' | 'preset';

/** A song's default reference comparison: a user reference set, or a genre preset. */
export interface SongReferenceProfile {
  kind: ReferenceProfileKind;
  id: string;
  name: string;
  hue: number;
}

export interface CreateTagRequest {
  name: string;
  isPublic: boolean;
}

export interface ReportListItemDto {
  jobId: string;
  versionId: string | null;
  versionNumber: number | null;
  versionLabel: string | null;
  songId: string | null;
  songName: string | null;
  genreHint: string | null;
  status: string;
  grade: string | null;
  score: number | null;
  tags: TagDto[];
  dispatchedAt: string;
  completedAt: string | null;
}

export interface ReportListResponse {
  items: ReportListItemDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ReportsFilter {
  songName?: string;
  tags?: string;
  genreHint?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

export interface UploadResponse {
  songId: string;
  versionId: string;
  // null when the upload deferred analysis (unified-upload sends analyze=false
  // on the mix, then dispatches a single job downstream).
  jobId: string | null;
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

// POST /api/reports/{jobId}/phases/{phase}/rerun — id of the lightweight re-run
// job to poll; the re-run updates the existing report in place.
export interface RerunPhaseResponse {
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
  // null when the .als was attached with analyze=false (unified-upload flow).
  reanalysisJobId: string | null;
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

// ── Bulk stem upload (drag-drop + audio-content auto-classification) ──
export interface StemRawDto {
  id: string;
  originalFilename: string;
  detectedRole: StemRole | null;
  confidence: number;
  evidence: string | null;
  confirmedRole: StemRole | null;
}

export interface StageStemsResponse {
  versionId: string;
  stems: StemRawDto[];
}

export interface StemProposalsResponse {
  versionId: string;
  classified: boolean;
  stems: StemRawDto[];
}

export interface ConfirmStemItem {
  id: string;
  confirmedRole: StemRole;
}

export interface ConfirmStemsRequest {
  stems: ConfirmStemItem[];
  mode: 'grouped' | 'per_stem';
}

export interface ConfirmStemsResponse {
  versionId: string;
  reanalysisJobId: string;
}

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
  setIds: string[];
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

// ── .als project awareness ─────────────────────────────────────────────────
// The client parses a dropped .als into this map and POSTs it with the upload;
// the BFF stores it verbatim and returns it on the results DTO. Mirrors the
// producer type in features/upload/alsPreview.ts (AlsProjectJson). Kept here so
// the api layer owns its own wire contract.
export interface AlsProjectTrack {
  index: number;
  name: string;
  type: 'audio' | 'midi';
  color: number | null;
  devices: string[];
}

export interface AlsProjectJson {
  schemaVersion: number;
  source: string;
  tempo: number | null;
  timeSignature: string;
  timeSignatureNumerator: number;
  timeSignatureDenominator: number;
  abletonVersion: string | null;
  trackCount: number;
  tracks: AlsProjectTrack[];
  devices: string[];
  plugins: string[];
}

export interface JobResultsDto {
  jobId: string;
  analysisId: string;
  versionId: string | null;
  songId: string | null;
  songName: string | null;
  finalJson: unknown;
  shareToken: string | null;
  // Stored client-parsed Ableton project map ("project awareness"), surfaced for
  // the results Project view. Null when no .als project JSON was uploaded.
  alsProject?: AlsProjectJson | null;
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
  /** UI state for the arrangement score:
   *  - `pending`     — structure detection (allin1) is running in the background;
   *  - `unavailable` — the detector isn't set up (Docker/image missing);
   *  - `scored`      — a real arrangement score is present.
   *  Absent on older analyses. */
  arrangement_status?: 'pending' | 'unavailable' | 'scored';
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

/** Phase 9 — Mix Translation. All scores are 0..100 (analyzer scale, NOT 0..1).
 *  Every field optional: the phase can fail or skip. */
export interface Phase9Spatial {
  height_score?: number;
  depth_score?: number;
  width_consistency?: number;
  analysis?: string[];
}

export interface Phase9Surround {
  mono_compatibility?: number;
  phase_score?: number;
  is_atmos_ready?: boolean;
  analysis?: string[];
}

export interface Phase9Playback {
  headphone_score?: number;
  speaker_score?: number;
  crossfeed_safe?: boolean;
  bass_translation?: 'good' | 'weak' | 'excessive' | string;
  analysis?: string[];
}

export interface Phase9Data {
  spatial?: Phase9Spatial;
  surround?: Phase9Surround;
  playback?: Phase9Playback;
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

// ─── Coach conversations (story 1.5) ────────────────────────────────────
//
// Wire shapes for POST /api/coach/{analysisId}/messages and
// GET /api/coach/{analysisId}/conversation. Persisted-message + poll path
// (streaming relay = story 1.6; chat UI = story 1.8). The existing
// CoachChat.tsx still hits the legacy /api/coach/{jobId}/chat SSE endpoint
// until 1.8 swaps over.

export type CoachMessageRole = 'user' | 'assistant';

export type CoachMessageStatus = 'pending' | 'complete' | 'refused' | 'error';

export interface CoachEvidenceDto {
  label: string;
  path: string;
}

export interface CoachMessageDto {
  id: string;
  role: CoachMessageRole;
  status: CoachMessageStatus;
  content: string;
  /** Null on user rows; present (possibly empty) on assistant rows that
   *  reached the parse phase. Chips with unresolvable paths are dropped
   *  server-side per AR10. */
  evidence: CoachEvidenceDto[] | null;
  /** Stable refusal reason string from the prompt or the gateway:
   *  "missing_data" | "out_of_scope" | "injection_attempt" | "coach_offline". */
  refusalReason: string | null;
  /** ISO-8601 UTC. */
  createdAt: string;
  /** ISO-8601 UTC; null while status === 'pending'. */
  completedAt: string | null;
}

/** Story 1.9 / UX-DR16 — per-analysis follow-up cap state. `capReached` is
 *  server-computed (single source of truth — if the formula changes in
 *  story 2.6 the frontend won't disagree). The free-tier specialization of
 *  the UX-DR16 grammar `{used} of {limit} follow-ups · this analysis` is
 *  rendered by `CoachCapChip`; story 2.6 will widen this shape with `tier`
 *  + `resetsAt` for the Pro-per-month form. */
export interface CoachCapsDto {
  used: number;
  limit: number;
  capReached: boolean;
  /** Story 2.6/2.8 — UX-DR16 grammar selector. "analysis" = free per-analysis,
   *  "month" = pro pooled monthly, "unlimited" = credits. Optional: older
   *  payloads (and unit fixtures) may omit it. */
  scope?: 'analysis' | 'month' | 'unlimited';
  /** ISO-8601 UTC instant the pooled allowance resets; null for the
   *  per-analysis and unlimited scopes. */
  resetsAt?: string | null;
}

export interface CoachConversationDto {
  /** Guid.Empty (`"00000000-0000-0000-0000-000000000000"`) when no
   *  conversation exists yet — the UI may poll before the user posts. */
  conversationId: string;
  analysisId: string;
  messages: CoachMessageDto[];
  /** Story 1.9 — added on first paint so the chip + gate state render
   *  without a second roundtrip. */
  caps: CoachCapsDto;
}

export interface CreateCoachMessageRequest {
  content: string;
}

export interface CreateCoachMessageResponse {
  conversationId: string;
  userMessageId: string;
  pendingAssistantMessageId: string;
  /** Story 1.9 — post-POST cap snapshot lets the frontend flip to
   *  `CoachGateInline` in the same render tick that streaming starts. */
  caps: CoachCapsDto;
}

// ── Story 1.6 / AR9 / AR44 — SSE coach stream wire types ──────────────────
// The SSE endpoint at GET /api/coach/{analysisId}/messages/{messageId}/stream
// emits frames whose `data:` field is a single-line JSON object matching one
// of the four payload shapes below. `event:` field carries the type name.
// The chat UI (story 1.8) will consume these via an EventSource hook;
// story 1.6 ships only the wire types so 1.8 has a stable contract to code
// against.

export type CoachStreamEventType = 'token' | 'done' | 'refusal' | 'error';

/** Prose delta — append to the in-flight assistant body. Newline characters
 *  inside `text` are SSE-escaped (`\n`) on the wire by the BFF and decoded
 *  by the consumer before append. */
export interface CoachStreamTokenPayload {
  text: string;
}

/** Terminal frame for an answer. Closes the stream cleanly. */
export interface CoachStreamDonePayload {
  evidence: CoachEvidenceDto[];
}

/** Terminal frame for a refusal. The `body` text is also persisted on the
 *  row (status="refused") — consumers should prefer this frame over a
 *  subsequent poll if both arrive. */
export interface CoachStreamRefusalPayload {
  reason: string;
  body: string;
}

/** Terminal frame for an error. `code` matches AR38 machine-code vocabulary:
 *  "coach_offline" | "coach_error" | "coach_parse_failed" | "coach_stream_idle".
 *  Frontend keys off `code`, not `message`. */
export interface CoachStreamErrorPayload {
  code: string;
  message: string;
}
