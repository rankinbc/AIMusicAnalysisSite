// Tiny inline-SVG diagram kit for the /trust/how-its-built figures. Layouts
// are hand-placed coordinate tables (see pipeline-diagram-layout.ts and
// ArchitectureDiagram.tsx); this file only knows how to draw a box, a pill,
// a group frame, a strip and an orthogonal arrow. Colours come from tokens
// via CSS classes (diagram.module.css) — never hard-coded here.
import { useId } from 'react';
import type { ReactNode } from 'react';

import s from './diagram.module.css';

export type Tone = 'neutral' | 'cyan' | 'blue' | 'violet' | 'yellow' | 'green' | 'orange';

export interface BoxSpec {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tone: Tone;
  title?: string;
  lines?: readonly string[];
  /** Dashed outline — an optional input / stage. */
  optional?: boolean | undefined;
  /** box: accent-bar card; pill: centred one-liner; group: dashed frame with
   *  a corner label; strip: tinted band with one centred mono line. */
  variant?: 'box' | 'pill' | 'group' | 'strip';
}

export interface EdgeSpec {
  /** Polyline points; the arrowhead sits on the last one. */
  pts: readonly (readonly [number, number])[];
  /** No arrowhead (a bus/trunk line). */
  bare?: boolean;
  dashed?: boolean;
  label?: { x: number; y: number; text: string; anchor?: 'start' | 'middle' | 'end' };
}

export interface TextSpec {
  x: number;
  y: number;
  text: string;
  anchor?: 'start' | 'middle' | 'end';
}

const TITLE_H = 15;
const LINE_H = 13;

function BoxText({ b }: { b: BoxSpec }) {
  const lines = b.lines ?? [];
  const block = (b.title ? TITLE_H : 0) + lines.length * LINE_H;
  const top = b.y + (b.h - block) / 2;
  const tx = b.x + 14;
  return (
    <>
      {b.title && (
        <text x={tx} y={top + 11} className={s.title}>
          {b.title}
        </text>
      )}
      {lines.map((ln, i) => (
        <text key={i} x={tx} y={top + (b.title ? TITLE_H : 0) + 10 + i * LINE_H} className={s.line}>
          {ln}
        </text>
      ))}
    </>
  );
}

export function Box({ b }: { b: BoxSpec }) {
  const v = b.variant ?? 'box';
  const cls = `${s.box} ${s[b.tone]}${b.optional ? ` ${s.optional}` : ''}`;
  if (v === 'group') {
    return (
      <g className={cls} data-node={b.id}>
        <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={12} className={s.groupRect} />
        {b.title && (
          <text x={b.x + 12} y={b.y + 18} className={s.groupLabel}>
            {b.title}
          </text>
        )}
      </g>
    );
  }
  if (v === 'pill') {
    return (
      <g className={cls} data-node={b.id}>
        <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={b.h / 2} className={s.pillRect} />
        <text x={b.x + b.w / 2} y={b.y + b.h / 2 + 4} textAnchor="middle" className={s.pillText}>
          {b.title}
        </text>
      </g>
    );
  }
  if (v === 'strip') {
    return (
      <g className={cls} data-node={b.id}>
        <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={6} className={s.stripRect} />
        <text x={b.x + b.w / 2} y={b.y + b.h / 2 + 3.5} textAnchor="middle" className={s.stripText}>
          {b.title}
        </text>
      </g>
    );
  }
  return (
    <g className={cls} data-node={b.id}>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} className={s.rect} />
      <rect x={b.x} y={b.y + 8} width={3} height={b.h - 16} rx={1.5} className={s.accent} />
      <BoxText b={b} />
    </g>
  );
}

function pathOf(pts: EdgeSpec['pts']): string {
  return pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
}

export function Edge({ e, marker }: { e: EdgeSpec; marker: string }) {
  return (
    <g>
      <path
        d={pathOf(e.pts)}
        className={`${s.edge}${e.dashed ? ` ${s.edgeDashed}` : ''}`}
        markerEnd={e.bare ? undefined : `url(#${marker})`}
      />
      {e.label && (
        <text x={e.label.x} y={e.label.y} textAnchor={e.label.anchor ?? 'start'} className={s.edgeLabel}>
          {e.label.text}
        </text>
      )}
    </g>
  );
}

interface SvgProps {
  width: number;
  height: number;
  title: string;
  desc: string;
  className?: string;
  children: (marker: string) => ReactNode;
}

/** The <svg> shell: accessible name (aria-label = the <title>, <desc> via aria-describedby), a
 *  per-instance arrowhead marker id (two diagrams of the same layout can be
 *  on the page at once — the wide and narrow variants). */
export function DiagramSvg({ width, height, title, desc, className, children }: SvgProps) {
  const raw = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const marker = `arr${raw}`;
  const tid = `t${raw}`;
  const did = `d${raw}`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`${s.svg}${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={title}
      aria-describedby={did}
      preserveAspectRatio="xMidYMin meet"
    >
      <title id={tid}>{title}</title>
      <desc id={did}>{desc}</desc>
      <defs>
        <marker id={marker} viewBox="0 0 8 8" refX={7} refY={4} markerWidth={7} markerHeight={7} orient="auto">
          <path d="M0 0 L8 4 L0 8 z" className={s.arrowHead} />
        </marker>
      </defs>
      {children(marker)}
    </svg>
  );
}

export function StageText({ t }: { t: TextSpec }) {
  return (
    <text x={t.x} y={t.y} textAnchor={t.anchor ?? 'middle'} className={s.stage}>
      {t.text}
    </text>
  );
}
