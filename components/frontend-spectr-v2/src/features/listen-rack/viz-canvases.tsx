/* SPECTR · Listen rack — the three imperative canvas layers VizStage drives:
 * StageCanvas (spectrum / radial / orbit / bloom / spectro / lights / smoke),
 * LaserFan and Fireworks. Each exposes a draw/launch handle; VizStage owns the
 * single rAF and the frame (see viz.tsx). Split out of viz.tsx for size only.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import { LASER_COLORS } from './helpers';

export interface VizFrame { t: number; spectrum: number[]; energy: number; pulse: number; beat: boolean; flash: number }
export interface FlashPoint { x: number; y: number; life: number; born: number }
interface LaserOpts {
  effect: string; intensity: number; mono: boolean; color: string;
  beams?: number; speed?: number; move?: boolean; pattern?: string; flashPoints?: FlashPoint[];
}
export interface StageCanvasHandle { draw(frame: VizFrame, stages: string[], accentHex: string): void }
export interface LaserFanHandle { clear(): void; draw(frame: VizFrame, opts: LaserOpts): void }
export interface FireworksHandle { launch(): void }

// ── Spectrum / radial / orbit / bloom / spectro / lights canvas ────────────
export const StageCanvas = forwardRef<StageCanvasHandle, { accent: string }>(function StageCanvas(_props, ref) {
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
export const LaserFan = forwardRef<LaserFanHandle>(function LaserFan(_props, ref) {
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
export const Fireworks = forwardRef<FireworksHandle>(function Fireworks(_props, ref) {
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
