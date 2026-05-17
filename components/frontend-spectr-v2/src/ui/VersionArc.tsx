import { gradeColor, gradeLabel } from '../features/results/helpers/grade';

export interface VersionArcPoint {
  versionNumber: number;
  score: number | null;
  grade: string | null;
}

interface VersionArcProps {
  versions: VersionArcPoint[];
  delta?: number | null;
  compact?: boolean;
}

const WIDTH = 240;

export function VersionArc({ versions, delta, compact = false }: VersionArcProps) {
  const h = compact ? 32 : 44;
  const padX = 8;
  const padY = compact ? 6 : 10;
  const innerW = WIDTH - padX * 2;
  const innerH = h - padY * 2;

  // Only versions with a numeric score can be plotted on the arc itself.
  // The grade-chip row at the bottom still lists every version.
  const scored = versions.filter((v): v is VersionArcPoint & { score: number } => v.score != null);

  if (scored.length === 0) {
    return (
      <div>
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 4,
          }}
        >
          <span className="label">Version arc</span>
        </header>
        <div
          className="mono"
          style={{
            fontSize: 10,
            color: 'var(--muted)',
            padding: '8px 0',
            letterSpacing: '0.04em',
          }}
        >
          No scored versions yet
        </div>
        <ChipStrip versions={versions} />
      </div>
    );
  }

  const minScore = Math.min(...scored.map((v) => v.score), 40);
  const maxScore = Math.max(...scored.map((v) => v.score), 100);
  const range = Math.max(20, maxScore - minScore);
  const padded = (s: number) => ((s - minScore + 10) / (range + 20)) * innerH;

  const points = scored.map((v, i) => {
    const x = scored.length === 1 ? innerW / 2 : (i / (scored.length - 1)) * innerW;
    const y = innerH - padded(v.score);
    return { x: padX + x, y: padY + y, v };
  });

  const lineD =
    points.length > 1 ? `M ${points.map((p) => `${p.x},${p.y}`).join(' L ')}` : null;
  const fillD =
    points.length > 1
      ? `${lineD} L ${points[points.length - 1].x},${h - padY} L ${points[0].x},${h - padY} Z`
      : null;

  return (
    <div>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 4,
        }}
      >
        <span className="label">Version arc</span>
        {delta != null && (
          <span
            className="mono"
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: delta > 0 ? 'var(--cyan)' : delta < 0 ? 'var(--red)' : 'var(--muted)',
            }}
          >
            {delta > 0 ? '↑' : delta < 0 ? '↓' : '·'} {delta > 0 ? '+' : ''}
            {delta} pts
          </span>
        )}
      </header>
      <svg
        width="100%"
        height={h}
        viewBox={`0 0 ${WIDTH} ${h}`}
        preserveAspectRatio="none"
        style={{ display: 'block' }}
      >
        {fillD && <path d={fillD} fill="var(--cyan)" opacity="0.10" />}
        {lineD && (
          <path
            d={lineD}
            stroke="var(--cyan)"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {points.map((p, i) => {
          const isLast = i === points.length - 1;
          const c = gradeColor(p.v.grade);
          return (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={isLast ? 4 : 3}
              fill={c}
              stroke={isLast ? '#06151a' : 'transparent'}
              strokeWidth={isLast ? 1.5 : 0}
              style={isLast ? { filter: `drop-shadow(0 0 5px ${c})` } : {}}
            />
          );
        })}
      </svg>
      <ChipStrip versions={versions} />
    </div>
  );
}

function ChipStrip({ versions }: { versions: VersionArcPoint[] }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, gap: 4 }}>
      {versions.map((p, i) => {
        const isLast = i === versions.length - 1;
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 1,
              opacity: isLast ? 1 : 0.7,
              flex: 1,
              minWidth: 0,
            }}
          >
            <span
              className="mono"
              style={{ fontSize: 9, fontWeight: 700, color: gradeColor(p.grade) }}
            >
              {gradeLabel(p.grade)}
            </span>
            <span className="mono" style={{ fontSize: 8, color: 'var(--dim)' }}>
              v{p.versionNumber}
            </span>
          </div>
        );
      })}
    </div>
  );
}
