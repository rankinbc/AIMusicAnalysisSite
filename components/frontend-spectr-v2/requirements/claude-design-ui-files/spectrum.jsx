/* SPECTR — Spectrum visualizer
 * Procedural — generates a realistic-looking real-time spectrum from sine sums
 * and a beat envelope, since we don't have audio decoded. Three styles: bars,
 * mirrored, radial. Canvas-driven for smoothness.
 */

const { useState, useEffect, useRef, useMemo } = React;

const SPECTR_BANDS = 64;

// Per-band weighting curve — bass-heavy, gentle high rolloff
function buildEnergyShape() {
  const shape = new Float32Array(SPECTR_BANDS);
  for (let i = 0; i < SPECTR_BANDS; i++) {
    const t = i / (SPECTR_BANDS - 1);
    // bass mound around 0.08, mid dip around 0.5, slight high lift at 0.78
    const bass = Math.exp(-Math.pow((t - 0.08) / 0.13, 2)) * 0.92;
    const lowMid = Math.exp(-Math.pow((t - 0.25) / 0.18, 2)) * 0.55;
    const mid = Math.exp(-Math.pow((t - 0.5) / 0.22, 2)) * 0.42;
    const high = Math.exp(-Math.pow((t - 0.78) / 0.18, 2)) * 0.42;
    shape[i] = Math.min(1, bass + lowMid + mid + high);
  }
  return shape;
}

const ENERGY = buildEnergyShape();

// Phase offsets for per-band sine oscillators — deterministic
const BAND_PHASES = Array.from({ length: SPECTR_BANDS }, (_, i) => (i * 0.413) % (Math.PI * 2));
const BAND_RATES  = Array.from({ length: SPECTR_BANDS }, (_, i) => 0.7 + ((i * 1.3) % 3) * 0.45);

function sampleSpectrum(time, bpm = 128, playing = true) {
  if (!playing) {
    // Idle — quiet bumps
    const out = new Float32Array(SPECTR_BANDS);
    for (let i = 0; i < SPECTR_BANDS; i++) {
      out[i] = ENERGY[i] * 0.05 + 0.02;
    }
    return out;
  }
  const beatHz = bpm / 60;
  const beatPhase = (time * beatHz) % 1;
  // sharp attack on the beat, exponential decay
  const beatEnv = Math.pow(Math.max(0, 1 - beatPhase), 1.3);
  // half-bar accent every 4 beats
  const bar = Math.floor(time * beatHz) % 8;
  const barAccent = (bar === 0 || bar === 4) ? 0.18 : 0;

  const out = new Float32Array(SPECTR_BANDS);
  for (let i = 0; i < SPECTR_BANDS; i++) {
    const t = i / (SPECTR_BANDS - 1);
    // bass band reacts to beat, high band rides the hi-hat
    const beatWeight = t < 0.18 ? 0.85 : t < 0.4 ? 0.4 : t < 0.7 ? 0.25 : 0.5;
    const osc1 = Math.sin(time * BAND_RATES[i] + BAND_PHASES[i]) * 0.5 + 0.5;
    const osc2 = Math.sin(time * BAND_RATES[i] * 2.3 + BAND_PHASES[i] * 1.7) * 0.5 + 0.5;
    const tex  = osc1 * 0.55 + osc2 * 0.45;
    const noise = (Math.sin(time * 31.7 + i * 1.7) * 0.5 + 0.5) * 0.18;
    let v = ENERGY[i] * (0.42 + tex * 0.5) + beatEnv * beatWeight * 0.45 + noise;
    if (i < 14) v += barAccent;
    out[i] = Math.max(0, Math.min(1, v));
  }
  return out;
}

// ── Bars style ────────────────────────────────────────────────────────────

function SpectrumBars({ playing, bpm = 128, style = 'mirrored', height = 360 }) {
  const canvasRef = useRef(null);
  const dprRef = useRef(1);
  const peakHoldRef = useRef(new Float32Array(SPECTR_BANDS));
  const smoothedRef = useRef(new Float32Array(SPECTR_BANDS));

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    let raf;
    let last = performance.now() / 1000;
    let time = 0;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      dprRef.current = dpr;
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      cv.width = w * dpr;
      cv.height = h * dpr;
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);

    function frame() {
      const now = performance.now() / 1000;
      const dt = Math.min(0.05, now - last);
      last = now;
      time += dt;

      const dpr = dprRef.current;
      const W = cv.width;
      const H = cv.height;
      ctx.clearRect(0, 0, W, H);

      const spectrum = sampleSpectrum(time, bpm, playing);
      const smoothed = smoothedRef.current;
      const peaks = peakHoldRef.current;

      // attack/release smoothing
      for (let i = 0; i < SPECTR_BANDS; i++) {
        const target = spectrum[i];
        if (target > smoothed[i]) smoothed[i] = smoothed[i] + (target - smoothed[i]) * 0.45;
        else smoothed[i] = smoothed[i] + (target - smoothed[i]) * 0.12;
        if (smoothed[i] > peaks[i]) peaks[i] = smoothed[i];
        else peaks[i] = Math.max(0, peaks[i] - dt * 0.5);
      }

      const N = SPECTR_BANDS;
      const gap = 3 * dpr;
      const barW = (W - gap * (N - 1)) / N;

      if (style === 'radial') {
        drawRadial(ctx, smoothed, peaks, W, H, dpr);
      } else if (style === 'bars') {
        drawUpBars(ctx, smoothed, peaks, W, H, dpr, barW, gap);
      } else {
        drawMirrored(ctx, smoothed, peaks, W, H, dpr, barW, gap);
      }

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [playing, bpm, style]);

  return (
    <canvas ref={canvasRef} style={{ width: '100%', height, display: 'block' }} />
  );
}

function makeGradient(ctx, x0, y0, x1, y1, alpha = 1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0,    `rgba(167,139,250,${0.78 * alpha})`); // violet at top
  g.addColorStop(0.35, `rgba(0,229,176,${0.95 * alpha})`);   // cyan
  g.addColorStop(1,    `rgba(0,229,176,${0.35 * alpha})`);   // cyan dim at bottom
  return g;
}

function drawUpBars(ctx, smoothed, peaks, W, H, dpr, barW, gap) {
  const N = SPECTR_BANDS;
  for (let i = 0; i < N; i++) {
    const v = smoothed[i];
    const h = v * (H - 12 * dpr);
    const x = i * (barW + gap);
    const y = H - h;
    ctx.fillStyle = makeGradient(ctx, 0, H - H * 0.9, 0, H);
    roundRect(ctx, x, y, barW, h, 2 * dpr);
    ctx.fill();
    // peak tick
    const ph = peaks[i] * (H - 12 * dpr);
    const py = H - ph;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(x, py - 2 * dpr, barW, 2 * dpr);
  }
}

function drawMirrored(ctx, smoothed, peaks, W, H, dpr, barW, gap) {
  const N = SPECTR_BANDS;
  const mid = H / 2;
  // centerline
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(0, mid - 0.5 * dpr, W, dpr);

  for (let i = 0; i < N; i++) {
    const v = smoothed[i];
    const halfH = v * (H * 0.46);
    const x = i * (barW + gap);
    // top half (brighter, violet→cyan)
    const gtop = ctx.createLinearGradient(0, mid - halfH, 0, mid);
    gtop.addColorStop(0,   'rgba(167,139,250,0.85)');
    gtop.addColorStop(0.5, 'rgba(0,229,176,0.95)');
    gtop.addColorStop(1,   'rgba(0,229,176,0.55)');
    ctx.fillStyle = gtop;
    roundRect(ctx, x, mid - halfH, barW, halfH, 2 * dpr);
    ctx.fill();

    // bottom half (dimmer)
    const gbot = ctx.createLinearGradient(0, mid, 0, mid + halfH);
    gbot.addColorStop(0, 'rgba(0,229,176,0.45)');
    gbot.addColorStop(1, 'rgba(0,229,176,0.10)');
    ctx.fillStyle = gbot;
    roundRect(ctx, x, mid, barW, halfH, 2 * dpr);
    ctx.fill();

    // peak ticks on top half only
    const phh = peaks[i] * (H * 0.46);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(x, mid - phh - 2 * dpr, barW, 2 * dpr);
  }

  // Glow pass — additive sweep on bass region
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < N; i++) {
    if (i > 14) continue;
    const v = smoothed[i];
    const halfH = v * (H * 0.46);
    const x = i * (barW + gap);
    ctx.fillStyle = `rgba(0,229,176,${0.10 * v})`;
    ctx.fillRect(x - 4, mid - halfH - 4, barW + 8, halfH * 2 + 8);
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawRadial(ctx, smoothed, peaks, W, H, dpr) {
  const cx = W / 2;
  const cy = H / 2;
  const baseR = Math.min(W, H) * 0.22;
  const maxR = Math.min(W, H) * 0.46;
  const N = SPECTR_BANDS;
  const span = N * 2 - 2;

  for (let i = 0; i < N; i++) {
    const v = smoothed[i];
    const r = baseR + v * (maxR - baseR);
    const peakR = baseR + peaks[i] * (maxR - baseR);
    // duplicate across mirror so we use 2N segments
    for (let side = 0; side < 2; side++) {
      const ang0 = (-Math.PI / 2) + (side === 0 ? 1 : -1) * (i / span) * Math.PI * 2;
      const ang1 = (-Math.PI / 2) + (side === 0 ? 1 : -1) * ((i + 0.85) / span) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, baseR, ang0, ang1, side === 1);
      ctx.arc(cx, cy, r,     ang1, ang0, side === 0);
      ctx.closePath();
      const g = ctx.createRadialGradient(cx, cy, baseR, cx, cy, r);
      g.addColorStop(0, 'rgba(0,229,176,0.85)');
      g.addColorStop(1, 'rgba(167,139,250,0.55)');
      ctx.fillStyle = g;
      ctx.fill();
      // peak tick
      ctx.beginPath();
      ctx.arc(cx, cy, peakR, ang0, ang1, side === 1);
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.stroke();
    }
  }

  // inner circle bg
  ctx.fillStyle = '#0a0f1c';
  ctx.beginPath();
  ctx.arc(cx, cy, baseR - 4 * dpr, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,229,176,0.25)';
  ctx.lineWidth = dpr;
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  if (h < 1) h = 1;
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

// ── Mini bar EQ — for results page, small frequency band card ─────────────

function MiniSpectrum({ playing = true, bpm = 128, height = 60, bars = 32 }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    let raf;
    let last = performance.now() / 1000;
    let time = 0;
    const smoothed = new Float32Array(bars);

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      cv.width = cv.clientWidth * dpr;
      cv.height = cv.clientHeight * dpr;
    }
    resize();
    const ro = new ResizeObserver(resize); ro.observe(cv);

    function frame() {
      const now = performance.now() / 1000;
      const dt = Math.min(0.05, now - last); last = now; time += dt;
      const dpr = window.devicePixelRatio || 1;
      const W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);
      const full = sampleSpectrum(time, bpm, playing);
      // resample to `bars`
      for (let i = 0; i < bars; i++) {
        const srcIdx = Math.floor((i / bars) * SPECTR_BANDS);
        const target = full[srcIdx];
        if (target > smoothed[i]) smoothed[i] += (target - smoothed[i]) * 0.45;
        else smoothed[i] += (target - smoothed[i]) * 0.14;
      }
      const gap = 2 * dpr;
      const bw = (W - gap * (bars - 1)) / bars;
      for (let i = 0; i < bars; i++) {
        const h = smoothed[i] * H * 0.95;
        const x = i * (bw + gap);
        const y = H - h;
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, 'rgba(167,139,250,0.85)');
        g.addColorStop(1, 'rgba(0,229,176,0.45)');
        ctx.fillStyle = g;
        roundRect(ctx, x, y, bw, h, 1.5 * dpr); ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [playing, bpm, bars]);
  return <canvas ref={canvasRef} style={{ width: '100%', height, display: 'block' }} />;
}

Object.assign(window, { SpectrumBars, MiniSpectrum, sampleSpectrum });
