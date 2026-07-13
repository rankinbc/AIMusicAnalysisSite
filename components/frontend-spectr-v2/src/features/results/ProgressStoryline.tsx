import { useEffect, useState } from 'react';

import { useWorkerHealth } from '../../api/hooks';
import type { JobStatusDto } from '../../api/types';
import s from './ProgressStoryline.module.css';

// Story 12.2 (AC3) — per-phase progress storyline for the results page.
// Replaces the bare status-line + <progress> so a stuck job LOOKS different
// from a healthy one: named phases with the current one highlighted, elapsed
// time, and escalating hints keyed on real signals (worker heartbeat via the
// shared useWorkerHealth poll; wall-clock thresholds as the softer fallback).

// The 7 base pipeline phases, display-ready names persisted by the worker
// (audio_analysis pipeline PHASE_DEFS). Conditional/extra phases (ALS phase 8,
// "Mix Translation", structure_actor's "Arrangement") and any future rename
// are tolerated: an unrecognized in-flight phase renders as an appended row.
const BASE_PHASES = [
  'Universal Mix Analysis',
  'Genre Detection',
  'Genre-Specific Scoring',
  'Stem Separation & Clash',
  'Reference Comparison',
  'Gap Analysis',
  'Arrangement Advice',
] as const;

// Lifecycle markers the worker writes outside the numbered phases — these are
// job states, not phases, so they never render as an appended phase row.
const SENTINELS = new Set(['', 'queued', 'starting', 'complete', 'failed']);

// Worker phase names that are the same step as a base row under another name —
// structure_actor writes "Arrangement" while running arrangement advice.
// Without the alias it would render as a duplicate row under the base one.
const PHASE_ALIASES: Record<string, string> = {
  Arrangement: 'Arrangement Advice',
};

// Story 12.8 (AC3): one-line explainer per phase. Typed against BASE_PHASES so
// a phase rename breaks the build here instead of silently orphaning its copy.
const PHASE_EXPLAINERS: Record<(typeof BASE_PHASES)[number], string> = {
  'Universal Mix Analysis':
    'loudness, true peak, key, tempo and the measurements every genre shares.',
  'Genre Detection': 'which genre profile your track is judged against.',
  'Genre-Specific Scoring':
    "the measured values scored against that genre's reference ranges.",
  'Stem Separation & Clash': 'where instruments fight for the same frequencies.',
  'Reference Comparison':
    'your mix against a reference track when one is attached.',
  'Gap Analysis': 'the biggest measurable distances from the genre profile.',
  'Arrangement Advice': 'energy and structure over the timeline.',
};

// Soft "taking longer than usual" thresholds — deliberately constants, not
// config: they only tune a hint, and a wrong value is a copy nit, not a bug.
const SLOW_ELAPSED_MS = 10 * 60 * 1000; // any status, 10 min total
const SLOW_PENDING_MS = 2 * 60 * 1000; // still queued after 2 min

export interface ProgressStorylineViewProps {
  status: string;
  currentPhase: string;
  phasePct: number;
  elapsedMs: number;
  /** True on a definitive offline reading (healthy === false) OR when the
   *  health probe itself errors — an unreachable BFF/Redis must not read as
   *  "everything fine" on the page whose whole job is failure visibility. */
  workerOffline: boolean;
  /** Jobs waiting on the dead worker; shown with the offline hint. */
  queueDepth?: number | undefined;
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
  queueDepth = 0,
}: ProgressStorylineViewProps) {
  const pct = Math.max(0, Math.min(1, phasePct));
  const phase = PHASE_ALIASES[currentPhase] ?? currentPhase;
  const knownIdx = (BASE_PHASES as readonly string[]).indexOf(phase);
  const isSentinel = SENTINELS.has(phase);
  const isUnknownPhase = knownIdx === -1 && !isSentinel;
  // Hints and the ticking clock only make sense while the job is actually
  // running — a completed job briefly passes through here while the report
  // payload loads, and must not show "taking longer than usual".
  const active = status === 'pending' || status === 'processing';

  const rows: { name: string; state: 'done' | 'current' | 'todo' }[] =
    BASE_PHASES.map((name, idx) => {
      if (status === 'complete') return { name, state: 'done' };
      if (knownIdx >= 0) {
        if (idx < knownIdx) return { name, state: 'done' };
        if (idx === knownIdx) return { name, state: 'current' };
        return { name, state: 'todo' };
      }
      // Unknown/extra phase in flight (ALS phase 8, Mix Translation, …):
      // base phases are checked off by overall progress — the only signal we
      // still have. Denominator assumes one extra phase, since the known
      // extras run AFTER the 7 base phases (worker pct is (phase-1+frac)/8
      // for an ALS job, so /8 marks all base rows done exactly then).
      if (isUnknownPhase) {
        return {
          name,
          state: pct >= (idx + 1) / (BASE_PHASES.length + 1) ? 'done' : 'todo',
        };
      }
      return { name, state: 'todo' };
    });
  if (isUnknownPhase) {
    rows.push({ name: phase, state: 'current' });
  }

  const slow =
    active &&
    (elapsedMs > SLOW_ELAPSED_MS ||
      (status === 'pending' && elapsedMs > SLOW_PENDING_MS));

  const waiting =
    queueDepth > 0 ? ` ${queueDepth} job${queueDepth === 1 ? '' : 's'} queued.` : '';

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
        {rows.map((row) => (
          <li
            key={row.name}
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
            {row.name}
          </li>
        ))}
      </ol>

      <progress className={s.progress} value={pct} max={1} />

      {active && workerOffline && (
        <p className={s.hintOffline} role="status">
          The analysis worker appears to be down — this job will resume or fail
          shortly.{waiting}
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
export function ProgressStoryline({ job }: { job: JobStatusDto }) {
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
      queueDepth={health.data?.queueDepth}
    />
  );
}
