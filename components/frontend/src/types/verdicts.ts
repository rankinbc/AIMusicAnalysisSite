// Hand-mirrored from components/shared/aimusic_shared/verdicts/models.py.
// Keep in sync with the Pydantic models.

export type Severity = "critical" | "severe" | "moderate" | "minor" | "win";

export type Category =
  | "low_end"
  | "frequency_balance"
  | "dynamics"
  | "stereo_phase"
  | "loudness"
  | "sections"
  | "trance_arrangement"
  | "stem_reference"
  | "harmonic"
  | "clarity"
  | "spatial"
  | "surround"
  | "playback"
  | "overall"
  | "gain_staging"
  | "stereo_field"
  | "frequency_collision"
  | "humanization"
  | "section_contrast"
  | "density"
  | "chord_harmony"
  | "device_chain"
  | "priority_summary"
  | "clipping"
  | "mono_compatibility";

export type DspType =
  | "peaking_eq"
  | "low_shelf"
  | "high_shelf"
  | "high_pass"
  | "low_pass"
  | "compressor"
  | "multiband_compressor"
  | "limiter"
  | "gain"
  | "stereo_width"
  | "sidechain";

export type FeedbackKind = "helpful" | "wrong" | "unclear";

export interface Evidence {
  metric: string;
  value: number | null;
  expected_range: [number, number] | null;
  delta_pct: number | null;
  label: string;
  frequency_range_hz: [number, number] | null;
  stems: string[] | null;
}

export interface DspOp {
  type: DspType;
  params: Record<string, unknown>;
}

export interface FixTarget {
  type: "stem" | "master" | "bus";
  name: string;
}

export interface FixSection {
  start_seconds: number;
  end_seconds: number;
  section_type?: string | null;
}

export interface SidechainSpec {
  source_stem: string;
  depth_db: number;
  release_ms: number;
}

export interface AbletonHint {
  device?: string;
  band?: number;
  preset_name?: string;
  [key: string]: unknown;
}

export interface Fix {
  fix_id: string;
  target: FixTarget;
  section: FixSection | null;
  dsp_chain: DspOp[];
  sidechain: SidechainSpec | null;
  expected_outcome: string;
  ableton_hint: AbletonHint | null;
}

export interface UserState {
  dismissed: boolean;
  applied: boolean;
  user_modified_fix: Record<string, unknown> | null;
  feedback: FeedbackKind | null;
}

export interface Verdict {
  verdict_id: string;
  track_id: string;
  specialist: string;
  prompt_version: string;
  model: string;
  severity: Severity;
  category: Category;
  confidence: number;
  priority_score: number;
  headline: string;
  summary: string;
  evidence: Evidence[];
  fix: Fix | null;
  why_it_matters: string;
  related_verdict_ids: string[];
  sources: string[];
  user_state: UserState;
  created_at: string; // ISO-8601
}

export interface SpecialistRoutingPlanEntry {
  name: string;
  priority: number;
  focus: string;
}

export interface SpecialistRoutingPlan {
  specialists_to_run: SpecialistRoutingPlanEntry[];
  skip: string[];
  rationale: string;
  estimated_total_tokens: number;
}

export interface VerdictsPayload {
  verdicts: Verdict[];
}
