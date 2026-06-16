import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { LaserEffect } from './LaserRig';
import s from './LaserShow.module.css';

// Canvas 2D laser-show engine: a fan of beams radiating from a tight origin,
// additive-blended so crossings blow out to white, each beam landing on a lit
// floor with a glow pool + reflection. Sweep rotates the fan; Burst/Beat
// explodes it open on detected beats; Strobe blinks the beams; Flash adds a
// rate-limited full-field white hit. Driven by the page's single rAF loop via
// the imperative draw() handle — no loop, no per-frame React state of its own.

export interface LaserDrawArgs {
  t: number; // performance.now() ms (animation clock)
  beat: boolean;
  pulse: number; // 0..1 beat envelope
  flash: number; // 0..1 capped white-flash envelope (≤3 Hz, set by the page)
  intensity: number; // 0..4 (laserIntensity / 100)
  mono: boolean;
  color: string; // hex, used when mono
  effect: LaserEffect;
  energyMul: number; // 0..2 energy macro
}

export interface LaserShowHandle {
  draw: (args: LaserDrawArgs) => void;
  clear: () => void;
}

const PALETTE = ['#ff4d8d', '#5eead4', '#ffd24d', '#5aa6ff', '#b07cff', '#34d399'];
const BEAMS = 15;

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h.padEnd(6, '0').slice(0, 6);
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export const LaserShow = forwardRef<LaserShowHandle>(function LaserShow(_props, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const size = (canvas: HTMLCanvasElement) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { w: rect.width, h: rect.height, dpr };
  };

  const drawBeam = (
    ctx: CanvasRenderingContext2D,
    ox: number,
    oy: number,
    angle: number,
    len: number,
    floorY: number,
    col: string,
    bright: number,
    coreW: number,
  ) => {
    const dx = Math.sin(angle);
    const dy = Math.cos(angle);
    const ex = ox + dx * len;
    const ey = oy + dy * len;

    const colorGrad = ctx.createLinearGradient(ox, oy, ex, ey);
    colorGrad.addColorStop(0, hexToRgba(col, 1));
    colorGrad.addColorStop(0.45, hexToRgba(col, 0.55));
    colorGrad.addColorStop(1, hexToRgba(col, 0));

    ctx.lineCap = 'round';
    const line = () => {
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    };

    // The luminance comes from the beam itself: every pass is the beam's own
    // colour, stacked additively ('lighter') with a real shadowBlur halo so
    // each beam casts coloured light into the space around it.
    ctx.strokeStyle = colorGrad;
    ctx.shadowColor = col;

    // 1. Wide soft outer glow — the coloured light spilling off the beam.
    ctx.shadowBlur = 26 + coreW * 7;
    ctx.lineWidth = coreW * 6;
    ctx.globalAlpha = Math.min(1, bright * 0.16);
    line();

    // 2. Mid glow.
    ctx.shadowBlur = 18 + coreW * 5;
    ctx.lineWidth = coreW * 2.6;
    ctx.globalAlpha = Math.min(1, bright * 0.5);
    line();

    // 3. Bright coloured core, still haloed by its own shadow.
    ctx.shadowBlur = 10 + coreW * 3;
    ctx.lineWidth = coreW;
    ctx.globalAlpha = Math.min(1, bright);
    line();
    ctx.shadowBlur = 0;

    // Ground hit: where the beam crosses the floor, a glow pool + reflection.
    if (dy > 0.05) {
      const tHit = (floorY - oy) / dy;
      const hx = ox + dx * tHit;
      const hy = floorY;
      if (tHit > 0 && hx > -50 && hx < ctx.canvas.width + 50) {
        const poolR = 34 + coreW * 10;
        const pool = ctx.createRadialGradient(hx, hy, 0, hx, hy, poolR);
        pool.addColorStop(0, hexToRgba(col, 0.55 * Math.min(1, bright)));
        pool.addColorStop(1, hexToRgba(col, 0));
        ctx.globalAlpha = 1;
        ctx.fillStyle = pool;
        ctx.save();
        ctx.translate(hx, hy);
        ctx.scale(1, 0.32); // flatten into a floor ellipse
        ctx.beginPath();
        ctx.arc(0, 0, poolR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Faint vertical reflection below the floor.
        const refl = ctx.createLinearGradient(hx, hy, hx, hy + 60);
        refl.addColorStop(0, hexToRgba(col, 0.18 * Math.min(1, bright)));
        refl.addColorStop(1, hexToRgba(col, 0));
        ctx.strokeStyle = refl;
        ctx.lineWidth = coreW * 1.6;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx, hy + 60);
        ctx.stroke();
      }
    }
  };

  useImperativeHandle(ref, () => ({
    draw(a) {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const { w, h, dpr } = size(canvas);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (a.intensity <= 0) return;
      ctx.globalCompositeOperation = 'lighter';

      const ox = w * 0.5;
      const oy = -h * 0.04;
      const floorY = h * 0.8;
      const len = h * 1.5;
      const energy = Math.max(0.3, a.energyMul);
      const bright = Math.min(1.4, a.intensity) * (0.55 + 0.45 * a.pulse) * energy;
      const coreW = 1.4 + Math.min(1.4, a.intensity) * 1.6;

      // Fan geometry by effect.
      let center = 0;
      let spread = 0.62;
      if (a.effect === 'sweep') {
        center = Math.sin(a.t * 0.0006) * 0.55; // whole fan swings
        spread = 0.5;
      } else if (a.effect === 'beat') {
        center = Math.sin(a.t * 0.0004) * 0.18;
        spread = 0.32 + a.pulse * 0.7; // explodes open on the beat (Burst)
      } else {
        center = Math.sin(a.t * 0.00035) * 0.22; // gentle breathing fan
      }

      // Strobe gates the whole fan on/off fast (beams are thin → small area).
      const visible = a.effect !== 'strobe' || Math.floor(a.t / 60) % 2 === 0;

      if (visible) {
        for (let i = 0; i < BEAMS; i += 1) {
          const f = BEAMS > 1 ? i / (BEAMS - 1) : 0.5;
          const angle = center + (f * 2 - 1) * spread;
          const col = a.mono ? a.color : PALETTE[i % PALETTE.length]!;
          drawBeam(ctx, ox, oy, angle, len, floorY, col, bright, coreW);
        }
      }

      // Full-field white flash (rate-limited upstream): flash + beat effects.
      if (a.flash > 0.01 && (a.effect === 'flash' || a.effect === 'beat')) {
        ctx.globalAlpha = Math.min(0.5, a.flash * 0.5);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
    clear() {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  }), []);

  return <canvas ref={canvasRef} className={s.canvas} aria-hidden />;
});
