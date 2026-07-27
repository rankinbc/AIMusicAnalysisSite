/* Animated signal wire through the rack chain — an SVG overlay over the card
 * grid connecting each powered, in-chain card's right edge to the next one's
 * left edge with a cubic bezier. Three strokes per hop: a wide low-opacity
 * glow underlay, the 2px base wire, and a dash layer whose stroke-dashoffset
 * animates via CSS so bright pulses travel in signal-flow order. Geometry
 * re-measures on reorder/toggle (chain key), container resize
 * (ResizeObserver), and drag settle. pointer-events:none throughout. */
import { useLayoutEffect, useState } from 'react';

interface ChainWireProps {
  /** The grid container (cards carry data-cid). */
  grid: HTMLElement | null;
  /** Powered, in-chain card ids in signal order (empty hides the wire). */
  chain: string[];
}

function buildPaths(grid: HTMLElement, chain: string[]): string[] {
  const gr = grid.getBoundingClientRect();
  const pts: { l: { x: number; y: number }; r: { x: number; y: number } }[] = [];
  for (const id of chain) {
    const el = grid.querySelector(`[data-cid="${id}"]`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    pts.push({
      l: { x: r.left - gr.left, y: r.top - gr.top + r.height / 2 },
      r: { x: r.right - gr.left, y: r.top - gr.top + r.height / 2 },
    });
  }
  const paths: string[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i].r;
    const b = pts[i + 1].l;
    paths.push(
      `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} C ${(a.x + 40).toFixed(1)} ${a.y.toFixed(1)}, ${(b.x - 40).toFixed(1)} ${b.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`,
    );
  }
  return paths;
}

export function ChainWire({ grid, chain }: ChainWireProps) {
  const [paths, setPaths] = useState<string[]>([]);
  const chainKey = chain.join('|');

  useLayoutEffect(() => {
    if (!grid || chain.length < 2) {
      setPaths([]);
      return undefined;
    }
    const measure = () => setPaths(buildPaths(grid, chain));
    // measure after layout settles (drag-reorder commits, fonts, etc.)
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, chainKey]);

  if (paths.length === 0) return null;
  return (
    <svg className="lr-wire" aria-hidden="true">
      {paths.map((d, i) => (
        <g key={i}>
          <path d={d} className="wglow" />
          <path d={d} className="wbase" />
          <path d={d} className="wpulse" />
        </g>
      ))}
    </svg>
  );
}
