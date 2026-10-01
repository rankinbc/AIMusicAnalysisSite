// The analysis page's pinned dock: two-stage status (static analysis → AI
// specialists) plus the actions. It lives outside the scrolling body so the
// next action is always visible. While the job runs the primary CTA is a
// disabled "Analyzing…" and the secondary action leaves the page (the job
// keeps running server-side); once complete the CTA is gated on every routed
// specialist settling, with a safety valve if triage or a run stalls.

import type { ReactNode } from 'react';

import { CostTag } from '../billing/CostTag';
import { fmtSeconds, type LiveStep, type RunStatus } from './helpers/liveRun';
import type { SpecialistStage } from './helpers/specialist-stage';
import s from './AnalysisCompleteModal.module.css';

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(' ');

const ArrowRight = ({ n = 14 }: { n?: number }) => (
  <svg width={n} height={n} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

interface DockProps {
  status: RunStatus;
  steps: readonly LiveStep[];
  stage: SpecialistStage;
  sequential: boolean;
  valveOpen: boolean;
  /** Extra live-state content (e.g. the guest's demo-report link). */
  extra?: ReactNode;
  onClose: () => void;
  onViewReport: () => void;
  onReanalyze?: (() => void) | undefined;
}

export function AnalysisDock({ status, steps, stage, sequential, valveOpen, extra, onClose, onViewReport, onReanalyze }: DockProps) {
  const complete = status === 'complete';
  const runnable = steps.filter((p) => p.state !== 'skipped');
  const ran = steps.filter((p) => p.state !== 'skipped' && p.state !== 'waiting' && p.state !== 'running');
  const failedCount = steps.filter((p) => p.state === 'failed').length;
  const running = steps.find((p) => p.state === 'running');
  const totalSec = ran.reduce((sum, p) => sum + (p.seconds ?? 0), 0);
  const ctaReady = complete && stage.complete;

  return (
    <div className={s.dock} data-testid="acm-status-dock">
      <div className={s.stages}>
        <div className={cx(s.stageRow, complete ? s.done : s.next)}>
          <span className={s.stageIc} aria-hidden>
            {complete ? '✓' : <span className={s.spin} />}
          </span>
          <span className={s.stageTitle}>{complete ? 'Static analysis complete' : 'Static analysis'}</span>
          <span className={s.stageMeta}>
            {complete ? (
              <>
                {ran.length} of {steps.length} steps ran
                {failedCount > 0 && <span className={s.failedNote}> · {failedCount} failed</span>}
                {totalSec > 0 && ` · ${fmtSeconds(totalSec)}`}
              </>
            ) : status === 'queued' ? (
              'waiting for a worker…'
            ) : (
              `step ${Math.min(ran.length + 1, runnable.length)} of ${runnable.length}${running ? ` · ${running.short.toLowerCase()}` : ''}`
            )}
          </span>
        </div>
        <div
          className={cx(s.stageRow, ctaReady ? s.done : s.next, !complete && s.later)}
          data-testid="acm-ai-block"
        >
          <span className={s.stageIc} aria-hidden>
            {ctaReady ? '✓' : complete ? <span className={s.spin} /> : <span className={s.queuedDot} />}
          </span>
          <span className={s.stageTitle}>
            {!stage.planReady
              ? 'AI specialists'
              : stage.total === 0
                ? 'AI specialists · none needed'
                : ctaReady
                  ? 'AI specialists complete'
                  : `AI specialists ${stage.settled}/${stage.total}`}
          </span>
          <span className={s.stageMeta}>
            {!complete
              ? 'next, once the analysis is done'
              : !stage.planReady
                ? 'picking who to consult…'
                : ctaReady
                  ? stage.rows.some((r) => r.state === 'failed')
                    ? `${stage.rows.filter((r) => r.state === 'failed').length} didn’t finish`
                    : ''
                  : sequential
                    ? 'running one at a time'
                    : 'running in parallel'}
          </span>
        </div>
        {extra}
      </div>
      <div className={s.actions}>
        {complete ? (
          <>
            {valveOpen && !ctaReady && (
              <button type="button" className={s.valve} onClick={onViewReport}>
                Open report now
              </button>
            )}
            {onReanalyze && (
              <button type="button" className={s.btn} onClick={onReanalyze}>
                ↺ Re-analyze <CostTag action="analysis" />
              </button>
            )}
          </>
        ) : (
          <button type="button" className={s.btn} onClick={onClose}>
            Run in background
          </button>
        )}
        <button
          type="button"
          className={cx(s.btn, s.primary)}
          onClick={onViewReport}
          disabled={!ctaReady}
          data-testid="acm-cta"
        >
          {ctaReady ? (
            <>
              Open full report <ArrowRight n={16} />
            </>
          ) : !complete ? (
            <>
              <span className={s.spin} aria-hidden /> Analyzing…
            </>
          ) : stage.planReady ? (
            <>
              <span className={s.spin} aria-hidden /> Consulting specialists… ({stage.settled}/{stage.total})
            </>
          ) : (
            <>
              <span className={s.spin} aria-hidden /> Picking specialists…
            </>
          )}
        </button>
      </div>
    </div>
  );
}
