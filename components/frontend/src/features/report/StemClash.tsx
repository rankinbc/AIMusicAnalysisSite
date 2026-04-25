const SEVERITY_COLORS: Record<string, string> = {
  high: '#f87171', medium: '#fb923c', low: '#facc15',
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
      <div className="rounded-xl border border-studio-border bg-studio-card px-5 py-4">
        <p className="text-sm text-green-400">No frequency clashes detected between stems.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-studio-border bg-studio-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-studio-border text-left">
              <th className="px-5 py-2 text-xs font-medium text-studio-muted">Stems</th>
              <th className="py-2 text-xs font-medium text-studio-muted">Frequency</th>
              <th className="py-2 text-xs font-medium text-studio-muted">Severity</th>
              <th className="py-2 pr-5 text-xs font-medium text-studio-muted">EQ Fix</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-studio-border">
            {clashes.map((clash, i) => {
              const sev = (clash.severity ?? 'low').toLowerCase()
              const color = SEVERITY_COLORS[sev] ?? '#94a3b8'
              return (
                <tr key={i} className="hover:bg-studio-surface transition-colors">
                  <td className="px-5 py-3 text-gray-300">{clash.stems ?? '—'}</td>
                  <td className="py-3 font-metric text-xs text-studio-sky">{clash.frequency_range ?? '—'}</td>
                  <td className="py-3">
                    <span
                      className="rounded px-2 py-0.5 font-metric text-xs font-bold uppercase"
                      style={{ color, backgroundColor: `${color}18` }}
                    >
                      {sev}
                    </span>
                  </td>
                  <td className="py-3 pr-5 text-xs text-studio-muted">{clash.eq_suggestion ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
