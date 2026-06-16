import { forwardRef, useImperativeHandle, useRef } from 'react';
import s from './Spectrogram.module.css';

// Spectrogram waterfall (Canvas 2D). Each frame scrolls the existing image one
// column to the left and paints the newest FFT slice down the right edge, with
// frequency on the Y axis (log-scaled, lows at the bottom) and magnitude mapped
// to a blue→red→white heat ramp. Driven by the page's single rAF loop via the
// imperative draw() handle — no loop of its own, no per-frame React state.

export interface SpectrogramHandle {
  /** Paint one column from the linear 0..1 FFT bins. energyMul boosts contrast. */
  draw: (bins: ArrayLike<number>, energyMul: number) => void;
  clear: () => void;
}

const COL = 2; // device px advanced per frame

export const Spectrogram = forwardRef<SpectrogramHandle>(function Spectrogram(_props, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });

  const ensureSize = (canvas: HTMLCanvasElement) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; // resizing clears the canvas — acceptable on layout change
      canvas.height = h;
      sizeRef.current = { w, h };
    }
  };

  useImperativeHandle(ref, () => ({
    draw(bins, energyMul) {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      ensureSize(canvas);
      const { w, h } = sizeRef.current;
      const n = bins.length;
      if (n === 0) return;

      // Scroll the existing image COL px to the left ('copy' leaves the newly
      // exposed strip on the right transparent for us to repaint).
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(canvas, -COL, 0);
      ctx.globalCompositeOperation = 'source-over';

      // Paint the newest column. Map each row (y) to a log-spaced FFT bin so
      // the low end isn't crushed into a couple of pixels.
      const minLog = 0; // log10(1)
      const maxLog = Math.log10(n);
      const x = w - COL;
      for (let y = 0; y < h; y += 1) {
        const t = 1 - y / h; // 0 at bottom (lows) → 1 at top (highs)
        const bin = Math.min(n - 1, Math.floor(10 ** (minLog + t * (maxLog - minLog))));
        const m = Math.min(1, (bins[bin] ?? 0) * 1.3 * Math.max(0.4, energyMul));
        if (m <= 0.01) {
          ctx.fillStyle = '#070a0f';
        } else {
          // blue (cool, quiet) → red → white-hot (loud)
          const hue = 240 - m * 240;
          const light = 8 + m * 56;
          ctx.fillStyle = `hsl(${hue.toFixed(0)}, 90%, ${light.toFixed(0)}%)`;
        }
        ctx.fillRect(x, y, COL, 1);
      }
    },
    clear() {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  }), []);

  return <canvas ref={canvasRef} className={s.canvas} aria-hidden />;
});
