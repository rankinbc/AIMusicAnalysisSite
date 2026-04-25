// Pass/fail badge classes are safelisted in tailwind.config.ts
const PLATFORMS = [
  { name: 'Spotify', target: -14 },
  { name: 'Apple Music', target: -16 },
  { name: 'YouTube', target: -14 },
  { name: 'Tidal', target: -14 },
  { name: 'Amazon Music', target: -14 },
  { name: 'SoundCloud', target: -14 },
  { name: 'Beatport', target: -9 },
]

interface Props {
  lufs: number
  truePeakDb?: number | null
  clippingDetected?: boolean | null
}

interface Check {
  label: string
  target: string
  value: string
  pass: boolean
}

export default function StreamingReadiness({ lufs, truePeakDb, clippingDetected }: Props) {
  const checks: Check[] = [
    ...PLATFORMS.map(({ name, target }) => ({
      label: name,
      target: `${target} LUFS`,
      value: `${lufs != null ? lufs.toFixed(1) : '—'} LUFS`,
      pass: lufs <= target + 1,
    })),
    ...(truePeakDb != null
      ? [{ label: 'True Peak', target: '< −1.0 dBTP', value: `${truePeakDb.toFixed(1)} dBTP`, pass: truePeakDb < -1.0 }]
      : []),
    ...(clippingDetected != null
      ? [{ label: 'No Clipping', target: '0 clipped samples', value: clippingDetected ? 'Clipping detected' : 'Clean', pass: !clippingDetected }]
      : []),
  ]

  const passes = checks.filter((c) => c.pass).length

  return (
    <div className="rounded-xl border border-studio-border bg-studio-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-studio-border">
        <p className="text-xs font-semibold uppercase tracking-widest text-studio-muted">Platform checks</p>
        <span className={`font-metric text-xs rounded-full px-2 py-0.5 border ${
          passes >= checks.length * 0.8
            ? 'bg-green-950 border-green-800 text-green-400'
            : passes >= checks.length * 0.5
            ? 'bg-yellow-950 border-yellow-800 text-yellow-400'
            : 'bg-red-950 border-red-800 text-red-400'
        }`}>
          {passes}/{checks.length} pass
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-studio-border text-left">
            <th className="px-5 py-2 text-xs font-medium text-studio-muted">Platform</th>
            <th className="py-2 text-xs font-medium text-studio-muted">Target</th>
            <th className="py-2 text-xs font-medium text-studio-muted">Your value</th>
            <th className="py-2 text-xs font-medium text-studio-muted pr-5">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-studio-border">
          {checks.map(({ label, target, value, pass }) => (
            <tr key={label} className="hover:bg-studio-surface transition-colors">
              <td className="px-5 py-2.5 text-gray-300">{label}</td>
              <td className="py-2.5 font-metric text-xs text-studio-muted">{target}</td>
              <td className="py-2.5 font-metric text-xs text-white">{value}</td>
              <td className="py-2.5 pr-5">
                <span className={`rounded px-2 py-0.5 font-metric text-xs font-bold ${
                  pass ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                }`}>
                  {pass ? 'PASS' : 'FAIL'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
