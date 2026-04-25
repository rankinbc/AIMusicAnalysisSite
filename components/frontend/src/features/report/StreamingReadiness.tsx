// Pass/fail badge classes are safelisted in tailwind.config.ts
const PLATFORMS = [
  { name: 'Spotify', target: -14 },
  { name: 'Apple Music', target: -16 },
  { name: 'YouTube', target: -14 },
  { name: 'Tidal', target: -14 },
]

interface Props {
  lufs: number
}

export default function StreamingReadiness({ lufs }: Props) {
  return (
    <div className="rounded-2xl bg-gray-900 p-6">
      <h2 className="mb-4 text-xl font-bold">Streaming Readiness</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-left text-gray-400">
            <th className="pb-2">Platform</th>
            <th className="pb-2">Target LUFS</th>
            <th className="pb-2">Your LUFS</th>
            <th className="pb-2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {PLATFORMS.map(({ name, target }) => {
            // Pass if track LUFS is at or below the target (with 1 dB tolerance)
            const pass = lufs <= target + 1
            return (
              <tr key={name}>
                <td className="py-3 text-gray-200">{name}</td>
                <td className="py-3 text-gray-400">{target} LUFS</td>
                <td className="py-3 font-mono text-white">
                  {lufs != null ? lufs.toFixed(1) : '—'} LUFS
                </td>
                <td className="py-3">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-bold ${
                      pass
                        ? 'bg-green-900 text-green-300'
                        : 'bg-red-900 text-red-300'
                    }`}
                  >
                    {pass ? 'PASS' : 'FAIL'}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
