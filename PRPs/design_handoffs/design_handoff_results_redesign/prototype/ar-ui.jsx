/* spectre — Analysis Results redesign. Shared primitives + icons. */
const { useState: useStateUI, useEffect: useEffectUI, useRef: useRefUI } = React;

// ── Icons (stroke 1.7, rounded) ──────────────────────────────────────
function Icon({ name, size = 15 }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths = {
    back: <path d="M19 12H5M11 18l-6-6 6-6" />,
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
    play: <path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none" />,
    pause: <><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /></>,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    check: <path d="M5 13l4 4L19 7" />,
    x: <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>,
    flag: <><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></>,
    target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.4" /></>,
    chart: <><path d="M4 19V5" /><rect x="7" y="11" width="3" height="8" rx="1" /><rect x="13" y="7" width="3" height="12" rx="1" /></>,
    sliders: <><path d="M4 21v-6M4 11V3M12 21v-9M12 8V3M20 21v-4M20 13V3" /><circle cx="4" cy="13" r="1.6" /><circle cx="12" cy="10" r="1.6" /><circle cx="20" cy="15" r="1.6" /></>,
    layers: <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>,
    sparkle: <path d="M12 3l1.7 5.2L19 10l-5.3 1.8L12 17l-1.7-5.2L5 10l5.3-1.8z" fill="currentColor" stroke="none" />,
    users: <><circle cx="9" cy="8" r="3.2" /><path d="M3.4 19.2a5.6 5.6 0 0 1 11.2 0" /><path d="M16.2 5.3a3.2 3.2 0 0 1 0 5.5" /><path d="M17.8 19.2a5.6 5.6 0 0 0-3-5" /></>,
    refresh: <><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 4v4h-4" /></>,
    download: <><path d="M12 4v11" /><path d="M7 11l5 5 5-5" /><path d="M5 20h14" /></>,
    send: <path d="M5 12l15-7-7 15-2-6z" />,
    dots: <><circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none" /></>,
    anchor: <><circle cx="12" cy="5" r="2.4" /><path d="M12 22V8" /><path d="M5 12a7 7 0 0 0 14 0" /><path d="M3 12h2M19 12h2" /></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>,
    alert: <><path d="M10.3 4.3 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
    clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
    copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>,
    chevron: <path d="M6 9l6 6 6-6" />,
    folder: <path d="M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />,
    file: <><path d="M14 3v5h5" /><path d="M7 3h7l5 5v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /></>,
    bolt: <path d="M13 3 5 13h6l-1 8 8-10h-6z" />,
    vinyl: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5.4" opacity="0.4" /><circle cx="12" cy="12" r="2.4" /><circle cx="12" cy="12" r="0.7" fill="currentColor" stroke="none" /></>,
    cassette: <><rect x="3" y="5.5" width="18" height="13" rx="2.2" /><circle cx="9" cy="12.5" r="2" /><circle cx="15" cy="12.5" r="2" /><path d="M7.4 18.5l1.3-3h6.6l1.3 3" /></>,
    wrench: <path d="M14.5 5.5a4 4 0 0 0-5.3 5.1L4 16l2 2 5.4-5.2a4 4 0 0 0 5.1-5.3l-2.3 2.3-2.1-.6-.6-2.1z" />,
    zoom: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /><path d="M11 8v6M8 11h6" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>,
    wave: <path d="M3 12h2l2-6 3 13 3-16 2 9 2-4h4" />,
    collision: <><path d="M12 3v6M12 15v6M3 12h6M15 12h6" /><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" /></>,
    music: <><circle cx="6" cy="18" r="2.6" /><circle cx="17" cy="16" r="2.6" /><path d="M8.6 18V6l11-2v10" /></>,
    pulse: <path d="M3 12h4l2-6 4 14 2-8h6" />,
    spatial: <><circle cx="12" cy="12" r="3" /><ellipse cx="12" cy="12" rx="9" ry="3.6" /></>,
    save: <><path d="M5 4h11l3 3v13H5z" /><path d="M8 4v5h7V4" /><rect x="8" y="13" width="8" height="6" /></>,
    sound: <><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M17 8a5 5 0 0 1 0 8" /></>,
    message: <path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />,
    external: <><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>,
    robot: <><rect x="5" y="8" width="14" height="11" rx="2.5" /><path d="M12 4.6V8" /><circle cx="12" cy="3.5" r="1.3" fill="currentColor" stroke="none" /><path d="M9.5 13h.01M14.5 13h.01" /><path d="M3 12.5v2.5M21 12.5v2.5" /></>,
    phone: <><rect x="7" y="3" width="10" height="18" rx="2.5" /><path d="M10.5 18h3" /></>,
    laptop: <><rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M2 20h20" /></>,
  };
  return <svg {...p}>{paths[name] || null}</svg>;
}

// ── Brand mark — peak-meter glyph ────────────────────────────────────
function BrandMark() {
  return (
    <svg className="tb-mark" viewBox="0 0 22 22" fill="none">
      <rect x="3" y="9" width="2.4" height="9" rx="1" fill="currentColor" opacity="0.5" />
      <rect x="7" y="5" width="2.4" height="13" rx="1" fill="currentColor" opacity="0.85" />
      <rect x="11" y="2" width="2.4" height="16" rx="1" fill="currentColor" />
      <rect x="15" y="7" width="2.4" height="11" rx="1" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

// ── Cover art — gradient blob + mini waveform ────────────────────────
function CoverArt({ hue = 168, size = 64, radius = 11, badge }) {
  const bars = Array.from({ length: 22 }, (_, i) => 0.22 + Math.abs(Math.sin(i * 0.7) * 0.55 + Math.sin(i * 1.9) * 0.3));
  return (
    <div className="coverart" style={{ width: size, height: size, borderRadius: radius, '--ch': hue,
      position: 'relative', overflow: 'hidden', flexShrink: 0,
      background: `radial-gradient(ellipse 80% 60% at 30% 30%, oklch(0.74 0.15 ${hue} / .7), transparent 55%), radial-gradient(ellipse 70% 80% at 80% 70%, oklch(0.56 0.17 ${hue + 58} / .5), transparent 60%), linear-gradient(135deg, oklch(0.24 0.05 ${hue}), oklch(0.14 0.04 ${hue + 30}))`,
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08), 0 6px 18px -8px rgba(0,0,0,.6)' }}>
      {badge && <span style={{ position: 'absolute', top: 5, right: 5, zIndex: 2, fontFamily: "'JetBrains Mono',monospace", fontSize: 8.5, fontWeight: 600, padding: '2px 5px', borderRadius: 5, background: 'rgba(0,0,0,.42)', color: '#fff', border: '1px solid rgba(255,255,255,.22)' }}>{badge}</span>}
      <div style={{ position: 'absolute', left: 7, right: 7, bottom: 7, height: '34%', display: 'flex', alignItems: 'flex-end', gap: 1.4, zIndex: 1 }}>
        {bars.map((v, i) => <i key={i} style={{ flex: 1, background: 'rgba(255,255,255,.6)', borderRadius: .5, minHeight: 1, height: `${Math.min(100, v * 100)}%` }} />)}
      </div>
    </div>
  );
}

// ── Coach avatar — armored bot with animated EQ visor (mint) ─────────
function CoachBot({ size = 54, thinking = false, glow = true }) {
  const [bars, setBars] = useStateUI(() => Array.from({ length: 5 }, () => 0.35));
  const uid = useRefUI(Math.random().toString(36).slice(2, 8)).current;
  useEffectUI(() => {
    if ('matchMedia' in window && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf, t0 = performance.now() / 1000;
    const frame = () => {
      const t = performance.now() / 1000 - t0, sp = thinking ? 8 : 2.2;
      setBars([0, 1.1, 2.0, 3.3, 4.7].map((ph) => 0.3 + (Math.sin(t * sp + ph) * 0.5 + 0.5) * 0.6));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [thinking]);
  const S = 'rgba(0,229,176,';
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" style={{ display: 'block', filter: glow ? 'drop-shadow(0 0 14px rgba(0,229,176,0.32))' : 'none' }}>
      <defs>
        <linearGradient id={`cb-h-${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1c2433" /><stop offset="0.5" stopColor="#11151d" /><stop offset="1" stopColor="#070a12" /></linearGradient>
        <linearGradient id={`cb-v-${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#00f3bd" /><stop offset="0.55" stopColor="#00e5b0" /><stop offset="1" stopColor="#00e5b0" stopOpacity="0.5" /></linearGradient>
      </defs>
      <line x1="40" y1="2" x2="40" y2="10" stroke="#00e5b0" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="40" cy="3" r="2.6" fill="#00e5b0" />
      <path d="M14 22 L24 16 L40 14 L56 16 L66 22 L68 32 L66 48 L60 60 L52 68 L40 70 L28 68 L20 60 L14 48 L12 32 Z" fill={`url(#cb-h-${uid})`} stroke={S + '0.5)'} strokeWidth="1.4" strokeLinejoin="miter" />
      <rect x="4" y="30" width="9" height="20" rx="2.5" fill="#11151d" stroke={S + '0.55)'} strokeWidth="1.1" /><circle cx="8.5" cy="40" r="2" fill="#00e5b0" />
      <rect x="67" y="30" width="9" height="20" rx="2.5" fill="#11151d" stroke={S + '0.55)'} strokeWidth="1.1" /><circle cx="71.5" cy="40" r="2" fill="#00f3bd" />
      <path d="M16 30 L26 26 L40 25 L54 26 L64 30 L62 42 L56 46 L40 47 L24 46 L18 42 Z" fill="#0b1714" stroke={`url(#cb-v-${uid})`} strokeWidth="1.4" strokeLinejoin="miter" />
      {bars.map((v, i) => { const barH = 11 * v, x = 24 + i * 6.5, y = 36 - barH / 2; return <rect key={i} x={x} y={y} width="3.5" height={barH} rx="1" fill={i === 2 ? '#00f3bd' : '#00e5b0'} opacity={0.7 + v * 0.3} />; })}
      <rect x="30" y="54" width="20" height="10" rx="2" fill="#0b1714" stroke={S + '0.4)'} strokeWidth="0.9" />
      {Array.from({ length: 5 }).map((_, i) => <line key={i} x1={32 + i * 4} y1="56" x2={32 + i * 4} y2="62" stroke={S + '0.55)'} strokeWidth="1.1" strokeLinecap="round" />)}
    </svg>
  );
}

// ── Goniometer — stereo field scatter (meaningful viz) ───────────────
// correlation ~1 → vertical line (mono); ~0 → round cloud; width spreads it.
function Goniometer({ width = 0.5, correlation = 0.5, size = 116 }) {
  const N = 96, cx = size / 2, cy = size / 2, R = size / 2 - 8;
  const spread = 0.25 + width * 0.75;               // horizontal spread
  const tilt = correlation;                          // 1 = collapse to vertical
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 0.45 + 0.5 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.9));
    let x = Math.cos(a) * r * spread;
    let y = Math.sin(a) * r;
    // bias toward vertical as correlation rises
    x *= (1 - tilt * 0.82);
    pts.push([cx + x * R, cy + y * R]);
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="scope">
      <circle cx={cx} cy={cy} r={R} fill="rgba(0,229,176,.02)" stroke="var(--border-2)" strokeWidth="1" />
      <line x1={cx} y1={cy - R} x2={cx} y2={cy + R} stroke="rgba(255,255,255,.07)" strokeWidth="1" />
      <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke="rgba(255,255,255,.07)" strokeWidth="1" />
      <line x1={cx - R * 0.7} y1={cy - R * 0.7} x2={cx + R * 0.7} y2={cy + R * 0.7} stroke="rgba(255,255,255,.04)" strokeWidth="1" />
      <line x1={cx + R * 0.7} y1={cy - R * 0.7} x2={cx - R * 0.7} y2={cy + R * 0.7} stroke="rgba(255,255,255,.04)" strokeWidth="1" />
      <text x={cx - R} y={cy - 3} fill="var(--muted)" fontSize="7" fontFamily="JetBrains Mono">L</text>
      <text x={cx + R - 5} y={cy - 3} fill="var(--muted)" fontSize="7" fontFamily="JetBrains Mono">R</text>
      {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.5" fill="var(--accent)" opacity={0.5 + (i % 5) * 0.1} />)}
    </svg>
  );
}

// ── KeyBadge — qualifies low-confidence keys ─────────────────────────
function KeyBadge({ k, confidence }) {
  const conf = confidence == null ? 1 : confidence;
  const uncertain = conf < 0.5;
  return (
    <span className="mono" title={`key confidence ${Math.round(conf * 100)}%`} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, color: uncertain ? 'var(--muted)' : 'inherit' }}>
      {k}{uncertain && <span style={{ fontSize: 9, color: 'var(--orange)' }}>· uncertain</span>}
    </span>
  );
}

// ── JSON syntax view (copyable, highlighted) ─────────────────────────
function jsonHighlight(obj) {
  const json = JSON.stringify(obj, null, 2);
  const esc = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (m) => {
      let cls = 'jn';
      if (/^"/.test(m)) cls = /:$/.test(m) ? 'jk' : 'js';
      else if (/true|false/.test(m)) cls = 'jb';
      else if (/null/.test(m)) cls = 'jnull';
      return `<span class="${cls}">${m}</span>`;
    }
  );
}
function JsonView({ data, label, maxHeight = 340 }) {
  const [copied, setCopied] = useStateUI(false);
  const copy = () => {
    const text = JSON.stringify(data, null, 2);
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="json-block">
      <div className="json-hd">
        <span className="jl">{label}</span>
        <button className="json-copy" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={11} />{copied ? 'copied' : 'copy'}</button>
      </div>
      <pre className="json-pre" style={{ maxHeight }} dangerouslySetInnerHTML={{ __html: jsonHighlight(data) }} />
    </div>
  );
}

// ── Section label ────────────────────────────────────────────────────
function SecLabel({ children, hint }) {
  return (
    <div className="seclabel">
      <span className="t">{children}</span>
      {hint && <span className="hint">{hint}</span>}
      <span className="rule" />
    </div>
  );
}

// ── Specialist avatar (group-colored bot tile) ───────────────────────
function SpecAvatar({ icon, color, size = 40 }) {
  return (
    <div className="spec-av" style={{ width: size, height: size, color, background: `color-mix(in srgb, ${color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 34%, transparent)` }}>
      <Icon name={icon} size={size * 0.5} />
    </div>
  );
}

// ── Directive — prose fix with `backtick` params highlighted ─────────
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

// ── MiniSpectrum — 7-band evidence chart, one band flagged ───────────
function MiniSpectrum({ bands, warnIndex }) {
  const vals = bands.map(b => b.db);
  const floor = Math.min(...vals) - 4, ceil = Math.max(...vals) + 2;
  const h = (v) => `${Math.max(6, Math.min(100, ((v - floor) / (ceil - floor)) * 100))}%`;
  return (
    <div className="chart-bars">
      {bands.map((b, i) => {
        const warn = i === warnIndex;
        return (
          <div className="chart-col" key={i}>
            <div className="bw"><div className={`barfill${warn ? ' warn' : ''}`} style={{ height: h(b.db) }} /></div>
            <span className={`lbl${warn ? ' warn' : ''}`}>{b.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── MiniMeter — value vs target on a scale ───────────────────────────
function MiniMeter({ value, min, max, target, targetLabel, hot }) {
  const pct = (v) => `${Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100))}%`;
  return (
    <div>
      <div className="meter-line">
        <div className="fill" style={{ width: pct(value), background: hot ? 'var(--orange)' : 'var(--accent)', boxShadow: hot ? '0 0 6px rgba(251,146,60,.4)' : '0 0 6px rgba(0,229,176,.4)' }} />
        <div className="tgt" style={{ left: pct(target) }}><span className="cap">{targetLabel}</span></div>
      </div>
      <div className="meter-scale"><span>{min}</span><span>yours {value}</span><span>{max}</span></div>
    </div>
  );
}

// ── RackModule — a DSP module + its params (preset / fix data / Coach Mix) ──
function RackModule({ m }) {
  const meta = (AR_MOD_META && AR_MOD_META[m.mod]) || { accent: 'var(--accent)', icon: 'sliders' };
  return (
    <div className="rackmod" style={{ '--ac': meta.accent }}>
      <div className="rm-hd"><span className="rm-glyph"><Icon name={meta.icon} size={15} /></span><span className="rm-nm"><span className="rm-name">{m.mod}</span>{m.sub && <span className="rm-sub">{m.sub}</span>}</span></div>
      <div className="rm-params">
        {Object.entries(m.params).map(([k, v]) => <div className="rm-p" key={k}><span className="rm-k">{k}</span><span className="rm-v">{v}</span></div>)}
      </div>
    </div>
  );
}

Object.assign(window, { Icon, BrandMark, CoverArt, CoachBot, Goniometer, KeyBadge, JsonView, SecLabel, SpecAvatar, Directive, MiniSpectrum, MiniMeter, RackModule });
