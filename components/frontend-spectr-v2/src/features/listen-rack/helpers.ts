/* SPECTR · Listen rack redesign — pure helpers + constants.
 * Kept in a non-component module so Fast Refresh stays happy (the component
 * .tsx files import from here). No JSX in this file.
 */
import { useCallback, useRef } from 'react';
import type { KeyboardEvent } from 'react';

// ── CSS var resolver ────────────────────────────────────────────────────────
export const cssVar = (v: string): string =>
  (typeof v === 'string' && v.startsWith('var('))
    ? getComputedStyle(document.documentElement).getPropertyValue(v.slice(4, -1)).trim() || '#00e5b0'
    : v;

// ── Hue → hex ───────────────────────────────────────────────────────────────
export function hslToHex(h: number, s = 80, l = 60): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x: number) => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

// ── Drag-to-change: vertical drag over `range` px = full min→max sweep ───────
export function useDragValue({
  value, min, max, step, onChange, range = 180,
}: {
  value: number; min: number; max: number; step?: number | undefined;
  onChange: (v: number) => void; range?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ y: number; v: number } | null>(null);
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    start.current = { y: e.clientY, v: value };
    const move = (ev: PointerEvent) => {
      if (!start.current) return;
      const dy = start.current.y - ev.clientY;
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
  return { ref, onPointerDown };
}

// ── Keyboard operability for the drag controls (WCAG 2.1.1) ─────────────────
/**
 * Next value for a keyboard nudge on a slider/knob/fader, or `null` if `key`
 * isn't a value-adjustment key (so the handler can let it bubble). Arrows step
 * by `step` (or a 1% sweep), Page keys by ~10%, Home/End jump to the rails.
 * Mirrors `useDragValue`'s step-snap + float de-fuzz so keyboard and pointer
 * land on identical values.
 */
export function nudgeValue(
  key: string,
  value: number,
  { min, max, step }: { min: number; max: number; step?: number | undefined },
): number | null {
  const fine = step && step > 0 ? step : (max - min) / 100;
  const coarse = Math.max(fine, (max - min) / 10);
  let next: number;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp': next = value + fine; break;
    case 'ArrowLeft':
    case 'ArrowDown': next = value - fine; break;
    case 'PageUp': next = value + coarse; break;
    case 'PageDown': next = value - coarse; break;
    case 'Home': next = min; break;
    case 'End': next = max; break;
    default: return null;
  }
  next = Math.max(min, Math.min(max, next));
  if (step && step > 0) next = Math.round(next / step) * step;
  return Math.round(next * 1e6) / 1e6;
}

/**
 * ARIA + keyboard prop bundle spread onto a custom slider/knob/fader `<div>` so
 * it is focusable and operable without a pointer (WCAG 2.1.1 + 4.1.2). Pair
 * with `className="lr-ctl"` for the focus ring.
 */
export function sliderA11y({
  value, min, max, step, label, onChange, orientation = 'horizontal',
}: {
  value: number; min: number; max: number; step?: number | undefined;
  label?: string | undefined; onChange: (v: number) => void;
  orientation?: 'horizontal' | 'vertical';
}) {
  return {
    role: 'slider' as const,
    tabIndex: 0,
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-valuenow': value,
    'aria-orientation': orientation,
    ...(label ? { 'aria-label': label } : {}),
    onKeyDown: (e: KeyboardEvent) => {
      const next = nudgeValue(e.key, value, { min, max, step });
      if (next === null) return;
      e.preventDefault();
      onChange(next);
    },
  };
}

// ── Visualizer constants ────────────────────────────────────────────────────
const FMIN = 20, FMAX = 20000;
export const freqToX = (hz: number): number => Math.log(hz / FMIN) / Math.log(FMAX / FMIN);
export const LASER_COLORS = ['#00e5b0', '#a78bfa', '#fb923c', '#f43f5e', '#fbbf24', '#60a5fa', '#34d399', '#f472b6'];

// ── Photosensitivity: cap full-field flash rate at ≤3 Hz (WCAG 2.3.1) ───────
export const FLASH_HZ_MAX = 3;
/** Clamp a requested background-flash rate into the safe [0.5, 3] Hz band, so a
 *  full-field flash can never strobe faster than the photosensitivity threshold. */
export const safeFlashHz = (hz: number | undefined): number =>
  Math.min(FLASH_HZ_MAX, Math.max(0.5, hz || 2));

// ── Transport time formatting ───────────────────────────────────────────────
export const fmtTime = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export const SECTION_COLORS: Record<string, string> = {
  intro: 'rgba(255,255,255,0.10)',
  buildup: 'rgba(0,229,176,0.32)',
  drop: 'rgba(251,146,60,0.55)',
  breakdown: 'rgba(167,139,250,0.45)',
  outro: 'rgba(255,255,255,0.10)',
};
