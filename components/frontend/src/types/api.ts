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
}
