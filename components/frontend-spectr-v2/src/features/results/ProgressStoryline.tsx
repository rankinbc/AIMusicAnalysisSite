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

// Soft "taking longer than usual" thresholds — deliberately constants, not
// config: they only tune a hint, and a wrong value is a copy nit, not a bug.
const SLOW_ELAPSED_MS = 10 * 60 * 1000; // any status, 10 min total
const SLOW_PENDING_MS = 2 * 60 * 1000; // still queued after 2 min

export interface ProgressStorylineViewProps {
  status: string;
  currentPhase: string;
  phasePct: number;
  elapsedMs: number;
  /** True only on a definitive offline reading (useWorkerHealth healthy === false). */
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
  const knownIdx = (BASE_PHASES as readonly string[]).indexOf(currentPhase);
  const isSentinel = SENTINELS.has(currentPhase);
  const isUnknownPhase = knownIdx === -1 && !isSentinel;

  const rows: { name: string; state: 'done' | 'current' | 'todo' }[] =
    BASE_PHASES.map((name, idx) => {
      if (status === 'complete') return { name, state: 'done' };
      if (knownIdx >= 0) {
        if (idx < knownIdx) return { name, state: 'done' };
        if (idx === knownIdx) return { name, state: 'current' };
        return { name, state: 'todo' };
      }
      // Unknown/extra phase in flight (ALS, Mix Translation, …): base phases
      // are checked off by overall progress — the only signal we still have.
      if (isUnknownPhase) {
        return { name, state: pct >= (idx + 1) / BASE_PHASES.length ? 'done' : 'todo' };
      }
      return { name, state: 'todo' };
    });
  if (isUnknownPhase) {
    rows.push({ name: currentPhase, state: 'current' });
  }

  const slow =
    elapsedMs > SLOW_ELAPSED_MS ||
    (status === 'pending' && elapsedMs > SLOW_PENDING_MS);

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

      {workerOffline && (
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

      {/* Story 12-8 (AC3) will add the "How analysis works" link here. */}
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
      workerOffline={health.data?.healthy === false}
      queueDepth={health.data?.queueDepth}
    />
  );
}
