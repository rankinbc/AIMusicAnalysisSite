/* SPECTR · Listen rack redesign — Visualizer stage (ported to TS)
 * Spectrum + EQ overlay, laser fan, fireworks, radial/orbit/bloom/lights/spectro/
 * info stages, plus the AUTO director that auto-pilots the stage. One rAF in
 * VizStage computes a `frame`, then calls child .draw(frame) handles.
 *
 * SWAP BOUNDARY: the spectrum/levels are SYNTHETIC here. Replace the procedural
 * `frameRef.current.spectrum`/energy with a real AnalyserNode tap (see
 * PORTING_NOTES.md → StageCanvas).
 */
import { forwardRef, Fragment, useEffect, useImperativeHandle, useMemo, useRef } from 'react';

import { CoverArt } from '../../ui/CoverArt';
import type { AudioFrame } from '../listen/useAudioGraph';
import {
  ROOM_LISTENERS, type Director, type EqBand, type ModuleManifest, type VizState,
} from './data';
import { cssVar, freqToX, hslToHex, LASER_COLORS } from './helpers';
import { Avatar, ModuleIcon } from './ui';

export interface VizFrame { t: number; spectrum: number[]; energy: number; pulse: number; beat: boolean; flash: number }
interface FlashPoint { x: number; y: number; life: number; born: number }
interface LaserOpts {
  effect: string; intensity: number; mono: boolean; color: string;
  beams?: number; speed?: number; move?: boolean; pattern?: string; flashPoints?: FlashPoint[];
}
export interface StageCanvasHandle { draw(frame: VizFrame, stages: string[], accentHex: string): void }
export interface LaserFanHandle { clear(): void; draw(frame: VizFrame, opts: LaserOpts): void }
export interface FireworksHandle { launch(): void }

// ── Spectrum / radial / orbit / bloom / spectro / lights canvas ────────────
const StageCanvas = forwardRef<StageCanvasHandle, { accent: string }>(function StageCanvas(_props, ref) {
  const cvs = useRef<HTMLCanvasElement>(null);
  const spectroBuf = useRef<number[][]>([]);
  useImperativeHandle(ref, () => ({
    draw(frame, stages, accentHex) {
      const c = cvs.current;
      if (!c) return;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = c.clientWidth, H = c.clientHeight;
      if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const spec = frame.spectrum, acc = accentHex;
      const has = (s: string) => stages.includes(s);
      if (has('smoke')) drawSmoke(ctx, W, H, frame);
      if (has('bloom')) drawBloom(ctx, W, H, acc, frame);
      if (has('spectro')) drawSpectro(ctx, W, H, frame, spectroBuf);
      if (has('lights')) drawLights(ctx, W, H, frame);
      if (has('eq')) drawBars(ctx, W, H, spec, acc);
      if (has('radial')) drawRadial(ctx, W, H, spec, acc, frame);
      if (has('orbit')) drawOrbit(ctx, W, H, spec, acc, frame);
    },
  }));
  return <canvas ref={cvs} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />;
});

function drawBars(ctx: CanvasRenderingContext2D, W: number, H: number, spec: number[], acc: string) {
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
function drawLights(ctx: CanvasRenderingContext2D, W: number, H: number, frame: VizFrame) {
  const cols = 6, rows = 3, gap = 8, cw = (W - gap * (cols - 1)) / cols, ch = (H - gap * (rows - 1)) / rows;
  for (let r = 0; r < rows; r++) for (let i = 0; i < cols; i++) {
    const seed = (i * 7 + r * 13);
    const lit = (Math.sin(frame.t / 240 + seed) * 0.5 + 0.5) * frame.energy;
    const col = LASER_COLORS[(seed) % LASER_COLORS.length];
    ctx.fillStyle = col + Math.round(20 + lit * 200).toString(16).padStart(2, '0');
    rr(ctx, i * (cw + gap), r * (ch + gap), cw, ch, 8); ctx.fill();
  }
}
function drawRadial(ctx: CanvasRenderingContext2D, W: number, H: number, spec: number[], acc: string, frame: VizFrame) {
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
function drawOrbit(ctx: CanvasRenderingContext2D, W: number, H: number, spec: number[], acc: string, frame: VizFrame) {
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
function drawBloom(ctx: CanvasRenderingContext2D, W: number, H: number, acc: string, frame: VizFrame) {
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
function drawSpectro(ctx: CanvasRenderingContext2D, W: number, H: number, frame: VizFrame, buf: React.RefObject<number[][]>) {
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
function heat(v: number): string {
  if (v < 0.25) return `rgba(20,120,90,${0.2 + v})`;
  if (v < 0.5) return `rgba(52,211,153,${0.4 + v * 0.5})`;
  if (v < 0.75) return `rgba(251,191,36,${v})`;
  return `rgba(244,80,90,${v})`;
}
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ── Laser fan (canvas) — beams from an apex, beat-reactive ─────────────────
const LaserFan = forwardRef<LaserFanHandle>(function LaserFan(_props, ref) {
  const cvs = useRef<HTMLCanvasElement>(null);
  useImperativeHandle(ref, () => ({
    clear() { const c = cvs.current; if (!c) return; c.getContext('2d')?.clearRect(0, 0, c.width, c.height); },
    draw(frame, opts) {
      const c = cvs.current;
      if (!c) return;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = c.clientWidth, H = c.clientHeight;
      if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      const { effect, intensity, mono, color, beams = 13, speed = 1, move = false, pattern = 'fan', flashPoints } = opts;
      let apexX = W / 2;
      const apexY = -10;
      if (move) {
        const seg = Math.floor(frame.t / 2400);
        const rnd = (n: number) => Math.abs((Math.sin(n * 127.1) * 43758.5453) % 1);
        const f = Math.min(1, ((frame.t % 2400) / 2400) * 3.2);
        apexX = W * (0.12 + 0.76 * (rnd(seg - 1) + (rnd(seg) - rnd(seg - 1)) * f));
      }
      const spread = Math.PI * 0.92;
      const sweep = effect === 'sweep' ? Math.sin(frame.t / 700 * speed) * 0.18 : 0;
      const pulse = (effect === 'beat' || effect === 'strobe') ? (0.4 + frame.pulse * 0.6) : 0.55;
      const rnd1 = (n: number) => Math.abs((Math.sin(n) * 43758.5453) % 1);
      for (let i = 0; i < beams; i++) {
        const tt = beams > 1 ? i / (beams - 1) : 0.5;
        let sx = apexX, sy = apexY, ex: number, ey: number;
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
interface Particle { x: number; y: number; vx: number; vy: number; life: number; col: string }
const Fireworks = forwardRef<FireworksHandle>(function Fireworks(_props, ref) {
  const cvs = useRef<HTMLCanvasElement>(null);
  const parts = useRef<Particle[]>([]);
  const raf = useRef(0);
  const loop = () => {
    const c = cvs.current;
    if (!c) { raf.current = 0; return; }
    const ctx = c.getContext('2d');
    if (!ctx) { raf.current = 0; return; }
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
    if (parts.current.length) raf.current = requestAnimationFrame(loop);
    else { raf.current = 0; ctx.clearRect(0, 0, W, H); }
  };
  useImperativeHandle(ref, () => ({
    launch() {
      const c = cvs.current;
      if (!c) return;
      const W = c.clientWidth, H = c.clientHeight;
      for (let i = 0; i < 60; i++) {
        const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 4;
        parts.current.push({ x: W / 2, y: H * 0.42, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, life: 1, col: LASER_COLORS[i % LASER_COLORS.length] });
      }
      if (!raf.current) loop();
    },
  }));
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return <canvas ref={cvs} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }} />;
});

// ── EQ response curve overlay (exported; kept for parity, not mounted) ──────
export function EqCurveOverlay({ bands }: { bands: EqBand[]; accent?: string }) {
  const W = 1000, H = 200, midY = H * 0.46;
  const dbToY = (db: number) => midY - db * (H * 0.026);
  const gainAt = (xp: number) => bands.reduce((g, b) => {
    const bx = freqToX(b.freq), sigma = 0.085 / (b.q || 1) + 0.03;
    return g + b.gainDb * Math.exp(-Math.pow((xp - bx) / sigma, 2));
  }, 0);
  const pts: [number, number][] = [];
  for (let i = 0; i <= 160; i++) { const xp = i / 160; pts.push([xp * W, dbToY(gainAt(xp))]); }
  const line = pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <defs>
        <linearGradient id="lreqstroke" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#a78bfa" /><stop offset="1" stopColor="#00e5b0" /></linearGradient>
        <linearGradient id="lreqfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgba(167,139,250,0.18)" /><stop offset="1" stopColor="rgba(0,229,176,0.01)" /></linearGradient>
      </defs>
      <line x1="0" y1={midY} x2={W} y2={midY} stroke="rgba(255,255,255,0.14)" strokeWidth="1" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
      <path d={`${line} L ${W} ${midY} L 0 ${midY} Z`} fill="url(#lreqfill)" />
      <path d={line} fill="none" stroke="url(#lreqstroke)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {bands.map((b, i) => {
        const x = freqToX(b.freq) * W, y = dbToY(b.gainDb), on = Math.abs(b.gainDb) > 0.05;
        return <g key={i}><circle cx={x} cy={y} r={on ? 9 : 6} fill={on ? 'rgba(0,229,176,0.16)' : 'rgba(255,255,255,0.05)'} stroke={on ? '#00e5b0' : 'rgba(255,255,255,0.3)'} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /><circle cx={x} cy={y} r="2" fill={on ? '#00e5b0' : 'rgba(255,255,255,0.5)'} /></g>;
      })}
    </svg>
  );
}

function drawSmoke(ctx: CanvasRenderingContext2D, W: number, H: number, frame: VizFrame) {
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
function ListenersStage({ myStatus }: { myStatus: string }) {
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
  const F: [number, string][] = [[60, '60'], [120, '120'], [250, '250'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k']];
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
function RackStage({ modules }: { modules: ModuleManifest[] }) {
  if (!modules || modules.length === 0) {
    return <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', zIndex: 2 }}><span className="mono" style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '0.1em' }}>RACK IS FLAT — enable a device to see the chain</span></div>;
  }
  const row = [...modules, ...modules];
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', overflow: 'hidden', zIndex: 2 }}>
      <div className="lr-rack-marquee" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {row.map((m, i) => (
          <Fragment key={i}>
            {i > 0 && <span style={{ color: 'var(--muted)', fontSize: 18, flexShrink: 0 }}>→</span>}
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '18px 22px', borderRadius: 14, minWidth: 120, background: `linear-gradient(180deg, ${cssVar(m.accent)}1f, ${cssVar(m.accent)}06)`, border: `1px solid ${cssVar(m.accent)}55`, boxShadow: `0 0 26px ${cssVar(m.accent)}33` }}>
              <ModuleIcon glyph={m.glyph} accent={m.accent} on size={44} />
              <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap' }}>{m.label}</div>
              <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.14em', color: m.accent }}>● ACTIVE</span>
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// ── The stage ──────────────────────────────────────────────────────────────
export function VizStage({
  playing, stages, setStages, viz, director, height = 300, compact = false, onStageEngine, onDrop, myStatus, activeModules, getFrame,
}: {
  playing: boolean;
  stages: string[];
  setStages: (v: string[]) => void;
  viz: VizState;
  director: Director | undefined;
  height?: number;
  compact?: boolean;
  onStageEngine?: React.Ref<HTMLDivElement>;
  onDrop?: () => void;
  myStatus: string;
  activeModules: ModuleManifest[];
  /** Real AnalyserNode frame source (Phase 2 Task 3). When supplied, the spectrum
   *  bars + energy come from the live mix; absent ⇒ synthetic (mock demo route). */
  getFrame?: () => AudioFrame | null;
}) {
  const stageRef = useRef<StageCanvasHandle>(null);
  const laserRef = useRef<LaserFanHandle>(null);
  const fireRef = useRef<FireworksHandle>(null);
  const bgLayerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<VizFrame>({ t: 0, spectrum: new Array(56).fill(0), energy: 0.4, pulse: 0, beat: false, flash: 0 });
  const beatPhase = useRef(0), lastDrop = useRef(0), autoLast = useRef(0);
  const flashPtsRef = useRef<FlashPoint[]>([]), lastBurst = useRef(0), autoReactLast = useRef(0);
  const accentHex = useMemo(() => cssVar(viz.barColor || 'var(--cyan)'), [viz.barColor]);
  const stageRef2 = useRef(stages); stageRef2.current = stages;
  const onDropRef = useRef(onDrop); onDropRef.current = onDrop;
  const getFrameRef = useRef(getFrame); getFrameRef.current = getFrame;

  // single rAF: compute frame → drive canvas + laser; auto-director cycles stage
  useEffect(() => {
    if (!playing) { laserRef.current?.clear(); return undefined; }
    let raf = 0;
    let prev = performance.now();
    const bpm = 128, beatSec = 60 / bpm;
    const loop = (now: number) => {
      const dt = (now - prev) / 1000; prev = now;
      const f = frameRef.current; f.t = now;
      const autoDir = director ? director.id !== 'off' : false;
      beatPhase.current += dt / beatSec; let beat = false;
      if (beatPhase.current >= 1) { beatPhase.current -= 1; beat = true; }
      f.beat = beat;
      const dirE = (director && director.id !== 'off' && director.energy != null) ? director.energy / 100 : ((viz && viz.energy != null) ? viz.energy / 100 : 0.5);
      const lfo = 0.5 + 0.5 * Math.sin(now / 2600);
      f.energy = Math.max(0.08, Math.min(1, dirE * 0.7 + lfo * 0.4));
      // Real audio (Phase 2 Task 3): override the synthetic spectrum + energy from
      // the live AnalyserNode frame so the bars/laser/bg breathe with the actual
      // mix. Beat/drop/flash stay synthetic — no new audio-driven full-field flash.
      const realFrame = getFrameRef.current?.();
      const hasReal = !!realFrame && realFrame.fftBins.length > 0;
      if (hasReal && realFrame && realFrame.bandAverages.length > 0) {
        const ba = realFrame.bandAverages;
        let s = 0; for (let k = 0; k < ba.length; k++) s += ba[k];
        f.energy = Math.max(0.08, Math.min(1, (s / ba.length) * 1.5));
      }
      if (bgLayerRef.current) bgLayerRef.current.style.opacity = viz.bgSync ? (0.4 + f.energy * 0.9).toFixed(2) : '';
      const dropFx = !director || director.id === 'off' ? viz.dropFx : true;
      if (dropFx && now - lastDrop.current > (director && director.id === 'hype' ? 6000 : 9000) && lfo > 0.82) {
        lastDrop.current = now; fireRef.current?.launch(); f.flash = 1; f.pulse = 1;
        if (onDropRef.current) onDropRef.current();
      }
      if (beat) f.pulse = 1; f.pulse *= 0.86; f.flash *= 0.8;
      const n = f.spectrum.length;
      if (hasReal && realFrame) {
        // Log-spaced down-sample of the real FFT to the bar count (mirrors the
        // shipping /listen/$versionId draw loop) so bass doesn't dominate.
        const bins = realFrame.fftBins;
        const minLog = Math.log10(1), maxLog = Math.log10(bins.length);
        for (let i = 0; i < n; i++) {
          const lo = Math.floor(10 ** (minLog + (i / n) * (maxLog - minLog)));
          const hi = Math.max(lo + 1, Math.floor(10 ** (minLog + ((i + 1) / n) * (maxLog - minLog))));
          let sum = 0; for (let j = lo; j < hi && j < bins.length; j++) sum += bins[j];
          f.spectrum[i] = Math.max(0.02, Math.min(1, (sum / Math.max(1, hi - lo)) * 1.4 * (1 + f.pulse * 0.2)));
        }
      } else {
        for (let i = 0; i < n; i++) {
          const tilt = Math.pow(1 - i / n, 0.7);
          const wob = 0.5 + 0.5 * Math.sin(now / 360 + i * 0.5) * Math.sin(now / 900 + i);
          f.spectrum[i] = Math.max(0.02, Math.min(1, (tilt * 0.7 + 0.15) * (0.5 + wob * 0.7) * f.energy * (1 + f.pulse * 0.35)));
        }
      }
      if (director && director.id !== 'off' && director.stages && director.cycleSec) {
        if (now - autoLast.current > director.cycleSec * 1000) {
          autoLast.current = now;
          const cur = stageRef2.current[0];
          const next = director.stages[(director.stages.indexOf(cur) + 1) % director.stages.length];
          setStages([next]);
        }
      }
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
          effect: director && director.id !== 'off' ? (director.laser ?? viz.laserEffect) : viz.laserEffect,
          intensity: Math.min(1.2, ((viz.laserIntensity || 60) / 100) * ((viz.laserSync || (!autoDir && viz.autoReact)) ? (0.4 + f.energy) : 1)),
          mono: viz.laserMono, color: viz.laserColor,
          beams: viz.laserBeams || 13, speed: viz.laserSpeed || 1, move: viz.laserMove, pattern: viz.laserPattern, flashPoints: flashPtsRef.current,
        });
      } else { laserRef.current?.clear(); flashPtsRef.current = []; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, accentHex, viz.laserOn, viz.laserEffect, viz.laserIntensity, viz.laserMono, viz.laserColor, viz.laserBeams, viz.laserSpeed, viz.laserMove, viz.laserFlash, viz.laserPattern, viz.dropFx, viz.autoColor, viz.laserSync, viz.bgSync, viz.autoReact, viz.autoReactSens, director]);

  const isInfo = stages.includes('info');
  const isRoom = stages.includes('room');
  const isDevices = stages.includes('devices');

  return (
    <div ref={onStageEngine} style={{ position: 'relative', height, overflow: 'hidden', borderRadius: compact ? 0 : 'var(--radius) var(--radius) 0 0', background: 'var(--bg-2)' }}>
      <div ref={bgLayerRef} className={'viz-bg' + (viz.bgAuto ? ' lr-bg-cycle' : '')} style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse 95% 85% at 50% 100%, ${cssVar(viz.bg || 'var(--cyan)')}1f, transparent 62%), transparent` }} />
      {viz.bgFlash && playing && <div className="lr-bg-flash" style={{ background: viz.bgFlashColor, animationDuration: (1 / (viz.bgFlashHz || 2)) + 's' }} />}
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
      <LaserFan ref={laserRef} />
      <Fireworks ref={fireRef} />
    </div>
  );
}
