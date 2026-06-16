import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { bandX, dbToY, EQ_BANDS, smoothPath, yToDb, type Pt } from './eqCurve';
import s from './EqCurveOverlay.module.css';

// Signature eq-stage element: a draggable EQ-response curve over the spectrum.
// Self-contained for now — drag updates a local 8-band gain set and redraws the
// curve; wiring these gains into the live useAudioGraph EQ is a follow-up.
const INITIAL_GAINS = [2, -1, 3, 0, -2, 1.5, 4, -3];

export const EqCurveOverlay = memo(function EqCurveOverlay() {
  const [gains, setGains] = useState<number[]>(INITIAL_GAINS);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<number | null>(null);

  // Track the rendered pixel size so 1 SVG user-unit = 1 px (no aspect
  // distortion of the round handles / uniform strokes).
  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = size;
  const pts: Pt[] = gains.map((g, i) => ({ x: bandX(i, w), y: dbToY(g, h) }));
  const curve = smoothPath(pts);
  const fillPath = curve && w > 0 ? `${curve} L ${w} ${h} L 0 ${h} Z` : '';

  const updateFromEvent = useCallback(
    (clientY: number) => {
      const idx = dragRef.current;
      const el = svgRef.current;
      if (idx == null || !el) return;
      const rect = el.getBoundingClientRect();
      if (rect.height === 0) return;
      const y = clientY - rect.top;
      const db = Math.round(yToDb(y, rect.height) * 10) / 10;
      setGains((g) => g.map((v, i) => (i === idx ? db : v)));
    },
    [],
  );

  const onMove = useCallback(
    (e: React.PointerEvent) => updateFromEvent(e.clientY),
    [updateFromEvent],
  );
  const endDrag = useCallback((e: React.PointerEvent) => {
    if (dragRef.current == null) return;
    dragRef.current = null;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
  }, []);

  // Horizontal grid lines at fixed dB marks.
  const gridDb = [12, 6, 0, -6, -12];

  return (
    <svg
      ref={svgRef}
      className={s.overlay}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {w > 0 && (
        <>
          {gridDb.map((db) => (
            <line
              key={db}
              className={s.gridLine}
              x1={0}
              x2={w}
              y1={dbToY(db, h)}
              y2={dbToY(db, h)}
            />
          ))}
          {fillPath && <path className={s.curveFill} d={fillPath} />}
          {curve && <path className={s.curve} d={curve} />}
          {pts.map((p, i) => (
            <g key={EQ_BANDS[i]}>
              <text className={s.handleLabel} x={p.x} y={p.y - 13} textAnchor="middle">
                {gains[i] > 0 ? `+${gains[i]}` : gains[i]}
              </text>
              <circle
                className={s.handle}
                cx={p.x}
                cy={p.y}
                r={6.5}
                onPointerDown={(e) => {
                  dragRef.current = i;
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                }}
                onPointerMove={onMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              />
            </g>
          ))}
        </>
      )}
    </svg>
  );
});
