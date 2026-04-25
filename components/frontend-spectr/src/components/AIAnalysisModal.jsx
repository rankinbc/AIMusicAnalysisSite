import { useState, useRef, useCallback, useEffect } from 'react';
import { SPECIALISTS, SPECIALIST_LABELS, runTriage, streamSpecialist } from '../api/experts.js';
import { EQLoader } from './primitives.jsx';

// ── Inline markdown renderer ──────────────────────────────────────────────────

function parseInline(text) {
  const parts = [];
  let rem = text, k = 0;
  while (rem.length > 0) {
    const boldIdx = rem.search(/\*\*/);
    const codeIdx = rem.search(/`[^`]/);
    if (boldIdx === -1 && codeIdx === -1) { parts.push(rem); break; }
    const boldFirst = boldIdx !== -1 && (codeIdx === -1 || boldIdx <= codeIdx);
    if (boldFirst) {
      if (boldIdx > 0) parts.push(rem.slice(0, boldIdx));
      const end = rem.indexOf('**', boldIdx + 2);
      if (end === -1) { parts.push(rem); break; }
      parts.push(<strong key={k++} style={{ color: 'var(--text)' }}>{rem.slice(boldIdx + 2, end)}</strong>);
      rem = rem.slice(end + 2);
    } else {
      if (codeIdx > 0) parts.push(rem.slice(0, codeIdx));
      const end = rem.indexOf('`', codeIdx + 1);
      if (end === -1) { parts.push(rem); break; }
      parts.push(
        <code key={k++} style={{
          fontFamily: 'JetBrains Mono, monospace', fontSize: '0.82em',
          background: 'rgba(0,229,176,0.08)', padding: '1px 5px',
          borderRadius: 3, color: 'var(--cyan)',
        }}>{rem.slice(codeIdx + 1, end)}</code>
      );
      rem = rem.slice(end + 1);
    }
  }
  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts;
}

function MarkdownBlock({ text, streaming }) {
  if (!text) return null;
  const lines = text.split('\n');
  const elements = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++; }
      elements.push(
        <pre key={`code-${i}`} style={{
          background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '12px 16px',
          fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
          color: 'var(--muted)', overflowX: 'auto', margin: '10px 0',
        }}><code>{codeLines.join('\n')}</code></pre>
      );
    } else if (line.startsWith('### ')) {
      elements.push(<h4 key={i} style={{ fontWeight: 700, fontSize: 13, margin: '14px 0 5px', color: 'var(--text)', letterSpacing: '0.02em' }}>{parseInline(line.slice(4))}</h4>);
    } else if (line.startsWith('## ')) {
      elements.push(<h3 key={i} style={{ fontWeight: 700, fontSize: 15, margin: '18px 0 7px', color: 'var(--cyan)' }}>{parseInline(line.slice(3))}</h3>);
    } else if (line.startsWith('# ')) {
      elements.push(<h2 key={i} style={{ fontWeight: 800, fontSize: 18, margin: '22px 0 9px', color: 'var(--cyan)' }}>{parseInline(line.slice(2))}</h2>);
    } else if (line.match(/^[-*] /)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^[-*] /)) { items.push(lines[i].slice(2)); i++; }
      elements.push(
        <ul key={`ul-${i}`} style={{ margin: '8px 0', paddingLeft: 20 }}>
          {items.map((it, j) => (
            <li key={j} style={{ marginBottom: 4, lineHeight: 1.65, color: 'var(--text)' }}>{parseInline(it)}</li>
          ))}
        </ul>
      );
      continue;
    } else if (line.trim() !== '') {
      elements.push(<p key={i} style={{ margin: '7px 0', lineHeight: 1.7, color: 'var(--text)' }}>{parseInline(line)}</p>);
    }
    i++;
  }
  return (
    <div style={{ fontSize: 14 }}>
      {elements}
      {streaming && (
        <span style={{
          display: 'inline-block', width: 7, height: 13, marginLeft: 2,
          background: 'var(--cyan)', verticalAlign: 'text-bottom',
          animation: 'eq 0.55s ease-in-out infinite alternate',
        }} />
      )}
    </div>
  );
}

// ── State helpers ─────────────────────────────────────────────────────────────

const initSpecState = () =>
  Object.fromEntries(SPECIALISTS.map(n => [n, { state: 'idle', text: '', error: '' }]));

// ── Inline panel (replaces full-screen modal) ─────────────────────────────────

export default function AIAnalysisPanel({ jobId }) {
  const [triageState,  setTriageState]  = useState('idle');
  const [triageText,   setTriageText]   = useState('');
  const [triageError,  setTriageError]  = useState('');
  const [recommended,  setRecommended]  = useState([]);
  const [specs,        setSpecs]        = useState(initSpecState);
  const [showAll,      setShowAll]      = useState(false);
  const [activeView,   setActiveView]   = useState('triage');
  const [expanded,     setExpanded]     = useState(false);
  const cancelRefs  = useRef({});
  const outputRef   = useRef(null);

  // Auto-scroll output as text streams in
  useEffect(() => {
    const el = outputRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (isNearBottom) el.scrollTop = el.scrollHeight;
  });

  // ── Triage ──
  const handleTriage = useCallback(async () => {
    setTriageState('loading');
    setTriageText('');
    setTriageError('');
    setRecommended([]);
    setActiveView('triage');
    setShowAll(false);
    try {
      const result = await runTriage(jobId);
      setTriageText(result.text ?? '');
      const recs = (result.recommended_specialists ?? []).filter(n => SPECIALIST_LABELS[n]);
      setRecommended(recs);
      setTriageState('done');
    } catch (err) {
      setTriageError(err.message ?? 'Triage failed');
      setTriageState('error');
    }
  }, [jobId]);

  // ── Specialist ──
  const handleRun = useCallback((name) => {
    setSpecs(prev => ({ ...prev, [name]: { state: 'loading', text: '', error: '' } }));
    setActiveView(name);
    cancelRefs.current[name] = streamSpecialist(
      jobId, name,
      (chunk) => setSpecs(prev => ({ ...prev, [name]: { ...prev[name], text: prev[name].text + chunk } })),
      ()      => setSpecs(prev => ({ ...prev, [name]: { ...prev[name], state: 'done' } })),
      (err)   => setSpecs(prev => ({ ...prev, [name]: { ...prev[name], state: 'error', error: err } })),
    );
  }, [jobId]);

  const handleCancel = useCallback((name) => {
    cancelRefs.current[name]?.();
    delete cancelRefs.current[name];
    setSpecs(prev => ({ ...prev, [name]: { state: 'idle', text: '', error: '' } }));
  }, []);

  // Auto-run triage on first mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { handleTriage(); }, []);

  // Expand to full height once triage finishes
  useEffect(() => {
    if (triageState === 'done' || triageState === 'error') setExpanded(true);
  }, [triageState]);

  const triageDone = triageState === 'done';
  const visibleSpecs = showAll
    ? SPECIALISTS
    : recommended.length > 0 ? recommended : SPECIALISTS;

  const isTriage     = activeView === 'triage';
  const activeSpec   = isTriage ? null : specs[activeView];
  const outputText   = isTriage ? triageText   : activeSpec?.text   ?? '';
  const outputState  = isTriage ? triageState  : activeSpec?.state  ?? 'idle';
  const outputError  = isTriage ? triageError  : activeSpec?.error  ?? '';
  const outputLabel  = isTriage ? 'TRIAGE REPORT' : (SPECIALIST_LABELS[activeView] ?? activeView).toUpperCase();
  const outputLoading = outputState === 'loading';

  return (
    <div style={{
      height: expanded ? 430 : 152,
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      marginBottom: 20,
      animation: 'fadeUp 0.28s cubic-bezier(0.16,1,0.3,1) both',
      transition: 'height 0.38s cubic-bezier(0.16,1,0.3,1)',
    }}>

      {/* ── Panel header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '11px 18px', borderBottom: '1px solid var(--border)',
        background: 'transparent',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 7, height: 7, borderRadius: '50%',
            background: 'var(--cyan)', boxShadow: '0 0 8px var(--cyan)',
            animation: 'pulse 2s ease-in-out infinite',
          }} />
          <span style={{
            fontFamily: 'Syne', fontWeight: 800, fontSize: 12,
            letterSpacing: '0.18em', color: 'var(--cyan)',
          }}>AI ANALYSIS</span>
        </div>
        {triageState === 'loading' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 13, height: 13, borderRadius: '50%',
              border: '2px solid var(--border)',
              borderTopColor: 'var(--cyan)',
              animation: 'spin 0.75s linear infinite',
            }} />
            <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em' }}>LOADING</span>
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left sidebar */}
        <div style={{
          width: 232, flexShrink: 0,
          borderRight: '1px solid var(--border)',
          background: 'var(--surface)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Specialists list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
              <span className="mono" style={{
                fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--muted)',
              }}>
                {showAll
                  ? `All ${SPECIALISTS.length}`
                  : triageDone
                    ? `${recommended.length} Recommended`
                    : 'Specialists'}
              </span>
              <button
                onClick={() => { setShowAll(s => { if (s) setExpanded(false); else setExpanded(true); return !s; }); }}
                style={{
                  background: 'none', border: 'none',
                  color: 'var(--muted)', fontSize: 10, cursor: 'pointer',
                  fontFamily: 'JetBrains Mono, monospace', padding: '2px 0',
                }}
              >{showAll ? '← fewer' : `all ${SPECIALISTS.length} →`}</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {visibleSpecs.map(name => {
                const sp    = specs[name];
                const isRec  = recommended.includes(name);
                const isAct  = activeView === name;
                const isDone = sp.state === 'done';
                const isLoad = sp.state === 'loading';

                return (
                  <button
                    key={name}
                    onClick={() => { setActiveView(name); setExpanded(true); }}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '6px 9px', borderRadius: 6, width: '100%', textAlign: 'left',
                      background: isAct
                        ? 'rgba(0,229,176,0.08)'
                        : isRec ? 'rgba(167,139,250,0.05)' : 'transparent',
                      border: `1px solid ${isAct
                        ? 'rgba(0,229,176,0.28)'
                        : isRec ? 'rgba(167,139,250,0.22)' : 'rgba(255,255,255,0.05)'}`,
                      cursor: 'pointer',
                      transition: 'all 0.12s',
                    }}
                  >
                    <span style={{
                      fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
                      color: isAct ? 'var(--cyan)' : isRec ? 'var(--violet)' : 'var(--muted)',
                      fontWeight: isAct || isRec ? 600 : 400,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      🤖 {SPECIALIST_LABELS[name]}
                    </span>
                    <span style={{ flexShrink: 0, marginLeft: 6, display: 'flex', alignItems: 'center' }}>
                      {isLoad && <EQLoader bars={3} height={8} color="var(--cyan)" />}
                      {isDone && !isLoad && <span style={{ color: 'var(--cyan)', fontSize: 11 }}>✓</span>}
                      {isRec && !isDone && !isLoad && (
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--violet)', display: 'inline-block' }} />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: output pane */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* Output header */}
          <div style={{
            padding: '9px 18px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'transparent', flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span className="mono" style={{
                fontSize: 11, letterSpacing: '0.1em', color: 'var(--text)', fontWeight: 600,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{outputLabel}</span>

              {outputLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <EQLoader bars={5} height={10} color="var(--cyan)" />
                  <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>streaming…</span>
                </div>
              )}
              {outputState === 'done' && (
                <span className="mono" style={{
                  fontSize: 9, color: 'var(--cyan)', padding: '2px 8px',
                  borderRadius: 99, background: 'rgba(0,229,176,0.08)',
                  border: '1px solid rgba(0,229,176,0.2)', flexShrink: 0,
                }}>COMPLETE</span>
              )}
              {outputState === 'error' && (
                <span className="mono" style={{
                  fontSize: 9, color: 'var(--red)', padding: '2px 8px',
                  borderRadius: 99, background: 'rgba(244,63,94,0.08)',
                  border: '1px solid rgba(244,63,94,0.2)', flexShrink: 0,
                }}>ERROR</span>
              )}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 12 }}>
              {!isTriage && activeSpec?.state === 'loading' && (
                <button onClick={() => handleCancel(activeView)} style={{
                  background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.28)',
                  color: 'var(--red)', fontSize: 11, padding: '4px 10px', borderRadius: 6,
                  cursor: 'pointer', fontFamily: 'Syne', fontWeight: 600,
                }}>Cancel</button>
              )}
              {!isTriage && (activeSpec?.state === 'idle' || activeSpec?.state === 'done') && (
                <button onClick={() => handleRun(activeView)} style={{
                  background: 'rgba(0,229,176,0.1)', border: '1px solid rgba(0,229,176,0.35)',
                  color: 'var(--cyan)', fontSize: 11, padding: '4px 12px', borderRadius: 6,
                  cursor: 'pointer', fontFamily: 'Syne', fontWeight: 700,
                }}>{activeSpec?.state === 'done' ? 'Re-run' : 'Run'}</button>
              )}
            </div>
          </div>

          {/* Scrollable output */}
          <div
            ref={outputRef}
            style={{
              flex: 1, overflowY: 'auto', padding: '18px 24px',
              backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(0,0,0,0.025) 1px, rgba(0,0,0,0.025) 2px)',
            }}
          >
            {!outputText && !outputLoading && outputState !== 'error' && (
              <div style={{
                height: '100%', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 12, opacity: 0.5,
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  border: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, color: 'var(--muted)',
                }}>✦</div>
                <p className="mono" style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.7 }}>
                  {isTriage
                    ? 'Run Triage to get a ranked breakdown\nof your mix\'s biggest issues'
                    : `Select Run to start the\n${SPECIALIST_LABELS[activeView] ?? ''} analysis`}
                </p>
              </div>
            )}

            {outputState === 'error' && (
              <div className="mono" style={{ fontSize: 12, color: 'var(--red)', lineHeight: 1.6 }}>
                Error: {outputError}
              </div>
            )}

            {outputText && <MarkdownBlock text={outputText} streaming={outputLoading} />}
          </div>
        </div>
      </div>
    </div>
  );
}
