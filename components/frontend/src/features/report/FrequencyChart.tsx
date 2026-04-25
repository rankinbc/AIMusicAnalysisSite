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
  genreMedian?: Record<string, number>
  genre?: string
}

const BAND_ORDER = ['sub_bass', 'bass', 'low_mid', 'mid', 'upper_mid', 'presence', 'air']
const BAND_LABELS: Record<string, string> = {
  sub_bass: 'Sub', bass: 'Bass', low_mid: 'Lo-Mid',
  mid: 'Mid', upper_mid: 'Hi-Mid', presence: 'Pres', air: 'Air',
}

function barColor(energy: number): string {
  if (energy > -10) return '#fb923c'
  if (energy < -40) return '#1e293b'
  return '#38bdf8'
}

export default function FrequencyChart({ bands, genreMedian, genre }: Props) {
  const data = BAND_ORDER.map((key) => ({
    name: BAND_LABELS[key] ?? key,
    energy: bands[key] ?? -60,
    median: genreMedian?.[key] ?? null,
    key,
  }))

  return (
    <div className="rounded-xl border border-studio-border bg-studio-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-studio-muted">Frequency balance</p>
        {genre && genreMedian && (
          <p className="text-xs text-studio-muted">
            <span className="inline-block h-2 w-3 rounded-sm bg-white opacity-20 mr-1" />
            {genre} median
          </p>
        )}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid strokeDasharray="2 4" stroke="#1c1c38" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: '#6b6b9a', fontSize: 11, fontFamily: 'JetBrains Mono' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[-60, 0]}
            tick={{ fill: '#6b6b9a', fontSize: 10, fontFamily: 'JetBrains Mono' }}
            tickFormatter={(v: number) => `${v}`}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#111120', border: '1px solid #1c1c38', borderRadius: 6, fontSize: 12 }}
            labelStyle={{ color: '#e2e8f0', fontFamily: 'JetBrains Mono' }}
            formatter={(value: number, name: string) => [
              `${value.toFixed(1)} dB`,
              name === 'energy' ? 'Your track' : `${genre ?? 'Genre'} median`,
            ]}
          />
          <ReferenceLine y={-14} stroke="#f59e0b" strokeDasharray="3 3" strokeWidth={1} />
          {genreMedian && (
            <Bar dataKey="median" radius={[2, 2, 0, 0]} fill="#ffffff" opacity={0.12} />
          )}
          <Bar dataKey="energy" radius={[2, 2, 0, 0]}>
            {data.map((entry) => (
              <Cell key={entry.key} fill={barColor(entry.energy)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-2 text-xs text-studio-muted">
        Amber line = streaming target −14 dB · orange bars = hot · ghost bars = {genre ?? 'genre'} median
      </p>
    </div>
  )
}
