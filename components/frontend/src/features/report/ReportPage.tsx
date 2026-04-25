import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import api from '../../lib/apiClient'
import type { JobResultResponse } from '../../types/api'
import FixCard, { type FixChartType } from './FixCard'
import StereoReadout from './StereoReadout'
import SubScoreRadar from './SubScoreRadar'
import StreamingReadiness from './StreamingReadiness'
import ReferenceComparison from './ReferenceComparison'
import GenreRadar from './GenreRadar'
import ArrangementAdvisor from './ArrangementAdvisor'
import { ALSAnalysis } from './ALSAnalysis'
import ExpertsPanel from '../experts/ExpertsPanel'

// ── Genre frequency profile targets (typical well-mixed examples) ─────────────
const GENRE_FREQ_MEDIANS: Record<string, Record<string, number>> = {
  trance:  { sub_bass: -22, bass: -18, low_mid: -20, mid: -22, upper_mid: -20, presence: -22, air: -18 },
  house:   { sub_bass: -16, bass: -15, low_mid: -19, mid: -23, upper_mid: -25, presence: -27, air: -32 },
  techno:  { sub_bass: -20, bass: -17, low_mid: -17, mid: -17, upper_mid: -19, presence: -21, air: -30 },
  dnb:     { sub_bass: -14, bass: -16, low_mid: -21, mid: -24, upper_mid: -23, presence: -25, air: -29 },
  other:   { sub_bass: -19, bass: -18, low_mid: -20, mid: -21, upper_mid: -23, presence: -25, air: -29 },
}

const GENRE_LUFS_MEDIANS: Record<string, number> = {
  trance: -8.5, house: -9.0, techno: -8.0, dnb: -9.5, other: -12.0,
}

// ── Fix heuristics ─────────────────────────────────────────────────────────────

function detectChartType(fix: string): FixChartType {
  const f = fix.toLowerCase()
  if (/clash|overlap|stem|kick|bass.*eq|eq.*bass/.test(f)) return 'stems'
  if (/lufs|loudness|stream|level|master|loud|quiet/.test(f)) return 'lufs'
  if (/frequency|eq|bass|sub|air|high.freq|low.freq|presence|band/.test(f)) return 'frequency'
  return 'frequency' // default to frequency chart
}

function extractMetricLine(
  fix: string,
  bands: Record<string, number>,
  lufs: number,
  clashes: Array<{ stems?: string; frequency_range?: string; severity?: string }>,
): string {
  const f = fix.toLowerCase()
  if (/air/.test(f) && bands.air != null)
    return `Air band: ${bands.air.toFixed(1)} dB (target ≥ −20 dB)`
  if (/sub.bass|sub bass/.test(f) && bands.sub_bass != null)
    return `Sub bass: ${bands.sub_bass.toFixed(1)} dB (target ≥ −20 dB)`
  if (/bass/.test(f) && bands.bass != null)
    return `Bass band: ${bands.bass.toFixed(1)} dB`
  if (/clash|stem|kick/.test(f) && clashes.length > 0)
    return `${clashes[0].severity?.toUpperCase() ?? 'HIGH'} clash · ${clashes[0].stems ?? '?'} at ${clashes[0].frequency_range ?? '?'}`
  if (/lufs|loudness|level|master/.test(f))
    return `LUFS: ${lufs.toFixed(1)} dB (Spotify target −14 LUFS)`
  if (/bpm|tempo/.test(f))
    return 'BPM outside genre-typical range'
  return `LUFS: ${lufs.toFixed(1)} dB`
}

function estimateImpact(rank: number, score: number): number {
  const base = score < 60 ? 10 : score < 75 ? 7 : 4
  return Math.max(1, base - (rank - 1) * 2)
}

// ── Grade helpers ──────────────────────────────────────────────────────────────

const GRADE_COLORS: Record<string, string> = {
  A: '#4ade80', B: '#a3e635', C: '#facc15', D: '#fb923c', F: '#f87171',
}

function gradeVerdict(grade: string): string {
  const map: Record<string, string> = {
    A: 'Release-ready', B: 'Almost there', C: 'Work needed', D: 'Major issues', F: 'Start over',
  }
  return map[grade] ?? grade
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ReportPage() {
  const { id } = useParams<{ id: string }>()
  const [result, setResult] = useState<JobResultResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!id) return
    api
      .get<JobResultResponse>(`/jobs/${id}/results`)
      .then(({ data }) => setResult(data))
      .catch(() => setError('Failed to load results. Please try again.'))
      .finally(() => setLoading(false))
  }, [id])

  const handleCopyLink = () => {
    if (!result?.share_token) return
    const url = `${window.location.origin}/reports/share/${result.share_token}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-studio-sky border-t-transparent" />
          <p className="font-metric text-xs text-studio-muted">loading analysis…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center text-white" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="text-center">
          <p className="mb-2 font-metric text-4xl font-bold text-red-400">ERR</p>
          <p className="text-studio-muted">{error}</p>
          <Link to="/upload" className="mt-4 block text-studio-sky hover:text-white text-sm transition-colors">
            Upload another track
          </Link>
        </div>
      </div>
    )
  }

  if (!result) return null

  const { result: pipeline } = result

  // ── Phase data extraction ──────────────────────────────────────────────────
  const phase1 = pipeline.phases.find((p) => p.phase === 1)?.data ?? {}
  const phase3 = pipeline.phases.find((p) => p.phase === 3)?.data ?? {}
  const phase4 = pipeline.phases.find((p) => p.phase === 4)?.data ?? {}
  const phase5 = pipeline.phases.find((p) => p.phase === 5)
  const phase6 = pipeline.phases.find((p) => p.phase === 6)?.data ?? {}
  const phase7 = pipeline.phases.find((p) => p.phase === 7)?.data ?? {}
  const phase8 = pipeline.phases.find((p) => p.phase === 8)
  const alsData = phase8?.status === 'ok' ? phase8.data : null

  const lufs                = (phase1.lufs as number) ?? -23
  const bpm                 = (phase1.bpm as number) ?? null
  const detectedKey         = (phase1.detected_key as string) ?? null
  const truePeakDb          = (phase1.true_peak_db as number) ?? null
  const clippingDetected    = (phase1.clipping_detected as boolean) ?? false
  const monoCompatibility   = (phase1.mono_compatibility as number) ?? null
  const stereoCorrelation   = (phase1.stereo_correlation as number) ?? null
  const stereoWidth         = (phase1.stereo_width as number) ?? null
  const bands               = (phase1.bands as Record<string, number>) ?? {}

  const clashes    = (phase4.clashes as Array<{ stems?: string; frequency_range?: string; severity?: string; eq_suggestion?: string }>) ?? []
  const deltas     = (phase5?.data.deltas as Record<string, unknown>) ?? {}
  const fixes7     = (phase7.fixes as string[]) ?? []
  const violations7= (phase7.violations as string[]) ?? []

  const phase3SubScores = (phase3.sub_scores as Record<string, number>) ?? {}
  const phase3Notes     = (phase3.notes as string[]) ?? []
  const phase3Score     = (phase3.total_score as number) ?? 0
  const genre           = (phase3.genre as string) ?? (phase6.genre as string) ?? 'other'
  const percentile      = (phase6.percentile as number) ?? null

  const danceScore  = pipeline.danceability_score ?? null
  const coachFixes  = pipeline.coached_fixes ?? []

  // ── Grade & score ──────────────────────────────────────────────────────────
  const grade       = pipeline.grade
  const score       = pipeline.overall_score
  const gradeColor  = GRADE_COLORS[grade] ?? '#94a3b8'
  const topFixes    = pipeline.top_fixes

  // ── Streaming badges summary ───────────────────────────────────────────────
  const PLATFORMS = [
    { name: 'Spotify', target: -14 },
    { name: 'Apple Music', target: -16 },
    { name: 'YouTube', target: -14 },
    { name: 'Tidal', target: -14 },
    { name: 'Amazon', target: -14 },
    { name: 'SoundCloud', target: -14 },
    { name: 'Beatport', target: -9 },
  ]
  const streamingPasses = PLATFORMS.filter(({ target }) => lufs <= target + 1).length

  // ── Genre frequency median ─────────────────────────────────────────────────
  const genreKey = genre.toLowerCase()
  const genreMedianBands = GENRE_FREQ_MEDIANS[genreKey] ?? GENRE_FREQ_MEDIANS.other
  const genreMedianLufs  = GENRE_LUFS_MEDIANS[genreKey] ?? GENRE_LUFS_MEDIANS.other

  // ── Build fix cards ────────────────────────────────────────────────────────
  const fixCards = topFixes.slice(0, 3).map((fix, i) => {
    const chartType = detectChartType(fix)
    const metricLine = extractMetricLine(fix, bands, lufs, clashes)
    const impact = estimateImpact(i + 1, score)
    const coachFix = coachFixes[i]
    return { fix, coachFix, chartType, metricLine, impact }
  })

  return (
    <div className="min-h-screen text-white" style={{ backgroundColor: 'var(--color-bg)' }}>

      {/* ── Nav ── */}
      <nav className="flex items-center justify-between border-b border-studio-border px-6 py-3">
        <span className="font-display font-bold tracking-wide text-studio-sky text-sm">
          AI Music Analyzer
        </span>
        <div className="flex items-center gap-3">
          <Link to="/history" className="text-xs text-studio-muted hover:text-white transition-colors">History</Link>
          <Link to="/tracks" className="text-xs text-studio-muted hover:text-white transition-colors">Versions</Link>
          {result.share_token && (
            <button
              onClick={handleCopyLink}
              className="rounded-lg border border-studio-border bg-studio-card px-3 py-1.5 text-xs text-studio-muted transition hover:border-studio-sky hover:text-studio-sky"
            >
              {copied ? 'Copied ✓' : 'Copy link'}
            </button>
          )}
          <Link
            to="/upload"
            className="rounded-lg border border-studio-border bg-studio-card px-3 py-1.5 text-xs text-studio-muted transition hover:border-studio-amber hover:text-studio-amber"
          >
            + Analyze track
          </Link>
        </div>
      </nav>

      <main className="mx-auto max-w-4xl space-y-5 px-6 py-6">

        {/* ── Verdict strip ── */}
        <div className="rounded-xl border border-studio-border bg-studio-card overflow-hidden">
          <div className="flex flex-wrap items-center gap-0 divide-x divide-studio-border">

            {/* Grade + score */}
            <div className="flex items-center gap-4 px-6 py-4">
              <span
                className="font-display text-7xl font-extrabold leading-none"
                style={{ color: gradeColor }}
              >
                {grade}
              </span>
              <div>
                <div className="flex items-baseline gap-1">
                  <span className="font-metric text-3xl font-bold text-white">{Math.round(score)}</span>
                  <span className="font-metric text-sm text-studio-muted">/100</span>
                </div>
                <p className="text-xs text-studio-muted mt-0.5">{gradeVerdict(grade)}</p>
              </div>
            </div>

            {/* Genre + confidence */}
            <div className="px-5 py-4">
              <p className="text-xs text-studio-muted uppercase tracking-widest mb-0.5">Genre</p>
              <p className="font-display font-semibold capitalize text-white text-base">{genre}</p>
              {percentile != null && (
                <p className="font-metric text-xs text-studio-muted mt-0.5">
                  {Math.round(percentile)}th percentile
                </p>
              )}
            </div>

            {/* BPM */}
            {bpm != null && (
              <div className="px-5 py-4">
                <p className="text-xs text-studio-muted uppercase tracking-widest mb-0.5">BPM</p>
                <p className="font-metric text-xl font-bold text-white">{bpm.toFixed(1)}</p>
              </div>
            )}

            {/* Key */}
            {detectedKey && (
              <div className="px-5 py-4">
                <p className="text-xs text-studio-muted uppercase tracking-widest mb-0.5">Key</p>
                <p className="font-metric text-xl font-bold text-white">{detectedKey}</p>
              </div>
            )}

            {/* LUFS */}
            <div className="px-5 py-4">
              <p className="text-xs text-studio-muted uppercase tracking-widest mb-0.5">LUFS</p>
              <p
                className="font-metric text-xl font-bold"
                style={{ color: lufs <= -14 ? '#4ade80' : lufs <= -9 ? '#facc15' : '#f87171' }}
              >
                {lufs.toFixed(1)}
              </p>
              {genreMedianLufs && (
                <p className="font-metric text-xs text-studio-muted">
                  med {genreMedianLufs.toFixed(1)}
                </p>
              )}
            </div>

            {/* Danceability */}
            {danceScore != null && (
              <div className="px-5 py-4">
                <p className="text-xs text-studio-muted uppercase tracking-widest mb-0.5">Dance</p>
                <p
                  className="font-metric text-xl font-bold"
                  style={{ color: danceScore >= 75 ? '#4ade80' : danceScore >= 50 ? '#facc15' : '#f87171' }}
                >
                  {danceScore}
                </p>
              </div>
            )}

            {/* Status badges */}
            <div className="ml-auto flex flex-wrap items-center gap-2 px-5 py-4">
              {clippingDetected && (
                <span className="font-metric rounded-full bg-red-950 border border-red-800 px-2.5 py-0.5 text-xs text-red-400">
                  ⚠ CLIP
                </span>
              )}
              {truePeakDb != null && truePeakDb >= -1 && (
                <span className="font-metric rounded-full bg-orange-950 border border-orange-800 px-2.5 py-0.5 text-xs text-orange-400">
                  TP {truePeakDb.toFixed(1)}
                </span>
              )}
              <span
                className={`font-metric rounded-full border px-2.5 py-0.5 text-xs ${
                  streamingPasses >= 5
                    ? 'bg-green-950 border-green-800 text-green-400'
                    : streamingPasses >= 3
                    ? 'bg-yellow-950 border-yellow-800 text-yellow-400'
                    : 'bg-red-950 border-red-800 text-red-400'
                }`}
              >
                {streamingPasses}/{PLATFORMS.length} streaming
              </span>
            </div>
          </div>
        </div>

        {/* ── Fix queue ── */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-studio-muted">
            Fix queue — ranked by impact
          </p>
          <div className="space-y-3">
            {fixCards.map(({ fix, coachFix, chartType, metricLine, impact }, i) => (
              <FixCard
                key={i}
                rank={i + 1}
                shortFix={fix}
                coachFix={coachFix}
                metricLine={metricLine}
                impact={impact}
                chartType={chartType as FixChartType}
                freqData={
                  chartType === 'frequency'
                    ? { bands, genreMedian: genreMedianBands, genre }
                    : undefined
                }
                lufsData={
                  chartType === 'lufs'
                    ? { lufs, genreMedianLufs, genre }
                    : undefined
                }
                stemsData={
                  chartType === 'stems'
                    ? { clashes }
                    : undefined
                }
              />
            ))}
            {topFixes.length === 0 && (
              <div className="rounded-xl border border-green-900 bg-green-950/20 px-5 py-4">
                <p className="text-sm text-green-400">No critical issues — this track is in good shape.</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Genre dimensions + stereo side-by-side ── */}
        {(Object.keys(phase3SubScores).length > 0 || stereoCorrelation != null) && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {Object.keys(phase3SubScores).length > 0 && (
              <SubScoreRadar
                subScores={phase3SubScores}
                notes={phase3Notes}
                genre={genre}
                totalScore={phase3Score}
              />
            )}
            <StereoReadout
              correlation={stereoCorrelation}
              stereoWidth={stereoWidth}
              monoCompatibility={monoCompatibility}
            />
          </div>
        )}

        {/* ── Genre radar (phase 6 gaps) ── */}
        {Object.keys(phase6).length > 0 && (
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-studio-muted">Genre comparison</p>
            <GenreRadar gaps={phase6} />
          </div>
        )}

        {/* ── Streaming readiness (full table) ── */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-studio-muted">Streaming readiness</p>
          <StreamingReadiness lufs={lufs} truePeakDb={truePeakDb} clippingDetected={clippingDetected} />
        </div>

        {/* ── Reference comparison ── */}
        {phase5 && phase5.status !== 'skipped' && Object.keys(deltas).length > 0 && (
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-studio-muted">Reference track comparison</p>
            <ReferenceComparison deltas={deltas} />
          </div>
        )}

        {/* ── Arrangement advisor ── */}
        {(fixes7.length > 0 || violations7.length > 0) && (
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-studio-muted">Arrangement</p>
            <ArrangementAdvisor fixes={fixes7} violations={violations7} />
          </div>
        )}

        {/* ── ALS Analysis ── */}
        {alsData && <ALSAnalysis data={alsData as any} />}

        {/* ── AI Experts ── */}
        <ExpertsPanel jobId={id!} />

      </main>
    </div>
  )
}
