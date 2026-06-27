import { useEffect, useMemo, useRef, useState } from 'react';

import { fmtDuration } from './helpers/format';

interface ResultsPlayerProps {
  /** Stable key for persisting playhead position across tab switches. */
  versionId: string | null;
  /** Track length in seconds (from phase 1). */
  durationSeconds: number | null | undefined;
}

const BAR_COUNT = 132;

// A deliberately simple transport: a bar-waveform scrubber that persists its
// playhead to localStorage so it survives tab changes. No Web Audio here — the
// real DSP audition lives on the Listen page. (Wiring it to <audio> is a later
// upgrade; the bars are a static silhouette for now, matching the prototype.)
export function ResultsPlayer({ versionId, durationSeconds }: ResultsPlayerProps) {
  const dur = durationSeconds && durationSeconds > 0 ? durationSeconds : 0;
  const storeKey = `results:player:${versionId ?? 'unknown'}`;

  const [pos, setPos] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(storeKey);
      const v = raw ? (JSON.parse(raw) as { pos?: number }) : null;
      return v && typeof v.pos === 'number' ? Math.min(v.pos, dur) : 0;
    } catch {
      return 0;
    }
  });
  const [playing, setPlaying] = useState(false);
  const posRef = useRef(pos);
  posRef.current = pos;
  const waveRef = useRef<HTMLDivElement>(null);

  // Static silhouette — deterministic so it doesn't reshuffle each render.
  const bars = useMemo(
    () =>
      Array.from(
        { length: BAR_COUNT },
        (_, i) =>
          0.18 +
          Math.abs(Math.sin(i * 0.5) * 0.5 + Math.sin(i * 1.3 + 1) * 0.32 + Math.sin(i * 0.21) * 0.2),
      ),
    [],
  );

  // Advance the playhead while "playing".
  useEffect(() => {
    if (!playing || dur <= 0) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      let next = posRef.current + dt;
      if (next >= dur) {
        next = dur;
        setPlaying(false);
      }
      setPos(next);
      if (next < dur) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, dur]);

  // Persist position.
  useEffect(() => {
    try {
      localStorage.setItem(storeKey, JSON.stringify({ pos }));
    } catch {
      /* ignore */
    }
  }, [pos, storeKey]);

  const seekFromEvent = (clientX: number) => {
    const el = waveRef.current;
    if (!el || dur <= 0) return;
    const r = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    setPos(frac * dur);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    seekFromEvent(e.clientX);
    const move = (ev: PointerEvent) => seekFromEvent(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const frac = dur > 0 ? pos / dur : 0;

  return (
    <div className="player">
      <button
        type="button"
        className="pl-btn"
        onClick={() => dur > 0 && setPlaying((p) => !p)}
        disabled={dur <= 0}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="pl-wave" ref={waveRef} onPointerDown={onPointerDown}>
        {bars.map((v, i) => (
          <i
            key={i}
            className={i / BAR_COUNT <= frac ? 'on' : undefined}
            style={{ height: `${Math.min(100, v * 100)}%` }}
          />
        ))}
      </div>
      <span className="mono pl-time">
        <span>{fmtDuration(pos)}</span>
        <span className="sep">/</span>
        <span className="tot">{dur > 0 ? fmtDuration(dur) : '–:––'}</span>
      </span>
    </div>
  );
}
