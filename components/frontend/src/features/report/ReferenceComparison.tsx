interface DeltaEntry {
  value: number
  severity: string
}

interface Props {
  deltas: Record<string, unknown>
}

const severityColor: Record<string, string> = {
  ok: 'text-green-400',
  minor: 'text-yellow-400',
  moderate: 'text-orange-400',
  significant: 'text-red-400',
}

export default function ReferenceComparison({ deltas }: Props) {
  const entries = Object.entries(deltas).filter(
    ([, v]) => v !== null && typeof v === 'object',
  ) as [string, DeltaEntry][]

  if (entries.length === 0) return null

  return (
    <div className="rounded-2xl bg-gray-900 p-6">
      <h2 className="mb-4 text-xl font-bold">Reference Track Comparison</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-left text-gray-400">
            <th className="pb-2 pr-4">Metric</th>
            <th className="pb-2 pr-4">Delta</th>
            <th className="pb-2">Severity</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {entries.map(([key, entry]) => (
            <tr key={key}>
              <td className="py-3 pr-4 capitalize text-gray-200">
                {key.replace(/_/g, ' ')}
              </td>
              <td className="py-3 pr-4 font-mono text-white">
                {entry.value > 0 ? '+' : ''}
                {entry.value?.toFixed(2)}
              </td>
              <td
                className={`py-3 font-medium ${
                  severityColor[entry.severity] ?? 'text-gray-400'
                }`}
              >
                {entry.severity}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
