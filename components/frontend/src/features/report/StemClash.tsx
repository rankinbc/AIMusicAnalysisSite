// Severity badge classes are safelisted in tailwind.config.ts
const severityBadge: Record<string, string> = {
  high: 'bg-red-900 text-red-300',
  medium: 'bg-orange-900 text-orange-300',
  low: 'bg-yellow-900 text-yellow-300',
}

interface ClashEntry {
  stems?: string
  frequency_range?: string
  severity?: string
  eq_suggestion?: string
}

interface Props {
  clashes: ClashEntry[]
}

export default function StemClash({ clashes }: Props) {
  if (!clashes || clashes.length === 0) {
    return (
      <div className="rounded-2xl bg-gray-900 p-6">
        <h2 className="mb-2 text-xl font-bold">Stem Clash Detection</h2>
        <p className="text-sm text-green-400">
          No frequency clashes detected between stems.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl bg-gray-900 p-6">
      <h2 className="mb-4 text-xl font-bold">Stem Clash Detection</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-gray-400">
              <th className="pb-2 pr-4">Stems</th>
              <th className="pb-2 pr-4">Frequency</th>
              <th className="pb-2 pr-4">Severity</th>
              <th className="pb-2">EQ Fix</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {clashes.map((clash, i) => {
              const sev = (clash.severity ?? 'low').toLowerCase()
              return (
                <tr key={i}>
                  <td className="py-3 pr-4 text-gray-200">{clash.stems ?? '—'}</td>
                  <td className="py-3 pr-4 text-gray-400">{clash.frequency_range ?? '—'}</td>
                  <td className="py-3 pr-4">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-bold ${
                        severityBadge[sev] ?? 'bg-gray-700 text-gray-300'
                      }`}
                    >
                      {sev.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-3 text-xs text-gray-400">
                    {clash.eq_suggestion ?? '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
