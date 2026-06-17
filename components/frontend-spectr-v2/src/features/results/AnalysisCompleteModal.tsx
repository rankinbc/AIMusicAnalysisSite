// Analysis Complete modal — the teaser/conversion surface shown after analysis.
// Recreates design_handoff_analysis_modal/Analysis Modal.html against real
// finalJson + the Triage routing plan. Two states: running + complete.

import { useEffect, useState } from 'react';

import type { FinalJson, RoutingPlanDto } from '../../api/types';
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
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    );
  if (kind === 'als')
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </svg>
    );
  if (kind === 'reference')
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3v12" />
        <circle cx="6" cy="18" r="3" />
        <path d="M12 9l9-3" />
      </svg>
    );
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
  const [aiOpen, setAiOpen] = useState(true);
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

  return (
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
              </div>
            </div>
            <button className={s.xBtn} aria-label="Close" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>

          {/* Body */}
          <div className={s.modalBody}>
            {isRunning ? (
              <RunView running={running!} R={R} C={C} pct={pct} />
            ) : (
              <>
                {/* Coach hero */}
                <div className={s.coachHero}>
                  <span className={s.chAv}>
                    <Sparkle />
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
                  <div>
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
                  </div>

                  <div>
                    <div className={s.sectionLabel}>
                      <span>Analysis steps</span>
                      <span className={s.line} />
                      <span>{ranCount} run · AI next</span>
                    </div>
                    <div className={s.pipe}>
                      {phaseRows.map((p) => (
                        <PhaseCard key={p.phase} p={p} open={openPhases.has(p.phase)} onToggle={() => togglePhase(p.phase)} />
                      ))}
                      <AiPhaseCard routing={routing} open={aiOpen} onToggle={() => setAiOpen((v) => !v)} onRun={onViewReport} />
                    </div>
                  </div>
                </div>

                {/* Inputs disclosure */}
                <div className={cx(s.disc, inputsOpen && s.open)}>
                  <button className={s.discHead} onClick={() => setInputsOpen((v) => !v)}>
                    <span className={s.dhL}>Inputs analyzed</span>
                    <span className={s.dhSum}>
                      {inSum.present.join(' · ')} · <b>{inSum.used}/4 sources</b>
                    </span>
                    <span className={s.chev}>
                      <Chevron n={14} />
                    </span>
                  </button>
                  {inputsOpen && (
                    <div className={s.discBody}>
                      <div className={s.inputsList}>
                        {inputs.map((r) => (
                          <div key={r.kind} className={cx(s.inRow, s[r.cls])}>
                            <span className={s.inIc}>
                              <InputIcon kind={r.kind} />
                            </span>
                            <div className={s.inTx}>
                              <span className={s.inK}>{r.label}</span>
                              <span className={s.inV}>{r.value}</span>
                            </div>
                            <span className={s.inMeta}>{r.meta}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className={s.modalFt}>
            {isRunning ? (
              <>
                <div className={s.ftMeta}>
                  Phase {running!.phaseIndex} of {running!.total} · analyzing your mix…
                </div>
                <button className={s.btn} onClick={onClose}>
                  Run in background
                </button>
              </>
            ) : (
              <>
                <div className={s.ftMeta}>
                  {props.analyzedSec ? (
                    <>
                      Analyzed in <b>{props.analyzedSec}s</b> · {ranCount} analyses ran
                    </>
                  ) : (
                    <>
                      <b>{ranCount}</b> analyses ran · AI specialists next
                    </>
                  )}
                </div>
                <button className={s.btn} onClick={onReanalyze}>
                  ↺ Re-analyze
                </button>
                <button className={cx(s.btn, s.primary)} onClick={onViewReport}>
                  View full report <ArrowRight />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function sevVar(sev: string): string {
  return sev === 'crit' ? 'red' : sev === 'mod' ? 'orange' : sev === 'min' ? 'blue' : 'cyan';
}

function PhaseCard({ p, open, onToggle }: { p: PhaseRow; open: boolean; onToggle: () => void }) {
  const st = p.status;
  return (
    <div className={cx(s.phase, open && s.open)} id={`ph-${p.phase}`}>
      <div className={s.phaseRow} onClick={onToggle}>
        <span className={cx(s.phaseStat, s[st])}>{STAT_GLYPH[st]}</span>
        <div className={s.phaseTxt}>
          <div className={s.pl}>
            {p.short} <span className={s.pnum}>phase {p.phase}</span>
          </div>
          <div className={s.pd}>{p.detail}</div>
        </div>
        <span className={cx(s.phaseTag, s[st])}>{STAT_TAG[st]}</span>
        <span className={s.chev}>
          <Chevron />
        </span>
      </div>
      {open && (
        <div className={s.phaseDetail}>
          {st === 'skipped' ? (
            <div className={s.detailEmpty}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M8 12h8" />
              </svg>
              {p.note ?? 'Not applicable for this run.'}
            </div>
          ) : (
            <>
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
              {p.note && (
                <div className={s.detailNote} style={{ marginTop: 10 }}>
                  {p.note}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AiPhaseCard({
  routing,
  open,
  onToggle,
  onRun,
}: {
  routing: ReturnType<typeof splitRouting>;
  open: boolean;
  onToggle: () => void;
  onRun: () => void;
}) {
  return (
    <div className={cx(s.phase, s.ai, open && s.open)}>
      <div className={s.phaseRow} onClick={onToggle}>
        <span className={cx(s.phaseStat, s.aiStat)}>
          <Sparkle n={12} />
        </span>
        <div className={s.phaseTxt}>
          <div className={s.pl}>
            AI Analysis <span className={s.pnum}>specialist deep-dive</span>
          </div>
          <div className={s.pd}>Runs when you open the full report</div>
        </div>
        <span className={cx(s.phaseTag, s.locked)}>in full report</span>
        <span className={s.chev}>
          <Chevron />
        </span>
      </div>
      {open && (
        <div className={s.phaseDetail}>
          {!routing ? (
            <>
              <div className={s.aiIntro}>
                <b>Triage AI</b> will route the right specialists for your mix and run a deeper,
                section-by-section analysis when you open the full report — then build a concrete
                DAW action plan.
              </div>
              <button className={s.scCta} onClick={onRun}>
                Run AI analysis in the full report <ArrowRight n={13} />
              </button>
            </>
          ) : (
            <>
              <div className={s.aiIntro}>
                <b>Triage AI</b> lined up <b>{routing.total} specialists</b>
                {routing.high.length ? (
                  <>
                    {' '}
                    — <b>{routing.high.length} high-priority</b> on what I found
                  </>
                ) : null}
                . They run when you open the full report.
              </div>
              <div className={s.aiSpecList}>
                {routing.high.map((sp, i) => {
              const g = GROUP_COLORS[sp.group];
              return (
                <div key={i} className={s.aiSpec}>
                  <span className={s.aiSpecAv} style={{ color: g.c, background: g.d }}>
                    {specInitials(sp.label)}
                  </span>
                  <div className={s.aiSpecTx}>
                    <div className={s.aiSpecName}>
                      {sp.label}{' '}
                      <span className={s.aiSpecGrp} style={{ color: g.c }}>
                        {sp.group}
                      </span>
                    </div>
                    <div className={s.aiSpecFocus}>{sp.focus}</div>
                  </div>
                </div>
              );
            })}
          </div>
          {routing.rest.length > 0 && (
            <>
              <div className={s.aiMoreLabel}>Also sweeping {routing.rest.length} more areas</div>
              <div className={s.aiChipRow}>
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
            </>
          )}
              <button className={s.scCta} onClick={onRun}>
                Run AI analysis in the full report <ArrowRight n={13} />
              </button>
            </>
          )}
        </div>
      )}
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
