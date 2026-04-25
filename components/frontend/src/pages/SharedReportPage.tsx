import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import type { PipelineResult } from '../types/api'
import MixScore from '../features/report/MixScore'
import StreamingReadiness from '../features/report/StreamingReadiness'
import FrequencyChart from '../features/report/FrequencyChart'
import CoachPanel from '../features/report/CoachPanel'
import { VerdictsPanel } from '../features/verdicts'
import type { Verdict } from '../types/verdicts'

export default function SharedReportPage() {
  const { token } = useParams<{ token: string }>()
  const [pipeline, setPipeline] = useState<PipelineResult | null>(null)
  const [verdicts, setVerdicts] = useState<Verdict[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) return
    fetch(`/api/reports/share/${token}`)
      .then((r) => {
        if (!r.ok) throw new Error('Report not found')
        return r.json()
      })
      .then((data) => {
        setPipeline(data.result as PipelineResult)
        setVerdicts((data.verdicts as Verdict[]) ?? [])
      })
      .catch(() => setError('Report not found or has been removed.'))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-500 border-t-transparent" />
      </div>
    )
  }

  if (error || !pipeline) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <p className="mb-2 text-2xl font-bold text-red-400">Not Found</p>
          <p className="text-gray-400">{error}</p>
          <Link to="/register" className="mt-4 block text-purple-400 hover:text-purple-300">
            Get your own analysis →
          </Link>
        </div>
      </div>
    )
  }

  const phase1 = pipeline.phases.find((p) => p.phase === 1)?.data ?? {}
  const lufs = (phase1.lufs as number) ?? -23
  const bands = (phase1.bands as Record<string, number>) ?? {}
  const truePeakDb = (phase1.true_peak_db as number) ?? null
  const clippingDetected = (phase1.clipping_detected as boolean) ?? null

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <nav className="flex items-center justify-between border-b border-gray-800 px-8 py-4">
        <span className="font-bold text-purple-400">AI Music Analyzer</span>
        <Link
          to="/register"
          className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-700"
        >
          Get Your Free Analysis
        </Link>
      </nav>

      <main className="mx-auto max-w-5xl space-y-8 p-8">
        <div>
          <h1 className="text-3xl font-bold">Shared Analysis Report</h1>
          <p className="mt-1 text-sm text-gray-500">Shared by another producer</p>
        </div>

        <MixScore
          grade={pipeline.grade}
          score={pipeline.overall_score}
          topFixes={pipeline.top_fixes}
        />

        {pipeline.coached_fixes?.length ? (
          <CoachPanel
            coachName={pipeline.coach_name ?? 'Coach'}
            coachIntro={pipeline.coach_intro ?? ''}
            coachedFixes={pipeline.coached_fixes}
          />
        ) : null}

        <StreamingReadiness
          lufs={lufs}
          truePeakDb={truePeakDb}
          clippingDetected={clippingDetected}
        />

        <FrequencyChart bands={bands} />

        {verdicts.length > 0 && (
          <VerdictsPanel
            jobId="shared"
            sseToken=""
            trackName="Shared track"
            preloadedVerdicts={verdicts}
          />
        )}

        <div className="rounded-2xl bg-gray-900 p-6 text-center">
          <p className="text-lg font-semibold text-white">Want a full analysis of your own track?</p>
          <p className="mt-1 text-gray-400">Sign up free and upload in seconds.</p>
          <Link
            to="/register"
            className="mt-4 inline-block rounded-xl bg-purple-600 px-8 py-3 font-bold text-white transition hover:bg-purple-700"
          >
            Analyze My Track →
          </Link>
        </div>
      </main>
    </div>
  )
}
