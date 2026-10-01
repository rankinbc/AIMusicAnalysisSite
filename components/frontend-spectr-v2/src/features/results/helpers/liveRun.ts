/* The live analysis page's step list — a pure map from what the job poll
 * (JobStatusDto + its `partial`) and, once complete, the final result say,
 * to one row per pipeline step: waiting → running → ✓ with its measured
 * values and how long it took.
 *
 * The same derivation serves the running job (partial results only) and the
 * finished report (final_json), so the page never swaps layouts at the
 * hand-off — values only fill in. */
import type {
  FinalJson,
  JobPartial,
  JobStatusDto,
  Phase1Data,
  PhaseResult,
} from '../../../api/types';
import { PHASE_SHORT, derivePhaseRows, type PhaseRow } from './analysisModalData';

/** Pipeline run order (audio_analysis.pipeline.PHASE_DEFS, then the .als
 *  phase 8 last). */
export const RUN_ORDER = [1, 2, 3, 4, 5, 6, 7, 9, 8] as const;

/** Pipeline display names (pipeline._PHASE_NAMES + "ALS Analysis") → phase,
 *  for jobs whose worker predates `partial.running`. */
const NAME_TO_PHASE: Record<string, number> = {
  'Universal Mix Analysis': 1,
  'Genre Detection': 2,
  'Genre-Specific Scoring': 3,
  'Stem Separation & Clash': 4,
  'Reference Comparison': 5,
  'Gap Analysis': 6,
  'Arrangement Advice': 7,
  'Mix Translation': 9,
  'ALS Analysis': 8,
};

export type StepState =
  | 'waiting'
  | 'running'
  | 'done'
  | 'failed'
  | 'skipped'
  /** Done, but background work for it is still in flight (phase-7 structure). */
  | 'background'
  /** Done; its background work settled without a result. */
  | 'unavailable';

export interface LiveStep {
  phase: number;
  short: string;
  state: StepState;
  /** Wall time the step took (done/failed steps). */
  seconds?: number | undefined;
  /** When the running step started (epoch ms), for its live clock. */
  startedAtMs?: number | undefined;
  /** The measured result, once the step has landed. */
  row?: PhaseRow | undefined;
}

/** What the page knows up front about the inputs; `undefined` = unknown. */
export interface LiveInputs {
  hasReference?: boolean | undefined;
  hasAls?: boolean | undefined;
  hasStems?: boolean | undefined;
}

/** The "Song · stems · 2/4 inputs" summary from what the version carries
 *  (the live page has no final_json to read the inputs from yet). */
export function liveInputsSummary(inputs: LiveInputs): { present: string[]; used: number } {
  const present = ['Song'];
  if (inputs.hasStems) present.push('stems');
  if (inputs.hasAls) present.push('Ableton project');
  if (inputs.hasReference) present.push('reference');
  return { present, used: present.length };
}

export type RunStatus = 'queued' | 'analyzing' | 'complete';

export function runStatus(job: Pick<JobStatusDto, 'status'> | undefined, fj?: FinalJson): RunStatus {
  if (fj || job?.status === 'complete') return 'complete';
  if (job?.status === 'processing') return 'analyzing';
  return 'queued';
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

/** The partial results as a FinalJson-shaped object, so every downstream
 *  helper (derivePhaseRows, the coach) reads one shape. Phase 1's early
 *  sub-results are NOT folded in here — see {@link phase1Values}. */
export function partialFinalJson(partial: JobPartial | null | undefined): FinalJson {
  const phases: PhaseResult[] = [];
  for (const [key, p] of Object.entries(partial?.phases ?? {})) {
    const phase = Number(key);
    if (!Number.isInteger(phase) || !p || typeof p !== 'object') continue;
    phases.push({
      phase,
      name: p.name ?? '',
      status: p.status ?? 'ok',
      error: p.error ?? null,
      data: isObj(p.data) ? p.data : {},
      ...(isNum(p.seconds) ? { duration_s: p.seconds } : {}),
    });
  }
  return { phases };
}

/** The best FinalJson available: the finished result, else the partials. */
export function liveFinalJson(job: JobStatusDto | undefined, fj: FinalJson | undefined): FinalJson {
  return fj ?? partialFinalJson(job?.partial);
}

/** Phase-1 measurements as far as they're known: the finished phase's data,
 *  else the early sub-results the worker streams while phase 1 runs. */
export function phase1Values(fj: FinalJson, partial: JobPartial | null | undefined): Phase1Data | undefined {
  const done = fj.phases?.find((p) => p.phase === 1);
  if (done && done.status !== 'failed' && isObj(done.data)) return done.data as Phase1Data;
  const early = partial?.early?.['1'];
  return isObj(early) && Object.keys(early).length ? (early as Phase1Data) : undefined;
}

/** The phase the worker is in right now (null when not running / unknown). */
export function runningPhase(job: JobStatusDto | undefined): number | null {
  if (!job || job.status !== 'processing') return null;
  const done = job.partial?.phases ?? {};
  const r = job.partial?.running;
  if (r && isNum(r.phase) && !(String(r.phase) in done)) return r.phase;
  const byName = NAME_TO_PHASE[job.currentPhase];
  if (byName !== undefined && !(String(byName) in done)) return byName;
  // Between phases (the previous one landed, the next not yet reported).
  const next = RUN_ORDER.find((n) => !(String(n) in done));
  return next ?? null;
}

function runningStartedAt(job: JobStatusDto | undefined, phase: number): number | undefined {
  const r = job?.partial?.running;
  if (!r || r.phase !== phase || !r.started_at) return undefined;
  const t = Date.parse(r.started_at);
  return Number.isFinite(t) ? t : undefined;
}

function secondsOf(fj: FinalJson, job: JobStatusDto | undefined, phase: number): number | undefined {
  const p = fj.phases?.find((x) => x.phase === phase);
  if (isNum(p?.duration_s)) return p.duration_s;
  const d = fj.phase_durations?.[String(phase)];
  if (isNum(d)) return d;
  const s = job?.partial?.phases?.[String(phase)]?.seconds;
  return isNum(s) ? s : undefined;
}

function stateOf(row: PhaseRow): StepState {
  if (row.status === 'skipped') return 'skipped';
  if (row.status === 'failed') return 'failed';
  if (row.pending) return 'background';
  if (row.unavailable) return 'unavailable';
  return 'done';
}

/** A step the inputs already rule out, shown muted from the start. */
function predictedSkip(phase: number, inputs: LiveInputs): PhaseRow | null {
  if (phase === 5 && inputs.hasReference === false) {
    return { phase, short: PHASE_SHORT[5]!, status: 'skipped', detail: 'No reference attached', kv: [], clashes: [] };
  }
  if (phase === 8 && inputs.hasAls === false) {
    return { phase, short: PHASE_SHORT[8]!, status: 'skipped', detail: 'No Ableton project', kv: [], clashes: [] };
  }
  return null;
}

/** The running step's values that are already in (phase 1's early LUFS /
 *  peak / tempo / key), so they fill in before the step finishes. */
function earlyRow(partial: JobPartial | null | undefined, phase: number): PhaseRow | undefined {
  const early = partial?.early?.[String(phase)];
  if (!isObj(early) || !Object.keys(early).length) return undefined;
  const row = derivePhaseRows({ phases: [{ phase, name: '', status: 'ok', data: early }] })[0];
  if (!row) return undefined;
  // Unknown values render as "—" (or a default "none" for clipping) — leave
  // them out until they're actually measured.
  const known = (kv: { k: string; v: string }) =>
    !kv.v.includes('—') && !(kv.k === 'Clipping' && !('clipping_detected' in early));
  return { ...row, kv: row.kv.filter(known) };
}

export interface LiveStepsInput {
  job: JobStatusDto | undefined;
  /** The finished result (complete jobs). */
  fj?: FinalJson | undefined;
  inputs?: LiveInputs | undefined;
}

/** One row per pipeline step, ran/running/waiting steps in run order and
 *  skipped ones last (matching the finished report's layout). */
export function buildLiveSteps({ job, fj, inputs = {} }: LiveStepsInput): LiveStep[] {
  const source = liveFinalJson(job, fj);
  const rows = new Map(derivePhaseRows(source).map((r) => [r.phase, r]));
  const complete = runStatus(job, fj) === 'complete';
  const running = runningPhase(job);
  const steps: LiveStep[] = [];
  for (const phase of RUN_ORDER) {
    const row = rows.get(phase);
    if (row) {
      steps.push({ phase, short: row.short, state: stateOf(row), seconds: secondsOf(source, job, phase), row });
      continue;
    }
    const skip = predictedSkip(phase, inputs);
    if (skip) {
      steps.push({ phase, short: skip.short, state: 'skipped', row: skip });
      continue;
    }
    // A finished result without this phase (older pipeline) — leave it out.
    if (complete && fj) continue;
    const isRunning = phase === running;
    steps.push({
      phase,
      short: PHASE_SHORT[phase] ?? `Phase ${phase}`,
      state: isRunning ? 'running' : 'waiting',
      startedAtMs: isRunning ? runningStartedAt(job, phase) : undefined,
      row: isRunning ? earlyRow(job?.partial, phase) : undefined,
    });
  }
  return [...steps.filter((s) => s.state !== 'skipped'), ...steps.filter((s) => s.state === 'skipped')];
}

/** "54.4s" / "3.2s" / "1m 05s" — '<0.1s' for real sub-50 ms phases (the
 *  pipeline rounds wall time to 0.01 s, so fast phases store 0.0–0.04, which
 *  would otherwise read as "0.0s") — '' when unknown. */
export function fmtSeconds(sec: number | undefined): string {
  if (!isNum(sec) || sec < 0) return '';
  if (sec < 0.05) return '<0.1s';
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  return `${m}m ${String(Math.round(sec % 60)).padStart(2, '0')}s`;
}

/** Live clock for the running step: "12s" / "1m 05s". */
export function fmtElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`;
}
