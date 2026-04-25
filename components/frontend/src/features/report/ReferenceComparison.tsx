interface DeltaEntry {
  value: number
  severity: string
}

interface Props {
  deltas: Record<string, unknown>
}

const SEVERITY_STYLE: Record<string, { text: string; dot: string }> = {
  ok:          { text: 'text-green-400',  dot: '#4ade80' },
  minor:       { text: 'text-yellow-400', dot: '#facc15' },
  moderate:    { text: 'text-orange-400', dot: '#fb923c' },
  significant: { text: 'text-red-400',   dot: '#f87171' },
}

export default function ReferenceComparison({ deltas }: Props) {
  const entries = Object.entries(deltas).filter(
    ([, v]) => v !== null && typeof v === 'object',
  ) as [string, DeltaEntry][]

  if (entries.length === 0) return null

  return (
    <div className="rounded-xl border border-studio-border bg-studio-card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-studio-border text-left">
            <th className="px-5 py-2 text-xs font-medium text-studio-muted">Metric</th>
            <th className="py-2 text-xs font-medium text-studio-muted">Delta</th>
            <th className="py-2 pr-5 text-xs font-medium text-studio-muted">Severity</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-studio-border">
          {entries.map(([key, entry]) => {
            const style = SEVERITY_STYLE[entry.severity] ?? { text: 'text-studio-muted', dot: '#6b6b9a' }
            return (
              <tr key={key} className="hover:bg-studio-surface transition-colors">
                <td className="px-5 py-2.5 capitalize text-gray-300">{key.replace(/_/g, ' ')}</td>
                <td className="py-2.5 font-metric text-xs text-white">
                  {entry.value > 0 ? '+' : ''}{entry.value?.toFixed(2)}
                </td>
                <td className={`py-2.5 pr-5 font-metric text-xs font-medium ${style.text}`}>
                  {entry.severity}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
