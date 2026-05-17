import { gradeColor, gradeLabel } from '../features/results/helpers/grade';

export interface TimelineVersion {
  versionNumber: number;
  label: string | null;
  score: number | null;
  grade: string | null;
  createdAt: string;
  isCurrent: boolean;
}

interface ProgressTimelineProps {
  versions: TimelineVersion[];
  height?: number;
}

const WIDTH = 1300;
const PAD_X = 50;
const PAD_TOP = 30;
const PAD_BOTTOM = 50;

// Horizontal grade bands so the per-version dot has visual context.
const BANDS: { label: string; score: number; color: string }[] = [
  { label: 'A', score: 90, color: 'var(--grade-a)' },
  { label: 'A-', score: 80, color: 'var(--grade-a)' },
  { label: 'B', score: 70, color: 'var(--grade-b)' },
  { label: 'C', score: 60, color: 'var(--grade-c)' },
  { label: 'D', score: 50, color: 'var(--grade-d)' },
];

export function ProgressTimeline({ versions, height = 200 }: ProgressTimelineProps) {
  const scored = versions.filter(
    (v): v is TimelineVersion & { score: number } => v.score != null,
  );

  const yFor = (score: number) => {
    const norm = Math.max(0, Math.min(100, score)) / 100;
    return PAD_TOP + (1 - norm) * (height - PAD_TOP - PAD_BOTTOM);
  };

  const xFor = (i: number, len: number) => {
    if (len === 1) return WIDTH / 2;
    return PAD_X + (i / (len - 1)) * (WIDTH - PAD_X * 2);
  };

  const points = scored.map((v, i) => ({
    ...v,
    x: xFor(i, scored.length),
    y: yFor(v.score),
  }));

  const linePath =
    points.length > 1 ? `M ${points.map((p) => `${p.x},${p.y}`).join(' L ')}` : null;
  const fillPath =
    linePath != null
      ? `${linePath} L ${points[points.length - 1].x},${height - PAD_BOTTOM} L ${points[0].x},${height - PAD_BOTTOM} Z`
      : null;

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${WIDTH} ${height}`}
      preserveAspectRatio="none"
      style={{ display: 'block' }}
    >
      {/* Grade bands */}
      {BANDS.map((b) => (
        <g key={b.label}>
          <line
            x1={PAD_X}
            x2={WIDTH - PAD_X}
            y1={yFor(b.score)}
            y2={yFor(b.score)}
            stroke={b.color}
            strokeOpacity="0.15"
            strokeWidth="1"
            strokeDasharray="4 6"
          />
          <text
            x={PAD_X - 10}
            y={yFor(b.score) + 4}
            fontSize="10"
            textAnchor="end"
            fill={b.color}
            opacity="0.5"
            fontFamily="JetBrains Mono, monospace"
          >
            {b.label}
          </text>
        </g>
      ))}

      {fillPath && <path d={fillPath} fill="var(--cyan)" opacity="0.08" />}
      {linePath && (
        <path
          d={linePath}
          stroke="var(--cyan)"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {points.map((p) => {
        const c = gradeColor(p.grade);
        return (
          <g key={p.versionNumber}>
            <circle
              cx={p.x}
              cy={p.y}
              r={p.isCurrent ? 8 : 6}
              fill={c}
              stroke={p.isCurrent ? '#06151a' : 'transparent'}
              strokeWidth={p.isCurrent ? 2 : 0}
              style={p.isCurrent ? { filter: `drop-shadow(0 0 6px ${c})` } : {}}
            />
            <text
              x={p.x}
              y={p.y - 14}
              fontSize="11"
              textAnchor="middle"
              fill={c}
              fontFamily="JetBrains Mono, monospace"
              fontWeight="700"
            >
              {Math.round(p.score)}
            </text>
            <text
              x={p.x}
              y={height - PAD_BOTTOM + 18}
              fontSize="10"
              textAnchor="middle"
              fill="var(--text-2)"
              fontFamily="JetBrains Mono, monospace"
              fontWeight="600"
            >
              {gradeLabel(p.grade)} · v{p.versionNumber}
            </text>
            <text
              x={p.x}
              y={height - PAD_BOTTOM + 32}
              fontSize="9"
              textAnchor="middle"
              fill="var(--dim)"
              fontFamily="JetBrains Mono, monospace"
            >
              {formatShortDate(p.createdAt)}
            </text>
          </g>
        );
      })}

      {points.length === 0 && (
        <text
          x={WIDTH / 2}
          y={height / 2}
          textAnchor="middle"
          fontSize="14"
          fill="var(--muted)"
          fontFamily="JetBrains Mono, monospace"
        >
          No scored versions yet
        </text>
      )}
    </svg>
  );
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
