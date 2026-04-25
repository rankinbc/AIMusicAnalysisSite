// API response types matching the FastAPI backend's OpenAPI schema

export interface TokenResponse {
  access_token: string
  token_type: string
}

export interface User {
  id: string
  email: string
  created_at: string
}

export interface UploadResponse {
  job_id: string
  status: 'queued'
}

// SSE event payload emitted by /api/jobs/:jobId/stream
export interface JobProgressEvent {
  job_id: string
  phase: number
  phase_name: string
  pct: number         // 0.0–1.0 within current phase
  status: string      // 'PENDING' | 'PROCESSING' | 'COMPLETE' | 'FAILED'
  error?: string
}

export type MixGrade = 'A' | 'B' | 'C' | 'D' | 'F'

export interface PhaseResult {
  phase: number
  name: string
  status: 'ok' | 'failed' | 'skipped'
  data: Record<string, unknown>
  error: string | null
}

export interface FrequencyBand {
  name: string
  energy_db: number
}

export interface StreamingTarget {
  platform: string
  target_lufs: number
  your_lufs: number
  pass: boolean
}

export interface StemClashEntry {
  stems: string
  frequency_range: string
  severity: 'low' | 'medium' | 'high'
  eq_suggestion: string
}

export interface GenrePercentile {
  feature: string
  user_value: number
  genre_mean: number
  percentile: number
}

export interface ArrangementFix {
  section?: string
  issue: string
  fix: string
  priority: 'low' | 'medium' | 'high'
}

export interface PipelineResult {
  file_path: string
  phases: PhaseResult[]
  overall_score: number
  grade: MixGrade
  top_fixes: string[]
  // GAP-03/04: technical quality checks
  true_peak_db?: number | null
  peak_dbfs?: number | null
  clipping_detected?: boolean | null
  clipped_sample_count?: number | null
  // GAP-09: key detection
  detected_key?: string | null
  // GAP-10: mono compatibility
  mono_compatibility?: number | null
  // GAP-11: coach persona
  coach_name?: string | null
  coach_intro?: string | null
  coached_fixes?: string[] | null
  // GAP-13: danceability
  danceability_score?: number | null
  // GAP-06: sharing
  share_token?: string | null
}

export interface JobStatusResponse {
  job_id: string
  status: 'PENDING' | 'PROCESSING' | 'COMPLETE' | 'FAILED'
  current_phase: number
  phase_name: string
  phase_pct: number
}

export interface JobResultResponse {
  job_id: string
  result: PipelineResult
  share_token?: string
}

// GAP-07: history list
export interface JobSummary {
  job_id: string
  status: string
  filename: string
  created_at: string
  score: number | null
  grade: string | null
}

// GAP-12: track version history
export interface TrackVersionSummary {
  job_id: string
  filename: string
  score: number | null
  grade: string | null
  created_at: string
}

export interface TrackGroup {
  track_name: string
  version_count: number
  latest_score: number | null
  latest_grade: string | null
  versions: TrackVersionSummary[]
}

// --- Expert Analysis types ---

export interface TriageResult {
  /** Full formatted triage report text (markdown) */
  text: string
  /** Specialist names extracted from triage output, e.g. ["LowEnd", "Dynamics"] */
  recommended_specialists: string[]
}

export interface ExpertStreamChunk {
  text: string
}

export type SpecialistName =
  | 'LowEnd'
  | 'FrequencyBalance'
  | 'Dynamics'
  | 'StereoPhase'
  | 'Loudness'
  | 'Sections'
  | 'TranceArrangement'
  | 'StemReference'
  | 'HarmonicAnalysis'
  | 'ClarityAnalysis'
  | 'SpatialAnalysis'
  | 'SurroundCompatibility'
  | 'PlaybackOptimization'
  | 'OverallScore'
  | 'GainStagingAudit'
  | 'StereoFieldAudit'
  | 'FrequencyCollisionDetection'
  | 'DynamicsHumanizationReport'
  | 'SectionContrastAnalysis'
  | 'DensityBusynessReport'
  | 'ChordHarmonyAnalysis'
  | 'DeviceChainAnalysis'
  | 'PriorityProblemSummary'

export const SPECIALIST_LABELS: Record<SpecialistName, string> = {
  LowEnd: 'Low End',
  FrequencyBalance: 'Frequency Balance',
  Dynamics: 'Dynamics',
  StereoPhase: 'Stereo & Phase',
  Loudness: 'Loudness',
  Sections: 'Sections',
  TranceArrangement: 'Trance Arrangement',
  StemReference: 'Stem Reference',
  HarmonicAnalysis: 'Harmonic & Key',
  ClarityAnalysis: 'Clarity',
  SpatialAnalysis: 'Spatial',
  SurroundCompatibility: 'Surround Compat.',
  PlaybackOptimization: 'Playback',
  OverallScore: 'Overall Score',
  GainStagingAudit: 'Gain Staging',
  StereoFieldAudit: 'Stereo Field',
  FrequencyCollisionDetection: 'Freq. Collisions',
  DynamicsHumanizationReport: 'Dynamics Humaniz.',
  SectionContrastAnalysis: 'Section Contrast',
  DensityBusynessReport: 'Density & Busyness',
  ChordHarmonyAnalysis: 'Chord Harmony',
  DeviceChainAnalysis: 'Device Chain',
  PriorityProblemSummary: 'Priority Summary',
}
