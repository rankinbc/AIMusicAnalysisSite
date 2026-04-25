import { useState, useEffect, useRef, useCallback } from 'react';
import { EQLoader } from './primitives';
import { streamJob } from '../api/client';

const PHASE_META = [
  {
    name:     'Universal Mix Analysis',
    measures: ['LUFS', 'True Peak', 'BPM', 'Key', 'Stereo Width', 'Clipping'],
    steps: [
      { at: 0,  msg: 'Loading audio file…' },
      { at: 10, msg: 'Measuring LUFS and dynamic range…' },
      { at: 28, msg: 'Detecting BPM with beat tracker…' },
      { at: 44, msg: 'Identifying key signature via chroma…' },
      { at: 60, msg: 'Analysing frequency bands (sub → air)…' },
      { at: 76, msg: 'Measuring stereo width and correlation…' },
      { at: 88, msg: 'Scanning for digital clipping…' },
    ],
  },
  {
    name:     'Genre Detection',
    measures: ['Genre', 'Confidence', 'Sub-genre'],
    steps: [
      { at: 0,  msg: 'Extracting spectral feature vectors…' },
      { at: 35, msg: 'Running genre classifier…' },
      { at: 70, msg: 'Weighting confidence scores…' },
      { at: 88, msg: 'Selecting best-fit genre…' },
    ],
  },
  {
    name:     'Genre-Specific Scoring',
    measures: ['Sub-scores', 'Genre fit', 'Fix queue', 'Grade'],
    steps: [
      { at: 0,  msg: 'Loading genre reference model…' },
      { at: 25, msg: 'Scoring energy and dynamics sub-dimensions…' },
      { at: 48, msg: 'Scoring spectral balance and stereo…' },
      { at: 68, msg: 'Computing overall genre-fit score…' },
      { at: 82, msg: 'Ranking and prioritising fix queue…' },
    ],
  },
  {
    name:     'Stem Separation & Clash Detection',
    measures: ['Kick vs Bass', 'Mid clashes', 'EQ suggestions'],
    steps: [
      { at: 0,  msg: 'Separating stems via spectral analysis…' },
      { at: 30, msg: 'Comparing kick and bass frequency overlap…' },
      { at: 55, msg: 'Detecting mid-range masking clashes…' },
      { at: 78, msg: 'Generating EQ cut suggestions…' },
    ],
  },
  {
    name:     'Reference Comparison',
    measures: ['Loudness delta', 'Spectral gap', 'Dynamic gap'],
    steps: [
      { at: 0,  msg: 'Loading reference track profile…' },
      { at: 30, msg: 'Aligning integrated loudness levels…' },
      { at: 55, msg: 'Comparing band-by-band spectral shape…' },
      { at: 80, msg: 'Computing gap scores per dimension…' },
    ],
  },
  {
    name:     'Gap Analysis',
    measures: ['Percentile', 'Benchmark gaps', 'Improvement deltas'],
    steps: [
      { at: 0,  msg: 'Computing genre percentile rank…' },
      { at: 40, msg: 'Ranking against reference library…' },
      { at: 72, msg: 'Calculating per-feature improvement deltas…' },
    ],
  },
  {
    name:     'Arrangement Advice',
    measures: ['Sections', 'Structure', 'Violations'],
    steps: [
      { at: 0,  msg: 'Detecting track sections and transitions…' },
      { at: 35, msg: 'Checking intro / drop / breakdown length…' },
      { at: 65, msg: 'Identifying arrangement convention violations…' },
      { at: 84, msg: 'Generating arrangement notes…' },
    ],
  },
];

// Error type → human-readable explanation
const ERROR_HINTS = {
  stream:   'The live progress connection dropped. Your file was uploaded successfully — try again and the server should pick it up.',
  timeout:  'The analysis took longer than expected and timed out. Large files or heavy phases (like stem separation) sometimes need a retry.',
  auth:     'Your session expired during analysis. Sign in again to continue.',
  default:  'Something went wrong on the server. Your file was received — try submitting again.',
};

function classifyError(err) {
  const msg = (err?.message ?? '').toLowerCase();
  if (msg.includes('401') || msg.includes('unauthorized')) return 'auth';
  if (msg.includes('timeout') || msg.includes('timed out'))  return 'timeout';
  if (msg.includes('stream') || msg.includes('eventsource') || msg.includes('network')) return 'stream';
  return 'default';
}

function phaseStep(phaseIdx, pct) {
  const steps = PHASE_META[phaseIdx]?.steps ?? [];
  let msg = steps[0]?.msg ?? '';
  for (const s of steps) { if (pct >= s.at) msg = s.msg; }
  return msg;
}

function fmtElapsed(s) {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

const mono = { fontFamily: "'JetBrains Mono', monospace" };

export default function ProcessingPage({ file, jobId, onComplete, onError }) {
  const [phases,       setPhases]       = useState([]);
  const [currentPhase, setCurrentPhase] = useState(0);
  const [phasePct,     setPhasePct]     = useState(0);
  const [elapsed,      setElapsed]      = useState(0);
  const [error,        setError]        = useState(null); // { phase, phaseName, kind, raw }

  const cleanupRef    = useRef(null);
  const latestPhaseRef = useRef(0); // mutable – readable inside SSE callback without stale closure

  // Elapsed timer
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!jobId) return;

    const cleanup = streamJob(
      jobId,
      (data) => {
        const phase = data.phase ?? 0;
        const pct   = data.pct ?? 0;
        latestPhaseRef.current = phase;
        setCurrentPhase(phase);
        setPhasePct(pct);
        setPhases(prev => (!prev.includes(phase) && phase > 0) ? [...prev, phase] : prev);
      },
      () => onComplete(),
      (err) => {
        // 401 → let parent log out immediately
        if (err?.message?.includes('401') || err?.message?.includes('Unauthorized')) {
          onError?.(err);
          return;
        }
        // All other errors: stay on this page, show clear error state
        const failedPhase = latestPhaseRef.current;
        setError({
          phase:     failedPhase,
          phaseName: PHASE_META[failedPhase - 1]?.name ?? 'Unknown phase',
          kind:      classifyError(err),
          raw:       err,
        });
      },
    );

    cleanupRef.current = cleanup;
    return () => cleanup();
  }, [jobId, onComplete, onError]);

  const handleStartOver = useCallback(() => {
    onError?.(error?.raw ?? new Error('User dismissed'));
  }, [onError, error]);

  const totalPhases    = PHASE_META.length;
  const completedCount = phases.filter(p => p < currentPhase).length;
  const overallPct     = Math.round(((completedCount + phasePct / 100) / totalPhases) * 100);
  const activeIdx      = currentPhase - 1;

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', padding: '48px 24px',
    }}>

      {/* Logo */}
      <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: '0.22em', color: 'var(--cyan)', marginBottom: 40 }}>
        SPECTR
      </div>

      {/* EQ animation — dims on error */}
      <div style={{ opacity: error ? 0.25 : 1, transition: 'opacity 0.5s' }}>
        <EQLoader count={12} height={44} />
      </div>

      {/* Title */}
      <div style={{ marginTop: 28, textAlign: 'center', marginBottom: 32 }}>
        <div style={{ fontWeight: 700, fontSize: 22 }}>
          {error ? 'Analysis interrupted' : 'Analyzing your track'}
        </div>
        {file && (
          <div style={{ ...mono, fontSize: 12, color: error ? 'var(--muted)' : 'var(--cyan)', marginTop: 6, opacity: 0.8 }}>
            {file.name}
          </div>
        )}
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="fade-in" style={{
          width: '100%', maxWidth: 540, marginBottom: 24,
          background: 'rgba(244,63,94,0.08)',
          border: '1px solid rgba(244,63,94,0.4)',
          borderRadius: 12, padding: '20px 24px',
          boxShadow: '0 0 32px rgba(244,63,94,0.08)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
            {/* Icon */}
            <div style={{
              width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
              background: 'rgba(244,63,94,0.15)', border: '1px solid rgba(244,63,94,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16,
            }}>✕</div>

            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--red)', marginBottom: 4 }}>
                Failed during {error.phaseName}
              </div>
              <div style={{ ...mono, fontSize: 11, color: 'rgba(244,63,94,0.7)', lineHeight: 1.6 }}>
                {ERROR_HINTS[error.kind]}
              </div>
            </div>
          </div>

          {/* Completed count */}
          {completedCount > 0 && (
            <div style={{ ...mono, fontSize: 10, color: 'var(--muted)', marginBottom: 16 }}>
              {completedCount} of {totalPhases} phases completed before the error.
            </div>
          )}

          <button
            onClick={handleStartOver}
            style={{
              width: '100%', padding: '11px', borderRadius: 8, cursor: 'pointer',
              background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.4)',
              color: 'var(--red)', fontSize: 14, fontWeight: 700,
              fontFamily: 'inherit', letterSpacing: '0.04em',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(244,63,94,0.22)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(244,63,94,0.12)'}
          >
            ← Start Over
          </button>
        </div>
      )}

      {/* ── Overall progress bar (hidden after error) ── */}
      {!error && (
        <div style={{ width: '100%', maxWidth: 540, marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ ...mono, fontSize: 10, color: 'var(--muted)' }}>
              Phase {currentPhase > 0 ? currentPhase : '—'} of {totalPhases}
            </span>
            <div style={{ display: 'flex', gap: 16 }}>
              <span style={{ ...mono, fontSize: 10, color: 'var(--cyan)' }}>{overallPct}%</span>
              <span style={{ ...mono, fontSize: 10, color: 'var(--muted)' }}>{fmtElapsed(elapsed)}</span>
            </div>
          </div>
          <div style={{ height: 4, background: 'var(--dim)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%', background: 'var(--cyan)', borderRadius: 2,
              width: `${overallPct}%`, transition: 'width 0.9s ease',
              boxShadow: '0 0 10px var(--cyan)',
            }} />
          </div>
        </div>
      )}

      {/* ── Phase list ── */}
      <div style={{ width: '100%', maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {PHASE_META.map((meta, i) => {
          const phaseNum = i + 1;
          const done     = phaseNum < currentPhase;
          const failed   = error != null && phaseNum === currentPhase;
          const active   = !error && phaseNum === currentPhase;
          const pending  = phaseNum > currentPhase;

          // ── Completed ──
          if (done) return (
            <div key={i} className="fade-in" style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '9px 14px', borderRadius: 8,
              background: 'rgba(0,229,176,0.04)',
              border: '1px solid rgba(0,229,176,0.1)',
            }}>
              <div style={{
                width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                background: 'var(--cyan-dim)', border: '1px solid var(--cyan)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontSize: 9, color: 'var(--cyan)' }}>✓</span>
              </div>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                {meta.name}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {meta.measures.map(m => (
                  <span key={m} style={{
                    ...mono, fontSize: 8, padding: '2px 6px', borderRadius: 3,
                    background: 'rgba(0,229,176,0.08)', color: 'var(--cyan)', letterSpacing: '0.05em',
                  }}>{m}</span>
                ))}
              </div>
            </div>
          );

          // ── Failed ──
          if (failed) return (
            <div key={i} className="fade-in" style={{
              padding: '16px 18px', borderRadius: 10,
              background: 'rgba(244,63,94,0.06)',
              border: '1px solid rgba(244,63,94,0.35)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                  background: 'rgba(244,63,94,0.15)', border: '1px solid rgba(244,63,94,0.4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, color: 'var(--red)',
                }}>✕</div>
                <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: 'var(--red)' }}>
                  {meta.name}
                </div>
                <span style={{ ...mono, fontSize: 9, color: 'rgba(244,63,94,0.6)' }}>
                  {Math.round(phasePct)}% when interrupted
                </span>
              </div>
            </div>
          );

          // ── Active ──
          if (active) return (
            <div key={i} style={{
              padding: '16px 18px', borderRadius: 10,
              background: 'var(--card)',
              border: '1px solid rgba(0,229,176,0.3)',
              boxShadow: '0 0 20px rgba(0,229,176,0.06)',
              animation: 'borderBreath 2.5s ease-in-out infinite',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <div style={{
                  width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                  border: '2px solid var(--cyan)', borderTopColor: 'transparent',
                  animation: 'spin 0.7s linear infinite',
                }} />
                <div style={{ flex: 1, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                  {meta.name}
                </div>
                <span style={{ ...mono, fontSize: 11, color: 'var(--cyan)' }}>
                  {Math.round(phasePct)}%
                </span>
              </div>

              <div style={{ ...mono, fontSize: 11, color: 'var(--muted)', marginBottom: 12, minHeight: 16 }}>
                {phaseStep(activeIdx, phasePct)}
              </div>

              <div style={{ height: 3, background: 'var(--dim)', borderRadius: 2, overflow: 'hidden', marginBottom: 12 }}>
                <div style={{
                  height: '100%', background: 'var(--cyan)', borderRadius: 2,
                  width: `${phasePct}%`, transition: 'width 0.6s ease',
                }} />
              </div>

              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                <span style={{ ...mono, fontSize: 8, color: 'var(--muted)', letterSpacing: '0.08em', alignSelf: 'center' }}>
                  MEASURES
                </span>
                {meta.measures.map(m => (
                  <span key={m} style={{
                    ...mono, fontSize: 8, padding: '2px 7px', borderRadius: 3,
                    background: 'rgba(0,229,176,0.1)', border: '1px solid rgba(0,229,176,0.2)',
                    color: 'var(--cyan)', letterSpacing: '0.05em',
                  }}>{m}</span>
                ))}
              </div>
            </div>
          );

          // ── Pending ──
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '9px 14px', borderRadius: 8,
              opacity: error ? 0.15 : 0.3,
              transition: 'opacity 0.4s',
            }}>
              <div style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--muted)' }} />
              </div>
              <div style={{ flex: 1, fontSize: 13, color: 'var(--muted)' }}>{meta.name}</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {meta.measures.slice(0, 2).map(m => (
                  <span key={m} style={{ ...mono, fontSize: 8, color: 'var(--dim)' }}>{m}</span>
                ))}
                {meta.measures.length > 2 && (
                  <span style={{ ...mono, fontSize: 8, color: 'var(--dim)' }}>+{meta.measures.length - 2}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!error && (
        <div style={{ ...mono, fontSize: 10, color: 'var(--dim)', marginTop: 40, textAlign: 'center' }}>
          Full analysis runs all 7 phases — this typically takes 30–90 seconds
        </div>
      )}
    </div>
  );
}
