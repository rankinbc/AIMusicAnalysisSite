// Analysis Complete modal — the teaser/conversion surface shown after analysis.
// Two states: running + complete. The complete state is laid out as:
//   header (song + genre correct) → scrolling body (coach, findings, compact
//   step list, inputs) → PINNED dock (two-stage status: static analysis done ✓,
//   AI analysis next in the full report) → footer actions.
// The dock lives outside the scroll area so the "what happens next" message
// and the primary CTA are always visible, however long the body gets.
//
// Rendered through a portal to <body>: ReportView mounts it inside `.rdx`,
// whose `.rdx * { margin:0; padding:0 }` reset ties on specificity with every
// CSS-module class here and wins or loses on stylesheet order. The modal is
// a fixed overlay, so escaping the subtree changes nothing but that.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import type { FinalJson, RoutingPlanDto } from '../../api/types';
import { GenreCorrectChip } from './GenreCorrectChip';
import { CostTag } from '../billing/CostTag';
import {
  GROUP_COLORS,
  coachMessage,
  deriveFindings,
  deriveInputs,
  derivePhaseRows,
  inputsSummary,
  specInitials,
  splitRouting,
  type PhaseRow,
} from './helpers/analysisModalData';
import s from './AnalysisCompleteModal.module.css';

const SEV_LABEL: Record<string, string> = {
  crit: 'critical',
  mod: 'moderate',
  min: 'minor',
  win: 'win',
};

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(' ');

// ── inline icons (stroke-based, matching the design) ──
const Sparkle = ({ n = 22 }: { n?: number }) => (
  <svg width={n} height={n} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z" />
  </svg>
);
const Chevron = ({ n = 13 }: { n?: number }) => (
  <svg width={n} height={n} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
    <path d="m6 9 6 6 6-6" />
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
const InputIcon = ({ kind }: { kind: string }) => {
  if (kind === 'stems')
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    );
  if (kind === 'als')
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </svg>
    );
  if (kind === 'reference')
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3v12" />
        <circle cx="6" cy="18" r="3" />
        <path d="M12 9l9-3" />
      </svg>
    );
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
};

const STAT_GLYPH: Record<string, string> = { ok: '✓', warn: '✓', failed: '!', skipped: '–' };
const STAT_TAG: Record<string, string> = { ok: 'done', warn: 'done', failed: 'failed', skipped: 'skipped' };

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

  const [openPhases, setOpenPhases] = useState<Set<number>>(new Set());
  const [aiOpen, setAiOpen] = useState(false);
  const [inputsOpen, setInputsOpen] = useState(false);

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const findings = deriveFindings(fj);
  const phaseRows = derivePhaseRows(fj);
  const inputs = deriveInputs(fj, props.songName);
  const inSum = inputsSummary(inputs);
  const routing = splitRouting(props.routingPlan);
  const ranCount = phaseRows.filter((p) => p.status === 'ok' || p.status === 'warn' || p.status === 'failed').length;
  const failedCount = phaseRows.filter((p) => p.status === 'failed').length;

  const togglePhase = (n: number) =>
    setOpenPhases((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

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
                {/* Coach hero */}
                <div className={s.coachHero}>
                  <span className={s.chAv}>
                    <Sparkle n={18} />
                  </span>
                  <div className={s.chTx}>
                    <div className={s.chName}>
                      <span>{fj.coach_name || 'Nova'}</span>
                      <span className={s.chRole}>your AI coach</span>
                      <span className={s.aiDot} />
                    </div>
                    <div className={s.chMsg}>{coachMessage(fj)}</div>
                  </div>
                </div>

                {/* Report grid */}
                <div className={s.reportGrid}>
                  <section>
                    <div className={s.sectionLabel}>
                      <span>What I found</span>
                      <span className={s.line} />
                      <span>{findings.length} initial findings</span>
                    </div>
                    <div className={s.findings}>
                      {findings.map((f, i) => (
                        <div key={i} className={s.finding} style={{ ['--sc' as string]: `var(--${sevVar(f.sev)})` }}>
                          <div className={s.fTop}>
                            <span className={cx(s.sevPill, s[f.sev])}>{SEV_LABEL[f.sev]}</span>
                            <span className={s.fCat}>{f.cat}</span>
                          </div>
                          <div className={s.fTitle}>{f.title}</div>
                          <div className={s.fBody}>{f.body}</div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section>
                    <div className={s.sectionLabel}>
                      <span>Analysis steps</span>
                      <span className={s.line} />
                      <span>
                        {ranCount} of {phaseRows.length} ran
                      </span>
                    </div>
                    <ul className={s.steps} data-testid="acm-steps">
                      {phaseRows.map((p) => (
                        <StepRow key={p.phase} p={p} open={openPhases.has(p.phase)} onToggle={() => togglePhase(p.phase)} />
                      ))}
                    </ul>
                  </section>
                </div>

                {/* Inputs disclosure */}
                <div className={cx(s.disc, inputsOpen && s.open)}>
                  <button
                    type="button"
                    className={s.discHead}
                    aria-expanded={inputsOpen}
                    onClick={() => setInputsOpen((v) => !v)}
                  >
                    <span className={s.dhL}>Inputs analyzed</span>
                    <span className={s.dhSum}>
                      {inSum.present.join(' · ')} · <b>{inSum.used}/4 sources</b>
                    </span>
                    <span className={s.chev}>
                      <Chevron n={13} />
                    </span>
                  </button>
                  {inputsOpen && (
                    <div className={s.discBody}>
                      {inputs.map((r) => (
                        <div key={r.kind} className={cx(s.inRow, s[r.cls])}>
                          <span className={s.inIc}>
                            <InputIcon kind={r.kind} />
                          </span>
                          <span className={s.inK}>{r.label}</span>
                          <span className={s.inV}>{r.value}</span>
                          <span className={s.inMeta}>{r.meta}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Pinned dock: two-stage status (complete state only) */}
          {!isRunning && (
            <StatusDock
              ranCount={ranCount}
              total={phaseRows.length}
              failedCount={failedCount}
              analyzedSec={props.analyzedSec}
              routing={routing}
              aiOpen={aiOpen}
              onToggleAi={() => setAiOpen((v) => !v)}
            />
          )}

          {/* Footer */}
          <div className={s.modalFt}>
            {isRunning ? (
              <>
                <div className={s.ftMeta}>
                  Phase {running!.phaseIndex} of {running!.total} · analyzing your mix…
                </div>
                <button type="button" className={s.btn} onClick={onClose}>
                  Run in background
                </button>
              </>
            ) : (
              <>
                <button type="button" className={s.btn} onClick={onReanalyze}>
                  ↺ Re-analyze <CostTag action="analysis" />
                </button>
                <span className={s.ftSpacer} />
                <button type="button" className={cx(s.btn, s.primary)} onClick={onViewReport}>
                  View full report <ArrowRight />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? modal : createPortal(modal, document.body);
}

function sevVar(sev: string): string {
  return sev === 'crit' ? 'red' : sev === 'mod' ? 'orange' : sev === 'min' ? 'blue' : 'cyan';
}

function StepRow({ p, open, onToggle }: { p: PhaseRow; open: boolean; onToggle: () => void }) {
  const st = p.pending ? 'pending' : p.status;
  return (
    <li className={cx(s.step, open && s.open)} id={`ph-${p.phase}`} data-status={st}>
      <button type="button" className={s.stepRow} aria-expanded={open} onClick={onToggle} title={p.detail}>
        <span className={cx(s.stepStat, s[st])} aria-hidden>
          {p.pending ? <span className={s.spin} /> : STAT_GLYPH[st]}
        </span>
        <span className={s.stepName}>{p.short}</span>
        <span className={s.stepSum}>{p.detail}</span>
        <span className={cx(s.stepTag, s[st])}>{p.pending ? 'running' : STAT_TAG[st]}</span>
        <span className={s.chev}>
          <Chevron n={11} />
        </span>
      </button>
      {open && (
        <div className={s.stepDetail}>
          {st === 'skipped' ? (
            <div className={s.detailEmpty}>{p.note ?? 'Not applicable for this run.'}</div>
          ) : (
            <>
              {p.detail && <div className={s.detailLead}>{p.detail}</div>}
              {p.clashes.map((c, i) => (
                <div key={i} className={s.clashRow}>
                  <span className={cx(s.sev, s[c.sev])}>{c.sev}</span>
                  <span>
                    <b>{c.stems}</b>
                    {c.range ? ` · ${c.range}` : ''}
                  </span>
                </div>
              ))}
              {p.kv.length > 0 && (
                <div className={s.kvGrid}>
                  {p.kv.map((kv, i) => (
                    <div key={i} className={s.kv}>
                      <span className={s.k}>{kv.k}</span>
                      <span className={cx(s.v, kv.tone && s[kv.tone])}>{kv.v}</span>
                    </div>
                  ))}
                </div>
              )}
              {p.note && <div className={s.detailNote}>{p.note}</div>}
            </>
          )}
        </div>
      )}
    </li>
  );
}

function StatusDock({
  ranCount,
  total,
  failedCount,
  analyzedSec,
  routing,
  aiOpen,
  onToggleAi,
}: {
  ranCount: number;
  total: number;
  failedCount: number;
  analyzedSec?: number | undefined;
  routing: ReturnType<typeof splitRouting>;
  aiOpen: boolean;
  onToggleAi: () => void;
}) {
  return (
    <div className={s.dock} data-testid="acm-status-dock">
      {/* Stage 1 — done */}
      <div className={cx(s.stageRow, s.done)}>
        <span className={s.stageIc} aria-hidden>
          ✓
        </span>
        <div className={s.stageTx}>
          <span className={s.stageTitle}>Static analysis complete</span>
          <span className={s.stageMeta}>
            {ranCount} of {total} steps ran
            {failedCount > 0 && <span className={s.failedNote}> · {failedCount} failed</span>}
            {analyzedSec ? ` · analyzed in ${analyzedSec}s` : ''}
          </span>
        </div>
      </div>

      {/* Stage 2 — next: AI analysis in the full report */}
      <div className={s.aiBlock} data-testid="acm-ai-block">
        <div className={cx(s.stageRow, s.next)}>
          <span className={s.stageIc} aria-hidden>
            <Sparkle n={12} />
          </span>
          <div className={s.stageTx}>
            <span className={s.stageTitle}>Continue to the full report to run AI analysis</span>
            <span className={s.stageMeta}>
              {routing ? (
                <>
                  Triage AI lined up <b>{routing.total} specialists</b>
                  {routing.high.length ? (
                    <>
                      {' '}
                      · <b>{routing.high.length} high-priority</b>
                    </>
                  ) : null}
                </>
              ) : (
                <>Triage AI will route the right specialists for your mix, then build a DAW action plan</>
              )}
            </span>
          </div>
          {routing ? (
            <button type="button" className={s.aiToggle} aria-expanded={aiOpen} onClick={onToggleAi}>
              {aiOpen ? 'Hide' : 'Specialists'}
              <span className={cx(s.chev, aiOpen && s.chevOpen)}>
                <Chevron n={11} />
              </span>
            </button>
          ) : null}
          <span className={s.aiTag}>In full report</span>
        </div>

        {routing && aiOpen && (
          <div className={s.aiDetail}>
            {routing.high.map((sp, i) => {
              const g = GROUP_COLORS[sp.group];
              return (
                <div key={i} className={s.aiSpec}>
                  <span className={s.aiSpecAv} style={{ color: g.c, background: g.d }}>
                    {specInitials(sp.label)}
                  </span>
                  <span className={s.aiSpecName}>{sp.label}</span>
                  <span className={s.aiSpecFocus} title={sp.focus}>
                    {sp.focus}
                  </span>
                </div>
              );
            })}
            {routing.rest.length > 0 && (
              <div className={s.aiChipRow}>
                <span className={s.aiMoreLabel}>+{routing.rest.length} more</span>
                {routing.rest.map((sp, i) => {
                  const g = GROUP_COLORS[sp.group];
                  return (
                    <span key={i} className={s.aiChip} style={{ color: g.c, borderColor: g.d }}>
                      <span className={s.aiChipDot} style={{ background: g.c }} />
                      {sp.label}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
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
