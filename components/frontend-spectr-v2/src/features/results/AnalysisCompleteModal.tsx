// Analysis Complete modal — the hand-off from the static (free) analysis to
// the AI analysis in the full report. Two states: running + complete. The
// complete state is laid out as:
//   header (song + genre correct) → scrolling body (coach: static summary +
//   which specialists he'll consult next; every step's measured results) →
//   PINNED dock (✓ static analysis complete → AI analysis next, with the
//   primary "Open full report & run AI analysis" CTA).
// The dock lives outside the scroll area so the next action is always visible.
// Findings cards are deliberately NOT shown here — the full report owns them.
//
// Rendered through a portal to <body>: ReportView mounts it inside `.rdx`,
// whose `.rdx * { margin:0; padding:0 }` reset ties on specificity with every
// CSS-module class here and wins or loses on stylesheet order. The modal is
// a fixed overlay, so escaping the subtree changes nothing but that.

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import type { FinalJson, RoutingPlanDto } from '../../api/types';
import { Coach } from '../../ui/Coach';
import { GenreCorrectChip } from './GenreCorrectChip';
import { CostTag } from '../billing/CostTag';
import {
  GROUP_COLORS,
  coachMessage,
  deriveInputs,
  derivePhaseRows,
  inputsSummary,
  splitRouting,
  type KvPair,
  type PhaseRow,
} from './helpers/analysisModalData';
import s from './AnalysisCompleteModal.module.css';

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(' ');

// ── inline icons (stroke-based, matching the design) ──
const Sparkle = ({ n = 22 }: { n?: number }) => (
  <svg width={n} height={n} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z" />
  </svg>
);
const CloseIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
const ArrowRight = ({ n = 14 }: { n?: number }) => (
  <svg width={n} height={n} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

const STAT_GLYPH: Record<string, string> = { ok: '✓', warn: '✓', failed: '!', skipped: '–' };
const STAT_TAG: Record<string, string> = {
  ok: 'done',
  warn: 'done',
  failed: 'failed',
  skipped: 'skipped',
  pending: 'running',
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

// The coach's static-analysis summary: his brief when the pipeline wrote one,
// otherwise composed from the headline measurements shown below it.
function staticSummary(fj: FinalJson, rows: PhaseRow[]): string {
  const hasBrief =
    Boolean((fj.coach_intro ?? '').trim()) ||
    (fj.coached_fixes ?? []).some((x) => typeof x === 'string' && x.trim());
  if (hasBrief) return coachMessage(fj);
  const ok = rows.filter((r) => (r.status === 'ok' || r.status === 'warn') && !r.pending && r.detail);
  if (!ok.length) return coachMessage(fj);
  const parts = ok.slice(0, 3).map((r) => `${r.short.toLowerCase()}: ${r.detail}`);
  return `From the static pass — ${parts.join('; ')}.`;
}

export interface RunningState {
  pct: number; // 0..1
  phaseName: string;
  phaseIndex: number; // 1-based
  total: number;
}

interface Props {
  fj: FinalJson;
  jobId: string;
  songName?: string | undefined;
  durationSec?: number | undefined;
  genre?: string | undefined;
  versionLabel?: string | undefined;
  analyzedSec?: number | undefined;
  routingPlan?: RoutingPlanDto | undefined;
  running?: RunningState | null | undefined;
  onClose: () => void;
  onViewReport: () => void;
  onReanalyze: () => void;
}

function fmtDur(sec?: number): string {
  if (!sec || !Number.isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const ss = String(Math.round(sec % 60)).padStart(2, '0');
  return `${m}:${ss}`;
}

export function AnalysisCompleteModal(props: Props) {
  const { fj, running, onClose, onViewReport, onReanalyze } = props;
  const isRunning = Boolean(running);

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const phaseRows = derivePhaseRows(fj);
  const inSum = inputsSummary(deriveInputs(fj, props.songName));
  const routing = splitRouting(props.routingPlan);
  const ranCount = phaseRows.filter((p) => p.status === 'ok' || p.status === 'warn' || p.status === 'failed').length;
  const failedCount = phaseRows.filter((p) => p.status === 'failed').length;

  const R = 66;
  const C = 2 * Math.PI * R; // 414.7
  const pct = running ? Math.max(0.02, Math.min(1, running.pct)) : 0;

  const modal = (
    <div className={s.root} role="dialog" aria-modal="true" aria-label="Analysis">
      <div className={s.backdrop} onClick={onClose} />
      <div className={s.stage}>
        <div className={s.modal} onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className={s.modalHd}>
            <div className={s.hdMain}>
              <div className={s.overline}>
                {isRunning ? (
                  <span className={s.live}>
                    <span className={s.d} />
                    Analyzing
                  </span>
                ) : (
                  <span>Analysis complete</span>
                )}
              </div>
              <div className={s.songTitle}>{props.songName ?? 'Your track'}</div>
              <div className={s.songSub}>
                <span>{fmtDur(props.durationSec)}</span>
                {props.versionLabel && (
                  <>
                    <span className={s.sep}>·</span>
                    <span>{props.versionLabel}</span>
                  </>
                )}
                {props.genre && (
                  <>
                    <span className={s.sep}>·</span>
                    <span>{props.genre}</span>
                  </>
                )}
                {!isRunning && (
                  <>
                    <span className={s.sep}>·</span>
                    <GenreCorrectChip jobId={props.jobId} genre={props.genre} />
                  </>
                )}
              </div>
            </div>
            <button className={s.xBtn} aria-label="Close" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>

          {/* Body — the only part that scrolls */}
          <div className={s.modalBody}>
            {isRunning ? (
              <RunView running={running!} R={R} C={C} pct={pct} />
            ) : (
              <>
                {/* Coach: what he knows from the static pass + who he'll consult next */}
                <div className={s.coachHero} data-testid="acm-coach">
                  <span className={s.chAv}>
                    <Coach size={46} thinking={!routing} />
                  </span>
                  <div className={s.chTx}>
                    <div className={s.chName}>
                      <span>{fj.coach_name || 'Nova'}</span>
                      <span className={s.chRole}>your AI coach</span>
                    </div>
                    <div className={s.chMsg}>{staticSummary(fj, phaseRows)}</div>
                    <div className={s.chNext} data-testid="acm-coach-next">
                      {routing ? (
                        <>
                          <span className={s.chNextLbl}>Next I&apos;ll bring in</span>
                          {[...routing.high, ...routing.rest].map((sp) => {
                            const g = GROUP_COLORS[sp.group];
                            return (
                              <span
                                key={sp.slug}
                                className={s.specChip}
                                style={{ color: g.c, borderColor: g.d, background: g.d }}
                                title={sp.focus}
                              >
                                {sp.label}
                              </span>
                            );
                          })}
                        </>
                      ) : (
                        <span className={s.chPicking}>
                          <span className={s.spin} aria-hidden />
                          Picking which specialists to consult…
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Every step's measured results, readable without clicking */}
                <div className={s.sectionLabel}>
                  <span>Static analysis results</span>
                  <span className={s.line} />
                  <span className={s.inputsSum}>
                    {inSum.present.join(' · ')} · {inSum.used}/4 inputs
                  </span>
                </div>
                {/* Ran steps as result cards; skipped steps as one muted
                    line each underneath, so they never stretch beside a full
                    result card in the grid. */}
                <div data-testid="acm-steps">
                  <ul className={s.steps}>
                    {phaseRows
                      .filter((p) => p.status !== 'skipped')
                      .map((p) => (
                        <StepCard key={p.phase} p={p} />
                      ))}
                  </ul>
                  {phaseRows.some((p) => p.status === 'skipped') && (
                    <ul className={s.skippedList}>
                      {phaseRows
                        .filter((p) => p.status === 'skipped')
                        .map((p) => (
                          <StepCard key={p.phase} p={p} />
                        ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>

          {isRunning ? (
            <div className={s.modalFt}>
              <div className={s.ftMeta}>
                Phase {running!.phaseIndex} of {running!.total} · analyzing your mix…
              </div>
              <button type="button" className={s.btn} onClick={onClose}>
                Run in background
              </button>
            </div>
          ) : (
            <div className={s.dock} data-testid="acm-status-dock">
              <div className={s.stages}>
                <div className={cx(s.stageRow, s.done)}>
                  <span className={s.stageIc} aria-hidden>
                    ✓
                  </span>
                  <span className={s.stageTitle}>Static analysis complete</span>
                  <span className={s.stageMeta}>
                    {ranCount} of {phaseRows.length} steps ran
                    {failedCount > 0 && <span className={s.failedNote}> · {failedCount} failed</span>}
                    {props.analyzedSec ? ` · ${props.analyzedSec}s` : ''}
                  </span>
                </div>
                <div className={cx(s.stageRow, s.next)} data-testid="acm-ai-block">
                  <span className={s.stageIc} aria-hidden>
                    <Sparkle n={11} />
                  </span>
                  <span className={s.stageTitle}>Next: AI analysis</span>
                  <span className={s.stageMeta}>
                    {routing ? `${routing.total} specialists · in the full report` : 'runs in the full report'}
                  </span>
                </div>
              </div>
              <div className={s.actions}>
                <button type="button" className={s.btn} onClick={onReanalyze}>
                  ↺ Re-analyze <CostTag action="analysis" />
                </button>
                <button type="button" className={cx(s.btn, s.primary)} onClick={onViewReport}>
                  Open full report &amp; run AI analysis <ArrowRight n={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? modal : createPortal(modal, document.body);
}

function StepCard({ p }: { p: PhaseRow }) {
  const st = p.pending ? 'pending' : p.status;
  const muted = st === 'skipped';
  const values = muted || st === 'failed' || p.pending ? [] : stepValues(p);
  return (
    <li className={cx(s.step, muted && s.muted)} data-status={st} title={muted ? p.note : undefined}>
      <div className={s.stepHd}>
        <span className={cx(s.stepStat, s[st])} aria-hidden>
          {p.pending ? <span className={s.spin} /> : STAT_GLYPH[st]}
        </span>
        <span className={s.stepName}>{p.short}</span>
        {muted && <span className={s.stepSum}>{p.detail}</span>}
        <span className={cx(s.stepTag, s[st])}>{STAT_TAG[st]}</span>
      </div>
      {!muted && (
        <div className={s.stepRes}>
          {values.length > 0 ? (
            values.map((kv, i) => (
              <span key={i} className={s.kv}>
                <span className={s.k}>{kv.k}</span>
                <span className={cx(s.v, kv.tone && s[kv.tone])}>{kv.v}</span>
              </span>
            ))
          ) : (
            <span className={s.stepText}>
              {p.detail}
              {p.clashes.length > 0 && ` — ${p.clashes.map((c) => c.stems).join(', ')}`}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

function RunView({ running, R, C, pct }: { running: RunningState; R: number; C: number; pct: number }) {
  return (
    <div className={s.runWrap}>
      <div className={s.runRing}>
        <svg width="150" height="150">
          <circle cx="75" cy="75" r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="8" />
          <circle
            cx="75"
            cy="75"
            r={R}
            fill="none"
            stroke="var(--cyan)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C - pct * C}
            style={{ filter: 'drop-shadow(0 0 6px var(--cyan-glow))' }}
          />
        </svg>
        <div className={s.pct}>
          <div className={s.n}>
            {Math.round(pct * 100)}
            <small>%</small>
          </div>
          <div className={s.lbl}>Analyzing</div>
        </div>
      </div>
      <div className={s.runPhase}>
        Running <span className={s.pn}>{running.phaseName}</span>
      </div>
      <div className={s.runHint}>
        Phase {running.phaseIndex} of {running.total} · keep this open, it&apos;s quick
      </div>
    </div>
  );
}
