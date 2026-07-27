/* Card activity light — one LED per powered device that blinks on the beat
 * (track BPM), with a soft glow halo that flares on each pulse. Driven by the
 * SHARED animClock loop; the component subscribes once and mutates its SVG
 * refs directly (no React state per frame, capped ~30fps). All cards pulse in
 * phase — that's the point: the rack breathes with the track. Off devices
 * show a dark dead LED. */
import { useEffect, useRef } from 'react';

import { subscribeClock } from './animClock';

const W = 16;
const H = 16;
const FPS_CAP = 1 / 30;

export function CardActivity({ on, accent, bpm }: {
  on: boolean;
  accent: string;
  /** Track tempo; the LED blinks once per beat. */
  bpm?: number | undefined;
}) {
  const core = useRef<SVGCircleElement>(null);
  const halo = useRef<SVGCircleElement>(null);
  const beatHz = (Number.isFinite(bpm) && (bpm as number) > 0 ? (bpm as number) : 120) / 60;

  useEffect(() => {
    if (!on) return undefined;
    let last = -1;
    return subscribeClock((t) => {
      if (t - last < FPS_CAP) return;
      last = t;
      // sharp attack on the beat, quick exponential decay
      const phase = (t * beatHz) % 1;
      const v = Math.exp(-phase * 5);
      core.current?.setAttribute('opacity', (0.25 + 0.75 * v).toFixed(2));
      halo.current?.setAttribute('opacity', (0.4 * v).toFixed(2));
    });
  }, [on, beatHz]);

  return (
    <svg width={W} height={H} className="lr-act-svg" style={{ color: accent }}>
      {on ? (
        <>
          <circle ref={halo} cx={W / 2} cy={H / 2} r={7} fill="currentColor" opacity={0} className="lr-act-halo" />
          <circle ref={core} cx={W / 2} cy={H / 2} r={3} fill="currentColor" opacity={0.25} />
        </>
      ) : (
        <circle cx={W / 2} cy={H / 2} r={2.5} fill="rgba(255,255,255,0.07)" stroke="rgba(0,0,0,0.5)" strokeWidth={1} />
      )}
    </svg>
  );
}
