import { useState, useRef, useCallback } from 'react';
import { SPECIALISTS, SPECIALIST_LABELS, runTriage, streamSpecialist } from '../api/experts.js';
import { Label, EQLoader } from './primitives.jsx';

// ── Inline markdown renderer ──────────────────────────────────────────────────

function parseInline(text) {
  const parts = [];
  let rem = text;
  let k = 0;
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
        }}>
          {rem.slice(codeIdx + 1, end)}
        </code>
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
        }}>
          <code>{codeLines.join('\n')}</code>
        </pre>
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
    } else if (line.trim() === '') {
      // skip blank lines
    } else {
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

// ── Specialist card (presentational) ─────────────────────────────────────────

function SpecialistCard({ name, spec, isRecommended, isExpanded, onRun, onCancel, onToggle }) {
  const { state, text, error } = spec;
  const isActive = state === 'loading';
  const isDone   = state === 'done';
  const isErr    = state === 'error';
  const hasText  = text.length > 0;

  return (
    <div style={{
      background: 'var(--card)',
      border: `1px solid ${isRecommended ? 'rgba(167,139,250,0.4)' : 'var(--border)'}`,
      borderRadius: 10, overflow: 'hidden',
      transition: 'border-color 0.2s',
    }}>
      {/* Header row */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '11px 14px',
        background: isRecommended ? 'rgba(167,139,250,0.05)' : 'transparent',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          {isRecommended && (
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--violet)', flexShrink: 0 }} />
          )}
          <span style={{
            fontWeight: 600, fontSize: 13,
            color: isRecommended ? 'var(--violet)' : 'var(--text)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {SPECIALIST_LABELS[name]}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, marginLeft: 8 }}>
          {hasText && (
            <button onClick={onToggle} style={{
              background: 'none', border: 'none', color: 'var(--muted)',
              fontSize: 11, cursor: 'pointer', padding: '3px 6px',
            }}>
              {isExpanded ? '▲' : '▼'}
            </button>
          )}
          {isActive ? (
            <button onClick={onCancel} style={{
              background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)',
              color: 'var(--red)', fontSize: 11, padding: '4px 10px', borderRadius: 5,
              cursor: 'pointer', fontFamily: 'Syne', fontWeight: 600,
            }}>
              Cancel
            </button>
          ) : (
            <button onClick={onRun} style={{
              background: isDone ? 'rgba(0,229,176,0.06)' : 'rgba(0,229,176,0.12)',
              border: `1px solid ${isDone ? 'rgba(0,229,176,0.2)' : 'rgba(0,229,176,0.4)'}`,
              color: 'var(--cyan)', fontSize: 11, padding: '4px 12px', borderRadius: 5,
              cursor: 'pointer', fontFamily: 'Syne', fontWeight: 700,
            }}>
              {isDone ? 'Re-run' : 'Run'}
            </button>
          )}
        </div>
      </div>

      {/* Inline loading indicator (no text yet) */}
      {isActive && !hasText && (
        <div style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid var(--border)' }}>
          <EQLoader bars={6} height={14} color="var(--cyan)" />
          <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>Analyzing…</span>
        </div>
      )}

      {/* Error */}
      {isErr && (
        <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--red)', borderTop: '1px solid var(--border)' }}>
          {error}
        </div>
      )}

      {/* Streaming / done output */}
      {hasText && isExpanded && (
        <div style={{ padding: '2px 16px 16px', borderTop: '1px solid var(--border)' }}>
          <MarkdownBlock text={text} streaming={isActive} />
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

const initSpecState = () =>
  Object.fromEntries(SPECIALISTS.map(n => [n, { state: 'idle', text: '', error: '' }]));

export default function ExpertsPanel({ jobId }) {
  const [triageState,    setTriageState]    = useState('idle');
  const [triageText,     setTriageText]     = useState('');
  const [triageError,    setTriageError]    = useState('');
  const [recommended,    setRecommended]    = useState([]);
  const [triageExpanded, setTriageExpanded] = useState(true);
  const [specs,          setSpecs]          = useState(initSpecState);
  const [expanded,       setExpanded]       = useState({});
  const [showAll,        setShowAll]        = useState(false);
  const cancelRefs = useRef({});

  // ── Triage ──
  const handleTriage = useCallback(async () => {
    setTriageState('loading');
    setTriageText('');
    setTriageError('');
    setRecommended([]);
    setShowAll(false);
    try {
      const result = await runTriage(jobId);
      setTriageText(result.text ?? '');
      const recs = (result.recommended_specialists ?? []).filter(n => SPECIALIST_LABELS[n]);
      setRecommended(recs);
      setTriageState('done');
      setTriageExpanded(true);
      // Auto-expand recommended cards when triage completes
      setExpanded(prev => Object.fromEntries(recs.map(n => [n, prev[n] ?? false])));
    } catch (err) {
      setTriageError(err.message ?? 'Triage failed');
      setTriageState('error');
    }
  }, [jobId]);

  // ── Specialist run / cancel ──
  const handleRun = useCallback((name) => {
    setSpecs(prev => ({ ...prev, [name]: { state: 'loading', text: '', error: '' } }));
    setExpanded(prev => ({ ...prev, [name]: true }));

    cancelRefs.current[name] = streamSpecialist(
      jobId, name,
      (chunk) => setSpecs(prev => ({ ...prev, [name]: { ...prev[name], text: prev[name].text + chunk } })),
      ()      => setSpecs(prev => ({ ...prev, [name]: { ...prev[name], state: 'done' } })),
      (err)   => setSpecs(prev => ({ ...prev, [name]: { ...prev[name], state: 'error', error: err } })),
    );
  }, [jobId]);

  const handleCancel = useCallback((name) => {
    if (cancelRefs.current[name]) { cancelRefs.current[name](); delete cancelRefs.current[name]; }
    setSpecs(prev => ({ ...prev, [name]: { state: 'idle', text: '', error: '' } }));
  }, []);

  const toggleExpanded = useCallback((name) => {
    setExpanded(prev => ({ ...prev, [name]: !prev[name] }));
  }, []);

  const visibleSpecialists = showAll ? SPECIALISTS : recommended;
  const triageDone = triageState === 'done';

  return (
    <div style={{ marginTop: 56 }}>
      {/* Section header */}
      <div style={{ marginBottom: 20 }}>
        <Label>Expert Analysis</Label>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
          24 specialist AI systems · Each does a deep-dive on a specific mix dimension · Powered by Claude
        </p>
      </div>

      {/* Triage card */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 12, marginBottom: 20, overflow: 'hidden',
      }}>
        <div style={{
          padding: '16px 20px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
          borderBottom: triageDone && triageExpanded ? '1px solid var(--border)' : 'none',
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Triage</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
              {triageState === 'idle'    && 'Start here — Claude reads your full analysis and ranks the biggest problems'}
              {triageState === 'loading' && 'Reading your analysis…'}
              {triageDone               && `${recommended.length} specialist${recommended.length !== 1 ? 's' : ''} recommended`}
              {triageState === 'error'   && <span style={{ color: 'var(--red)' }}>{triageError}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {triageDone && (
              <button onClick={() => setTriageExpanded(e => !e)} style={{
                background: 'none', border: 'none', color: 'var(--muted)',
                fontSize: 12, cursor: 'pointer', padding: '6px 10px',
              }}>
                {triageExpanded ? 'Collapse ▲' : 'Report ▼'}
              </button>
            )}
            <button
              onClick={handleTriage}
              disabled={triageState === 'loading'}
              style={{
                background: triageDone ? 'rgba(0,229,176,0.06)' : 'rgba(0,229,176,0.14)',
                border: '1px solid rgba(0,229,176,0.35)',
                color: triageState === 'loading' ? 'var(--muted)' : 'var(--cyan)',
                fontSize: 13, fontWeight: 700, padding: '8px 22px', borderRadius: 8,
                cursor: triageState === 'loading' ? 'default' : 'pointer',
                fontFamily: 'Syne',
              }}
            >
              {triageState === 'loading' ? 'Analyzing…' : triageDone ? 'Re-run Triage' : 'Run Triage'}
            </button>
          </div>
        </div>

        {triageDone && triageExpanded && (
          <div style={{ padding: '16px 20px' }}>
            <MarkdownBlock text={triageText} streaming={false} />
          </div>
        )}
      </div>

      {/* Specialist grid */}
      {(triageDone || showAll) && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {showAll ? `All ${SPECIALISTS.length} specialists` : `${recommended.length} recommended`}
            </div>
            <button onClick={() => setShowAll(s => !s)} style={{
              background: 'none', border: '1px solid var(--border)',
              color: 'var(--muted)', fontSize: 12, padding: '5px 14px',
              borderRadius: 6, cursor: 'pointer', fontFamily: 'Syne',
            }}>
              {showAll ? 'Show recommended' : `Show all ${SPECIALISTS.length} →`}
            </button>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 10,
          }}>
            {visibleSpecialists.map(name => (
              <SpecialistCard
                key={name}
                name={name}
                spec={specs[name]}
                isRecommended={recommended.includes(name)}
                isExpanded={!!expanded[name]}
                onRun={() => handleRun(name)}
                onCancel={() => handleCancel(name)}
                onToggle={() => toggleExpanded(name)}
              />
            ))}
          </div>
        </>
      )}

      {/* Show All trigger before triage (secondary entry point) */}
      {!triageDone && !showAll && (
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <button onClick={() => setShowAll(true)} style={{
            background: 'none', border: 'none',
            color: 'var(--muted)', fontSize: 12, cursor: 'pointer',
            textDecoration: 'underline', padding: '4px 8px',
          }}>
            Skip triage — browse all {SPECIALISTS.length} specialists
          </button>
        </div>
      )}
    </div>
  );
}
