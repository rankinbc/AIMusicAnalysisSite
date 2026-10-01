// The analysis page — ONE layout from the moment the job exists to the
// hand-off into the full report. The results route shows it while the job is
// queued/running (fed by the job poll's per-phase `partial` results);
// ReportView shows the same layout over the report once it's complete (fed by
// final_json + the specialist runs). Between the two only values change:
//   header ("Analyzing…" → "Analysis complete") → body: the coach's chat on
//   the left (he narrates every result as it lands, then consults the AI
//   specialists, who report back in their own voice), the pipeline steps on
//   the right (waiting → running → ✓ with values + duration), then the AI
//   specialists stage and the live findings list → PINNED dock (status + the
//   primary CTA, greyed until the report is ready).
// The chat log is append-only and kept per job (useLiveNarration), so the
// remount at the hand-off continues the same conversation.
//
// Rendered through a portal to <body>: ReportView mounts it inside `.rdx`,
// whose `.rdx * { margin:0; padding:0 }` reset ties on specificity with every
// CSS-module class here and wins or loses on stylesheet order. The page is a
// fixed overlay, so escaping the subtree changes nothing but that.
//
// No close affordance (owner ruling 2026-10-01): no "×", no Esc, no backdrop
// click, no "Run in background". The overlay starts BELOW the app top bar
// (--topnav-h) so the site header stays visible and usable — that, the
// browser's back button and "Open full report" are the ways out, and none of
// them leaves the page half-dismissed. Hence role="region", not an aria-modal
// dialog: the rest of the app is deliberately still reachable.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type {
  FinalJson,
  JobStatusDto,
  Phase2Data,
  RoutingPlanDto,
  SpecialistStatus,
  VerdictDto,
} from '../../api/types';
import { SpectrLogo } from '../../ui/SpectrLogo';
import { GenreCorrectChip } from './GenreCorrectChip';
import { CoachChatFeed } from './AnalysisCompleteCoach';
import { AnalysisDock } from './AnalysisDock';
import { AnalysisStepList } from './AnalysisStepList';
import { LiveFindingsList } from './LiveFindingsList';
import { SpecialistStageSection } from './AnalysisCompleteStage';
import { narrate, type ChatMessage } from './helpers/coachNarration';
import { waitContext } from './helpers/coachWaitLines';
import { deriveSpecialistStage } from './helpers/specialist-stage';
import { deriveInputs, inputsSummary } from './helpers/analysisModalData';
import {
  buildLiveSteps,
  liveFinalJson,
  liveInputsSummary,
  phase1Values,
  runStatus,
  runningPhase,
  type LiveInputs,
} from './helpers/liveRun';
import { useLiveNarration } from './useLiveNarration';
import s from './AnalysisCompleteModal.module.css';

interface Props {
  jobId: string;
  /** The job poll — drives the live (queued/running) state. */
  job?: JobStatusDto | undefined;
  /** The finished result (complete jobs). */
  fj?: FinalJson | undefined;
  /** Known up front: which optional inputs this version has. */
  inputs?: LiveInputs | undefined;
  songName?: string | undefined;
  durationSec?: number | undefined;
  genre?: string | undefined;
  versionLabel?: string | undefined;
  routingPlan?: RoutingPlanDto | undefined;
  /** Live specialist run state from useSpecialistRuns (ReportView owns the
   *  polling + auto-run; the page only reads it). */
  specialistStatuses?: readonly SpecialistStatus[] | undefined;
  runningSlugs?: ReadonlySet<string> | undefined;
  verdicts?: readonly VerdictDto[] | undefined;
  hasStems?: boolean | undefined;
  /** One-thread worker lane (guest pool): specialists run one at a time. */
  sequential?: boolean | undefined;
  /** Extra dock content while the job runs (e.g. a guest's demo link). */
  dockExtra?: ReactNode;
  onViewReport: () => void;
}

/** No routing plan after this long → offer "Open report now". */
export const PLAN_WAIT_MS = 120_000;
/** Specialists not all settled this long after the plan landed → same. */
export const SETTLE_WAIT_MS = 240_000;

function fmtDur(sec?: number): string {
  if (!sec || !Number.isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const ss = String(Math.round(sec % 60)).padStart(2, '0');
  return `${m}:${ss}`;
}

export function AnalysisCompleteModal(props: Props) {
  const { fj, job } = props;
  const status = runStatus(job, fj);
  const complete = status === 'complete';

  const source = liveFinalJson(job, fj);
  const p1 = phase1Values(source, job?.partial);
  const steps = buildLiveSteps({ job, fj, inputs: props.inputs });
  const inSum =
    complete || !props.inputs
      ? inputsSummary(deriveInputs(source, props.songName))
      : liveInputsSummary(props.inputs);
  const genre = props.genre ?? (source.phases?.find((p) => p.phase === 2)?.data as Phase2Data | undefined)?.genre;
  const durationSec = props.durationSec ?? p1?.duration_seconds;
  const stage = deriveSpecialistStage({
    routingPlan: complete ? props.routingPlan : undefined,
    specialists: props.specialistStatuses,
    running: props.runningSlugs,
    verdicts: props.verdicts,
    hasStems: props.hasStems ?? false,
    sequential: props.sequential,
  });
  const sequential = props.sequential ?? false;

  // Arrival order of settled specialists, so they report back in the order
  // they actually came back.
  const [settleOrder, setSettleOrder] = useState<string[]>([]);
  const settledKey = stage.rows
    .filter((r) => r.state === 'done' || r.state === 'failed')
    .map((r) => r.slug)
    .join(',');
  useEffect(() => {
    if (!settledKey) return;
    setSettleOrder((prev) => {
      const add = settledKey.split(',').filter((slug) => !prev.includes(slug));
      return add.length ? [...prev, ...add] : prev;
    });
  }, [settledKey]);

  // The chat: what the current state has earned (stable by content) → the
  // append-only per-job log, plus "still working" lines in quiet stretches.
  const availableKey = JSON.stringify(
    narrate({ status, fj: source, p1, verdicts: props.verdicts, routingPlan: props.routingPlan, stage, settleOrder }),
  );
  const available = useMemo(() => JSON.parse(availableKey) as ChatMessage[], [availableKey]);
  const running = runningPhase(job);
  const waitCtx = waitContext({ status, runningPhase: running, stage });
  const runStarted = job?.partial?.running;
  const waitStartedAtMs =
    waitCtx === `phase:${running}` && runStarted?.phase === running && runStarted.started_at
      ? Date.parse(runStarted.started_at)
      : undefined;
  const chat = useLiveNarration({
    jobId: props.jobId,
    available,
    waitCtx,
    waitStartedAtMs: Number.isFinite(waitStartedAtMs) ? waitStartedAtMs : undefined,
  });
  const busy = !complete || !stage.planReady || (stage.total > 0 && !stage.complete);

  // Clock: running-step timers + the specialist stage's safety valve.
  const [mountedAt] = useState(() => Date.now());
  const [planSeenAt, setPlanSeenAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [valveOpen, setValveOpen] = useState(false);
  useEffect(() => {
    if (stage.planReady && planSeenAt === null) setPlanSeenAt(Date.now());
  }, [stage.planReady, planSeenAt]);
  useEffect(() => {
    if (complete && stage.complete) return undefined;
    const t = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (!complete) return;
      if (planSeenAt === null ? at - mountedAt >= PLAN_WAIT_MS : at - planSeenAt >= SETTLE_WAIT_MS) {
        setValveOpen(true);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [complete, stage.complete, planSeenAt, mountedAt]);
  const elapsedMs = planSeenAt === null || stage.complete ? null : Math.max(0, now - planSeenAt);

  const page = (
    <div className={s.root} role="region" aria-label="Analysis">
      <div className={s.backdrop} />
      <div className={s.stage}>
        <div className={s.brand} data-testid="acm-brand">
          <SpectrLogo size="xl" />
        </div>
        <div className={s.modal} data-status={status}>
          {/* Header */}
          <div className={s.modalHd}>
            <div className={s.hdMain}>
              <div className={s.overline} data-testid="acm-overline">
                {complete ? (
                  <span>Analysis complete</span>
                ) : (
                  <span className={s.live}>
                    <span className={s.d} />
                    Analyzing…
                  </span>
                )}
              </div>
              <div className={s.songTitle}>{props.songName ?? 'Your track'}</div>
              <div className={s.songSub}>
                <span>{fmtDur(durationSec)}</span>
                {props.versionLabel && (
                  <>
                    <span className={s.sep}>·</span>
                    <span>{props.versionLabel}</span>
                  </>
                )}
                {genre && (
                  <>
                    <span className={s.sep}>·</span>
                    <span>{genre}</span>
                  </>
                )}
                {complete && fj && (
                  <>
                    <span className={s.sep}>·</span>
                    <GenreCorrectChip jobId={props.jobId} genre={genre} />
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Body: chat | steps + specialists */}
          <div className={s.modalBody}>
            <div className={s.chatCol}>
              <CoachChatFeed
                name={fj?.coach_name || 'Coach'}
                messages={chat.messages}
                initialIds={chat.initialIds}
                stage={stage}
                busy={busy}
                onOpenReport={props.onViewReport}
              />
            </div>
            <div className={s.workCol}>
              <div className={s.sectionLabel}>
                <span>{complete ? 'Static analysis results' : 'Static analysis'}</span>
                <span className={s.line} />
                <span className={s.inputsSum}>
                  {inSum.present.join(' · ')} · {inSum.used}/4 inputs
                </span>
              </div>
              <AnalysisStepList steps={steps} nowMs={now} />
              {stage.planReady && stage.total > 0 && (
                <SpecialistStageSection stage={stage} elapsedMs={elapsedMs} sequential={sequential} />
              )}
              <LiveFindingsList verdicts={props.verdicts} />
            </div>
          </div>

          <AnalysisDock
            status={status}
            steps={steps}
            stage={stage}
            sequential={sequential}
            valveOpen={valveOpen}
            extra={complete ? undefined : props.dockExtra}
            onViewReport={props.onViewReport}
          />
        </div>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? page : createPortal(page, document.body);
}
