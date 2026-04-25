import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import apiClient from '../lib/apiClient'

// ── types ──────────────────────────────────────────────────────────────────

interface GenreProfileSummary {
  genre: string
  display_name: string
  profile_name: string | null
  track_count: number
  created_date: string | null
  has_profile: boolean
}

interface FeatureStats {
  mean: number
  std: number
  min: number
  max: number
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
  acceptable_range: [number, number]
}

interface GenrePreset {
  target_lufs: number
  bpm_min: number
  bpm_max: number
  correlation_min: number
  correlation_max: number
  bass_mono_below_hz: number
}

interface GenreProfileDetail {
  genre: string
  display_name: string
  profile_name: string
  track_count: number
  created_date: string
  feature_statistics: Record<string, FeatureStats>
  preset: GenrePreset | null
}

// ── helpers ────────────────────────────────────────────────────────────────

const GENRES = ['trance', 'house', 'techno', 'dnb', 'progressive']

/** Features shown prominently; others shown in a collapsed "more" section */
const PRIMARY_FEATURES = [
  'tempo', 'stereo_width', 'phase_correlation', 'pumping_score',
  'four_on_floor_score', 'spectral_brightness', 'trance_score',
  'energy_progression',
]

function fmt(v: number, feat: string): string {
  if (feat === 'tempo') return v.toFixed(1)
  if (v > 10) return v.toFixed(1)
  return v.toFixed(3)
}

function featureLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ── RangeBar ───────────────────────────────────────────────────────────────

function RangeBar({ stats }: { stats: FeatureStats }) {
  const { min, max, p10, p25, p50, p75, p90 } = stats
  const span = max - min || 1

  const pct = (v: number) => Math.max(0, Math.min(100, ((v - min) / span) * 100))

  return (
    <div className="relative h-3 w-full rounded-full" style={{ backgroundColor: 'var(--color-border)' }}>
      {/* P10–P90 acceptable range */}
      <div
        className="absolute h-full rounded-full opacity-30"
        style={{
          left: `${pct(p10)}%`,
          width: `${pct(p90) - pct(p10)}%`,
          backgroundColor: 'var(--color-sky)',
        }}
      />
      {/* IQR box (P25–P75) */}
      <div
        className="absolute h-full rounded-full opacity-60"
        style={{
          left: `${pct(p25)}%`,
          width: `${pct(p75) - pct(p25)}%`,
          backgroundColor: 'var(--color-sky)',
        }}
      />
      {/* Median tick */}
      <div
        className="absolute top-0 h-full w-0.5 rounded-full bg-white opacity-90"
        style={{ left: `${pct(p50)}%` }}
      />
    </div>
  )
}

// ── FeatureRow ─────────────────────────────────────────────────────────────

function FeatureRow({ name, stats }: { name: string; stats: FeatureStats }) {
  return (
    <div className="grid grid-cols-[180px_1fr_120px] items-center gap-4 py-2.5
                    border-b border-studio-border last:border-0">
      <span className="font-metric text-xs text-studio-muted truncate" title={name}>
        {featureLabel(name)}
      </span>
      <RangeBar stats={stats} />
      <div className="text-right font-metric text-xs text-white">
        <span>{fmt(stats.mean, name)}</span>
        <span className="text-studio-muted"> ±{fmt(stats.std, name)}</span>
      </div>
    </div>
  )
}

// ── PresetCard ─────────────────────────────────────────────────────────────

function PresetCard({ preset, displayName }: { preset: GenrePreset; displayName: string }) {
  const rows = [
    { label: 'Target LUFS', value: `${preset.target_lufs} dBFS` },
    { label: 'BPM range', value: `${preset.bpm_min} – ${preset.bpm_max}` },
    { label: 'Stereo correlation', value: `${preset.correlation_min} – ${preset.correlation_max}` },
    { label: 'Bass mono below', value: `${preset.bass_mono_below_hz} Hz` },
  ]
  return (
    <div className="rounded-xl border border-studio-border bg-studio-card p-5">
      <h3 className="mb-3 text-sm font-semibold text-white">{displayName} preset targets</h3>
      <div className="space-y-2">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex justify-between text-xs">
            <span className="text-studio-muted">{label}</span>
            <span className="font-metric text-white">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── ProfileDetail ──────────────────────────────────────────────────────────

function ProfileDetail({ detail }: { detail: GenreProfileDetail }) {
  const [showAll, setShowAll] = useState(false)

  const primaryEntries = Object.entries(detail.feature_statistics).filter(([k]) =>
    PRIMARY_FEATURES.includes(k),
  )
  const otherEntries = Object.entries(detail.feature_statistics).filter(([k]) =>
    !PRIMARY_FEATURES.includes(k),
  )

  const dateStr = detail.created_date
    ? new Date(detail.created_date).toLocaleDateString('en-GB', {
        year: 'numeric', month: 'short', day: 'numeric',
      })
    : '—'

  return (
    <div className="space-y-5">
      {/* Summary + preset side-by-side */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Summary */}
        <div className="rounded-xl border border-studio-border bg-studio-card p-5">
          <h3 className="mb-3 text-sm font-semibold text-white">Profile summary</h3>
          <div className="space-y-2">
            {[
              { label: 'Reference tracks', value: String(detail.track_count) },
              { label: 'Features tracked', value: String(Object.keys(detail.feature_statistics).length) },
              { label: 'Profile version', value: detail.profile_name },
              { label: 'Built', value: dateStr },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-xs">
                <span className="text-studio-muted">{label}</span>
                <span className="font-metric text-white">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Preset */}
        {detail.preset && (
          <PresetCard preset={detail.preset} displayName={detail.display_name} />
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 text-xs text-studio-muted">
        <span className="font-semibold text-white">Feature distributions</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-6 rounded-full opacity-30" style={{ backgroundColor: 'var(--color-sky)' }} />
          P10–P90 range
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-full opacity-60" style={{ backgroundColor: 'var(--color-sky)' }} />
          IQR (P25–P75)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-0.5 rounded bg-white opacity-90" />
          Median
        </span>
        <span className="ml-auto font-metric">mean ±std</span>
      </div>

      {/* Primary features */}
      <div className="rounded-xl border border-studio-border bg-studio-card px-5 py-2">
        {primaryEntries.map(([name, stats]) => (
          <FeatureRow key={name} name={name} stats={stats} />
        ))}
      </div>

      {/* All other features (collapsed by default) */}
      {otherEntries.length > 0 && (
        <>
          <button
            onClick={() => setShowAll(v => !v)}
            className="text-xs text-studio-muted hover:text-white transition-colors"
          >
            {showAll ? '▲ Hide' : '▼ Show'} {otherEntries.length} additional features
          </button>
          {showAll && (
            <div className="rounded-xl border border-studio-border bg-studio-card px-5 py-2">
              {otherEntries.map(([name, stats]) => (
                <FeatureRow key={name} name={name} stats={stats} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── GenreProfilePage ───────────────────────────────────────────────────────

export default function GenreProfilePage() {
  const [summaries, setSummaries] = useState<GenreProfileSummary[]>([])
  const [activeGenre, setActiveGenre] = useState<string>(GENRES[0])
  const [detail, setDetail] = useState<GenreProfileDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiClient.get<GenreProfileSummary[]>('/genre-profiles').then(r => setSummaries(r.data))
  }, [])

  useEffect(() => {
    const summary = summaries.find(s => s.genre === activeGenre)
    if (!summary?.has_profile) { setDetail(null); return }

    setLoading(true)
    setError(null)
    apiClient
      .get<GenreProfileDetail>(`/genre-profiles/${activeGenre}`)
      .then(r => setDetail(r.data))
      .catch(() => setError('Failed to load profile.'))
      .finally(() => setLoading(false))
  }, [activeGenre, summaries])

  const activeSummary = summaries.find(s => s.genre === activeGenre)

  return (
    <div className="min-h-screen text-white" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* Nav */}
      <nav className="flex items-center justify-between border-b border-studio-border px-6 py-3">
        <div className="flex items-center gap-4">
          <Link to="/upload" className="text-sm text-studio-muted hover:text-white transition-colors">
            ← Back
          </Link>
          <span className="font-display text-sm font-semibold text-white">Genre Profiles</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-studio-muted">
          <Link to="/history" className="hover:text-white transition-colors">History</Link>
          <Link to="/tracks" className="hover:text-white transition-colors">Tracks</Link>
        </div>
      </nav>

      <main className="mx-auto max-w-4xl space-y-6 px-6 py-6">
        {/* Page title */}
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Genre Reference Profiles</h1>
          <p className="mt-1 text-sm text-studio-muted">
            Statistical distributions built from professionally mastered reference tracks.
            Used by Phase 6 gap analysis to place your mix against genre norms.
          </p>
        </div>

        {/* Genre tabs */}
        <div className="flex gap-1 rounded-xl border border-studio-border bg-studio-card p-1">
          {GENRES.map(genre => {
            const s = summaries.find(x => x.genre === genre)
            const active = genre === activeGenre
            return (
              <button
                key={genre}
                onClick={() => setActiveGenre(genre)}
                className={[
                  'flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors',
                  active
                    ? 'bg-studio-surface text-white'
                    : 'text-studio-muted hover:text-white',
                ].join(' ')}
              >
                {s?.display_name ?? genre}
                {s && !s.has_profile && (
                  <span className="ml-1 opacity-40">·</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Content area */}
        {loading && (
          <div className="flex items-center justify-center py-20 text-sm text-studio-muted">
            Loading profile…
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-900 bg-red-950/30 p-5 text-sm text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && activeSummary && !activeSummary.has_profile && (
          <div className="rounded-xl border border-studio-border bg-studio-card p-10 text-center">
            <p className="text-sm text-studio-muted">
              No statistical profile available for{' '}
              <span className="text-white">{activeSummary.display_name}</span> yet.
            </p>
            <p className="mt-1 text-xs text-studio-muted">
              Add reference tracks to{' '}
              <code className="rounded bg-studio-surface px-1 py-0.5 font-metric text-xs">
                data/reference_library/{activeGenre}/
              </code>{' '}
              and run the reference profiler to generate one.
            </p>
          </div>
        )}

        {!loading && !error && detail && <ProfileDetail detail={detail} />}
      </main>
    </div>
  )
}
