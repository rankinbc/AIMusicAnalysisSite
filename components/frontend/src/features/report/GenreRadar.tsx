import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts'

interface GapEntry {
  user_val?: number
  genre_mean?: number
}

interface Props {
  gaps: Record<string, unknown>
}

export default function GenreRadar({ gaps }: Props) {
  const genre      = (gaps.genre as string) ?? 'Unknown'
  const percentile = (gaps.percentile as number) ?? 50
  const gapsData   = (gaps.gaps as Record<string, GapEntry> | undefined) ?? {}

  const data = Object.entries(gapsData)
    .slice(0, 6)
    .map(([key, val]) => ({
      feature: key.replace(/_/g, ' '),
      user: val.user_val ?? 0,
      genre: val.genre_mean ?? 0,
    }))

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-studio-border bg-studio-card p-5">
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-violet-700 bg-violet-950 px-3 py-0.5 text-xs font-medium capitalize text-violet-300">
            {genre}
          </span>
          <span className="font-metric text-xs text-studio-muted">
            {Math.round(percentile)}th percentile
          </span>
        </div>
        <p className="mt-3 text-xs text-studio-muted">No genre feature gaps data available.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-studio-border bg-studio-card p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="rounded-full border border-violet-700 bg-violet-950 px-3 py-0.5 text-xs font-semibold capitalize text-violet-300">
          {genre}
        </span>
        <span className="font-metric text-xs text-studio-muted">
          overall <span className="text-white">{Math.round(percentile)}th</span> percentile
        </span>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <RadarChart data={data}>
          <PolarGrid stroke="#1c1c38" />
          <PolarAngleAxis
            dataKey="feature"
            tick={{ fill: '#6b6b9a', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          />
          <Radar name="Your Track" dataKey="user" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.2} strokeWidth={1.5} />
          <Radar name="Genre Mean" dataKey="genre" stroke="#6b6b9a" fill="#6b6b9a" fillOpacity={0.08} strokeDasharray="3 3" />
          <Tooltip
            contentStyle={{ backgroundColor: '#111120', border: '1px solid #1c1c38', borderRadius: 6, fontSize: 12 }}
            labelStyle={{ color: '#e2e8f0', fontFamily: 'JetBrains Mono' }}
          />
          <Legend
            wrapperStyle={{ color: '#6b6b9a', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
