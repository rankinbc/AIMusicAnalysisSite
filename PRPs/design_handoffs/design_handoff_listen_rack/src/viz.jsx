/* SPECTR · Listen rack redesign — Visualizer stage
 * Preserves the listening-room look (spectrum + EQ overlay, laser fan, fireworks,
 * radial/orbit/bloom/lights/spectro/info stages) and ADDS the AUTO director that
 * auto-pilots the stage. Mirrors the real app's imperative-handle architecture:
 * one rAF in VizStage computes a `frame`, then calls child .draw(frame) handles.
 */
const { useState: useStateV, useRef: useRefV, useEffect: useEffectV, useImperativeHandle, forwardRef, useMemo: useMemoV } = React;

const FMIN = 20, FMAX = 20000;
const freqToX = (hz) => Math.log(hz / FMIN) / Math.log(FMAX / FMIN);
const LASER_COLORS = ['#00e5b0', '#a78bfa', '#fb923c', '#f43f5e', '#fbbf24', '#60a5fa', '#34d399', '#f472b6'];

// ── Spectrum / radial / orbit / bloom / spectro / lights canvas ────────────
const StageCanvas = forwardRef(function StageCanvas({ accent }, ref) {
  const cvs = useRefV(null);
  const spectroBuf = useRefV([]);
  useImperativeHandle(ref, () => ({
    draw(frame, stages, accentHex) {
      const c = cvs.current; if (!c) return;
      const ctx = c.getContext('2d');
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = c.clientWidth, H = c.clientHeight;
      if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const spec = frame.spectrum, acc = accentHex;
      const has = (s) => stages.includes(s);
      if (has('smoke')) drawSmoke(ctx, W, H, frame);
      if (has('bloom')) drawBloom(ctx, W, H, acc, frame);
      if (has('spectro')) drawSpectro(ctx, W, H, frame, spectroBuf);
      if (has('lights')) drawLights(ctx, W, H, frame);
      if (has('eq')) drawBars(ctx, W, H, spec, acc, frame);
      if (has('radial')) drawRadial(ctx, W, H, spec, acc, frame);
      if (has('orbit')) drawOrbit(ctx, W, H, spec, acc, frame);
    },
  }));
  return <canvas ref={cvs} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />;
});

function drawBars(ctx, W, H, spec, acc, frame) {
  const n = spec.length, gap = 2, bw = (W - gap * (n - 1)) / n;
  for (let i = 0; i < n; i++) {
    const v = spec[i];
    const h = Math.max(2, v * (H - 8));
    const x = i * (bw + gap), y = H - h;
    const g = ctx.createLinearGradient(0, H, 0, y);
    g.addColorStop(0, acc + 'cc'); g.addColorStop(1, acc + '22');
    ctx.fillStyle = g;
    rr(ctx, x, y, bw, h, 1.5); ctx.fill();
  }
}
function drawLights(ctx, W, H, frame) {
  const cols = 6, rows = 3, gap = 8, cw = (W - gap * (cols - 1)) / cols, ch = (H - gap * (rows - 1)) / rows;
  for (let r = 0; r < rows; r++) for (let i = 0; i < cols; i++) {
    const seed = (i * 7 + r * 13);
    const lit = (Math.sin(frame.t / 240 + seed) * 0.5 + 0.5) * frame.energy;
    const col = LASER_COLORS[(seed) % LASER_COLORS.length];
    ctx.fillStyle = col + Math.round(20 + lit * 200).toString(16).padStart(2, '0');
    rr(ctx, i * (cw + gap), r * (ch + gap), cw, ch, 8); ctx.fill();
  }
}
function drawRadial(ctx, W, H, spec, acc, frame) {
  const cx = W / 2, cy = H / 2, base = Math.min(W, H) * 0.12;
  for (let ring = 0; ring < 4; ring++) {
    const rr0 = base + ring * base * 0.7 + frame.pulse * 10;
    ctx.beginPath(); ctx.arc(cx, cy, rr0, 0, Math.PI * 2);
    ctx.strokeStyle = acc + (ring === 0 ? 'ee' : (60 - ring * 14).toString(16)); ctx.lineWidth = 2; ctx.stroke();
  }
  const n = spec.length;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, len = base * 0.6 + spec[i] * base * 1.8;
    const r0 = base * 2.6;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
    ctx.strokeStyle = acc + 'aa'; ctx.lineWidth = 2; ctx.stroke();
  }
}
function drawOrbit(ctx, W, H, spec, acc, frame) {
  const cx = W / 2, cy = H / 2;
  ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(cx, cy, 6 + frame.pulse * 4, 0, Math.PI * 2); ctx.fill();
  ctx.shadowColor = acc; ctx.shadowBlur = 16; ctx.fill(); ctx.shadowBlur = 0;
  const n = 20;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + frame.t / 1600;
    const rad = Math.min(W, H) * (0.18 + 0.22 * (i % 3) / 2) + frame.pulse * 8 + spec[i % spec.length] * 24;
    ctx.fillStyle = acc + 'cc';
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad * 0.8, 2.6 + spec[i % spec.length] * 4, 0, Math.PI * 2); ctx.fill();
  }
}
function drawBloom(ctx, W, H, acc, frame) {
  const cx = W / 2, cy = H / 2;
  for (let i = 0; i < 5; i++) {
    const phase = (frame.t / 1400 + i / 5) % 1;
    const rad = phase * Math.min(W, H) * 0.6;
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.strokeStyle = acc + Math.round((1 - phase) * 150).toString(16).padStart(2, '0'); ctx.lineWidth = 2 + (1 - phase) * 3; ctx.stroke();
  }
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 40 + frame.pulse * 30);
  g.addColorStop(0, acc + 'aa'); g.addColorStop(1, acc + '00');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 70, 0, Math.PI * 2); ctx.fill();
}
function drawSpectro(ctx, W, H, frame, buf) {
  buf.current.push(frame.spectrum.slice());
  const maxCols = Math.floor(W / 3);
  while (buf.current.length > maxCols) buf.current.shift();
  const cw = 3;
  for (let x = 0; x < buf.current.length; x++) {
    const col = buf.current[buf.current.length - 1 - x];
    for (let b = 0; b < col.length; b++) {
      const v = col[b];
      const y = H - (b / col.length) * H;
      ctx.fillStyle = heat(v);
      ctx.fillRect(W - (x + 1) * cw, y - H / col.length, cw, H / col.length + 1);
    }
  }
}
function heat(v) {
  // green→yellow→red waterfall like the spectro reference
  if (v < 0.25) return `rgba(20,120,90,${0.2 + v})`;
  if (v < 0.5) return `rgba(52,211,153,${0.4 + v * 0.5})`;
  if (v < 0.75) return `rgba(251,191,36,${v})`;
  return `rgba(244,80,90,${v})`;
}
function rr(ctx, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

// ── Laser fan (canvas) — beams from an apex, beat-reactive ─────────────────
const LaserFan = forwardRef(function LaserFan(_, ref) {
  const cvs = useRefV(null);
  useImperativeHandle(ref, () => ({
    clear() { const c = cvs.current; if (!c) return; c.getContext('2d').clearRect(0, 0, c.width, c.height); },
    draw(frame, opts) {
      const c = cvs.current; if (!c) return;
      const ctx = c.getContext('2d');
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = c.clientWidth, H = c.clientHeight;
      if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      const { effect, intensity, mono, color, beams = 13, speed = 1, move = false, pattern = 'fan', flashPoints } = opts;
      let apexX = W / 2; const apexY = -10;
      if (move) {
        const seg = Math.floor(frame.t / 2400);
        const rnd = (n) => Math.abs((Math.sin(n * 127.1) * 43758.5453) % 1);
        const f = Math.min(1, ((frame.t % 2400) / 2400) * 3.2);
        apexX = W * (0.12 + 0.76 * (rnd(seg - 1) + (rnd(seg) - rnd(seg - 1)) * f));
      }
      const spread = Math.PI * 0.92;
      const sweep = effect === 'sweep' ? Math.sin(frame.t / 700 * speed) * 0.18 : 0;
      const pulse = (effect === 'beat' || effect === 'strobe') ? (0.4 + frame.pulse * 0.6) : 0.55;
      const rnd1 = (n) => Math.abs((Math.sin(n) * 43758.5453) % 1);
      for (let i = 0; i < beams; i++) {
        const tt = beams > 1 ? i / (beams - 1) : 0.5;
        let sx = apexX, sy = apexY, ex, ey;
        if (pattern === 'parallel') {
          const x = W * (0.05 + 0.9 * tt) + Math.sin(frame.t / 900 * speed + i) * W * 0.02;
          sx = x; sy = -10; ex = x; ey = H * 1.1;
        } else if (pattern === 'scan') {
          const ang = Math.PI / 2 + Math.sin(frame.t / 600 * speed) * 0.5 + (tt - 0.5) * 0.12;
          ex = apexX + Math.cos(ang) * H * 1.4; ey = apexY + Math.sin(ang) * H * 1.4;
        } else if (pattern === 'random') {
          if (rnd1(Math.floor(frame.t / 110) * 131 + i * 977) < 0.6) continue;
          const ang = Math.PI / 2 + (tt - 0.5) * spread + sweep;
          ex = apexX + Math.cos(ang) * H * 1.4; ey = apexY + Math.sin(ang) * H * 1.4;
        } else {
          const ang = Math.PI / 2 + (tt - 0.5) * spread + sweep;
          ex = apexX + Math.cos(ang) * H * 1.4; ey = apexY + Math.sin(ang) * H * 1.4;
        }
        const col = mono ? (color || '#00e5b0') : LASER_COLORS[i % LASER_COLORS.length];
        const w = (1.4 + pulse * 3.2) * (0.5 + intensity);
        const grad = ctx.createLinearGradient(sx, sy, ex, ey);
        grad.addColorStop(0, col + 'ff'); grad.addColorStop(0.5, col + '55'); grad.addColorStop(1, col + '00');
        ctx.strokeStyle = grad; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      }
      if (pattern !== 'parallel') {
        const core = ctx.createRadialGradient(apexX, apexY + 8, 0, apexX, apexY + 8, 60 + frame.pulse * 30);
        core.addColorStop(0, 'rgba(255,255,255,' + (0.5 + frame.pulse * 0.4) + ')'); core.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = core; ctx.beginPath(); ctx.arc(apexX, apexY + 8, 70, 0, Math.PI * 2); ctx.fill();
      }
      if (flashPoints) for (const p of flashPoints) {
        if (frame.t < p.born) continue;
        const fx = p.x * W, fy = p.y * H, rad = 46 * p.life + 12;
        const fc = mono ? (color || '#00e5b0') : LASER_COLORS[Math.floor(p.x * 11) % LASER_COLORS.length];
        const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, rad);
        fg.addColorStop(0, `rgba(255,255,255,${0.8 * p.life})`);
        fg.addColorStop(0.35, fc + Math.round(p.life * 200).toString(16).padStart(2, '0'));
        fg.addColorStop(1, fc + '00');
        ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(fx, fy, rad, 0, Math.PI * 2); ctx.fill();
      }
      if ((effect === 'flash' || effect === 'strobe') && frame.flash > 0.02) {
        ctx.fillStyle = `rgba(255,255,255,${frame.flash * 0.3})`; ctx.fillRect(0, 0, W, H);
      }
      ctx.globalCompositeOperation = 'source-over';
    },
  }));
  return <canvas ref={cvs} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }} />;
});

// ── Fireworks (drop moment) ────────────────────────────────────────────────
const Fireworks = forwardRef(function Fireworks(_, ref) {
  const cvs = useRefV(null), parts = useRefV([]), raf = useRefV(0);
  useImperativeHandle(ref, () => ({
    launch() {
      const c = cvs.current; if (!c) return;
      const W = c.clientWidth, H = c.clientHeight;
      for (let i = 0; i < 60; i++) {
        const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 4;
        parts.current.push({ x: W / 2, y: H * 0.42, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, life: 1, col: LASER_COLORS[i % LASER_COLORS.length] });
      }
      if (!raf.current) loop();
    },
  }));
  function loop() {
    const c = cvs.current; if (!c) { raf.current = 0; return; }
    const ctx = c.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth, H = c.clientHeight;
    if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    parts.current = parts.current.filter((p) => p.life > 0);
    for (const p of parts.current) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.life -= 0.016;
      ctx.fillStyle = p.col + Math.round(p.life * 255).toString(16).padStart(2, '0');
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.4 * p.life + 0.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    if (parts.current.length) raf.current = requestAnimationFrame(loop); else { raf.current = 0; ctx.clearRect(0, 0, W, H); }
  }
  useEffectV(() => () => cancelAnimationFrame(raf.current), []);
  return <canvas ref={cvs} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }} />;
});

// ── EQ response curve overlay (when stage = eq) ────────────────────────────
function EqCurveOverlay({ bands, accent }) {
  const W = 1000, H = 200, midY = H * 0.46;
  const dbToY = (db) => midY - db * (H * 0.026);
  const gainAt = (xp) => bands.reduce((g, b) => {
    const bx = freqToX(b.freq), sigma = 0.085 / (b.q || 1) + 0.03;
    return g + b.gainDb * Math.exp(-Math.pow((xp - bx) / sigma, 2));
  }, 0);
  const pts = []; for (let i = 0; i <= 160; i++) { const xp = i / 160; pts.push([xp * W, dbToY(gainAt(xp))]); }
  const line = pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <defs>
        <linearGradient id="eqstroke2" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#a78bfa" /><stop offset="1" stopColor="#00e5b0" /></linearGradient>
        <linearGradient id="eqfill2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgba(167,139,250,0.18)" /><stop offset="1" stopColor="rgba(0,229,176,0.01)" /></linearGradient>
      </defs>
      <line x1="0" y1={midY} x2={W} y2={midY} stroke="rgba(255,255,255,0.14)" strokeWidth="1" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
      <path d={`${line} L ${W} ${midY} L 0 ${midY} Z`} fill="url(#eqfill2)" />
      <path d={line} fill="none" stroke="url(#eqstroke2)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {bands.map((b, i) => { const x = freqToX(b.freq) * W, y = dbToY(b.gainDb), on = Math.abs(b.gainDb) > 0.05; return (
        <g key={i}><circle cx={x} cy={y} r={on ? 9 : 6} fill={on ? 'rgba(0,229,176,0.16)' : 'rgba(255,255,255,0.05)'} stroke={on ? '#00e5b0' : 'rgba(255,255,255,0.3)'} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /><circle cx={x} cy={y} r="2" fill={on ? '#00e5b0' : 'rgba(255,255,255,0.5)'} /></g>
      ); })}
    </svg>
  );
}

function drawSmoke(ctx, W, H, frame) {
  ctx.globalCompositeOperation = 'lighter';
  const t = frame.t / 1000;
  for (let i = 0; i < 7; i++) {
    const hue = (i * 52 + t * 8) % 360;
    const x = W * (0.5 + 0.4 * Math.sin(t * 0.23 + i * 1.7));
    const y = H * (0.5 + 0.42 * Math.cos(t * 0.19 + i * 2.1));
    const r = Math.min(W, H) * (0.26 + 0.12 * Math.sin(t * 0.5 + i)) * (0.65 + frame.energy * 0.7);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `hsla(${hue},85%,62%,${0.14 + frame.energy * 0.12})`);
    g.addColorStop(1, `hsla(${hue},85%,62%,0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// Listeners stage — every listener + their live status as a visual
function ListenersStage({ myStatus }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexWrap: 'wrap', alignContent: 'center', justifyContent: 'center', gap: '24px 34px', padding: 40, zIndex: 2 }}>
      {ROOM_LISTENERS.map((u) => (
        <div key={u.handle} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9 }}>
          <div style={{ position: 'relative' }}>
            <Avatar handle={u.handle} hue={u.hue} anon={u.anon} size={56} ring />
            <span style={{ position: 'absolute', bottom: -6, right: -10, fontSize: 26, filter: 'drop-shadow(0 2px 5px rgba(0,0,0,0.7))' }}>{u.you ? myStatus : u.state}</span>
          </div>
          <span className="mono" style={{ fontSize: 11, color: u.you ? 'var(--cyan)' : 'var(--text-2)' }}>{u.anon ? 'anon' : '@' + u.handle}</span>
        </div>
      ))}
    </div>
  );
}

// EQ axis measurements (frequency + dB) overlaid on the spectrum
function EqAxes() {
  const F = [[60, '60'], [120, '120'], [250, '250'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k']];
  const DB = [0, -12, -24, -36];
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3 }}>
      {DB.map((d, i) => (
        <div key={d} style={{ position: 'absolute', left: 0, right: 8, top: `${10 + i * 24}%` }}>
          <div style={{ position: 'absolute', left: 30, right: 0, height: 1, background: 'rgba(255,255,255,0.05)' }} />
          <span className="mono" style={{ position: 'absolute', left: 6, top: -6, fontSize: 8.5, color: 'rgba(255,255,255,0.32)' }}>{d}</span>
        </div>
      ))}
      {F.map(([hz, l]) => (
        <span key={hz} className="mono" style={{ position: 'absolute', bottom: 4, left: `${freqToX(hz) * 100}%`, transform: 'translateX(-50%)', fontSize: 8.5, color: 'rgba(255,255,255,0.32)' }}>{l}</span>
      ))}
    </div>
  );
}

// Rack stage — side-scrolling marquee of the active chain devices
function RackStage({ modules }) {
  if (!modules || modules.length === 0) {
    return <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', zIndex: 2 }}><span className="mono" style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '0.1em' }}>RACK IS FLAT — enable a device to see the chain</span></div>;
  }
  const row = [...modules, ...modules];
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', overflow: 'hidden', zIndex: 2 }}>
      <div className="rack-marquee" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {row.map((m, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ color: 'var(--muted)', fontSize: 18, flexShrink: 0 }}>→</span>}
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '18px 22px', borderRadius: 14, minWidth: 120, background: `linear-gradient(180deg, ${cssVar(m.accent)}1f, ${cssVar(m.accent)}06)`, border: `1px solid ${cssVar(m.accent)}55`, boxShadow: `0 0 26px ${cssVar(m.accent)}33` }}>
              <ModuleIcon glyph={m.glyph} accent={m.accent} on size={44} />
              <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap' }}>{m.label}</div>
              <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.14em', color: m.accent }}>● ACTIVE</span>
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ── The stage ──────────────────────────────────────────────────────────────
function VizStage({ playing, stages, setStages, viz, setViz, director, eqBands, eqOn, sectionLabel, height = 300, compact = false, onStageEngine, onDrop, myStatus, activeModules }) {
  const stageRef = useRefV(null), laserRef = useRefV(null), fireRef = useRefV(null), bgLayerRef = useRefV(null);
  const frameRef = useRefV({ t: 0, spectrum: new Array(56).fill(0), energy: 0.4, pulse: 0, beat: false, flash: 0 });
  const beatPhase = useRefV(0), lastDrop = useRefV(0), autoLast = useRefV(0), flashPtsRef = useRefV([]), lastBurst = useRefV(0), autoReactLast = useRefV(0);
  const accentHex = useMemoV(() => cssVar(viz.barColor || 'var(--cyan)'), [viz.barColor]);
  // keep latest stage id for the loop without re-subscribing
  const stageRef2 = useRefV(stages); stageRef2.current = stages;
  const onDropRef = useRefV(onDrop); onDropRef.current = onDrop;

  // single rAF: compute frame → drive canvas + laser; auto-director cycles stage
  useEffectV(() => {
    if (!playing) { laserRef.current?.clear(); return; }
    let raf = 0, prev = performance.now();
    const bpm = 128, beatSec = 60 / bpm;
    const loop = (now) => {
      const dt = (now - prev) / 1000; prev = now;
      const f = frameRef.current; f.t = now;
      const autoDir = director && director.id !== 'off';
      // beat
      beatPhase.current += dt / beatSec; let beat = false;
      if (beatPhase.current >= 1) { beatPhase.current -= 1; beat = true; }
      f.beat = beat;
      // energy: slow LFO + director energy bias + occasional drop spikes
      const dirE = (director && director.id !== 'off' && director.energy != null) ? director.energy / 100 : ((viz && viz.energy != null) ? viz.energy / 100 : 0.5);
      const lfo = 0.5 + 0.5 * Math.sin(now / 2600);
      f.energy = Math.max(0.08, Math.min(1, dirE * 0.7 + lfo * 0.4));
      if (bgLayerRef.current) bgLayerRef.current.style.opacity = viz.bgSync ? (0.4 + f.energy * 0.9).toFixed(2) : '';
      // drop every ~9s when director drives FX (or club/hype)
      const dropFx = !director || director.id === 'off' ? viz.dropFx : true;
      if (dropFx && now - lastDrop.current > (director && director.id === 'hype' ? 6000 : 9000) && lfo > 0.82) {
        lastDrop.current = now; fireRef.current?.launch(); f.flash = 1; f.pulse = 1;
        if (onDropRef.current) onDropRef.current();
      }
      if (beat) f.pulse = 1; f.pulse *= 0.86; f.flash *= 0.8;
      // spectrum (procedural, pink-ish tilt + beat emphasis)
      const n = f.spectrum.length;
      for (let i = 0; i < n; i++) {
        const tilt = Math.pow(1 - i / n, 0.7);
        const wob = 0.5 + 0.5 * Math.sin(now / 360 + i * 0.5) * Math.sin(now / 900 + i);
        f.spectrum[i] = Math.max(0.02, Math.min(1, (tilt * 0.7 + 0.15) * (0.5 + wob * 0.7) * f.energy * (1 + f.pulse * 0.35)));
      }
      // AUTO director: cycle the stage + laser on a timer
      if (director && director.id !== 'off') {
        if (now - autoLast.current > director.cycleSec * 1000) {
          autoLast.current = now;
          const cur = stageRef2.current[0];
          const next = director.stages[(director.stages.indexOf(cur) + 1) % director.stages.length];
          setStages([next]);
        }
      }
      // AUTO-REACT: drive layer count + intensity from the music's energy
      if (!autoDir && viz.autoReact && now - autoReactLast.current > 1000) {
        autoReactLast.current = now;
        const sens = viz.autoReactSens != null ? viz.autoReactSens : 0.55;
        const e2 = Math.min(1, f.energy * (0.6 + sens));
        const want = e2 < 0.34 ? ['bloom'] : e2 < 0.58 ? ['eq'] : e2 < 0.8 ? ['eq', 'radial'] : ['eq', 'radial', 'lights'];
        if (want.join() !== stageRef2.current.join()) setStages(want);
      }
      const acc = viz.autoColor ? hslToHex((((now / 26) % 360) + (viz.specHue || 165)) % 360) : accentHex;
      stageRef.current?.draw(f, stageRef2.current, acc);
      if (viz.laserOn) {
        if (viz.laserFlash && now - lastBurst.current > 2400 + Math.random() * 2800) {
          lastBurst.current = now;
          const k = 3 + Math.floor(Math.random() * 3);
          for (let i = 0; i < k; i++) flashPtsRef.current.push({ x: 0.1 + Math.random() * 0.8, y: 0.1 + Math.random() * 0.66, life: 1, born: now + i * 70 });
        }
        flashPtsRef.current = flashPtsRef.current.filter((p) => { if (now >= p.born) p.life -= 0.07; return p.life > 0; });
        laserRef.current?.draw(f, {
          effect: director && director.id !== 'off' ? director.laser : viz.laserEffect,
          intensity: Math.min(1.2, ((viz.laserIntensity || 60) / 100) * ((viz.laserSync || (!autoDir && viz.autoReact)) ? (0.4 + f.energy) : 1)), mono: viz.laserMono, color: viz.laserColor,
          beams: viz.laserBeams || 13, speed: viz.laserSpeed || 1, move: viz.laserMove, pattern: viz.laserPattern, flashPoints: flashPtsRef.current,
        });
      } else { laserRef.current?.clear(); flashPtsRef.current = []; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line
  }, [playing, accentHex, viz.laserOn, viz.laserEffect, viz.laserIntensity, viz.laserMono, viz.laserColor, viz.laserBeams, viz.laserSpeed, viz.laserMove, viz.laserFlash, viz.laserPattern, viz.dropFx, viz.autoColor, viz.laserSync, viz.bgSync, viz.autoReact, viz.autoReactSens, director]);

  const isInfo = stages.includes('info');
  const isRoom = stages.includes('room');
  const isDevices = stages.includes('devices');
  const autoOn = director && director.id !== 'off';

  return (
    <div ref={onStageEngine} style={{ position: 'relative', height, overflow: 'hidden', borderRadius: compact ? 0 : 'var(--radius) var(--radius) 0 0', background: 'var(--bg-2)' }}>
      <div ref={bgLayerRef} className={'viz-bg' + (viz.bgAuto ? ' bg-cycle' : '')} style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse 95% 85% at 50% 100%, ${cssVar(viz.bg || 'var(--cyan)')}1f, transparent 62%), transparent` }} />
      {viz.bgFlash && playing && <div className="bg-flash" style={{ background: viz.bgFlashColor, animationDuration: (1 / (viz.bgFlashHz || 2)) + 's' }} />}
      {!isInfo && <StageCanvas ref={stageRef} accent={accentHex} />}
      {isRoom && <ListenersStage myStatus={myStatus} />}
      {isDevices && <RackStage modules={activeModules} />}
      {stages.includes('eq') && <EqAxes />}
      {isInfo && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          <div>
            <CoverArt hue={168} size="lg" />
            <div style={{ fontSize: 26, fontWeight: 800, marginTop: 16 }}>Aurora</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>v3 · Final Mix</div>
          </div>
        </div>
      )}
      {/* EQ curve overlay removed — the Rack stage shows the active device cycle */}
      <LaserFan ref={laserRef} />
      <Fireworks ref={fireRef} />

      {/* stage selection + full visual controls live in the right "Visuals" tab;
          live metering is the collapsible overlay rendered by the page (VisualMeters). */}

      {/* AUTO director floating status removed */}
    </div>
  );
}

Object.assign(window, { VizStage, StageCanvas, LaserFan, Fireworks, EqCurveOverlay, freqToX, LASER_COLORS });
