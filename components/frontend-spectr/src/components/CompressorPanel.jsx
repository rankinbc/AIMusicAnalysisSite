import { useState, useRef, useEffect, useCallback } from 'react';

const DB_MIN = -60;
const DB_MAX = 0;

const DEFAULTS = { threshold: -24, knee: 8, ratio: 4, attack: 10, release: 200, makeup: 0 };

function computeCurve(threshold, knee, ratio) {
  const pts = [];
  for (let x = DB_MIN; x <= DB_MAX; x += 0.5) {
    let y;
    const kLow  = threshold - knee / 2;
    const kHigh = threshold + knee / 2;
    if (knee === 0 || x < kLow) {
      y = x < threshold ? x : threshold + (x - threshold) / ratio;
    } else if (x <= kHigh) {
      const d = x - kLow;
      y = x + (1 / ratio - 1) * (d * d) / (2 * knee);
    } else {
      y = threshold + (x - threshold) / ratio;
    }
    pts.push([x, y]);
  }
  return pts;
}

// compNode — DynamicsCompressorNode from StickyPlayer
// gainNode — GainNode (makeup gain) from StickyPlayer
export default function CompressorPanel({
  compNode,
  gainNode,
  canvasHeight = 200,
  onToggleExpand,
  onClose,
  isExpanded = false,
}) {
  const [params,    setParams]    = useState({ ...DEFAULTS });
  const [bypass,    setBypass]    = useState(false);
  const [reduction, setReduction] = useState(0);

  const canvasRef  = useRef(null);
  const wrapRef    = useRef(null);
  const rafRef     = useRef(null);
  const paramsRef  = useRef(params);
  const bypassRef  = useRef(false);
  const chRef      = useRef(canvasHeight);
  const compRef    = useRef(compNode);
  const gainRef    = useRef(gainNode);

  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { bypassRef.current = bypass;  }, [bypass]);
  useEffect(() => { compRef.current = compNode;  }, [compNode]);
  useEffect(() => { gainRef.current = gainNode;  }, [gainNode]);

  // Push params → shared nodes
  useEffect(() => {
    const comp = compRef.current;
    const gain = gainRef.current;
    if (!comp || !gain) return;
    if (bypass) {
      comp.threshold.value = 0;
      comp.ratio.value     = 1;
      comp.knee.value      = 0;
      comp.attack.value    = 0;
      comp.release.value   = 0.25;
      gain.gain.value      = 1;
    } else {
      comp.threshold.value = params.threshold;
      comp.knee.value      = params.knee;
      comp.ratio.value     = params.ratio;
      comp.attack.value    = params.attack / 1000;
      comp.release.value   = params.release / 1000;
      gain.gain.value      = Math.pow(10, params.makeup / 20);
    }
  }, [params, bypass]);

  // Update canvas height when prop changes
  useEffect(() => {
    chRef.current = canvasHeight;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.height       = canvasHeight * dpr;
    canvas.style.height = canvasHeight + 'px';
  }, [canvasHeight]);

  // RAF: draw transfer curve + poll GR
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap   = wrapRef.current;
    if (!canvas || !wrap) return;

    let running = true;
    const dpr   = window.devicePixelRatio || 1;

    const setSize = () => {
      const W = wrap.clientWidth || 400;
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

      const comp = compRef.current;
      if (comp) setReduction(Math.abs(comp.reduction ?? 0));

      const W = canvas.width / dpr;
      const H = canvas.height / dpr;
      const c = canvas.getContext('2d');
      const p = paramsRef.current;
      const isBypass = bypassRef.current;

      c.save();
      c.scale(dpr, dpr);
      c.clearRect(0, 0, W, H);

      const pad = { l: 28, r: 10, t: 10, b: 22 };
      const cw  = W - pad.l - pad.r;
      const ch  = H - pad.t - pad.b;

      const xP = v => pad.l + ((v - DB_MIN) / (DB_MAX - DB_MIN)) * cw;
      const yP = v => pad.t + ch - ((v - DB_MIN) / (DB_MAX - DB_MIN)) * ch;

      // Grid
      c.strokeStyle = 'rgba(255,255,255,0.05)';
      c.lineWidth   = 1;
      for (const db of [-48, -36, -24, -12]) {
        c.beginPath(); c.moveTo(xP(db), pad.t); c.lineTo(xP(db), pad.t + ch); c.stroke();
        c.beginPath(); c.moveTo(pad.l, yP(db)); c.lineTo(pad.l + cw, yP(db)); c.stroke();
      }

      // 1:1 reference diagonal
      c.strokeStyle = 'rgba(255,255,255,0.09)';
      c.setLineDash([4, 4]);
      c.beginPath(); c.moveTo(xP(DB_MIN), yP(DB_MIN)); c.lineTo(xP(DB_MAX), yP(DB_MAX)); c.stroke();
      c.setLineDash([]);

      // Threshold marker
      if (!isBypass) {
        c.strokeStyle = 'rgba(251,191,36,0.4)';
        c.lineWidth = 1;
        c.setLineDash([2, 3]);
        const xt = xP(p.threshold);
        c.beginPath(); c.moveTo(xt, pad.t); c.lineTo(xt, pad.t + ch); c.stroke();
        c.setLineDash([]);
      }

      // Transfer curve
      const pts = isBypass ? [] : computeCurve(p.threshold, p.knee, p.ratio);
      if (pts.length) {
        // Fill
        c.beginPath();
        pts.forEach(([x, y], i) => {
          i === 0 ? c.moveTo(xP(x), yP(y)) : c.lineTo(xP(x), yP(y));
        });
        c.lineTo(pad.l + cw, pad.t + ch);
        c.lineTo(pad.l, pad.t + ch);
        c.closePath();
        c.fillStyle = 'rgba(251,163,60,0.07)';
        c.fill();

        // Line
        c.beginPath();
        pts.forEach(([x, y], i) => {
          i === 0 ? c.moveTo(xP(x), yP(y)) : c.lineTo(xP(x), yP(y));
        });
        c.strokeStyle = 'var(--orange)';
        c.lineWidth   = 2;
        c.stroke();
      } else {
        // Bypass: show straight 1:1 in orange
        c.strokeStyle = 'rgba(251,163,60,0.5)';
        c.lineWidth   = 2;
        c.beginPath();
        c.moveTo(xP(DB_MIN), yP(DB_MIN)); c.lineTo(xP(DB_MAX), yP(DB_MAX));
        c.stroke();
      }

      // Axis labels
      c.fillStyle  = 'rgba(100,116,139,0.5)';
      c.font       = "9px 'JetBrains Mono', monospace";
      c.textAlign  = 'center';
      for (const db of [-48, -24, 0]) {
        c.fillText(`${db}`, xP(db), pad.t + ch + 14);
      }
      c.textAlign = 'right';
      for (const db of [-48, -24]) {
        c.fillText(`${db}`, pad.l - 3, yP(db) + 3);
      }
      c.fillText('0', pad.l - 3, yP(0) + 3);

      c.restore();
    };

    draw();
    return () => { running = false; cancelAnimationFrame(rafRef.current); ro.disconnect(); };
  }, []);

  const updateParam = useCallback((key, value) => {
    setParams(prev => ({ ...prev, [key]: value }));
  }, []);

  const grPct   = Math.min(100, (reduction / 24) * 100);
  const grColor = reduction > 12 ? 'var(--red)' : reduction > 6 ? 'var(--yellow)' : 'var(--orange)';
  const mono    = { fontFamily: "'JetBrains Mono', monospace" };

  const SLIDERS = [
    { key: 'threshold', label: 'THRESH',  min: -60, max: 0,    step: 0.5, fmt: v => `${v.toFixed(0)} dB` },
    { key: 'ratio',     label: 'RATIO',   min: 1,   max: 20,   step: 0.1, fmt: v => `${v.toFixed(1)}:1` },
    { key: 'knee',      label: 'KNEE',    min: 0,   max: 40,   step: 0.5, fmt: v => `${v.toFixed(0)} dB` },
    { key: 'attack',    label: 'ATTACK',  min: 0,   max: 200,  step: 1,   fmt: v => `${v} ms` },
    { key: 'release',   label: 'RELEASE', min: 10,  max: 1000, step: 5,   fmt: v => `${v} ms` },
    { key: 'makeup',    label: 'MAKEUP',  min: 0,   max: 30,   step: 0.5, fmt: v => `+${v.toFixed(1)} dB` },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        background: 'rgba(255,255,255,0.015)',
      }}>
        <span style={{ ...mono, fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--orange)', flex: 1 }}>
          Compressor
        </span>

        <button onClick={() => setBypass(b => !b)} style={{
          ...mono, fontSize: 9, padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
          background: bypass ? 'rgba(244,63,94,0.1)' : 'rgba(251,163,60,0.1)',
          border: `1px solid ${bypass ? 'rgba(244,63,94,0.3)' : 'rgba(251,163,60,0.25)'}`,
          color: bypass ? 'var(--red)' : 'var(--orange)',
        }}>
          {bypass ? '⊘ BYPASS' : '◉ ACTIVE'}
        </button>

        <button onClick={() => setParams({ ...DEFAULTS })} style={{
          ...mono, fontSize: 9, padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
          background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)',
        }}>
          Reset
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
          <button onClick={onClose} title="Close" style={{
            ...mono, fontSize: 13, padding: '2px 7px', borderRadius: 5, cursor: 'pointer',
            background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', lineHeight: 1,
          }}>
            ✕
          </button>
        )}
      </div>

      {/* Canvas + GR meter */}
      <div style={{ display: 'flex', background: 'rgba(0,0,0,0.28)', flexShrink: 0 }}>
        <div ref={wrapRef} style={{ flex: 1, position: 'relative' }}>
          <canvas ref={canvasRef} style={{ display: 'block' }} />
          {!compNode && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none',
            }}>
              <span style={{ ...mono, fontSize: 10, color: 'rgba(100,116,139,0.35)' }}>
                Press play to activate
              </span>
            </div>
          )}
        </div>

        {/* GR meter */}
        <div style={{
          width: 28, display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: '10px 0 20px', gap: 4, borderLeft: '1px solid var(--border)',
        }}>
          <span style={{ ...mono, fontSize: 7, color: 'var(--muted)', letterSpacing: '0.1em', writingMode: 'vertical-lr', transform: 'rotate(180deg)', marginBottom: 6 }}>GR</span>
          <div style={{ flex: 1, width: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              height: `${grPct}%`,
              background: grColor,
              borderRadius: 4,
              transition: 'height 0.04s linear, background 0.2s',
              boxShadow: `0 0 6px ${grColor}55`,
            }} />
          </div>
          <span style={{ ...mono, fontSize: 7, color: grColor, marginTop: 4 }}>
            {reduction.toFixed(1)}
          </span>
        </div>
      </div>

      {/* Parameter sliders */}
      <div style={{
        padding: '10px 14px 12px', borderTop: '1px solid var(--border)',
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px 20px',
      }}>
        {SLIDERS.map(({ key, label, min, max, step, fmt }) => (
          <div key={key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ ...mono, fontSize: 8, letterSpacing: '0.12em', color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</span>
              <span style={{ ...mono, fontSize: 8, color: 'var(--orange)' }}>{fmt(params[key])}</span>
            </div>
            <input
              type="range" min={min} max={max} step={step} value={params[key]}
              onChange={e => updateParam(key, parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--orange)', cursor: 'pointer' }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
