/* Listen Rack v2 — non-component helpers shared by the v2 surfaces (kept out
 * of the component files so Vite fast-refresh stays clean). */
import { fmtVal, type EqBand, type ParamDescriptor, type ParamValue } from './data';

export function lrClamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

export function lrTime(s: number): string {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** Pointer-drag over an element: reports 0..1 along the axis until pointerup. */
export function lrDrag(
  el: HTMLElement,
  e: { clientX: number; clientY: number },
  cb: (t: number) => void,
  vertical = false,
): void {
  const r = el.getBoundingClientRect();
  const move = (ev: { clientX: number; clientY: number }) =>
    cb(lrClamp(vertical ? 1 - (ev.clientY - r.top) / r.height : (ev.clientX - r.left) / r.width, 0, 1));
  move(e);
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/** Compact param summary shown on a card / row (null when neutral). */
export function paramSummary(
  m: { perBand?: boolean | undefined; params: ParamDescriptor[] },
  v: Record<string, ParamValue>,
): string | null {
  if (m.perBand) {
    const bands = (v['bands'] as EqBand[] | undefined) ?? [];
    const on = bands.filter((b) => b.enabled && b.gainDb !== 0);
    if (!on.length) return null;
    return on
      .slice(0, 3)
      .map((b) => `${b.freq >= 1000 ? b.freq / 1000 + 'k' : b.freq} ${b.gainDb > 0 ? '+' : ''}${b.gainDb}`)
      .join(' · ');
  }
  const out: string[] = [];
  m.params.forEach((p) => {
    if (p.key === 'enabled') return;
    const val = v[p.key];
    if (val === p.default || val == null) return;
    out.push(fmtVal(p.unit, val, { dp: 2 }));
  });
  return out.slice(0, 3).join(' · ') || null;
}
