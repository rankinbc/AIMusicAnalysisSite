// Grade color maps — classes are safelisted in tailwind.config.ts
const GRADE_COLORS: Record<string, string> = {
  A: '#4ade80', B: '#a3e635', C: '#facc15', D: '#fb923c', F: '#f87171',
}

interface Props {
  grade: string
  score: number
  topFixes: string[]
}

export default function MixScore({ grade, score, topFixes }: Props) {
  const color = GRADE_COLORS[grade] ?? '#94a3b8'

  return (
    <div className="grid grid-cols-1 gap-5 rounded-xl border border-studio-border bg-studio-card p-5 md:grid-cols-2">
      <div className="flex items-center gap-5">
        <span className="font-display text-7xl font-extrabold leading-none" style={{ color }}>
          {grade}
        </span>
        <div>
          <p className="text-xs text-studio-muted uppercase tracking-widest mb-0.5">Mix Score</p>
          <div className="flex items-baseline gap-1">
            <span className="font-metric text-4xl font-bold text-white">{Math.round(score)}</span>
            <span className="font-metric text-sm text-studio-muted">/100</span>
          </div>
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-studio-muted">Top Fixes</h3>
        <ol className="space-y-2">
          {topFixes.slice(0, 3).map((fix, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="shrink-0 font-metric font-bold text-studio-amber">{i + 1}.</span>
              <span className="text-gray-300 leading-snug">{fix}</span>
            </li>
          ))}
          {topFixes.length === 0 && (
            <li className="text-sm text-green-400">No critical issues found.</li>
          )}
        </ol>
      </div>
    </div>
  )
}
