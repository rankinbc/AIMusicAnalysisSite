/* SPECTR — shared primitives, widgets, brand. */

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ── Brand mark ────────────────────────────────────────────────────────────

function BrandMark({ size = 22 }) {
  // Triangular peak-meter glyph — references spectrum bars.
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none">
      <rect x="3"  y="9"  width="2.4" height="9"  rx="1" fill="#00e5b0" opacity="0.5" />
      <rect x="7"  y="5"  width="2.4" height="13" rx="1" fill="#00e5b0" opacity="0.85" />
      <rect x="11" y="2"  width="2.4" height="16" rx="1" fill="#00e5b0" />
      <rect x="15" y="7"  width="2.4" height="11" rx="1" fill="#00e5b0" opacity="0.7" />
    </svg>
  );
}

// ── Color helpers ─────────────────────────────────────────────────────────

const sevColor = (s) =>
  s === 'critical' ? 'var(--red)' : s === 'warning' ? 'var(--orange)' : 'var(--cyan)';
const sevBg = (s) =>
  s === 'critical' ? 'var(--red-dim)' : s === 'warning' ? 'var(--orange-dim)' : 'var(--cyan-dim)';

const gradeColor = (g) =>
  g[0] === 'A' ? 'var(--green)' : g[0] === 'B' ? 'var(--cyan)' : g[0] === 'C' ? 'var(--yellow)' : 'var(--orange)';

// ── Label ─────────────────────────────────────────────────────────────────

function Label({ children, style }) {
  return <div className="label" style={style}>{children}</div>;
}

// ── Grade pill (used in library + verdict) ────────────────────────────────

function GradePill({ grade, size = 'md' }) {
  const c = gradeColor(grade);
  const sz = size === 'lg' ? 64 : size === 'sm' ? 30 : 44;
  const fs = size === 'lg' ? 32 : size === 'sm' ? 14 : 21;
  return (
    <div style={{
      width: sz, height: sz, borderRadius: sz * 0.22,
      display: 'grid', placeItems: 'center',
      fontFamily: 'JetBrains Mono, monospace',
      fontWeight: 700, fontSize: fs,
      color: c,
      background: `linear-gradient(180deg, ${c}1a, ${c}08)`,
      border: `1px solid ${c}44`,
      boxShadow: `inset 0 0 14px ${c}1f, 0 0 18px -8px ${c}55`,
      flexShrink: 0,
    }}>
      {grade}
    </div>
  );
}

// ── ScoreRing — circular score with bg ring ───────────────────────────────

function ScoreRing({ value, max = 100, size = 96, label, color = 'var(--cyan)', stroke = 6 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (value / max) * c;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} fill="none" />
        <circle cx={size/2} cy={size/2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(.4,0,.2,1)' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div>
          <div className="mono" style={{ fontSize: size * 0.26, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
          {label && <div className="mono" style={{ fontSize: 8, color: 'var(--muted)', letterSpacing: '0.14em', textTransform: 'uppercase', marginTop: 4 }}>{label}</div>}
        </div>
      </div>
    </div>
  );
}

// ── Meter — horizontal bar with marker zones (LUFS, etc) ──────────────────

function MeterBar({ value, min, max, color, targets = [], target, height = 8, animated = true, marker }) {
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return (
    <div style={{ position: 'relative', height, background: 'var(--dim)', borderRadius: height/2, overflow: 'visible' }}>
      <div className={animated ? 'fill-w' : ''} style={{
        position: 'absolute', left: 0, top: 0, bottom: 0,
        width: `${pct * 100}%`,
        background: color,
        borderRadius: height/2,
        boxShadow: `0 0 6px ${color}44`,
      }} />
      {targets.map((t, i) => {
        const tp = (t.v - min) / (max - min);
        return (
          <div key={i} style={{
            position: 'absolute', top: -3, bottom: -3,
            left: `${tp * 100}%`, width: 1.5,
            background: t.color || 'rgba(255,255,255,0.32)',
          }} title={t.label} />
        );
      })}
      {target != null && (
        <div style={{
          position: 'absolute', top: -3, bottom: -3,
          left: `${((target - min) / (max - min)) * 100}%`, width: 2,
          background: 'rgba(167,139,250,0.7)', borderRadius: 1,
        }} />
      )}
      {marker != null && (
        <div style={{
          position: 'absolute', top: '50%',
          left: `${pct * 100}%`,
          transform: 'translate(-50%, -50%)',
          width: height + 4, height: height + 4,
          borderRadius: '50%', border: `2px solid ${color}`,
          background: 'var(--bg)',
          boxShadow: `0 0 8px ${color}88`,
        }} />
      )}
    </div>
  );
}

// ── Sparkline ─────────────────────────────────────────────────────────────

function Sparkline({ data, color = 'var(--cyan)', height = 32, width = 120, fill = true }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  });
  const path = `M ${points.join(' L ')}`;
  const fillPath = `${path} L ${width},${height} L 0,${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      {fill && (
        <path d={fillPath} fill={color} opacity="0.12" />
      )}
      <path d={path} stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── LufsMeter — used in side rail of Now Playing ──────────────────────────

function LufsMeter({ value, target, range = [-30, 0] }) {
  const [min, max] = range;
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const targetPct = (target - min) / (max - min);
  const color = value <= target + 0.5 ? 'var(--cyan)' : value <= target + 2 ? 'var(--yellow)' : 'var(--red)';
  return (
    <div style={{ position: 'relative', height: 14, background: 'var(--dim)', borderRadius: 4 }}>
      {/* zones */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${targetPct * 100}%`, background: 'linear-gradient(90deg, rgba(0,229,176,0.10), rgba(0,229,176,0.18))', borderRadius: 4 }} />
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct * 100}%`, background: color, borderRadius: 4, boxShadow: `0 0 8px ${color}66`, transition: 'width 0.18s linear' }} />
      <div style={{ position: 'absolute', top: -2, bottom: -2, left: `${targetPct * 100}%`, width: 2, background: 'rgba(167,139,250,0.7)' }} />
    </div>
  );
}

// ── CompactStat — compact metric block ────────────────────────────────────

function CompactStat({ label, value, sub, color = 'var(--text)', icon, tone, style }) {
  return (
    <div style={{
      padding: '10px 12px',
      background: tone ? `${tone}08` : 'rgba(255,255,255,0.018)',
      border: `1px solid ${tone ? `${tone}26` : 'var(--border)'}`,
      borderRadius: 8,
      ...style,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        {icon}
        <div className="mono" style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>
          {label}
        </div>
      </div>
      <div className="mono" style={{ fontSize: 20, fontWeight: 600, color, lineHeight: 1.05 }}>{value}</div>
      {sub && <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ── EQ bars (idle little decoration) ──────────────────────────────────────

function EQDots({ count = 4, color = 'var(--cyan)', height = 12 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{
          width: 3, background: color, borderRadius: 1,
          transformOrigin: 'bottom',
          animation: `eq ${0.55 + (i % 4) * 0.12}s ease-in-out infinite`,
          animationDelay: `${i * 0.07}s`,
          height: '100%',
        }} />
      ))}
      <style>{`@keyframes eq { 0%,100% { transform: scaleY(0.2); } 50% { transform: scaleY(1); } }`}</style>
    </div>
  );
}

// ── Section label inside cards ────────────────────────────────────────────

function SectionTitle({ children, accent = 'var(--cyan)', right, style }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: accent, boxShadow: `0 0 8px ${accent}` }} />
        <div className="label">{children}</div>
      </div>
      {right}
    </div>
  );
}

// ── Cover art "blob" — used in library cards ──────────────────────────────

function CoverArt({ hue = 168, size = 'md', children }) {
  const px = size === 'lg' ? 240 : size === 'sm' ? 36 : 56;
  return (
    <div style={{
      width: size === 'fluid' ? '100%' : px,
      height: size === 'fluid' ? '100%' : px,
      borderRadius: size === 'lg' ? 14 : 8,
      flexShrink: 0,
      position: 'relative',
      overflow: 'hidden',
      background: `
        radial-gradient(ellipse 80% 60% at 30% 30%, oklch(0.72 0.18 ${hue} / 0.7) 0%, transparent 55%),
        radial-gradient(ellipse 70% 80% at 80% 70%, oklch(0.55 0.20 ${(hue + 60) % 360} / 0.55) 0%, transparent 60%),
        linear-gradient(135deg, oklch(0.22 0.04 ${hue}) 0%, oklch(0.14 0.04 ${(hue + 30) % 360}) 100%)
      `,
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06), 0 4px 14px -6px rgba(0,0,0,0.6)',
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 4px)',
        opacity: 0.4,
      }} />
      {children}
    </div>
  );
}

Object.assign(window, {
  BrandMark, sevColor, sevBg, gradeColor,
  Label, GradePill, ScoreRing, MeterBar, Sparkline, LufsMeter,
  CompactStat, EQDots, SectionTitle, CoverArt,
});
