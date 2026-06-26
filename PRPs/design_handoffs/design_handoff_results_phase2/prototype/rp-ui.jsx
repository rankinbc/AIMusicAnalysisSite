/* spectre — shared Results primitives + icons. */
const { useState, useEffect, useRef } = React;

const rpGradeColor = (g) =>
  g[0] === 'A' ? 'var(--green)' : g[0] === 'B' ? 'var(--accent)' : g[0] === 'C' ? 'var(--yellow)' : 'var(--orange)';

function GradePill({ grade, size = 'md' }) {
  const c = rpGradeColor(grade);
  return (
    <div className={`grade ${size}`} style={{
      color: c, background: `linear-gradient(180deg, ${c}1f, ${c}0a)`,
      border: `1px solid ${c}44`, boxShadow: `inset 0 0 14px ${c}1a, 0 0 18px -10px ${c}66`,
    }}>{grade}</div>
  );
}

// Brand mark — peak-meter glyph
function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 22 22" fill="none">
      <rect x="3" y="9" width="2.4" height="9" rx="1" fill="currentColor" opacity="0.5" />
      <rect x="7" y="5" width="2.4" height="13" rx="1" fill="currentColor" opacity="0.85" />
      <rect x="11" y="2" width="2.4" height="16" rx="1" fill="currentColor" />
      <rect x="15" y="7" width="2.4" height="11" rx="1" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

// Coach avatar — armored helmet bot with an animated EQ visor. Mint palette.
function TranceBot({ size = 62, thinking = false, glow = true }) {
  const [bars, setBars] = useState(() => Array.from({ length: 5 }, () => 0.35));
  const uid = useRef(Math.random().toString(36).slice(2, 8)).current;
  useEffect(() => {
    let raf, t0 = performance.now() / 1000;
    const frame = () => {
      const t = performance.now() / 1000 - t0;
      const sp = thinking ? 8 : 2.2;
      setBars([
        0.3 + (Math.sin(t * sp + 0.2) * 0.5 + 0.5) * 0.6,
        0.3 + (Math.sin(t * sp + 1.1) * 0.5 + 0.5) * 0.6,
        0.3 + (Math.sin(t * sp + 2.0) * 0.5 + 0.5) * 0.6,
        0.3 + (Math.sin(t * sp + 3.3) * 0.5 + 0.5) * 0.6,
        0.3 + (Math.sin(t * sp + 4.7) * 0.5 + 0.5) * 0.6,
      ]);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [thinking]);
  const S = 'rgba(94,234,212,'; // mint stroke base
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" style={{ display: 'block', filter: glow ? 'drop-shadow(0 0 16px rgba(94,234,212,0.35))' : 'none' }}>
      <defs>
        <linearGradient id={`tb-h-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1c2433" /><stop offset="0.5" stopColor="#11151d" /><stop offset="1" stopColor="#0b0d12" />
        </linearGradient>
        <linearGradient id={`tb-a-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0b0d12" /><stop offset="0.5" stopColor="#1e2430" /><stop offset="1" stopColor="#0b0d12" />
        </linearGradient>
        <linearGradient id={`tb-v-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#86efd1" /><stop offset="0.55" stopColor="#5eead4" /><stop offset="1" stopColor="#5eead4" stopOpacity="0.5" />
        </linearGradient>
        <radialGradient id={`tb-c-${uid}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#5eead4" stopOpacity="0.5" /><stop offset="1" stopColor="#5eead4" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`tb-horn-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5eead4" stopOpacity="0.9" /><stop offset="1" stopColor="#5eead4" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      <path d="M8 22 L4 14 L11 18 L14 26 Z" fill={`url(#tb-horn-${uid})`} stroke={S + '0.5)'} strokeWidth="0.8" />
      <path d="M72 22 L76 14 L69 18 L66 26 Z" fill={`url(#tb-horn-${uid})`} stroke={S + '0.5)'} strokeWidth="0.8" />
      <line x1="40" y1="2" x2="40" y2="10" stroke="#5eead4" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="40" cy="3" r="2.6" fill="#5eead4">{!('matchMedia' in window && window.matchMedia('(prefers-reduced-motion: reduce)').matches) && <animate attributeName="opacity" values="0.4;1;0.4" dur="1.4s" repeatCount="indefinite" />}</circle>
      <rect x="36" y="9" width="8" height="3" rx="1" fill="#11192a" stroke={S + '0.6)'} strokeWidth="0.8" />
      <path d="M14 18 L24 12 L40 10 L56 12 L66 18 L64 22 L58 19 L40 17 L22 19 L16 22 Z" fill={`url(#tb-a-${uid})`} stroke={S + '0.5)'} strokeWidth="1" strokeLinejoin="miter" />
      <circle cx="20" cy="20" r="1.2" fill={S + '0.7)'} /><circle cx="60" cy="20" r="1.2" fill={S + '0.7)'} />
      <path d="M14 22 L24 18 L40 17 L56 18 L66 22 L68 32 L66 48 L60 60 L52 68 L40 70 L28 68 L20 60 L14 48 L12 32 Z" fill={`url(#tb-h-${uid})`} stroke={S + '0.5)'} strokeWidth="1.4" strokeLinejoin="miter" />
      <path d="M20 60 L26 55 L40 56 L54 55 L60 60" fill="none" stroke={S + '0.3)'} strokeWidth="0.8" />
      <path d="M22 26 L28 22" fill="none" stroke={S + '0.3)'} strokeWidth="0.8" />
      <path d="M58 26 L52 22" fill="none" stroke={S + '0.3)'} strokeWidth="0.8" />
      <rect x="4" y="30" width="9" height="20" rx="2.5" fill="#11151d" stroke={S + '0.55)'} strokeWidth="1.1" />
      <rect x="6" y="33" width="5" height="14" rx="1.5" fill={S + '0.1)'} stroke={S + '0.4)'} strokeWidth="0.6" />
      <circle cx="8.5" cy="40" r="2" fill="#5eead4" />
      <rect x="67" y="30" width="9" height="20" rx="2.5" fill="#11151d" stroke={S + '0.55)'} strokeWidth="1.1" />
      <rect x="69" y="33" width="5" height="14" rx="1.5" fill={S + '0.1)'} stroke={S + '0.4)'} strokeWidth="0.6" />
      <circle cx="71.5" cy="40" r="2" fill="#86efd1" />
      <path d="M16 32 L26 28 L40 27 L54 28 L64 32 L62 42 L56 46 L40 47 L24 46 L18 42 Z" fill="#0b1714" stroke={`url(#tb-v-${uid})`} strokeWidth="1.4" strokeLinejoin="miter" />
      <path d="M19 33 L28 30 L40 29 L52 30 L61 33" fill="none" stroke={S + '0.25)'} strokeWidth="0.7" />
      {bars.map((v, i) => {
        const barH = 11 * v, x = 24 + i * 6.5, y = 38 - barH / 2;
        return <rect key={i} x={x} y={y} width="3.5" height={barH} rx="1" fill={i === 2 ? '#86efd1' : '#5eead4'} opacity={0.7 + v * 0.3} />;
      })}
      <path d="M16 48 L22 46 L24 56 L18 58 Z" fill={`url(#tb-a-${uid})`} stroke={S + '0.3)'} strokeWidth="0.7" />
      <path d="M64 48 L58 46 L56 56 L62 58 Z" fill={`url(#tb-a-${uid})`} stroke={S + '0.3)'} strokeWidth="0.7" />
      <ellipse cx="20" cy="52" rx="3" ry="3.5" fill={`url(#tb-c-${uid})`} /><ellipse cx="60" cy="52" rx="3" ry="3.5" fill={`url(#tb-c-${uid})`} />
      <rect x="30" y="54" width="20" height="10" rx="2" fill="#0b1714" stroke={S + '0.4)'} strokeWidth="0.9" />
      {Array.from({ length: 5 }).map((_, i) => <line key={i} x1={32 + i * 4} y1="56" x2={32 + i * 4} y2="62" stroke={S + '0.55)'} strokeWidth="1.1" strokeLinecap="round" />)}
      <path d="M30 64 L34 70 L40 72 L46 70 L50 64" fill={`url(#tb-a-${uid})`} stroke={S + '0.5)'} strokeWidth="1" strokeLinejoin="miter" />
      <circle cx="40" cy="70" r="1.3" fill={S + '0.8)'} />
    </svg>
  );
}

// Tiny inline icons (stroke, 1.6)
function Icon({ name, size = 15 }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths = {
    target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.4" /></>,
    chart: <><path d="M4 19V5" /><rect x="7" y="11" width="3" height="8" /><rect x="13" y="7" width="3" height="12" /><rect x="19" y="14" width="0.5" height="5" /></>,
    folder: <path d="M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />,
    play: <path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none" />,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    check: <path d="M5 13l4 4L19 7" />,
    x: <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>,
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
    download: <><path d="M12 4v11" /><path d="M7 11l5 5 5-5" /><path d="M5 20h14" /></>,
    sparkle: <path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z" fill="currentColor" stroke="none" />,
    clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
    refresh: <><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 4v4h-4" /></>,
    send: <path d="M5 12l15-7-7 15-2-6z" />,
    dots: <><circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none" /></>,
    layers: <><path d="M12 4l8 4-8 4-8-4z" /><path d="M4 12l8 4 8-4" /></>,
    spark: <><path d="M13 3 5 13h6l-1 8 8-10h-6z" /></>,
    users: <><circle cx="9" cy="8" r="3.2" /><path d="M3.4 19.2a5.6 5.6 0 0 1 11.2 0" /><path d="M16.2 5.3a3.2 3.2 0 0 1 0 5.5" /><path d="M17.8 19.2a5.6 5.6 0 0 0-3-5" /></>,
    copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>,
    alert: <><path d="M10.3 4.3 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>,
    anchor: <><circle cx="12" cy="5" r="2.4" /><path d="M12 22V8" /><path d="M5 12a7 7 0 0 0 14 0" /><path d="M3 12h2M19 12h2" /></>,
    sliders: <><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" /><path d="M1 14h6M9 8h6M17 16h6" /></>,
  };
  return <svg {...p}>{paths[name]}</svg>;
}

// Parse a directive string: `tokens` → .param, plain → text
function Directive({ text, scope, className = '' }) {
  const parts = String(text).split('`');
  return (
    <div className={`directive ${className}`}>
      <span className="arrow">→</span>
      <div className="d-text">
        {scope && <span className="scope">{scope}</span>}{scope ? ' · ' : ''}
        {parts.map((seg, i) => i % 2 === 1
          ? <span className="param" key={i}>{seg}</span>
          : <span key={i}>{seg}</span>)}
      </div>
    </div>
  );
}

// Confidence/impact little bar signal
function SignalBars({ value, max = 5, color = 'var(--text-2)' }) {
  return (
    <span className="bar">
      {Array.from({ length: max }).map((_, i) => (
        <i key={i} style={{ height: `${30 + i * 17}%`, background: i < value ? color : 'var(--dim)' }} />
      ))}
    </span>
  );
}

// Mini spectrum chart for evidence
function MiniSpectrum({ warnBands = [] }) {
  return (
    <div>
      <div className="chart-bars">
        {RP_FREQ.map((b, i) => {
          const warn = warnBands.includes(i);
          return (
            <div className="chart-col" key={i}>
              <div className="bw">
                <div className="median" style={{ height: `${b.med * 100}%` }} />
                <div className={`barfill${warn ? ' warn' : ''}`} style={{ height: `${b.v * 100}%` }} />
              </div>
              <span className={`lbl${warn ? ' warn' : ''}`}>{b.n}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Mini loudness meter line for evidence
function MiniMeter({ value, min, max, target, targetLabel }) {
  const pct = (v) => `${Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100))}%`;
  return (
    <div>
      <div className="meter-line">
        <div className="fill" style={{ width: pct(value) }} />
        <div className="tgt" style={{ left: pct(target) }}><span className="cap">{targetLabel}</span></div>
      </div>
      <div className="meter-scale"><span>{min}</span><span>yours {value}</span><span>{max}</span></div>
    </div>
  );
}

// Section structure strip
function StructureStrip({ height = 26, labels = false }) {
  const total = RP_STRUCTURE.reduce((s, x) => s + x.bars, 0);
  return (
    <div style={{ display: 'flex', gap: 2, height, borderRadius: 5, overflow: 'hidden' }}>
      {RP_STRUCTURE.map((s, i) => (
        <div key={i} title={s.l} style={{
          width: `${(s.bars / total) * 100}%`, background: RP_STRUCT_COLORS[s.t],
          position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          padding: labels ? 8 : 0, border: s.flag ? '1px solid rgba(245,158,11,.5)' : '1px solid transparent',
        }}>
          {labels && <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: 'rgba(255,255,255,.9)' }}>{s.l}</span>}
          {labels && <span className="mono" style={{ fontSize: 8.5, color: 'rgba(255,255,255,.55)' }}>{s.bars} bars</span>}
          {s.flag && <div style={{ position: 'absolute', top: 4, right: 4, width: 4, height: 4, borderRadius: '50%', background: 'var(--orange)' }} />}
        </div>
      ))}
    </div>
  );
}

function SecLabel({ glyph, children, hint }) {
  return (
    <div className="seclabel">
      {glyph && <span className="glyph">{glyph}</span>}
      <span className="t">{children}</span>
      {hint && <span className="hint">{hint}</span>}
      <span className="rule" />
    </div>
  );
}

// Cover art — gradient blob with optional mini waveform + version badge
function CoverArt({ hue = 168, size = 92, radius = 10, waveform = true, badge }) {
  const bars = waveform ? Array.from({ length: 30 }, (_, i) => 0.22 + Math.abs(Math.sin(i * 0.7) * 0.55 + Math.sin(i * 1.9) * 0.3)) : null;
  return (
    <div className="coverart" style={{ width: size, height: size, borderRadius: radius, '--ch': hue }}>
      {badge && <span className="ca-badge">{badge}</span>}
      {bars && <div className="ca-wave">{bars.map((v, i) => <i key={i} style={{ height: `${Math.min(100, v * 100)}%` }} />)}</div>}
    </div>
  );
}

// ── Key badge — qualifies with key_detection_confidence ──────────────
function KeyBadge({ k, confidence }) {
  const conf = confidence == null ? 1 : confidence;
  const uncertain = conf < 0.5;
  const filled = conf >= 0.7 ? 3 : conf >= 0.45 ? 2 : 1;
  return (
    <span className={`keybadge mono${uncertain ? ' uncertain' : ''}`} title={`key confidence ${Math.round(conf * 100)}%`}>
      {k}{uncertain && <span className="ku">· uncertain</span>}
      <span className="kdots">{[0, 1, 2].map(i => <i key={i} className={i < filled ? 'on' : ''} />)}</span>
    </span>
  );
}

// ── Percentile ring (phase 6) ────────────────────────────────────────
function PercentRing({ value, size = 86, stroke = 7, hue = null, label = 'pctile' }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, off = c * (1 - value / 100);
  const col = hue != null ? `oklch(0.78 0.13 ${hue})` : 'var(--accent)';
  return (
    <div className="pring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--dim)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off}
          transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset .6s ease' }} />
      </svg>
      <div className="pring-c">
        <span className="pv mono" style={{ color: col }}>{value}<i>th</i></span>
        <span className="pl mono">{label}</span>
      </div>
    </div>
  );
}

// ── Radial gauge (the 'dial' metric-viz variant) ─────────────────────
function gaugePolar(cx, cy, r, a) { const rad = a * Math.PI / 180; return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)]; }
function gaugeArc(cx, cy, r, a0, a1) {
  const [x0, y0] = gaugePolar(cx, cy, r, a0), [x1, y1] = gaugePolar(cx, cy, r, a1);
  const large = (a1 - a0) <= 180 ? 0 : 1;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function GaugeDial({ value, min, max, zone, unit = '', color = 'var(--accent)', size = 110, label, sub, display }) {
  const A0 = -134, A1 = 134, span = A1 - A0;
  const cf = (v) => Math.max(0, Math.min(1, (v - min) / (max - min)));
  const va = A0 + cf(value) * span;
  const h = Math.round(size * 0.8), r = (size - 18) / 2, cx = size / 2, cy = size / 2, sw = 9;
  const [mx, my] = gaugePolar(cx, cy, r, va);
  return (
    <div className="gdial" style={{ width: size }}>
      <svg width={size} height={h} viewBox={`0 0 ${size} ${h}`}>
        <path d={gaugeArc(cx, cy, r, A0, A1)} fill="none" stroke="var(--dim)" strokeWidth={sw} strokeLinecap="round" />
        {zone && <path d={gaugeArc(cx, cy, r, A0 + cf(zone[0]) * span, A0 + cf(zone[1]) * span)} fill="none" stroke="rgba(16,185,129,.30)" strokeWidth={sw} strokeLinecap="round" />}
        <path d={gaugeArc(cx, cy, r, A0, va)} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" style={{ transition: 'all .5s ease' }} />
        <circle cx={mx} cy={my} r={4.5} fill={color} stroke="var(--bg)" strokeWidth="2" />
        <text x={cx} y={cy - 1} textAnchor="middle" className="gdial-val" fill={color}>{display != null ? display : value}</text>
        {unit && <text x={cx} y={cy + 14} textAnchor="middle" className="gdial-unit">{unit}</text>}
      </svg>
      {label && <div className="gdial-l">{label}</div>}
      {sub && <div className="gdial-s mono">{sub}</div>}
    </div>
  );
}

// ── Range bar — acceptable-range band + user marker (phase 6 gaps) ────
function RangeBar({ value, range, min, max, unit = '', inRange = true }) {
  const pct = (v) => `${Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100))}%`;
  const c = inRange ? 'var(--green)' : 'var(--orange)';
  return (
    <div className="rangebar">
      <div className="rb-track">
        <div className="rb-zone" style={{ left: pct(range[0]), right: `calc(100% - ${pct(range[1])})` }} />
        <div className="rb-mark" style={{ left: pct(value), background: c, boxShadow: `0 0 0 3px ${c}22` }} />
      </div>
      <div className="rb-scale mono"><span>{min}{unit}</span><span>{max}{unit}</span></div>
    </div>
  );
}

// ── Linear scale with a position dot + end labels (tone metrics) ─────
function ScalePos({ pct, lo, hi, color = 'var(--accent)' }) {
  return (
    <div className="scalepos">
      <div className="sp-track"><div className="sp-dot" style={{ left: `${pct}%`, background: color }} /></div>
      <div className="sp-ends mono"><span>{lo}</span><span>{hi}</span></div>
    </div>
  );
}

// ── Stat tile (compact labelled value) ───────────────────────────────
function StatTile({ l, v, u, c = 'var(--text)' }) {
  return (
    <div className="stattile">
      <div className="st-l mono">{l}</div>
      <div className="st-v"><span className="mono" style={{ color: c }}>{v}</span>{u && <span className="st-u mono">{u}</span>}</div>
    </div>
  );
}

Object.assign(window, {
  rpGradeColor, GradePill, BrandMark, TranceBot, Icon, Directive, SignalBars,
  MiniSpectrum, MiniMeter, StructureStrip, SecLabel, CoverArt,
  KeyBadge, PercentRing, GaugeDial, RangeBar, ScalePos, StatTile,
});
