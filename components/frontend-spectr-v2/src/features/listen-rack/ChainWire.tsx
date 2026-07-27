/* Animated signal wire through the rack chain — an SVG overlay over the card
 * grid connecting each powered, in-chain card in signal order. Same-row hops
 * run straight; row wraps take ROUNDED ELBOWS routed through the grid gutters
 * (exit right → down the column gap → across the row gap → into the next
 * card's left edge) so the wire never slashes diagonally across card faces.
 * The overlay also sits UNDER the cards (z-index) — where a hop must pass an
 * intermediate module it disappears beneath it like a cable under the chassis.
 * Three strokes per hop: glow underlay, 2px base, and a dash layer whose
 * stroke-dashoffset animates via CSS so pulses travel in signal-flow order.
 * Re-measures on reorder/toggle (chain key) + container resize. */
import { useLayoutEffect, useState } from 'react';

interface ChainWireProps {
  /** The grid container (cards carry data-cid). */
  grid: HTMLElement | null;
  /** Powered, in-chain card ids in signal order (empty hides the wire). */
  chain: string[];
}

interface CardBox { left: number; right: number; top: number; bottom: number; cy: number; }

/** Rounded orthogonal elbow: a.right → gutter down/up → across → b.left. */
function elbow(a: CardBox, b: CardBox): string {
  const lead = 3.5;               // half the 7px grid gap — stay in the gutters
  const r = 3;                    // corner radius (must be < lead)
  const x1 = a.right + lead;
  const x2 = b.left - lead;
  const gy = b.cy > a.cy ? (a.bottom + b.top) / 2 : (b.bottom + a.top) / 2;
  const sy1 = gy > a.cy ? 1 : -1; // into the row gap
  const sy2 = b.cy > gy ? 1 : -1; // out of the row gap
  const sx = x2 > x1 ? 1 : -1;    // horizontal travel direction
  const f = (n: number) => n.toFixed(1);
  return [
    `M ${f(a.right)} ${f(a.cy)}`,
    `L ${f(x1 - r)} ${f(a.cy)}`,
    `Q ${f(x1)} ${f(a.cy)} ${f(x1)} ${f(a.cy + sy1 * r)}`,
    `L ${f(x1)} ${f(gy - sy1 * r)}`,
    `Q ${f(x1)} ${f(gy)} ${f(x1 + sx * r)} ${f(gy)}`,
    `L ${f(x2 - sx * r)} ${f(gy)}`,
    `Q ${f(x2)} ${f(gy)} ${f(x2)} ${f(gy + sy2 * r)}`,
    `L ${f(x2)} ${f(b.cy - sy2 * r)}`,
    `Q ${f(x2)} ${f(b.cy)} ${f(x2 + r)} ${f(b.cy)}`,
    `L ${f(b.left)} ${f(b.cy)}`,
  ].join(' ');
}

function buildPaths(grid: HTMLElement, chain: string[]): string[] {
  const gr = grid.getBoundingClientRect();
  const boxes: CardBox[] = [];
  for (const id of chain) {
    const el = grid.querySelector(`[data-cid="${id}"]`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    boxes.push({
      left: r.left - gr.left,
      right: r.right - gr.left,
      top: r.top - gr.top,
      bottom: r.bottom - gr.top,
      cy: r.top - gr.top + r.height / 2,
    });
  }
  const paths: string[] = [];
  for (let i = 0; i < boxes.length - 1; i++) {
    const a = boxes[i];
    const b = boxes[i + 1];
    if (Math.abs(a.cy - b.cy) < 6 && b.left > a.right) {
      // same row, forward: straight run (hidden under any modules in between)
      paths.push(`M ${a.right.toFixed(1)} ${a.cy.toFixed(1)} L ${b.left.toFixed(1)} ${b.cy.toFixed(1)}`);
    } else {
      paths.push(elbow(a, b));
    }
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
