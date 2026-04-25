import { useState } from 'react'
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

// ── Types ─────────────────────────────────────────────────────────────────────

export type FixChartType = 'frequency' | 'lufs' | 'stems' | 'none'

interface FreqData {
  bands: Record<string, number>
  genreMedian?: Record<string, number>
  genre?: string
}

interface LufsData {
  lufs: number
  genreMedianLufs?: number
  genre?: string
}

interface StemsData {
  clashes: Array<{ stems?: string; frequency_range?: string; severity?: string; eq_suggestion?: string }>
}

export interface FixCardProps {
  rank: number
  shortFix: string
  coachFix?: string
  metricLine: string
  impact: number
  chartType: FixChartType
  freqData?: FreqData
  lufsData?: LufsData
  stemsData?: StemsData
  grade?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BAND_ORDER = ['sub_bass', 'bass', 'low_mid', 'mid', 'upper_mid', 'presence', 'air']
const BAND_LABELS: Record<string, string> = {
  sub_bass: 'Sub', bass: 'Bass', low_mid: 'Lo-Mid',
  mid: 'Mid', upper_mid: 'Hi-Mid', presence: 'Pres', air: 'Air',
}

const SEVERITY_COLORS: Record<string, string> = {
  high: '#f87171', medium: '#fb923c', low: '#facc15',
}

const PLATFORM_TARGETS = [
  { name: 'Spotify / YouTube', target: -14 },
  { name: 'Apple Music', target: -16 },
  { name: 'Beatport / Club', target: -9 },
]

// ── Sub-components ─────────────────────────────────────────────────────────────

function FreqChart({ bands, genreMedian, genre }: FreqData) {
  const data = BAND_ORDER.map((key) => ({
    name: BAND_LABELS[key] ?? key,
    energy: bands[key] ?? -60,
    median: genreMedian?.[key] ?? null,
    key,
  }))

  return (
    <div>
      {genre && (
        <p className="mb-2 text-xs text-studio-muted">
          <span className="text-studio-sky font-metric">▬</span> your track
          {genreMedian && (
            <> &nbsp; <span className="opacity-40">▬</span> {genre} median</>
          )}
        </p>
      )}
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid strokeDasharray="2 4" stroke="#1c1c38" vertical={false} />
          <XAxis dataKey="name" tick={{ fill: '#6b6b9a', fontSize: 11, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
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
              <Cell
                key={entry.key}
                fill={entry.energy > -10 ? '#fb923c' : entry.energy < -40 ? '#334155' : '#38bdf8'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-1 text-xs text-studio-muted">Amber line = streaming target −14 dB · orange bars = hot</p>
    </div>
  )
}

function LufsChart({ lufs, genreMedianLufs, genre }: LufsData) {
  const userVal = Math.max(-40, Math.min(0, lufs))
  const platformData = PLATFORM_TARGETS.map(({ name, target }) => ({
    name,
    target,
    user: userVal,
    pass: lufs <= target + 1,
  }))

  return (
    <div className="space-y-2">
      {/* LUFS bar vs targets */}
      <div className="flex items-center gap-4 py-2">
        <span className="text-xs text-studio-muted w-20 shrink-0">Your LUFS</span>
        <div className="flex-1 relative h-5">
          <div className="absolute inset-0 rounded bg-studio-border" />
          {/* platform lines */}
          {PLATFORM_TARGETS.map(({ target }) => {
            const pct = ((target + 40) / 40) * 100
            return (
              <div
                key={target}
                className="absolute top-0 h-full w-px bg-studio-muted opacity-50"
                style={{ left: `${pct}%` }}
              />
            )
          })}
          {/* user bar */}
          <div
            className="absolute top-1 bottom-1 rounded"
            style={{
              left: 0,
              width: `${Math.max(4, ((userVal + 40) / 40) * 100)}%`,
              backgroundColor: lufs <= -14 ? '#4ade80' : lufs <= -9 ? '#facc15' : '#f87171',
            }}
          />
        </div>
        <span className="font-metric text-sm text-studio-sky w-20 text-right">{lufs.toFixed(1)} LUFS</span>
      </div>

      {genreMedianLufs != null && (
        <p className="text-xs text-studio-muted">
          {genre ?? 'Genre'} median:{' '}
          <span className="font-metric text-white">{genreMedianLufs.toFixed(1)} LUFS</span>
        </p>
      )}

      {/* Platform pass/fail pills */}
      <div className="flex flex-wrap gap-2 pt-1">
        {platformData.map(({ name, pass }) => (
          <span
            key={name}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-metric ${
              pass ? 'bg-green-950 text-green-400 border border-green-800' : 'bg-red-950 text-red-400 border border-red-900'
            }`}
          >
            {pass ? '✓' : '✗'} {name}
          </span>
        ))}
      </div>
    </div>
  )
}

function StemsChart({ clashes }: StemsData) {
  if (!clashes.length) {
    return <p className="text-sm text-green-400 py-2">No frequency clashes detected.</p>
  }
  return (
    <div className="space-y-2">
      {clashes.map((c, i) => {
        const sev = (c.severity ?? 'low').toLowerCase()
        return (
          <div key={i} className="flex items-start gap-3 rounded border border-studio-border bg-studio-bg p-3">
            <span
              className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-metric uppercase"
              style={{ color: SEVERITY_COLORS[sev] ?? '#94a3b8', backgroundColor: `${SEVERITY_COLORS[sev] ?? '#94a3b8'}18` }}
            >
              {sev}
            </span>
            <div className="min-w-0">
              <p className="text-sm text-white">{c.stems ?? '—'} <span className="text-studio-muted">·</span> <span className="font-metric text-studio-sky text-xs">{c.frequency_range ?? ''}</span></p>
              {c.eq_suggestion && <p className="text-xs text-studio-muted mt-0.5">{c.eq_suggestion}</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Main FixCard ───────────────────────────────────────────────────────────────

const RANK_IMPACT_COLOR = ['#f59e0b', '#94a3b8', '#64748b'] // amber, slate, muted slate

export default function FixCard({
  rank,
  shortFix,
  coachFix,
  metricLine,
  impact,
  chartType,
  freqData,
  lufsData,
  stemsData,
}: FixCardProps) {
  const [open, setOpen] = useState(false)
  const [showCoach, setShowCoach] = useState(false)

  const accentColor = RANK_IMPACT_COLOR[rank - 1] ?? '#64748b'
  const hasChart = chartType !== 'none'
  const hasCoach = Boolean(coachFix && coachFix !== shortFix)

  return (
    <div
      className="rounded-xl border border-studio-border bg-studio-card overflow-hidden transition-all duration-200"
      style={{ borderLeftWidth: 3, borderLeftColor: accentColor }}
    >
      {/* Card header */}
      <div className="flex items-start gap-4 p-5">
        {/* Rank number */}
        <div
          className="shrink-0 font-metric text-4xl font-bold leading-none tabular-nums"
          style={{ color: accentColor, opacity: rank === 1 ? 1 : rank === 2 ? 0.7 : 0.45 }}
        >
          {String(rank).padStart(2, '0')}
        </div>

        {/* Fix content */}
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-white leading-snug">{shortFix}</p>
          <p className="mt-1 font-metric text-xs text-studio-sky">{metricLine}</p>

          {/* Coach voice toggle */}
          {hasCoach && (
            <div className="mt-2">
              <button
                onClick={() => setShowCoach((v) => !v)}
                className="text-xs text-studio-muted hover:text-white transition-colors"
              >
                {showCoach ? '↑ hide coach note' : '↓ coach says…'}
              </button>
              {showCoach && (
                <p className="mt-1.5 rounded border border-studio-border bg-studio-surface px-3 py-2 text-sm italic text-slate-300 leading-relaxed">
                  "{coachFix}"
                </p>
              )}
            </div>
          )}
        </div>

        {/* Impact + chart toggle */}
        <div className="shrink-0 flex flex-col items-end gap-2">
          {impact > 0 && (
            <span
              className="font-metric text-xs rounded-full px-2 py-0.5 border"
              style={{ color: accentColor, borderColor: `${accentColor}40`, backgroundColor: `${accentColor}10` }}
            >
              +{impact} pts est.
            </span>
          )}
          {hasChart && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="text-xs text-studio-muted hover:text-white transition-colors flex items-center gap-1"
            >
              {open ? 'hide ↑' : 'show why ↓'}
            </button>
          )}
        </div>
      </div>

      {/* Expanded chart panel */}
      {open && hasChart && (
        <div className="border-t border-studio-border bg-studio-surface px-5 py-4">
          {chartType === 'frequency' && freqData && <FreqChart {...freqData} />}
          {chartType === 'lufs' && lufsData && <LufsChart {...lufsData} />}
          {chartType === 'stems' && stemsData && <StemsChart {...stemsData} />}
        </div>
      )}
    </div>
  )
}
