import { useState, useRef, useEffect, useCallback } from 'react';
import { EQLoader } from './primitives.jsx';
import { getVerdicts, streamVerdicts, dismissVerdict, giveFeedback } from '../api/verdicts.js';

// ── Severity helpers ──────────────────────────────────────────────────────────

const SEV_COLOR = {
  critical: 'var(--red)',
  severe:   'var(--orange)',
  moderate: 'var(--yellow)',
  minor:    'var(--cyan)',
  win:      'var(--green)',
};

const SEV_BG = {
  critical: 'rgba(244,63,94,0.08)',
  severe:   'rgba(251,146,60,0.08)',
  moderate: 'rgba(251,191,36,0.08)',
  minor:    'rgba(0,229,176,0.06)',
  win:      'rgba(52,211,153,0.08)',
};

// ── Verdict card ──────────────────────────────────────────────────────────────

function VerdictCard({ verdict, isExpanded, onToggle, onDismiss, onFeedback, feedback }) {
  const { verdict_id, severity, category, headline, summary, evidence, fix, why_it_matters } = verdict;
  const color = SEV_COLOR[severity] ?? 'var(--muted)';
  const bg    = SEV_BG[severity]    ?? 'transparent';

  return (
    <div style={{
      background: 'var(--surface)',
      border: `1px solid ${isExpanded ? 'rgba(255,255,255,0.12)' : 'var(--border)'}`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 8,
      overflow: 'hidden',
      transition: 'border-color 0.15s',
      flexShrink: 0,
    }}>
      {/* Card header — always visible */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          padding: '10px 14px', cursor: 'pointer',
          background: isExpanded ? bg : 'transparent',
        }}
      >
        {/* Severity dot */}
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: color, flexShrink: 0, marginTop: 5,
          boxShadow: `0 0 6px ${color}`,
        }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span className="mono" style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.14em',
              textTransform: 'uppercase', color,
            }}>
              {severity}
            </span>
            <span className="mono" style={{
              fontSize: 9, color: 'var(--muted)', letterSpacing: '0.08em',
            }}>
              {category?.replace(/_/g, ' ')}
            </span>
          </div>
          <div style={{
            fontWeight: 600, fontSize: 13, lineHeight: 1.4,
            color: 'var(--text)', overflow: 'hidden',
            display: '-webkit-box', WebkitLineClamp: isExpanded ? 'unset' : 2,
            WebkitBoxOrient: 'vertical',
          }}>
            {headline}
          </div>
        </div>

        <div style={{
          flexShrink: 0, color: 'var(--muted)', fontSize: 11,
          marginTop: 2, userSelect: 'none',
        }}>
          {isExpanded ? '▲' : '▼'}
        </div>
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border)' }}>

          {/* Summary */}
          {summary && (
            <p style={{ margin: '10px 0 8px', fontSize: 13, lineHeight: 1.65, color: 'var(--text)' }}>
              {summary}
            </p>
          )}

          {/* Evidence */}
          {evidence?.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div className="mono" style={{
                fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
                color: 'var(--muted)', marginBottom: 5,
              }}>Evidence</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {evidence.map((ev, i) => (
                  <div key={i} className="mono" style={{
                    fontSize: 11, color: 'var(--muted)',
                    background: 'rgba(0,0,0,0.25)', borderRadius: 4, padding: '4px 8px',
                  }}>
                    <span style={{ color: 'var(--text)' }}>{ev.label}</span>
                    {ev.value != null && (
                      <span> · <span style={{ color }}>{
                        typeof ev.value === 'number' ? ev.value.toFixed(2) : ev.value
                      }</span></span>
                    )}
                    {ev.expected_range != null && (
                      <span style={{ color: 'var(--dim)' }}>
                        {' '}(expected {ev.expected_range[0]}–{ev.expected_range[1]})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fix — full prescriptive recipe */}
          {fix && (
            <div style={{ marginBottom: 10 }}>
              <div className="mono" style={{
                fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
                color: 'var(--muted)', marginBottom: 5,
              }}>Do this</div>
              <div style={{
                background: 'rgba(0,229,176,0.05)', border: '1px solid rgba(0,229,176,0.15)',
                borderRadius: 5, padding: '8px 10px',
              }}>
                {/* Where to apply */}
                {(fix.target?.name || fix.target?.type || fix.section) && (
                  <div className="mono" style={{
                    fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em',
                    marginBottom: 6,
                  }}>
                    {fix.target?.type && fix.target?.name &&
                      <span style={{ color: 'var(--cyan)' }}>
                        {fix.target.type}: {fix.target.name}
                      </span>}
                    {fix.target?.type && !fix.target?.name &&
                      <span style={{ color: 'var(--cyan)' }}>{fix.target.type}</span>}
                    {fix.section && (
                      <span>
                        {(fix.target?.name || fix.target?.type) ? '  ·  ' : ''}
                        {fix.section.section_type ?? 'section'}{' '}
                        ({Math.round(fix.section.start_seconds ?? 0)}s–
                        {Math.round(fix.section.end_seconds ?? 0)}s)
                      </span>
                    )}
                  </div>
                )}

                {/* DSP chain — full per-step params */}
                {fix.dsp_chain?.length > 0 && (
                  <ol style={{
                    listStyle: 'none', padding: 0, margin: '0 0 6px 0',
                    display: 'flex', flexDirection: 'column', gap: 4,
                  }}>
                    {fix.dsp_chain.map((op, idx) => (
                      <li key={idx} style={{
                        fontSize: 12, lineHeight: 1.45, color: 'var(--text)',
                        display: 'flex', gap: 8,
                      }}>
                        <span className="mono" style={{
                          color: 'var(--muted)', fontSize: 10,
                          minWidth: 14, paddingTop: 2,
                        }}>{idx + 1}.</span>
                        <span>
                          <span className="mono" style={{
                            color: 'var(--cyan)', fontWeight: 700,
                            textTransform: 'lowercase',
                          }}>
                            {op.type?.replace(/_/g, ' ')}
                          </span>
                          {Object.keys(op.params ?? {}).length > 0 && (
                            <span className="mono" style={{ color: 'var(--text)', marginLeft: 6 }}>
                              {Object.entries(op.params).map(([k, v]) => {
                                const unit = k.endsWith('_hz') ? ' Hz'
                                  : k.endsWith('_db') ? ' dB'
                                  : k.endsWith('_ms') ? ' ms'
                                  : k.endsWith('_pct') ? '%'
                                  : '';
                                const display = typeof v === 'number'
                                  ? (Number.isInteger(v) ? v : v.toFixed(2))
                                  : v;
                                return (
                                  <span key={k} style={{ marginRight: 10 }}>
                                    <span style={{ color: 'var(--muted)' }}>{k.replace(/_/g, ' ')}</span>{' '}
                                    <span style={{ color: 'var(--text)' }}>{display}{unit}</span>
                                  </span>
                                );
                              })}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}

                {/* Sidechain config */}
                {fix.sidechain && (
                  <div className="mono" style={{
                    fontSize: 11, color: 'var(--text)',
                    padding: '4px 0', borderTop: '1px solid rgba(255,255,255,0.06)',
                    marginTop: 4,
                  }}>
                    <span style={{ color: 'var(--muted)' }}>sidechain:</span>{' '}
                    <span style={{ color: 'var(--cyan)' }}>{fix.sidechain.source_stem}</span>
                    {' → '}
                    <span>{fix.sidechain.depth_db} dB depth</span>
                    {fix.sidechain.release_ms != null && <span>, {fix.sidechain.release_ms} ms release</span>}
                  </div>
                )}

                {/* Ableton hint — load this preset */}
                {fix.ableton_hint && (fix.ableton_hint.device || fix.ableton_hint.preset_name) && (
                  <div className="mono" style={{
                    fontSize: 11, color: 'var(--text)',
                    padding: '4px 0', borderTop: '1px solid rgba(255,255,255,0.06)',
                    marginTop: 4,
                  }}>
                    <span style={{ color: 'var(--muted)' }}>ableton:</span>{' '}
                    {fix.ableton_hint.device && (
                      <span style={{ color: 'var(--cyan)' }}>{fix.ableton_hint.device}</span>
                    )}
                    {fix.ableton_hint.preset_name && (
                      <span>
                        {fix.ableton_hint.device ? '  ·  ' : ''}
                        preset “{fix.ableton_hint.preset_name}”
                      </span>
                    )}
                    {fix.ableton_hint.band != null && (
                      <span>  ·  band {fix.ableton_hint.band}</span>
                    )}
                  </div>
                )}

                {/* Expected outcome */}
                {fix.expected_outcome && (
                  <div style={{
                    fontSize: 12, fontStyle: 'italic', color: 'var(--muted)',
                    marginTop: 8, paddingTop: 6,
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    → {fix.expected_outcome}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Why it matters */}
          {why_it_matters && (
            <p style={{
              margin: '0 0 12px', fontSize: 12, lineHeight: 1.6,
              color: 'var(--muted)', fontStyle: 'italic',
            }}>
              {why_it_matters}
            </p>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {(['helpful', 'wrong', 'unclear']).map(fb => (
              <button
                key={fb}
                onClick={e => { e.stopPropagation(); onFeedback(verdict_id, fb); }}
                style={{
                  background: feedback === fb ? 'rgba(0,229,176,0.15)' : 'none',
                  border: `1px solid ${feedback === fb ? 'rgba(0,229,176,0.4)' : 'var(--border)'}`,
                  color: feedback === fb ? 'var(--cyan)' : 'var(--muted)',
                  fontSize: 11, padding: '3px 10px', borderRadius: 5,
                  cursor: 'pointer', fontFamily: 'Syne',
                }}
              >
                {fb === 'helpful' ? '👍' : fb === 'wrong' ? '👎' : '?'} {fb}
              </button>
            ))}
            <button
              onClick={e => { e.stopPropagation(); onDismiss(verdict_id); }}
              style={{
                background: 'none', border: '1px solid var(--border)',
                color: 'var(--dim)', fontSize: 11, padding: '3px 10px',
                borderRadius: 5, cursor: 'pointer', fontFamily: 'Syne', marginLeft: 'auto',
              }}
            >
              ✕ Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function AIAnalysisPanel({ jobId }) {
  const [panelState,    setPanelState]    = useState('idle');
  const [verdicts,      setVerdicts]      = useState([]);
  const [routingPlan,   setRoutingPlan]   = useState(null);
  const [error,         setError]         = useState('');
  const [expanded,      setExpanded]      = useState(false);
  const [dismissed,     setDismissed]     = useState(new Set());
  const [feedbacks,     setFeedbacks]     = useState({});
  const [expandedCards, setExpandedCards] = useState(new Set());
  const stopStreamRef = useRef(null);
  const listRef = useRef(null);

  // Auto-scroll list as new verdicts arrive
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (near) el.scrollTop = el.scrollHeight;
  }, [verdicts.length]);

  // On mount: check for cached verdicts
  useEffect(() => {
    getVerdicts(jobId).then(payload => {
      if (payload?.verdicts?.length) {
        setVerdicts(payload.verdicts);
        // Restore user state from server
        const fb = {};
        const dis = new Set();
        for (const v of payload.verdicts) {
          if (v.user_state?.feedback) fb[v.verdict_id] = v.user_state.feedback;
          if (v.user_state?.dismissed) dis.add(v.verdict_id);
        }
        setFeedbacks(fb);
        setDismissed(dis);
        setPanelState('done');
        setExpanded(true);
      }
      // 404 (null) → stays idle
    }).catch(() => {}); // ignore errors silently on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerate = useCallback(() => {
    stopStreamRef.current?.();
    setPanelState('loading');
    setExpanded(true);
    setVerdicts([]);
    setRoutingPlan(null);
    setError('');

    stopStreamRef.current = streamVerdicts(jobId, {
      onRoutingPlan: plan  => setRoutingPlan(plan),
      onVerdict:     v     => setVerdicts(prev => [...prev, v]),
      onComplete:    data  => {
        setVerdicts(data.verdicts ?? []);
        setPanelState('done');
      },
      onError:       msg   => {
        setError(msg);
        setPanelState('error');
      },
    });
  }, [jobId]);

  const handleDismiss = useCallback((id) => {
    setDismissed(prev => new Set([...prev, id]));
    dismissVerdict(id).catch(() => {});
  }, []);

  const handleFeedback = useCallback((id, fb) => {
    setFeedbacks(prev => ({ ...prev, [id]: fb }));
    giveFeedback(id, fb).catch(() => {});
  }, []);

  const toggleCard = useCallback((id) => {
    setExpandedCards(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }, []);

  const isLoading = panelState === 'loading';
  const isDone    = panelState === 'done';
  const visible   = verdicts.filter(v => !dismissed.has(v.verdict_id));
  const dismissedCount = dismissed.size;

  return (
    <div style={{
      height: expanded ? 560 : 152,
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      marginBottom: 20,
      animation: 'fadeUp 0.28s cubic-bezier(0.16,1,0.3,1) both',
      transition: 'height 0.38s cubic-bezier(0.16,1,0.3,1)',
    }}>

      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '11px 18px', borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 7, height: 7, borderRadius: '50%',
            background: 'var(--cyan)', boxShadow: '0 0 8px var(--cyan)',
          }} />
          <span style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 12, letterSpacing: '0.18em', color: 'var(--cyan)' }}>
            AI VERDICT ANALYSIS
          </span>
          {isLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <EQLoader bars={4} height={10} color="var(--cyan)" />
              <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
                {verdicts.length > 0 ? `${verdicts.length} found…` : 'running pipeline…'}
              </span>
            </div>
          )}
          {isDone && verdicts.length > 0 && (
            <span className="mono" style={{
              fontSize: 9, color: 'var(--cyan)', padding: '2px 8px',
              borderRadius: 99, background: 'rgba(0,229,176,0.08)',
              border: '1px solid rgba(0,229,176,0.2)',
            }}>
              {verdicts.length} verdict{verdicts.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {(isDone || panelState === 'error') && (
            <button onClick={handleGenerate} style={{
              background: 'none', border: '1px solid var(--border)',
              color: 'var(--muted)', fontSize: 11, padding: '4px 10px',
              borderRadius: 6, cursor: 'pointer', fontFamily: 'Syne',
            }}>↺ Regenerate</button>
          )}
          <button
            onClick={() => setExpanded(e => !e)}
            style={{
              background: 'none', border: 'none',
              color: 'var(--muted)', fontSize: 13, cursor: 'pointer', padding: '2px 4px',
            }}
          >{expanded ? '▲' : '▼'}</button>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* Routing plan strip */}
        {isLoading && routingPlan?.specialists_to_run?.length > 0 && (
          <div style={{
            padding: '7px 18px', borderBottom: '1px solid var(--border)',
            background: 'rgba(0,229,176,0.03)', flexShrink: 0,
          }}>
            <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
              Running: {routingPlan.specialists_to_run.map(s => s.name).join(' · ')}
            </span>
          </div>
        )}

        {/* Idle state */}
        {panelState === 'idle' && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 14,
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, color: 'var(--muted)', opacity: 0.5,
            }}>✦</div>
            <p className="mono" style={{
              fontSize: 11, color: 'var(--muted)', textAlign: 'center',
              lineHeight: 1.7, opacity: 0.7, margin: 0,
            }}>
              Run the full AI verdict pipeline<br />to get ranked, actionable mix fixes
            </p>
            <button onClick={handleGenerate} style={{
              background: 'rgba(0,229,176,0.14)', border: '1px solid rgba(0,229,176,0.4)',
              color: 'var(--cyan)', fontSize: 13, fontWeight: 700,
              padding: '9px 24px', borderRadius: 8, cursor: 'pointer', fontFamily: 'Syne',
            }}>
              Generate AI Analysis
            </button>
          </div>
        )}

        {/* Error state */}
        {panelState === 'error' && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 10,
          }}>
            <span className="mono" style={{ fontSize: 12, color: 'var(--red)' }}>{error}</span>
            <button onClick={handleGenerate} style={{
              background: 'none', border: '1px solid rgba(244,63,94,0.35)',
              color: 'var(--red)', fontSize: 12, padding: '6px 16px',
              borderRadius: 6, cursor: 'pointer', fontFamily: 'Syne',
            }}>Retry</button>
          </div>
        )}

        {/* Verdict list */}
        {(isLoading || isDone) && (
          <div
            ref={listRef}
            style={{ flex: 1, overflowY: 'auto', padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            {visible.length === 0 && isLoading && (
              <div style={{ padding: '20px 0', textAlign: 'center', opacity: 0.5 }}>
                <EQLoader bars={6} height={18} color="var(--cyan)" />
              </div>
            )}

            {visible.map(verdict => (
              <VerdictCard
                key={verdict.verdict_id}
                verdict={verdict}
                isExpanded={expandedCards.has(verdict.verdict_id)}
                onToggle={() => toggleCard(verdict.verdict_id)}
                onDismiss={handleDismiss}
                onFeedback={handleFeedback}
                feedback={feedbacks[verdict.verdict_id]}
              />
            ))}

            {dismissedCount > 0 && (
              <div className="mono" style={{
                fontSize: 10, color: 'var(--dim)', textAlign: 'center', padding: '4px 0',
              }}>
                {dismissedCount} dismissed
                <button
                  onClick={() => setDismissed(new Set())}
                  style={{
                    background: 'none', border: 'none', color: 'var(--muted)',
                    fontSize: 10, cursor: 'pointer', marginLeft: 8, fontFamily: 'inherit',
                    textDecoration: 'underline',
                  }}
                >restore</button>
              </div>
            )}

            {isDone && visible.length === 0 && dismissedCount === 0 && (
              <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', padding: 20 }}>
                No verdicts generated. Try regenerating.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
