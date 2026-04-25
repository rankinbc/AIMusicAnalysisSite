interface Props {
  fixes: string[]
  violations: string[]
}

export default function ArrangementAdvisor({ fixes, violations }: Props) {
  return (
    <div className="rounded-2xl bg-gray-900 p-6">
      <h2 className="mb-4 text-xl font-bold">Arrangement Advisor</h2>

      {violations.length > 0 && (
        <div className="mb-5">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
            Violations
          </h3>
          <ul className="space-y-1">
            {violations.map((v, i) => (
              <li key={i} className="flex gap-2 text-sm text-orange-300">
                <span className="shrink-0">⚠</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {fixes.length > 0 ? (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
            Recommendations
          </h3>
          <ol className="space-y-2">
            {fixes.map((fix, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="shrink-0 font-bold text-purple-400">{i + 1}.</span>
                <span className="text-gray-200">{fix}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        violations.length === 0 && (
          <p className="text-sm text-green-400">
            Arrangement looks good — no issues found.
          </p>
        )
      )}
    </div>
  )
}
