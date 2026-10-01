// The analysis page's pipeline steps: waiting → running (spinner + live
// clock) → ✓ with the measured values and how long the step took. Rows come
// from helpers/liveRun.buildLiveSteps, which serves the running job and the
// finished report alike, so nothing re-lays-out at the hand-off.

import type { KvPair, PhaseRow } from './helpers/analysisModalData';
import { fmtElapsed, fmtSeconds, type LiveStep, type StepState } from './helpers/liveRun';
import s from './AnalysisCompleteModal.module.css';

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(' ');

const GLYPH: Partial<Record<StepState, string>> = {
  done: '✓',
  failed: '!',
  skipped: '–',
  unavailable: '–',
};

// Short display labels for the always-visible step results (the helper's kv
// labels were written for a roomy expanded panel).
const KV_SHORT: Record<string, string> = {
  'Integrated LUFS': 'LUFS',
  'True peak': 'Peak',
  'Detected key': 'Key',
  'Total score': 'Score',
  'Arrangement grade': 'Grade',
  'Project health': 'Health',
  'Total devices': 'Devices',
  'Mono compat': 'Mono',
  'Bass translation': 'Bass',
};
// Per-phase picks of the headline measurements; other phases show their
// first few values.
const KV_PICK: Record<number, string[]> = {
  1: ['Integrated LUFS', 'True peak', 'BPM', 'Detected key', 'Clipping'],
};
const KV_MAX = 4;

function stepValues(p: PhaseRow): KvPair[] {
  const pick = KV_PICK[p.phase];
  const kv = pick
    ? pick.map((k) => p.kv.find((x) => x.k === k)).filter((x): x is KvPair => Boolean(x))
    : p.kv.slice(0, KV_MAX);
  return kv.map((x) => ({ ...x, k: KV_SHORT[x.k] ?? x.k }));
}

function tagText(step: LiveStep, nowMs: number): string {
  switch (step.state) {
    case 'waiting':
      return 'waiting';
    case 'running':
      return step.startedAtMs !== undefined ? fmtElapsed(nowMs - step.startedAtMs) : 'running';
    case 'skipped':
      return 'skipped';
    case 'background':
      return 'in background';
    case 'unavailable':
      return 'n/a';
    default:
      return fmtSeconds(step.seconds) || (step.state === 'failed' ? 'failed' : 'done');
  }
}

function StepCard({ step, nowMs }: { step: LiveStep; nowMs: number }) {
  const { state, row } = step;
  const muted = state === 'skipped';
  const spinning = state === 'running' || state === 'background';
  const values = row && (state === 'done' || state === 'running' || state === 'background') ? stepValues(row) : [];
  const text =
    state === 'waiting'
      ? ''
      : state === 'running' && !values.length
        ? 'measuring…'
        : row && !values.length
          ? `${row.detail}${row.clashes.length > 0 ? ` — ${row.clashes.map((c) => c.stems).join(', ')}` : ''}`
          : '';
  return (
    <li
      className={cx(s.step, muted && s.muted, s[`st_${state}`])}
      data-status={state}
      data-phase={step.phase}
      title={muted || state === 'unavailable' ? row?.note : undefined}
    >
      <div className={s.stepHd}>
        <span className={cx(s.stepStat, s[`st_${state}`])} aria-hidden>
          {spinning ? <span className={s.spin} /> : state === 'waiting' ? <span className={s.queuedDot} /> : GLYPH[state]}
        </span>
        <span className={s.stepName}>{step.short}</span>
        {muted && <span className={s.stepSum}>{row?.detail}</span>}
        <span
          className={cx(s.stepTag, s[`st_${state}`], (state === 'done' || state === 'failed' || state === 'running') && s.time)}
          data-testid="acm-step-time"
        >
          {tagText(step, nowMs)}
        </span>
      </div>
      {!muted && (values.length > 0 || text) && (
        <div className={s.stepRes}>
          {values.length > 0
            ? values.map((kv, i) => (
                <span key={i} className={s.kv}>
                  <span className={s.k}>{kv.k}</span>
                  <span className={cx(s.v, kv.tone && s[kv.tone])}>{kv.v}</span>
                </span>
              ))
            : <span className={s.stepText}>{text}</span>}
        </div>
      )}
    </li>
  );
}

/** Ran / running / waiting steps as cards; skipped steps as muted one-liners
 *  underneath, so they never stretch beside a full result card. */
export function AnalysisStepList({ steps, nowMs }: { steps: readonly LiveStep[]; nowMs: number }) {
  const main = steps.filter((p) => p.state !== 'skipped');
  const skipped = steps.filter((p) => p.state === 'skipped');
  return (
    <div data-testid="acm-steps">
      <ul className={s.steps}>
        {main.map((p) => (
          <StepCard key={p.phase} step={p} nowMs={nowMs} />
        ))}
      </ul>
      {skipped.length > 0 && (
        <ul className={s.skippedList}>
          {skipped.map((p) => (
            <StepCard key={p.phase} step={p} nowMs={nowMs} />
          ))}
        </ul>
      )}
    </div>
  );
}
