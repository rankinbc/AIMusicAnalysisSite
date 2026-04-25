import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from 'recharts'

interface Props {
  bands: Record<string, number>
}

const BAND_ORDER = [
  'sub_bass',
  'bass',
  'low_mid',
  'mid',
  'upper_mid',
  'presence',
  'air',
]

const BAND_LABELS: Record<string, string> = {
  sub_bass: 'Sub Bass',
  bass: 'Bass',
  low_mid: 'Low Mid',
  mid: 'Mid',
  upper_mid: 'Upper Mid',
  presence: 'Presence',
  air: 'Air',
}

function barColor(energy: number): string {
  if (energy > -10) return '#f97316' // too hot — orange
  if (energy < -40) return '#6b7280' // too quiet — gray
  return '#818cf8' // balanced — indigo
}

export default function FrequencyChart({ bands }: Props) {
  const data = BAND_ORDER.map((key) => ({
    name: BAND_LABELS[key] ?? key,
    energy: bands[key] ?? -60,
    key,
  }))

  return (
    <div className="rounded-2xl bg-gray-900 p-6">
      <h2 className="mb-4 text-xl font-bold">Frequency Balance</h2>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 12 }} />
          <YAxis
            domain={[-60, 0]}
            tick={{ fill: '#9ca3af', fontSize: 12 }}
            tickFormatter={(v: number) => `${v}dB`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1f2937',
              border: '1px solid #374151',
              borderRadius: '8px',
            }}
            labelStyle={{ color: '#f3f4f6' }}
            formatter={(value: number) => [`${value.toFixed(1)} dB`, 'Energy']}
          />
          <ReferenceLine
            y={-14}
            stroke="#a855f7"
            strokeDasharray="4 4"
            label={{ value: 'Target', fill: '#a855f7', fontSize: 11 }}
          />
          <Bar dataKey="energy" radius={[4, 4, 0, 0]}>
            {data.map((entry) => (
              <Cell key={entry.key} fill={barColor(entry.energy)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-2 text-xs text-gray-500">
        Purple dashed line = typical streaming target (−14 dB). Orange bars indicate
        energy above −10 dB.
      </p>
    </div>
  )
}
