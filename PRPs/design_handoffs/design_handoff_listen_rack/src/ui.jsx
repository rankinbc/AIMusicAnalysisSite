/* SPECTR · Listen rack redesign — shared control primitives
 * Pro-tool knobs/faders/toggles/meters in the cool-neon language. Every control
 * is draggable (vertical drag) so the mockup feels like the real instrument.
 * Shared by all three rack IA directions.
 */
/* hooks via React.* — avoid global const collision with components.jsx */

// Drag-to-change: vertical drag over `range` px = full min→max sweep.
function useDragValue({ value, min, max, step, onChange, range = 180 }) {
  const ref = React.useRef(null);
  const start = React.useRef(null);
  const onDown = React.useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    start.current = { y: e.clientY ?? e.touches?.[0]?.clientY, v: value };
    const move = (ev) => {
      const y = ev.clientY ?? ev.touches?.[0]?.clientY;
      const dy = start.current.y - y;
      let nv = start.current.v + (dy / range) * (max - min);
      nv = Math.max(min, Math.min(max, nv));
      if (step) nv = Math.round(nv / step) * step;
      nv = Math.round(nv * 1e6) / 1e6;
      onChange(nv);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.style.cursor = 'ns-resize';
  }, [value, min, max, step, onChange, range]);
  return { ref, onPointerDown: onDown };
}

const cssVar = (v) => (typeof v === 'string' && v.startsWith('var(')
  ? getComputedStyle(document.documentElement).getPropertyValue(v.slice(4, -1)).trim() || '#00e5b0'
  : v);

// ── Rotary knob (the workhorse) ────────────────────────────────────────────
function Knob({ value, min, max, step, unit, label, accent = 'var(--cyan)', size = 44, bipolar = false, onChange, dim = false, hint }) {
  const drag = useDragValue({ value, min, max, step, onChange: onChange || (() => {}) });
  const t = (value - min) / (max - min);            // 0..1
  const A0 = -135, A1 = 135;                         // sweep degrees
  const ang = A0 + t * (A1 - A0);
  const r = size / 2;
  const cx = r, cy = r;
  const trackR = r - 4;
  const polar = (deg, rad) => [cx + rad * Math.cos((deg - 90) * Math.PI / 180), cy + rad * Math.sin((deg - 90) * Math.PI / 180)];
  const arc = (a0, a1) => {
    const [x0, y0] = polar(a0, trackR), [x1, y1] = polar(a1, trackR);
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    const sweep = a1 > a0 ? 1 : 0;
    return `M ${x0} ${y0} A ${trackR} ${trackR} 0 ${large} ${sweep} ${x1} ${y1}`;
  };
  const fillFrom = bipolar ? 0 : A0;
  const acc = dim ? 'var(--muted)' : accent;
  const [px, py] = polar(ang, trackR);
  const [pinX, pinY] = polar(ang, trackR - size * 0.16);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, userSelect: 'none' }}>
      {label && <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.12em', color: 'var(--muted)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{label}</span>}
      <div ref={drag.ref} onPointerDown={drag.onPointerDown} title={hint}
        style={{ width: size, height: size, cursor: 'ns-resize', touchAction: 'none', position: 'relative' }}>
        <svg width={size} height={size} style={{ display: 'block', overflow: 'visible' }}>
          <circle cx={cx} cy={cy} r={trackR} fill="rgba(7,10,18,0.6)" stroke="var(--border)" strokeWidth="1" />
          <path d={arc(A0, A1)} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" strokeLinecap="round" />
          <path d={arc(fillFrom, ang)} fill="none" stroke={acc} strokeWidth="3" strokeLinecap="round"
            style={{ filter: dim ? 'none' : `drop-shadow(0 0 4px ${cssVar(accent)}88)` }} />
          <line x1={pinX} y1={pinY} x2={px} y2={py} stroke={acc} strokeWidth="2" strokeLinecap="round" />
          {bipolar && <circle cx={polar(0, trackR + 3)[0]} cy={polar(0, trackR + 3)[1]} r="1" fill="var(--muted)" />}
        </svg>
      </div>
      {unit !== undefined && <span className="mono" style={{ fontSize: 9.5, fontWeight: 600, color: dim ? 'var(--muted)' : 'var(--text-2)', whiteSpace: 'nowrap' }}>{fmtVal(unit, value)}</span>}
    </div>
  );
}

// ── Vertical fader (console direction) ─────────────────────────────────────
function Fader({ value, min, max, step, unit, label, accent = 'var(--cyan)', height = 110, onChange, dim = false }) {
  const drag = useDragValue({ value, min, max, step, onChange: onChange || (() => {}), range: height });
  const t = (value - min) / (max - min);
  const acc = dim ? 'var(--muted)' : accent;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, userSelect: 'none' }}>
      <div ref={drag.ref} onPointerDown={drag.onPointerDown}
        style={{ position: 'relative', width: 26, height, cursor: 'ns-resize', touchAction: 'none' }}>
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 4, transform: 'translateX(-50%)', background: 'rgba(255,255,255,0.06)', borderRadius: 2, border: '1px solid var(--border)' }} />
        <div style={{ position: 'absolute', left: '50%', bottom: 0, width: 4, height: `${t * 100}%`, transform: 'translateX(-50%)', background: acc, borderRadius: 2, boxShadow: dim ? 'none' : `0 0 6px ${cssVar(accent)}66` }} />
        <div style={{ position: 'absolute', left: '50%', bottom: `calc(${t * 100}% - 7px)`, transform: 'translateX(-50%)', width: 22, height: 13, borderRadius: 3, background: 'var(--card-2)', border: `1px solid ${acc}`, boxShadow: dim ? 'none' : `0 0 8px ${cssVar(accent)}55, inset 0 1px 0 rgba(255,255,255,0.15)` }} />
      </div>
      {label && <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.1em', color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</span>}
      {unit !== undefined && <span className="mono" style={{ fontSize: 9.5, fontWeight: 600, color: dim ? 'var(--muted)' : 'var(--text-2)' }}>{fmtVal(unit, value)}</span>}
    </div>
  );
}

// ── On/off switch ──────────────────────────────────────────────────────────
function Switch({ on, onChange, accent = 'var(--cyan)', size = 'md' }) {
  const w = size === 'sm' ? 26 : 30, h = size === 'sm' ? 14 : 16, k = h - 4;
  return (
    <button onClick={(e) => { e.stopPropagation(); onChange(!on); }}
      style={{ width: w, height: h, borderRadius: 999, position: 'relative', flexShrink: 0,
        background: on ? accent : 'var(--dim)', border: 'none', transition: 'background .15s',
        boxShadow: on ? `0 0 8px ${cssVar(accent)}66` : 'none' }}>
      <span style={{ position: 'absolute', top: 2, left: on ? w - k - 2 : 2, width: k, height: k, borderRadius: '50%',
        background: on ? '#06151a' : 'rgba(255,255,255,0.5)', transition: 'left .15s' }} />
    </button>
  );
}

// ── Segmented (enum, ≤3 short options) ─────────────────────────────────────
function Segmented({ value, options, onChange, accent = 'var(--cyan)' }) {
  return (
    <div style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
      {options.map((o) => (
        <button key={o} onClick={(e) => { e.stopPropagation(); onChange(o); }} className="mono"
          style={{ fontSize: 9.5, fontWeight: 600, padding: '3px 8px', borderRadius: 4, textTransform: 'lowercase',
            color: value === o ? '#06151a' : 'var(--muted)',
            background: value === o ? accent : 'transparent' }}>{o}</button>
      ))}
    </div>
  );
}

// ── Select (enum, many/long options) — cycles on click, shows current ──────
function SelectChip({ value, options, onChange, accent = 'var(--cyan)', label }) {
  const next = (e) => { e.stopPropagation(); onChange(options[(options.indexOf(value) + 1) % options.length]); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      {label && <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.12em', color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</span>}
      <button onClick={next} className="mono" title="Click to cycle"
        style={{ fontSize: 10, fontWeight: 600, padding: '5px 10px', borderRadius: 6, color: accent,
          border: `1px solid ${cssVar(accent)}44`, background: `${cssVar(accent)}12`, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {value}<span style={{ opacity: 0.5, fontSize: 8 }}>▾</span>
      </button>
    </div>
  );
}

// ── Horizontal slider (mix, cents) ─────────────────────────────────────────
function HSlider({ value, min, max, step, unit, label, accent = 'var(--cyan)', onChange, dim = false, width = '100%' }) {
  const ref = React.useRef(null);
  const t = (value - min) / (max - min);
  const acc = dim ? 'var(--muted)' : accent;
  const onDown = (e) => {
    e.stopPropagation();
    const set = (ev) => {
      const rect = ref.current.getBoundingClientRect();
      let nv = min + Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)) * (max - min);
      if (step) nv = Math.round(nv / step) * step;
      onChange(Math.round(nv * 1e6) / 1e6);
    };
    set(e);
    const up = () => { window.removeEventListener('pointermove', set); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', set); window.addEventListener('pointerup', up);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, width }}>
      {(label || unit !== undefined) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          {label && <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.12em', color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</span>}
          {unit !== undefined && <span className="mono" style={{ fontSize: 9.5, fontWeight: 600, color: dim ? 'var(--muted)' : 'var(--text-2)' }}>{fmtVal(unit, value)}</span>}
        </div>
      )}
      <div ref={ref} onPointerDown={onDown} style={{ position: 'relative', height: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', touchAction: 'none' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, border: '1px solid var(--border)' }} />
        <div style={{ position: 'absolute', left: 0, width: `${t * 100}%`, height: 4, background: acc, borderRadius: 2, boxShadow: dim ? 'none' : `0 0 6px ${cssVar(accent)}55` }} />
        <div style={{ position: 'absolute', left: `${t * 100}%`, width: 12, height: 12, borderRadius: '50%', transform: 'translateX(-50%)', background: acc, boxShadow: dim ? 'none' : `0 0 6px ${cssVar(accent)}` }} />
      </div>
    </div>
  );
}

// ── Gain-reduction meter (comp / gate / limiter) ───────────────────────────
function GRMeter({ reductionDb = 0, open, height = 110, vertical = true, label = 'GR' }) {
  // reductionDb is negative; map 0..-20 dB to 0..1
  const t = Math.max(0, Math.min(1, -reductionDb / 20));
  if (!vertical) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span className="mono" style={{ fontSize: 8.5, color: 'var(--muted)', letterSpacing: '0.1em' }}>{label}</span>
          <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: t > 0.01 ? 'var(--orange)' : 'var(--muted)' }}>{reductionDb <= -0.05 ? `${reductionDb.toFixed(1)} dB` : '0.0 dB'}</span>
        </div>
        <div style={{ position: 'relative', height: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${t * 100}%`, background: 'linear-gradient(90deg, var(--orange), var(--red))', borderRadius: 2 }} />
        </div>
      </div>
    );
  }
  const SEG = 16;
  const lit = Math.round(t * SEG);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
      <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 2, height, width: 14 }}>
        {Array.from({ length: SEG }).map((_, i) => (
          <div key={i} style={{ flex: 1, borderRadius: 1, background: i < lit ? (i > SEG - 4 ? 'var(--red)' : 'var(--orange)') : 'rgba(255,255,255,0.05)', boxShadow: i < lit && i >= lit - 1 ? '0 0 5px var(--orange)' : 'none' }} />
        ))}
      </div>
      <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: t > 0.01 ? 'var(--orange)' : 'var(--muted)' }}>{reductionDb <= -0.05 ? reductionDb.toFixed(1) : '0.0'}</span>
      <span className="mono" style={{ fontSize: 7.5, color: 'var(--muted)', letterSpacing: '0.12em' }}>{open != null ? (open ? 'OPEN' : 'SHUT') : label}</span>
    </div>
  );
}

// ── Module glyph badge ─────────────────────────────────────────────────────
function ModuleIcon({ glyph, accent, on, size = 28 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 7, flexShrink: 0, display: 'grid', placeItems: 'center',
      fontFamily: 'JetBrains Mono, monospace', fontSize: size * 0.46, fontWeight: 700,
      color: on ? accent : 'var(--muted)',
      background: on ? `${cssVar(accent)}1a` : 'rgba(255,255,255,0.025)',
      border: `1px solid ${on ? `${cssVar(accent)}55` : 'var(--border)'}`,
      boxShadow: on ? `0 0 10px ${cssVar(accent)}33, inset 0 0 8px ${cssVar(accent)}14` : 'none', transition: 'all .15s' }}>{glyph}</div>
  );
}

// ── Handle-binding tag (handoff annotation; toggled by "Bindings" switch) ──
function BindTag({ bind, show }) {
  if (!show) return null;
  return (
    <div className="mono" style={{ fontSize: 8, color: 'var(--cyan)', letterSpacing: '0.02em', marginTop: 6,
      padding: '3px 7px', borderRadius: 5, background: 'rgba(0,229,176,0.05)', border: '1px dashed rgba(0,229,176,0.3)',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      ⌁ graph.{bind}
    </div>
  );
}

// Worklet "initializing" pill (gate/bitcrusher/limiter post-load state)
function WorkletPill({ ready }) {
  return (
    <span className="mono" style={{ fontSize: 7.5, padding: '1px 6px', borderRadius: 4, letterSpacing: '0.08em',
      color: ready ? 'var(--green)' : 'var(--yellow)',
      border: `1px solid ${ready ? 'rgba(52,211,153,0.3)' : 'rgba(251,191,36,0.32)'}`,
      background: ready ? 'rgba(52,211,153,0.06)' : 'rgba(251,191,36,0.06)' }}>
      {ready ? 'WORKLET' : 'INIT…'}
    </span>
  );
}

// Generic param control dispatcher (renders the right widget for a ParamDescriptor)
function ParamControl({ p, value, accent, onChange, dim, knobSize = 40 }) {
  const set = (v) => onChange(p.key, v);
  switch (p.control) {
    case 'knob':
    case 'knobBipolar':
      return <Knob label={p.label} value={value} min={p.min} max={p.max} step={p.step} unit={p.unit} accent={accent} size={knobSize} bipolar={p.control === 'knobBipolar'} onChange={set} dim={dim} hint={p.hint} />;
    case 'slider':
      return <HSlider label={p.label} value={value} min={p.min} max={p.max} step={p.step} unit={p.unit} accent={accent} onChange={set} dim={dim} />;
    case 'toggle':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
          <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.12em', color: 'var(--muted)', textTransform: 'uppercase' }}>{p.label}</span>
          <Switch on={!!value} onChange={set} accent={accent} size="sm" />
        </div>
      );
    case 'segmented':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
          <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.12em', color: 'var(--muted)', textTransform: 'uppercase' }}>{p.label}</span>
          <Segmented value={value} options={p.options} onChange={set} accent={accent} />
        </div>
      );
    case 'select':
      return <SelectChip label={p.label} value={value} options={p.options} onChange={set} accent={accent} />;
    default:
      return null;
  }
}

// ── Segmented bar (id/label options) ───────────────────────────────────────
function SegBar({ value, options, onChange, accent = 'var(--cyan)', size = 'md' }) {
  const fs = size === 'sm' ? 10 : 10.5, pad = size === 'sm' ? '5px 10px' : '6px 13px';
  return (
    <div style={{ display: 'inline-flex', gap: 2, padding: 3, borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)', flexWrap: 'wrap' }}>
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} className="mono" style={{ fontSize: fs, fontWeight: 700, letterSpacing: '0.04em', padding: pad, borderRadius: 6, color: value === o.id ? '#06151a' : 'var(--muted)', background: value === o.id ? accent : 'transparent', transition: 'color .15s, background .15s' }}>{o.label}</button>
      ))}
    </div>
  );
}

// ── Avatars: listener (gradient + initial), anonymous (bot), coach (robot) ──
function BotFace({ size = 26, ring }) {
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.28, background: 'linear-gradient(135deg, #1b2436, #0e1626)', border: '1px solid var(--border-2)', display: 'grid', placeItems: 'center', flexShrink: 0, boxShadow: ring ? '0 0 0 2px var(--bg), 0 0 14px rgba(180,200,230,0.35)' : 'none' }}>
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24">
        <rect x="4" y="6.5" width="16" height="12.5" rx="4" fill="none" stroke="var(--muted)" strokeWidth="1.5" />
        <circle cx="9.5" cy="12.5" r="1.6" fill="var(--text-2)" /><circle cx="14.5" cy="12.5" r="1.6" fill="var(--text-2)" />
        <line x1="12" y1="2.6" x2="12" y2="6.5" stroke="var(--muted)" strokeWidth="1.5" /><circle cx="12" cy="2.2" r="1.3" fill="var(--muted)" />
      </svg>
    </div>
  );
}
function Avatar({ handle = '?', hue = 200, anon, size = 26, ring }) {
  if (anon) return <BotFace size={size} ring={ring} />;
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: `linear-gradient(135deg, oklch(0.72 0.16 ${hue}), oklch(0.5 0.18 ${(hue + 60) % 360}))`, display: 'grid', placeItems: 'center', fontSize: size * 0.4, fontWeight: 800, color: '#06151a', boxShadow: ring ? `0 0 0 2px var(--bg), 0 0 14px oklch(0.7 0.16 ${hue})` : 'none' }}>{handle[0].toUpperCase()}</div>
  );
}
// The Coach mascot — domed helmet, neon visor with rAF EQ-bar mouth, pulsing
// antenna, side headphone pods + chin grille. `thinking`/`live` speeds the bars.
const COACH_REDUCE = typeof window !== 'undefined' && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function CoachBot({ size = 44, live, thinking, glow = true }) {
  const animated = !COACH_REDUCE && size >= 28;
  const [bars, setBars] = React.useState([0.45, 0.78, 1, 0.66, 0.5]);
  React.useEffect(() => {
    if (!animated) return;
    let raf, t0 = performance.now();
    const speed = (thinking || live) ? 7.5 : 3.2;
    const tick = (t) => {
      const e = (t - t0) / 1000;
      setBars([0, 1, 2, 3, 4].map((i) =>
        Math.max(0.18, Math.min(1, 0.42 + 0.46 * (0.5 + 0.5 * Math.sin(e * speed + i * 1.25))))));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animated, thinking, live]);
  return (
    <div style={{ width: size, height: size, flexShrink: 0, display: 'grid', placeItems: 'center', filter: glow ? 'drop-shadow(0 0 7px rgba(0,229,176,0.45))' : 'none' }}>
      <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="The Coach">
        <defs>
          <radialGradient id="cbGlow" cx="50%" cy="46%" r="54%">
            <stop offset="0%" stopColor="#00e5b0" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#00e5b0" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="cbShell" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0e2030" /><stop offset="100%" stopColor="#081019" />
          </linearGradient>
        </defs>
        {glow && <circle cx="24" cy="23" r="22" fill="url(#cbGlow)" />}
        {/* antenna */}
        <line x1="24" y1="5.4" x2="24" y2="10.5" stroke="#34e1b0" strokeWidth="1.1" />
        <path className="coach-antenna" d="M24 2.4 l1.8 1.9 -1.8 1.9 -1.8 -1.9 z" fill="#5eead4" />
        {/* side fins */}
        <path d="M14.5 15.5 L6.5 10.5 L9.5 18.5 Z" fill="#0c1a26" stroke="#34e1b0" strokeWidth="1" strokeLinejoin="round" />
        <path d="M33.5 15.5 L41.5 10.5 L38.5 18.5 Z" fill="#0c1a26" stroke="#34e1b0" strokeWidth="1" strokeLinejoin="round" />
        {/* side headphone pods */}
        <rect x="7" y="22" width="4.6" height="9.4" rx="2.1" fill="#0a1622" stroke="#34e1b0" strokeWidth="1" />
        <circle cx="9.3" cy="26.7" r="1.05" fill="#34e1b0" />
        <rect x="36.4" y="22" width="4.6" height="9.4" rx="2.1" fill="#0a1622" stroke="#34e1b0" strokeWidth="1" />
        <circle cx="38.7" cy="26.7" r="1.05" fill="#e879f9" />
        {/* helmet shell */}
        <path d="M12.8 16.4 Q24 7.8 35.2 16.4 L36.6 24.2 Q36.6 31 30.2 35 L24 38.8 L17.8 35 Q11.4 31 11.4 24.2 Z" fill="url(#cbShell)" stroke="#34e1b0" strokeWidth="1.35" strokeLinejoin="round" />
        <path d="M14.4 18 Q24 13 33.6 18" fill="none" stroke="#34e1b0" strokeWidth="0.9" opacity="0.65" />
        {/* visor */}
        <path d="M16.2 19.4 L31.8 19.4 L29.9 27 L18.1 27 Z" fill="#0a121d" stroke="#a78bfa" strokeWidth="1.1" strokeLinejoin="round" />
        {/* EQ-bar mouth */}
        {bars.map((b, i) => {
          const h = 1.8 + b * 6.2, x = 18.7 + i * 2.35, y = 25.8 - h;
          return <rect key={i} x={x} y={y} width="1.5" height={h} rx="0.5" fill={i === 2 ? '#c4b5fd' : '#34e1b0'} />;
        })}
        {/* chin grille */}
        <g stroke="#34e1b0" strokeWidth="0.9" strokeLinecap="round" opacity="0.85">
          <line x1="21" y1="30.4" x2="21" y2="33.8" /><line x1="23" y1="30.8" x2="23" y2="34.8" />
          <line x1="25" y1="30.8" x2="25" y2="34.8" /><line x1="27" y1="30.4" x2="27" y2="33.8" />
        </g>
      </svg>
    </div>
  );
}

// ── Hue → hex + a rainbow hue slider (color control for visual effects) ────
function hslToHex(h, s = 80, l = 60) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x) => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}
function HueSlider({ value, onChange, label }) {
  const ref = React.useRef(null);
  const set = (e) => { const r = ref.current.getBoundingClientRect(); onChange(Math.max(0, Math.min(360, ((e.clientX - r.left) / r.width) * 360))); };
  const down = (e) => { e.stopPropagation(); set(e); const mv = set, up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); }; window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {label && <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.12em', color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</span>}
      <div ref={ref} onPointerDown={down} style={{ position: 'relative', height: 14, borderRadius: 7, cursor: 'pointer', touchAction: 'none', background: 'linear-gradient(90deg,hsl(0,80%,60%),hsl(60,80%,60%),hsl(120,80%,60%),hsl(180,80%,60%),hsl(240,80%,60%),hsl(300,80%,60%),hsl(360,80%,60%))' }}>
        <div style={{ position: 'absolute', top: '50%', left: `${value / 360 * 100}%`, width: 14, height: 14, borderRadius: '50%', transform: 'translate(-50%,-50%)', background: hslToHex(value), border: '2px solid #fff', boxShadow: '0 0 6px rgba(0,0,0,0.5)' }} />
      </div>
    </div>
  );
}

Object.assign(window, {
  useDragValue, cssVar, Knob, Fader, Switch, Segmented, SelectChip, HSlider,
  GRMeter, ModuleIcon, BindTag, WorkletPill, ParamControl, SegBar, Avatar, BotFace, CoachBot, hslToHex, HueSlider,
});
