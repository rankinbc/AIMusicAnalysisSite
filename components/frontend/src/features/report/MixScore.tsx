// Grade color maps — classes are safelisted in tailwind.config.ts so Tailwind
// does not purge them when they are computed at runtime.
const gradeTextColor: Record<string, string> = {
  A: 'text-green-400',
  B: 'text-lime-400',
  C: 'text-yellow-400',
  D: 'text-orange-400',
  F: 'text-red-400',
}

const gradeBgColor: Record<string, string> = {
  A: 'bg-green-900/30',
  B: 'bg-lime-900/30',
  C: 'bg-yellow-900/30',
  D: 'bg-orange-900/30',
  F: 'bg-red-900/30',
}

interface Props {
  grade: string
  score: number
  topFixes: string[]
}

export default function MixScore({ grade, score, topFixes }: Props) {
  const textColor = gradeTextColor[grade] ?? 'text-white'
  const bgColor = gradeBgColor[grade] ?? 'bg-gray-800'

  return (
    <div className="grid grid-cols-1 gap-6 rounded-2xl bg-gray-900 p-6 md:grid-cols-2">
      {/* Grade + numeric score */}
      <div className="flex items-center gap-6">
        <div
          className={`flex h-28 w-28 items-center justify-center rounded-2xl ${bgColor}`}
        >
          <span className={`text-7xl font-black ${textColor}`}>{grade}</span>
        </div>
        <div>
          <p className="text-sm text-gray-400">Mix Score</p>
          <p className="text-5xl font-bold text-white">
            {Math.round(score)}
            <span className="text-2xl text-gray-500">/100</span>
          </p>
        </div>
      </div>

      {/* Top 3 priority fixes */}
      <div>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-400">
          Top 3 Fixes
        </h3>
        <ol className="space-y-2">
          {topFixes.slice(0, 3).map((fix, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="shrink-0 font-bold text-purple-400">{i + 1}.</span>
              <span className="text-gray-200">{fix}</span>
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
