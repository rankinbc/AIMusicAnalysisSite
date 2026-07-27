import type { Phase1Data } from '../../../api/types';
import { StructureStrip } from './StructureStrip';

const W = 720;
const H = 104;
const PAD_L = 34;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 6;
const Y_MIN = -20;
const Y_MAX = -4;

/** Loudness-over-time strip from phase1.loudness_timeline.short_term, with the
 *  −8/−14 LUFS gridlines, the track's short-term max as a dashed reference line,
 *  and structure section dividers overlaid. Reproduces the prototype exactly. */
export function LoudnessTimelineCard({ phase1 }: { phase1: Phase1Data | undefined }) {
  const timeline = phase1?.loudness_timeline?.short_term;
  const t = timeline?.t;
  const lufs = timeline?.lufs;
  if (!t || !lufs || t.length < 2 || t.length !== lufs.length) return null;

  const segments = phase1?.structure?.segments;
  const duration = phase1?.duration_seconds ?? t[t.length - 1] ?? 1;
  const stMax = phase1?.short_term_max_lufs;

  const x = (tt: number) => PAD_L + (tt / duration) * (W - PAD_L - PAD_R);
  const y = (v: number) =>
    PAD_T + (1 - (Math.max(Y_MIN, Math.min(Y_MAX, v)) - Y_MIN) / (Y_MAX - Y_MIN)) * (H - PAD_T - PAD_B);

  const pts = t.map((tt, i) => `${x(tt)},${y(lufs[i])}`).join(' ');
  const area = `${x(t[0])},${H - PAD_B} ${pts} ${x(t[t.length - 1])},${H - PAD_B}`;

  return (
    <div className="card">
      <div className="card-hd">
        <span className="t">
          <span className="led" />
          Loudness over time
        </span>
        <span className="meta">phase1.loudness_timeline.short_term</span>
      </div>
      <div className="card-body">
        <svg className="lt-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {[-8, -14].map((g) => (
            <g key={g}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y(g)} y2={y(g)} stroke="rgba(255,255,255,.06)" strokeWidth="1" />
              <text x={2} y={y(g) + 3} fontSize="8" fill="var(--muted)" fontFamily="JetBrains Mono">
                {g}
              </text>
            </g>
          ))}
          {segments?.slice(1).map((sg, i) => (
            <line
              key={i}
              x1={x(sg.start)}
              x2={x(sg.start)}
              y1={PAD_T}
              y2={H - PAD_B}
              stroke="rgba(122,162,247,.18)"
              strokeWidth="1"
            />
          ))}
          {stMax != null && (
            <g>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={y(stMax)}
                y2={y(stMax)}
                stroke="rgba(251,146,60,.4)"
                strokeWidth="1"
                strokeDasharray="3 4"
              />
              <text
                x={W - PAD_R - 2}
                y={y(stMax) - 3}
                fontSize="8"
                fill="var(--orange)"
                fontFamily="JetBrains Mono"
                textAnchor="end"
              >
                ST max {stMax}
              </text>
            </g>
          )}
          <polygon points={area} fill="rgba(0,229,176,.09)" />
          <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.6" />
        </svg>
        <StructureStrip structure={phase1?.structure} durationSec={duration} />
      </div>
    </div>
  );
}
