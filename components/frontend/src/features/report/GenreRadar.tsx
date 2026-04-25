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
  const genre = (gaps.genre as string) ?? 'Unknown'
  const percentile = (gaps.percentile as number) ?? 50
  const gapsData = (gaps.gaps as Record<string, GapEntry> | undefined) ?? {}

  const data = Object.entries(gapsData)
    .slice(0, 6)
    .map(([key, val]) => ({
      feature: key.replace(/_/g, ' '),
      user: val.user_val ?? 0,
      genre: val.genre_mean ?? 0,
    }))

  if (data.length === 0) {
    return (
      <div className="rounded-2xl bg-gray-900 p-6">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold">Genre Analysis</h2>
          <span className="rounded-full bg-purple-900 px-3 py-1 text-sm font-medium capitalize text-purple-300">
            {genre}
          </span>
          <span className="text-sm text-gray-400">
            Percentile rank:{' '}
            <span className="font-bold text-white">{Math.round(percentile)}th</span>
          </span>
        </div>
        <p className="mt-4 text-sm text-gray-500">
          No genre feature data available for radar chart.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl bg-gray-900 p-6">
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <h2 className="text-xl font-bold">Genre Analysis</h2>
        <span className="rounded-full bg-purple-900 px-3 py-1 text-sm font-medium capitalize text-purple-300">
          {genre}
        </span>
        <span className="text-sm text-gray-400">
          Overall percentile:{' '}
          <span className="font-bold text-white">{Math.round(percentile)}th</span>
        </span>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <RadarChart data={data}>
          <PolarGrid stroke="#374151" />
          <PolarAngleAxis dataKey="feature" tick={{ fill: '#9ca3af', fontSize: 11 }} />
          <Radar
            name="Your Track"
            dataKey="user"
            stroke="#a855f7"
            fill="#a855f7"
            fillOpacity={0.3}
          />
          <Radar
            name="Genre Mean"
            dataKey="genre"
            stroke="#6b7280"
            fill="#6b7280"
            fillOpacity={0.1}
            strokeDasharray="4 4"
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1f2937',
              border: '1px solid #374151',
              borderRadius: '8px',
            }}
          />
          <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12 }} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
