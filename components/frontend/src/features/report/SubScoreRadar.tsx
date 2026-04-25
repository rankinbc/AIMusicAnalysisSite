import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'

interface Props {
  subScores: Record<string, number>
  notes: string[]
  genre: string
  totalScore: number
}

const LABEL_MAP: Record<string, string> = {
  air_energy: 'Air',
  stereo_width: 'Width',
  bpm_adherence: 'BPM',
  bass_energy: 'Bass',
  mid_presence: 'Mids',
  minimal_air: 'Air cut',
  sub_bass_weight: 'Sub',
  frequency_balance: 'Balance',
}

export default function SubScoreRadar({ subScores, notes, genre, totalScore }: Props) {
  const entries = Object.entries(subScores)
  if (!entries.length) return null

  const data = entries.map(([key, val]) => ({
    feature: LABEL_MAP[key] ?? key.replace(/_/g, ' '),
    score: Math.round(val),
  }))

  const scoreColor = totalScore >= 80 ? '#4ade80' : totalScore >= 60 ? '#facc15' : '#f87171'

  return (
    <div className="rounded-xl border border-studio-border bg-studio-card p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-studio-muted">Genre Dimensions</h2>
          <p className="mt-0.5 text-sm text-white capitalize">{genre} scoring rubric</p>
        </div>
        <div className="text-right">
          <span className="font-metric text-2xl font-bold" style={{ color: scoreColor }}>
            {Math.round(totalScore)}
          </span>
          <p className="text-xs text-studio-muted">/100</p>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <RadarChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
          <PolarGrid stroke="#1c1c38" />
          <PolarAngleAxis
            dataKey="feature"
            tick={{ fill: '#6b6b9a', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          />
          <Radar
            name="Score"
            dataKey="score"
            stroke="#38bdf8"
            fill="#38bdf8"
            fillOpacity={0.15}
            strokeWidth={1.5}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#111120', border: '1px solid #1c1c38', borderRadius: 6, fontSize: 12 }}
            formatter={(v: number) => [`${v}/100`, 'Score']}
          />
        </RadarChart>
      </ResponsiveContainer>

      {notes.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-studio-border pt-3">
          {notes.map((note, i) => (
            <li key={i} className="flex gap-2 text-xs text-studio-muted">
              <span className="shrink-0 text-studio-amber">→</span>
              <span>{note}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
