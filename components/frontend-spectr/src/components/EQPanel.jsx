import { useState, useRef, useEffect, useCallback } from 'react';

export const EQ_BANDS = [
  { label: 'Sub',    freq: 60,    type: 'lowshelf',  Q: 0.7 },
  { label: 'Bass',   freq: 200,   type: 'peaking',   Q: 1.0 },
  { label: 'Lo-Mid', freq: 400,   type: 'peaking',   Q: 1.2 },
  { label: 'Mid',    freq: 1000,  type: 'peaking',   Q: 1.0 },
  { label: 'Hi-Mid', freq: 3500,  type: 'peaking',   Q: 1.2 },
  { label: 'Pres',   freq: 8000,  type: 'peaking',   Q: 1.0 },
  { label: 'Air',    freq: 16000, type: 'highshelf', Q: 0.7 },
];

const DB_MAX = 12;
const MIN_F  = 20;
const MAX_F  = 20000;
const FFT_N  = 2048;

const freqToX = (f, W) => (Math.log10(f / MIN_F) / Math.log10(MAX_F / MIN_F)) * W;
const gainToY = (db, H) => (H / 2) * (1 - db / DB_MAX);
const clamp   = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// filterNodes — BiquadFilterNode[] from StickyPlayer (shared audio graph)
// analyserNode — AnalyserNode from StickyPlayer
// playing — current playback state (for live FFT)
export default function EQPanel({
  filterNodes,
  analyserNode,
  playing = false,
  canvasHeight = 200,
  onToggleExpand,
  onClose,
  isExpanded = false,
}) {
  const [gains,    setGains]    = useState(() => EQ_BANDS.map(() => 0));
  const [bypass,   setBypass]   = useState(false);
  const [dragging, setDragging] = useState(null);

  const canvasRef       = useRef(null);
  const wrapRef         = useRef(null);
  const rafRef          = useRef(null);
  const gainsRef        = useRef(gains);
  const bypassRef       = useRef(false);
  const draggRef        = useRef(null);
  const playingRef      = useRef(playing);
  const chRef           = useRef(canvasHeight);
  const filterNodesRef  = useRef(filterNodes);
  const analyserNodeRef = useRef(analyserNode);

  useEffect(() => { gainsRef.current       = gains;        }, [gains]);
  useEffect(() => { bypassRef.current      = bypass;       }, [bypass]);
  useEffect(() => { draggRef.current       = dragging;     }, [dragging]);
  useEffect(() => { playingRef.current     = playing;      }, [playing]);
  useEffect(() => { filterNodesRef.current = filterNodes;  }, [filterNodes]);
  useEffect(() => { analyserNodeRef.current = analyserNode; }, [analyserNode]);

  // Push gains → shared filter nodes
  useEffect(() => {
    filterNodes?.forEach((f, i) => {
      if (f) f.gain.value = bypass ? 0 : gains[i];
    });
  }, [gains, bypass, filterNodes]);

  // Update canvas height when prop changes
  useEffect(() => {
    chRef.current = canvasHeight;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.height       = canvasHeight * dpr;
    canvas.style.height = canvasHeight + 'px';
  }, [canvasHeight]);

  // Single persistent RAF loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap   = wrapRef.current;
    if (!canvas || !wrap) return;

    let running = true;
    const dpr    = window.devicePixelRatio || 1;
    const fftBuf = new Uint8Array(FFT_N / 2);

    const setSize = () => {
      const W = wrap.clientWidth || 800;
      const H = chRef.current;
      canvas.width        = W * dpr;
      canvas.height       = H * dpr;
      canvas.style.width  = W + 'px';
      canvas.style.height = H + 'px';
    };
    setSize();

    const ro = new ResizeObserver(setSize);
    ro.observe(wrap);

    const draw = () => {
      if (!running) return;
      rafRef.current = requestAnimationFrame(draw);

      const W        = canvas.width / dpr;
      const H        = canvas.height / dpr;
      const c        = canvas.getContext('2d');
      const filters  = filterNodesRef.current ?? [];
      const analyser = analyserNodeRef.current;
      const curG     = gainsRef.current;
      const isBypass = bypassRef.current;
      const isDrag   = draggRef.current;

      c.save();
      c.scale(dpr, dpr);
      c.clearRect(0, 0, W, H);

      // Grid
      c.strokeStyle = 'rgba(255,255,255,0.033)';
      c.lineWidth   = 1;
      for (const db of [-9, -6, -3, 0, 3, 6, 9]) {
        const y = gainToY(db, H);
        c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
      }
      for (const f of [100, 200, 500, 1000, 2000, 5000, 10000]) {
        const x = freqToX(f, W);
        c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
      }

      // Axis labels
      c.fillStyle = 'rgba(100,116,139,0.45)';
      c.font      = "10px 'JetBrains Mono', monospace";
      for (const [f, lbl] of [[100,'100'],[500,'500'],[1000,'1k'],[5000,'5k'],[10000,'10k']]) {
        const x = freqToX(f, W);
        if (x > 20 && x < W - 20) c.fillText(lbl, x - 8, H - 5);
      }
      c.fillText('+12', 4, gainToY(12, H) + 10);
      c.fillText('  0', 4, gainToY(0,  H) + 4);
      c.fillText('-12', 4, gainToY(-12, H) - 2);

      // Live FFT
      if (analyser && playingRef.current) {
        analyser.getByteFrequencyData(fftBuf);
        const nyq = (analyser.context?.sampleRate ?? 44100) / 2;
        const bc  = analyser.frequencyBinCount;
        c.fillStyle = 'rgba(0,229,176,0.11)';
        const bars = 80;
        for (let i = 0; i < bars; i++) {
          const f0 = MIN_F * Math.pow(MAX_F / MIN_F, i / bars);
          const f1 = MIN_F * Math.pow(MAX_F / MIN_F, (i + 1) / bars);
          const b0 = Math.floor((f0 / nyq) * bc);
          const b1 = Math.min(Math.ceil((f1 / nyq) * bc), bc - 1);
          let peak = 0;
          for (let b = b0; b <= b1; b++) peak = Math.max(peak, fftBuf[b]);
          const v  = peak / 255;
          const x  = freqToX(f0, W);
          const bw = Math.max(1, freqToX(f1, W) - x - 1);
          c.fillRect(x, H * (1 - v), bw, H * v);
        }
      }

      // EQ curve
      if (filters.length) {
        const N      = Math.floor(W);
        const freqs  = new Float32Array(N);
        const totMag = new Float32Array(N).fill(1);
        const tmpMag = new Float32Array(N);
        const tmpPh  = new Float32Array(N);
        for (let i = 0; i < N; i++)
          freqs[i] = MIN_F * Math.pow(MAX_F / MIN_F, i / N);
        filters.forEach(f => {
          f.getFrequencyResponse(freqs, tmpMag, tmpPh);
          for (let i = 0; i < N; i++) totMag[i] *= tmpMag[i];
        });

        const grad = c.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, isBypass ? 'rgba(245,158,11,0.04)' : 'rgba(245,158,11,0.1)');
        grad.addColorStop(1, 'rgba(245,158,11,0)');
        c.beginPath(); c.moveTo(0, H / 2);
        for (let i = 0; i < N; i++) {
          const db = 20 * Math.log10(Math.max(1e-9, totMag[i]));
          c.lineTo(i, clamp(gainToY(db, H), 0, H));
        }
        c.lineTo(N - 1, H / 2); c.closePath();
        c.fillStyle = grad; c.fill();

        c.beginPath();
        c.strokeStyle = isBypass ? 'rgba(245,158,11,0.2)' : '#f59e0b';
        c.lineWidth   = 2;
        for (let i = 0; i < N; i++) {
          const db = 20 * Math.log10(Math.max(1e-9, totMag[i]));
          const y  = clamp(gainToY(db, H), 1, H - 1);
          i === 0 ? c.moveTo(0, y) : c.lineTo(i, y);
        }
        c.stroke();

        EQ_BANDS.forEach(({ freq }, i) => {
          const x   = freqToX(freq, W);
          const db  = isBypass ? 0 : curG[i];
          const y   = clamp(gainToY(db, H), 8, H - 8);
          const hot = isDrag?.idx === i;
          if (hot) {
            c.beginPath(); c.arc(x, y, 14, 0, Math.PI * 2);
            c.fillStyle = 'rgba(0,229,176,0.12)'; c.fill();
          }
          c.beginPath(); c.arc(x, y, hot ? 8 : 6, 0, Math.PI * 2);
          c.fillStyle = isBypass ? 'rgba(245,158,11,0.2)' : hot ? '#00e5b0' : '#f59e0b';
          c.fill();
          c.strokeStyle = '#070a12'; c.lineWidth = 2; c.stroke();
          if (Math.abs(db) > 0.3 || hot) {
            c.fillStyle  = hot ? '#00e5b0' : 'rgba(245,158,11,0.85)';
            c.font       = "bold 9px 'JetBrains Mono', monospace";
            c.textAlign  = 'center';
            const lbl    = `${db >= 0 ? '+' : ''}${db.toFixed(1)}`;
            const ly     = db >= 0 ? clamp(y - 14, 10, H - 10) : clamp(y + 21, 10, H - 10);
            c.fillText(lbl, x, ly);
            c.textAlign  = 'left';
          }
        });
      } else {
        c.strokeStyle = 'rgba(245,158,11,0.15)'; c.lineWidth = 1; c.setLineDash([5, 5]);
        c.beginPath(); c.moveTo(0, H / 2); c.lineTo(W, H / 2); c.stroke();
        c.setLineDash([]);
        EQ_BANDS.forEach(({ freq }) => {
          const x = freqToX(freq, W);
          c.beginPath(); c.arc(x, H / 2, 5, 0, Math.PI * 2);
          c.fillStyle = 'rgba(245,158,11,0.15)'; c.fill();
        });
      }

      // 0 dB centre rule
      c.strokeStyle = 'rgba(255,255,255,0.07)'; c.lineWidth = 1; c.setLineDash([3, 6]);
      c.beginPath(); c.moveTo(0, H / 2); c.lineTo(W, H / 2); c.stroke();
      c.setLineDash([]);

      c.restore();
    };

    draw();
    return () => { running = false; cancelAnimationFrame(rafRef.current); ro.disconnect(); };
  }, []);

  // Drag interaction
  const canvasXY = useCallback((clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const handleMouseDown = useCallback((e) => {
    const { x, y } = canvasXY(e.clientX, e.clientY);
    const W  = canvasRef.current.getBoundingClientRect().width;
    const H  = chRef.current;
    const curG = gainsRef.current;
    let best = -1, bestD = Infinity;
    EQ_BANDS.forEach(({ freq }, i) => {
      const d = Math.hypot(x - freqToX(freq, W), y - gainToY(curG[i], H));
      if (d < bestD) { bestD = d; best = i; }
    });
    if (bestD < 26) {
      e.preventDefault?.();
      const dr = { idx: best, startY: y, startG: curG[best] };
      setDragging(dr); draggRef.current = dr;
    }
  }, [canvasXY]);

  const handleMouseMove = useCallback((e) => {
    const dr = draggRef.current;
    if (!dr) return;
    const { y } = canvasXY(e.clientX, e.clientY);
    const H  = chRef.current;
    const raw = dr.startG + (dr.startY - y) * (DB_MAX / (H * 0.42));
    const g   = Math.round(clamp(raw, -DB_MAX, DB_MAX) * 10) / 10;
    setGains(prev => { const n = [...prev]; n[dr.idx] = g; return n; });
  }, [canvasXY]);

  const stopDrag = useCallback(() => { setDragging(null); draggRef.current = null; }, []);

  useEffect(() => {
    window.addEventListener('mouseup', stopDrag);
    return () => window.removeEventListener('mouseup', stopDrag);
  }, [stopDrag]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onTouchMove = (e) => {
      if (!draggRef.current) return;
      e.preventDefault();
      const t = e.touches[0];
      handleMouseMove({ clientX: t.clientX, clientY: t.clientY });
    };
    wrap.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => wrap.removeEventListener('touchmove', onTouchMove);
  }, [handleMouseMove]);

  const handleTouchStart = useCallback((e) => {
    const t = e.touches[0];
    handleMouseDown({ clientX: t.clientX, clientY: t.clientY, preventDefault: () => e.preventDefault() });
  }, [handleMouseDown]);

  const mono = { fontFamily: "'JetBrains Mono', monospace" };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        background: 'rgba(255,255,255,0.015)',
      }}>
        <span style={{ ...mono, fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#f59e0b', flex: 1 }}>
          Parametric EQ
        </span>

        <button onClick={() => setBypass(b => !b)} style={{
          ...mono, fontSize: 9, padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
          background: bypass ? 'rgba(244,63,94,0.1)' : 'rgba(245,158,11,0.1)',
          border: `1px solid ${bypass ? 'rgba(244,63,94,0.3)' : 'rgba(245,158,11,0.25)'}`,
          color: bypass ? 'var(--red)' : '#f59e0b',
        }}>
          {bypass ? '⊘ BYPASS' : '◉ ACTIVE'}
        </button>

        <button onClick={() => setGains(EQ_BANDS.map(() => 0))} style={{
          ...mono, fontSize: 9, padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
          background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)',
        }}>
          Flat
        </button>

        {onToggleExpand && (
          <button onClick={onToggleExpand} title={isExpanded ? 'Collapse' : 'Expand'} style={{
            ...mono, fontSize: 13, padding: '2px 7px', borderRadius: 5, cursor: 'pointer',
            background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', lineHeight: 1,
          }}>
            {isExpanded ? '⤓' : '⤒'}
          </button>
        )}

        {onClose && (
          <button onClick={onClose} title="Close EQ" style={{
            ...mono, fontSize: 13, padding: '2px 7px', borderRadius: 5, cursor: 'pointer',
            background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', lineHeight: 1,
          }}>
            ✕
          </button>
        )}
      </div>

      {/* Canvas */}
      <div
        ref={wrapRef}
        style={{
          position: 'relative', cursor: dragging ? 'ns-resize' : 'crosshair',
          userSelect: 'none', WebkitUserSelect: 'none',
          background: 'rgba(0,0,0,0.28)', flexShrink: 0,
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onTouchStart={handleTouchStart}
        onTouchEnd={stopDrag}
      >
        <canvas ref={canvasRef} style={{ display: 'block' }} />

        {!filterNodes?.length && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <span style={{ ...mono, fontSize: 10, color: 'rgba(100,116,139,0.35)' }}>
              Press play to activate EQ
            </span>
          </div>
        )}
      </div>

      {/* Band readout strip */}
      <div style={{ padding: '6px 14px', borderTop: '1px solid var(--border)', display: 'flex', flexShrink: 0 }}>
        {EQ_BANDS.map(({ label, freq }, i) => {
          const g   = gains[i];
          const col = Math.abs(g) < 0.05 ? 'var(--muted)' : g > 0 ? '#f59e0b' : 'var(--orange)';
          return (
            <div key={i} style={{ flex: 1, textAlign: 'center', cursor: 'pointer' }}
              onDoubleClick={() => setGains(prev => { const n = [...prev]; n[i] = 0; return n; })}
              title="Double-click to zero">
              <div style={{ ...mono, fontSize: 8, color: 'var(--muted)', marginBottom: 1 }}>
                {freq >= 1000 ? `${freq / 1000}k` : freq}
              </div>
              <div style={{ ...mono, fontSize: 10, fontWeight: 600, color: col, lineHeight: 1 }}>
                {g >= 0 ? '+' : ''}{g.toFixed(1)}
              </div>
              <div style={{ ...mono, fontSize: 8, color: 'rgba(100,116,139,0.4)', marginTop: 1 }}>{label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
