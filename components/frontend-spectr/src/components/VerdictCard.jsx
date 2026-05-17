// ── Severity helpers ──────────────────────────────────────────────────────────

export const SEV_COLOR = {
  critical: 'var(--red)',
  severe:   'var(--orange)',
  moderate: 'var(--yellow)',
  minor:    'var(--cyan)',
  win:      'var(--green)',
};

export const SEV_BG = {
  critical: 'rgba(244,63,94,0.08)',
  severe:   'rgba(251,146,60,0.08)',
  moderate: 'rgba(251,191,36,0.08)',
  minor:    'rgba(0,229,176,0.06)',
  win:      'rgba(52,211,153,0.08)',
};

// ── Verdict card ──────────────────────────────────────────────────────────────

export default function VerdictCard({
  verdict, isExpanded, onToggle, onDismiss, onFeedback, feedback,
}) {
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
