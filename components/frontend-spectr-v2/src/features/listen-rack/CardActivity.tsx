/* Live activity indicators for the rack device cards — purely cosmetic
 * (layered sines seeded per device id), driven by the SHARED animClock loop.
 * Each indicator subscribes once and mutates its own SVG refs directly; no
 * React state per frame, updates capped at 30fps. Off devices show a dead LED.
 *
 * Per type: comp/limiter → right-to-left GR segment bar (limiter's last two
 * segments red) · gate → snap LED (thresholded, no fade) · tremolo/pan →
 * bobbing dot at the device's rate · eq/djfilter → wobbling 5-point mini
 * curve · everything else → two slow-random-walk VU bars. */
import { useEffect, useRef } from 'react';

import { idSeed, subscribeClock } from './animClock';

const W = 36;
const H = 14;
const FPS_CAP = 1 / 30;

interface ActivityProps {
  id: string;
  on: boolean;
  accent: string;
  /** LFO rate (Hz) for tremolo-family devices, when the param exists. */
  rateHz?: number | undefined;
}

/** Layered-sine fake signal, 0..1, seeded so cards don't move in unison. */
function makeSignal(id: string) {
  const s = idSeed(id);
  const f1 = 0.5 + s * 2.2;          // 0.5..2.7 Hz
  const f2 = 2.4 + (1 - s) * 3.2;    // 2.4..5.6 Hz
  const phase = s * Math.PI * 2;
  return (t: number) =>
    0.5 + 0.32 * Math.sin(t * f1 * Math.PI * 2 + phase) + 0.18 * Math.sin(t * f2 * Math.PI * 2);
}

function useClock(on: boolean, draw: (t: number) => void) {
  useEffect(() => {
    if (!on) return undefined;
    let last = -1;
    return subscribeClock((t) => {
      if (t - last < FPS_CAP) return;
      last = t;
      draw(t);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);
}

function DeadLed() {
  return (
    <svg width={W} height={H} className="lr-act-svg">
      <circle cx={W - 5} cy={H / 2} r={2.5} fill="rgba(255,255,255,0.07)" stroke="rgba(0,0,0,0.5)" strokeWidth={1} />
    </svg>
  );
}

const SEGS = 7;

function GrBar({ id, on, accent, red }: { id: string; on: boolean; accent: string; red: boolean }) {
  const refs = useRef<(SVGRectElement | null)[]>([]);
  const sig = useRef(makeSignal(id));
  useClock(on, (t) => {
    const lit = Math.round(sig.current(t) * SEGS);
    refs.current.forEach((r, i) => {
      // segments light from the RIGHT (gain reduction eats in from the top)
      r?.setAttribute('opacity', i >= SEGS - lit ? '1' : '0.14');
    });
  });
  if (!on) return <DeadLed />;
  const segW = (W - (SEGS - 1) * 2) / SEGS;
  return (
    <svg width={W} height={H} className="lr-act-svg">
      {Array.from({ length: SEGS }, (_, i) => (
        <rect
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          x={i * (segW + 2)}
          y={4}
          width={segW}
          height={6}
          rx={1}
          fill={red && i >= SEGS - 2 ? 'var(--red)' : accent}
          opacity={0.14}
        />
      ))}
    </svg>
  );
}

function SnapLed({ id, on, accent }: { id: string; on: boolean; accent: string }) {
  const ref = useRef<SVGCircleElement>(null);
  const sig = useRef(makeSignal(id));
  useClock(on, (t) => {
    // gates SNAP — hard threshold, no fade
    const open = sig.current(t) > 0.55;
    ref.current?.setAttribute('opacity', open ? '1' : '0.12');
  });
  if (!on) return <DeadLed />;
  return (
    <svg width={W} height={H} className="lr-act-svg">
      <circle ref={ref} cx={W - 6} cy={H / 2} r={3.2} fill={accent} opacity={0.12} />
    </svg>
  );
}

function BobDot({ id, on, accent, rateHz }: ActivityProps) {
  const ref = useRef<SVGCircleElement>(null);
  const phase = useRef(idSeed(id) * Math.PI * 2);
  const rate = Number.isFinite(rateHz) && (rateHz as number) > 0 ? (rateHz as number) : 4;
  useClock(on, (t) => {
    const x = W / 2 + Math.sin(t * Math.min(rate, 6) * Math.PI * 2 + phase.current) * (W / 2 - 5);
    ref.current?.setAttribute('cx', x.toFixed(1));
  });
  if (!on) return <DeadLed />;
  return (
    <svg width={W} height={H} className="lr-act-svg">
      <line x1={3} y1={H / 2} x2={W - 3} y2={H / 2} stroke={accent} strokeWidth={1} opacity={0.2} />
      <circle ref={ref} cx={W / 2} cy={H / 2} r={2.6} fill={accent} />
    </svg>
  );
}

function MiniCurve({ id, on, accent }: { id: string; on: boolean; accent: string }) {
  const ref = useRef<SVGPolylineElement>(null);
  const seed = useRef(idSeed(id));
  useClock(on, (t) => {
    const s = seed.current;
    const pts = Array.from({ length: 5 }, (_, i) => {
      const x = 2 + (i * (W - 4)) / 4;
      const y = H / 2 + Math.sin(t * (0.6 + s) * Math.PI * 2 + i * 1.7 + s * 6) * 1 + Math.sin(i * 2.1 + s * 9) * 2.4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    ref.current?.setAttribute('points', pts.join(' '));
  });
  if (!on) return <DeadLed />;
  return (
    <svg width={W} height={H} className="lr-act-svg">
      <polyline ref={ref} points="" fill="none" stroke={accent} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function VuPair({ id, on, accent }: { id: string; on: boolean; accent: string }) {
  const a = useRef<SVGRectElement>(null);
  const b = useRef<SVGRectElement>(null);
  const sigA = useRef(makeSignal(id));
  const sigB = useRef(makeSignal(id + '·b'));
  useClock(on, (t) => {
    const set = (el: SVGRectElement | null, v: number) => {
      const h = 3 + v * (H - 5);
      el?.setAttribute('height', h.toFixed(1));
      el?.setAttribute('y', (H - 1 - h).toFixed(1));
    };
    set(a.current, Math.max(0, Math.min(1, sigA.current(t * 0.6))));
    set(b.current, Math.max(0, Math.min(1, sigB.current(t * 0.6 + 3))));
  });
  if (!on) return <DeadLed />;
  return (
    <svg width={W} height={H} className="lr-act-svg">
      <rect ref={a} x={W - 12} y={4} width={4} height={8} rx={1} fill={accent} opacity={0.9} />
      <rect ref={b} x={W - 6} y={6} width={4} height={6} rx={1} fill={accent} opacity={0.7} />
    </svg>
  );
}

export function CardActivity(p: ActivityProps) {
  switch (p.id) {
    case 'comp':
      return <GrBar id={p.id} on={p.on} accent={p.accent} red={false} />;
    case 'limiter':
      return <GrBar id={p.id} on={p.on} accent={p.accent} red />;
    case 'gate':
      return <SnapLed id={p.id} on={p.on} accent={p.accent} />;
    case 'tremolo':
    case 'pan':
      return <BobDot {...p} />;
    case 'eq':
    case 'djfilter':
      return <MiniCurve id={p.id} on={p.on} accent={p.accent} />;
    default:
      return <VuPair id={p.id} on={p.on} accent={p.accent} />;
  }
}
