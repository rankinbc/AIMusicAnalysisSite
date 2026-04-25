import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import api from '../../lib/apiClient'
import type { JobResultResponse } from '../../types/api'
import MixScore from './MixScore'
import StreamingReadiness from './StreamingReadiness'
import FrequencyChart from './FrequencyChart'
import StemClash from './StemClash'
import ReferenceComparison from './ReferenceComparison'
import GenreRadar from './GenreRadar'
import ArrangementAdvisor from './ArrangementAdvisor'
import CoachPanel from './CoachPanel'
import ExpertsPanel from '../experts/ExpertsPanel'

const danceabilityColor = (score: number): string => {
  if (score >= 75) return '#22c55e'
  if (score >= 50) return '#eab308'
  if (score >= 30) return '#f97316'
  return '#ef4444'
}

const danceabilityLabel = (score: number): string => {
  if (score >= 75) return 'Floor-ready'
  if (score >= 50) return 'Decent groove'
  if (score >= 30) return 'Needs work'
  return 'Low energy / off-tempo'
}

const monoCompatColor = (compat: number): string => {
  if (compat >= 0.7) return '#22c55e'
  if (compat >= 0.5) return '#eab308'
  return '#ef4444'
}

const monoCompatLabel = (compat: number): string => {
  if (compat >= 0.85) return 'Excellent'
  if (compat >= 0.70) return 'Good'
  if (compat >= 0.50) return 'Check phase'
  return 'Phase issues'
}

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
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-500 border-t-transparent" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <p className="mb-2 text-2xl font-bold text-red-400">Error</p>
          <p className="text-gray-400">{error}</p>
          <Link
            to="/upload"
            className="mt-4 block text-purple-400 hover:text-purple-300"
          >
            Upload another track
          </Link>
        </div>
      </div>
    )
  }

  if (!result) return null

  const { result: pipeline } = result

  // Extract per-phase data with safe fallbacks
  const phase1 = pipeline.phases.find((p) => p.phase === 1)?.data ?? {}
  const phase4 = pipeline.phases.find((p) => p.phase === 4)?.data ?? {}
  const phase5 = pipeline.phases.find((p) => p.phase === 5)
  const phase6 = pipeline.phases.find((p) => p.phase === 6)?.data ?? {}
  const phase7 = pipeline.phases.find((p) => p.phase === 7)?.data ?? {}

  const lufs = (phase1.lufs as number) ?? -23
  const bpm = (phase1.bpm as number) ?? null
  const detectedKey = (phase1.detected_key as string) ?? null
  const truePeakDb = (phase1.true_peak_db as number) ?? null
  const clippingDetected = (phase1.clipping_detected as boolean) ?? null
  const monoCompatibility = (phase1.mono_compatibility as number) ?? null
  const bands = (phase1.bands as Record<string, number>) ?? {}
  const clashes = (phase4.clashes as Record<string, unknown>[]) ?? []
  const deltas = (phase5?.data.deltas as Record<string, unknown>) ?? {}
  const fixes7 = (phase7.fixes as string[]) ?? []
  const violations7 = (phase7.violations as string[]) ?? []

  const danceScore = pipeline.danceability_score ?? null
  const coachName = pipeline.coach_name ?? 'Coach'
  const coachIntro = pipeline.coach_intro ?? ''
  const coachedFixes = pipeline.coached_fixes ?? []

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between border-b border-gray-800 px-8 py-4">
        <span className="font-bold text-purple-400">AI Music Analyzer</span>
        <div className="flex items-center gap-4">
          <Link to="/history" className="text-sm text-gray-400 hover:text-white">
            History
          </Link>
          <Link to="/tracks" className="text-sm text-gray-400 hover:text-white">
            Track History
          </Link>
          {result.share_token && (
            <button
              onClick={handleCopyLink}
              className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-300 transition hover:bg-gray-700"
            >
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
          )}
          <Link
            to="/upload"
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-300 transition hover:bg-gray-700"
          >
            Analyze Another Track
          </Link>
        </div>
      </nav>

      <main className="mx-auto max-w-5xl space-y-8 p-8">
        <div>
          <h1 className="text-3xl font-bold">Analysis Report</h1>
          <p className="mt-1 text-sm text-gray-500">Job ID: {id}</p>
        </div>

        {/* Track metadata bar — BPM + Key */}
        {(bpm != null || detectedKey) && (
          <div className="flex gap-8 rounded-2xl bg-gray-900 px-6 py-4">
            {bpm != null && (
              <div>
                <span className="text-3xl font-bold text-white">{bpm.toFixed(1)}</span>
                <span className="ml-1 text-sm text-gray-400">BPM</span>
              </div>
            )}
            {detectedKey && (
              <div>
                <span className="text-3xl font-bold text-white">{detectedKey}</span>
                <span className="ml-1 text-sm text-gray-400">Key</span>
              </div>
            )}
            {monoCompatibility != null && (
              <div className="ml-auto flex flex-col items-end">
                <span
                  className="text-2xl font-bold"
                  style={{ color: monoCompatColor(monoCompatibility) }}
                >
                  {Math.round(monoCompatibility * 100)}%
                </span>
                <span className="text-xs text-gray-400">
                  Mono Compat — {monoCompatLabel(monoCompatibility)}
                </span>
              </div>
            )}
          </div>
        )}

        <MixScore
          grade={pipeline.grade}
          score={pipeline.overall_score}
          topFixes={pipeline.top_fixes}
        />

        {/* Danceability score */}
        {danceScore != null && (
          <div className="flex items-center gap-6 rounded-2xl bg-gray-900 p-6">
            <div className="flex flex-col items-center">
              <span
                className="text-5xl font-bold"
                style={{ color: danceabilityColor(danceScore) }}
              >
                {danceScore}
              </span>
              <span className="mt-1 text-sm text-gray-400">Danceability</span>
              <span className="text-xs text-gray-500">{danceabilityLabel(danceScore)}</span>
            </div>
            <div className="h-16 w-px bg-gray-700" />
            <p className="text-sm text-gray-400">
              Scored from BPM match to genre ideal, rhythmic density, and sub-bass energy.
              Higher scores indicate a track that will perform well on the dance floor.
            </p>
          </div>
        )}

        {coachedFixes.length > 0 && (
          <CoachPanel
            coachName={coachName}
            coachIntro={coachIntro}
            coachedFixes={coachedFixes}
          />
        )}

        <StreamingReadiness
          lufs={lufs}
          truePeakDb={truePeakDb}
          clippingDetected={clippingDetected}
        />

        <FrequencyChart bands={bands} />

        <StemClash clashes={clashes} />

        {phase5 && phase5.status !== 'skipped' && Object.keys(deltas).length > 0 && (
          <ReferenceComparison deltas={deltas} />
        )}

        <GenreRadar gaps={phase6} />

        <ArrangementAdvisor fixes={fixes7} violations={violations7} />

        <ExpertsPanel jobId={id!} />
      </main>
    </div>
  )
}
