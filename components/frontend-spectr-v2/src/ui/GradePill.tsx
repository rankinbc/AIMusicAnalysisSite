import { gradeColor, gradeLabel } from '../features/results/helpers/grade';

type GradePillSize = 'sm' | 'md' | 'lg';

interface GradePillProps {
  grade: string | null | undefined;
  size?: GradePillSize;
}

const sizeMap: Record<GradePillSize, { box: number; fs: number }> = {
  sm: { box: 30, fs: 14 },
  md: { box: 44, fs: 21 },
  lg: { box: 64, fs: 32 },
};

export function GradePill({ grade, size = 'md' }: GradePillProps) {
  const { box, fs } = sizeMap[size];
  const color = gradeColor(grade);
  const label = gradeLabel(grade);
  return (
    <div
      className="mono"
      role="img"
      aria-label={`Grade: ${label}`}
      style={{
        width: box,
        height: box,
        borderRadius: box * 0.22,
        display: 'grid',
        placeItems: 'center',
        fontWeight: 700,
        fontSize: fs,
        color,
        background: `linear-gradient(180deg, ${color}1a, ${color}08)`,
        border: `1px solid ${color}44`,
        boxShadow: `inset 0 0 14px ${color}1f, 0 0 18px -8px ${color}55`,
        flexShrink: 0,
      }}
    >
      <span aria-hidden="true">{label}</span>
    </div>
  );
}
