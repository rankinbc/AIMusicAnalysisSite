import { useEffect, useState } from 'react';

import { useWorkerHealth } from '../../api/hooks';
import type { JobStatusDto } from '../../api/types';
import {
  BASE_PHASES,
  PHASE_EXPLAINERS,
  PHASE_SEQUENCE,
  buildProgressPlan,
} from './progress-phases';
import type { ProgressPlanInputs, ProgressRow } from './progress-phases';
import s from './ProgressStoryline.module.css';

// Story 12.2 (AC3) — per-phase progress storyline for the results page.
// Replaces the bare status-line + <progress> so a stuck job LOOKS different
// from a healthy one: named phases with the current one highlighted, elapsed
// time, and escalating hints keyed on real signals (worker heartbeat via the
// shared useWorkerHealth poll; wall-clock thresholds as the softer fallback).
// BASE_PHASES + PHASE_EXPLAINERS live in ./progress-phases (6.3 shares them).

// Lifecycle markers the worker writes outside the numbered phases — these are
// job states, not phases, so they never render as an appended phase row.
const SENTINELS = new Set(['', 'queued', 'starting', 'complete', 'failed']);

// Worker phase names that are the same step as a base row under another name —
// structure_actor writes "Arrangement" while running arrangement advice.
// Without the alias it would render as a duplicate row under the base one.
const PHASE_ALIASES: Record<string, string> = {
  Arrangement: 'Arrangement Advice',
};

// Soft "taking longer than usual" thresholds — deliberately constants, not
// config: they only tune a hint, and a wrong value is a copy nit, not a bug.
const SLOW_ELAPSED_MS = 10 * 60 * 1000; // any status, 10 min total
const SLOW_PENDING_MS = 2 * 60 * 1000; // still queued after 2 min

// Task G0 default: no optional input supplied — mix-only.
const DEFAULT_INPUTS: ProgressPlanInputs = {
  hasStems: false,
  hasReference: false,
  hasAls: false,
};

export interface ProgressStorylineViewProps {
  status: string;
  currentPhase: string;
  phasePct: number;
  elapsedMs: number;
  /** True on a definitive offline reading (healthy === false) OR when the
   *  health probe itself errors — an unreachable BFF/Redis must not read as
   *  "everything fine" on the page whose whole job is failure visibility. */
  workerOffline: boolean;
  /** Task G0 — which optional inputs (stems / reference / .als) were
   *  supplied. Drives which checklist rows show as "Not included" instead of
   *  pretending an analysis is running. Default: mix-only (all false). */
  inputs?: ProgressPlanInputs;
  /** Task G0 — true while the caller doesn't know `inputs` yet (e.g. the
   *  signed-in route's version query hasn't resolved). Renders the optional
   *  rows in a NEUTRAL state instead of guessing "Not included", so a
   *  supplied input never flashes the wrong verdict. */
  inputsLoading?: boolean;
}

type RowState = 'done' | 'current' | 'todo' | 'not-included' | 'neutral';

interface DisplayRow {
  key: string;
  label: string;
  state: RowState;
  benefit?: string;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Presentational core — static-render testable without providers or timers.
export function ProgressStorylineView({
  status,
  currentPhase,
  phasePct,
  elapsedMs,
  workerOffline,
  inputs,
  inputsLoading = false,
}: ProgressStorylineViewProps) {
  const pct = Math.max(0, Math.min(1, phasePct));
  const phase = PHASE_ALIASES[currentPhase] ?? currentPhase;
  // Task G0: matching now runs against the full worker phase sequence (the 7
  // base phases + the conditional ALS phase), not just BASE_PHASES — the ALS
  // phase is a real plan row now (phaseIndex 7), not an appended unknown one.
  const knownIdx = (PHASE_SEQUENCE as readonly string[]).indexOf(phase);
  const isSentinel = SENTINELS.has(phase);
  const isUnknownPhase = knownIdx === -1 && !isSentinel;
  // Hints and the ticking clock only make sense while the job is actually
  // running — a completed job briefly passes through here while the report
  // payload loads, and must not show "taking longer than usual".
  const active = status === 'pending' || status === 'processing';

  const plan: ProgressRow[] = buildProgressPlan(inputs ?? DEFAULT_INPUTS);
  const runsPhaseIndexes = plan
    .filter((row) => row.kind === 'runs' && row.phaseIndex !== undefined)
    .map((row) => row.phaseIndex as number);
  const maxKnownPhaseIndex = runsPhaseIndexes.length > 0 ? Math.max(...runsPhaseIndexes) : -1;

  const rows: DisplayRow[] = plan.map((row) => {
    if (row.kind === 'not-included') {
      // While the caller doesn't know the real inputs yet, never guess
      // "Not included" — render plain/neutral instead (never flashes wrong).
      if (inputsLoading) return { key: row.key, label: row.label, state: 'neutral' };
      return {
        key: row.key,
        label: row.label,
        state: 'not-included',
        ...(row.benefit !== undefined ? { benefit: row.benefit } : {}),
      };
    }
    const idx = row.phaseIndex as number;
    let rowState: RowState;
    if (status === 'complete') {
      rowState = 'done';
    } else if (knownIdx >= 0) {
      rowState = idx < knownIdx ? 'done' : idx === knownIdx ? 'current' : 'todo';
    } else if (isUnknownPhase) {
      // Unknown/extra phase in flight (a worker phase name not in the plan,
      // e.g. "Mix Translation"): known rows are checked off by overall
      // progress — the only signal left. Denominator assumes one extra phase
      // beyond the plan's known slots.
      rowState = pct >= (idx + 1) / (maxKnownPhaseIndex + 2) ? 'done' : 'todo';
    } else {
      rowState = 'todo';
    }
    return { key: row.key, label: row.label, state: rowState };
  });
  if (isUnknownPhase) {
    rows.push({ key: `unknown:${phase}`, label: phase, state: 'current' });
  }

  const slow =
    active &&
    (elapsedMs > SLOW_ELAPSED_MS ||
      (status === 'pending' && elapsedMs > SLOW_PENDING_MS));

  return (
    <div className={s.panel}>
      <div className={s.headerRow}>
        <p className={`mono ${s.statusLine}`}>
          Status: {status}
          {status === 'pending' ? ' · waiting for the analysis worker' : ''}
        </p>
        <span className={`mono ${s.elapsed}`} aria-label="Elapsed time">
          {formatElapsed(elapsedMs)}
        </span>
      </div>

      <ol className={s.phases} aria-label="Analysis phases">
        {rows.map((row) => {
          // Task G0 — an analysis that wasn't supplied is greyed + struck
          // through with a real "Not included" tag + benefit copy. It never
          // shows the active/done/failed marks, whatever currentPhase is.
          if (row.state === 'not-included') {
            return (
              <li key={row.key} className={`${s.phase} ${s.phaseNotIncluded}`} aria-disabled="true">
                <span className={s.phaseMark} aria-hidden="true">
                  –
                </span>
                <span className={s.phaseNotIncludedBody}>
                  <span>
                    <span className={s.phaseLabelStruck}>{row.label}</span>{' '}
                    <span className="pill">Not included</span>
                  </span>
                  {row.benefit && <span className={s.phaseBenefit}>{row.benefit}</span>}
                </span>
              </li>
            );
          }
          // Neutral: the caller doesn't know `inputs` yet (version still
          // loading) — plain label, no strike-through, no benefit, no tag.
          if (row.state === 'neutral') {
            return (
              <li key={row.key} className={s.phase}>
                <span className={s.phaseMark} aria-hidden="true">
                  ○
                </span>
                {row.label}
              </li>
            );
          }
          return (
            <li
              key={row.key}
              className={`${s.phase} ${
                row.state === 'current'
                  ? s.phaseCurrent
                  : row.state === 'done'
                    ? s.phaseDone
                    : ''
              }`}
              aria-current={row.state === 'current' ? 'step' : undefined}
            >
              <span className={s.phaseMark} aria-hidden="true">
                {row.state === 'done' ? '✓' : row.state === 'current' ? '●' : '○'}
              </span>
              {row.label}
            </li>
          );
        })}
      </ol>

      <progress className={s.progress} value={pct} max={1} />

      {active && workerOffline && (
        <p className={s.hintOffline} role="status">
          The analysis worker appears to be down — this job will resume or fail
          shortly.
        </p>
      )}
      {!workerOffline && slow && (
        <p className={s.hintSlow} role="status">
          Taking longer than usual.
        </p>
      )}

      {/* Story 12.8 (AC3): the 7 phases in one line each — inline expandable,
          copy keyed to the BASE_PHASES display names. */}
      <details className={s.howItWorks} data-testid="how-analysis-works">
        <summary>How analysis works</summary>
        <ol>
          {BASE_PHASES.map((name) => (
            <li key={name}>
              <b>{name}</b> — {PHASE_EXPLAINERS[name]}
            </li>
          ))}
        </ol>
        <p>Attach your Ableton project (.als) and an 8th phase names the exact project tracks to fix.</p>
      </details>
    </div>
  );
}

// Container — owns the elapsed-time tick and the shared worker-health poll
// (same TanStack Query cache as the global banner: no extra requests).
export function ProgressStoryline({
  job,
  inputs = DEFAULT_INPUTS,
  inputsLoading = false,
}: {
  job: JobStatusDto;
  /** Task G0 — forwarded to ProgressStorylineView. Omit for mix-only
   *  callers (the anon /analyze funnel never supplies these). */
  inputs?: ProgressPlanInputs;
  inputsLoading?: boolean;
}) {
  const health = useWorkerHealth();
  const startIso = job.startedAt ?? job.dispatchedAt;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <ProgressStorylineView
      status={job.status}
      currentPhase={job.currentPhase}
      phasePct={job.phasePct}
      elapsedMs={now - Date.parse(startIso)}
      workerOffline={health.data?.healthy === false || health.isError}
      inputs={inputs}
      inputsLoading={inputsLoading}
    />
  );
}
