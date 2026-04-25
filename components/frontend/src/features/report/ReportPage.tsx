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

export default function ReportPage() {
  const { id } = useParams<{ id: string }>()
  const [result, setResult] = useState<JobResultResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    api
      .get<JobResultResponse>(`/jobs/${id}/results`)
      .then(({ data }) => setResult(data))
      .catch(() => setError('Failed to load results. Please try again.'))
      .finally(() => setLoading(false))
  }, [id])

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
  const bands = (phase1.bands as Record<string, number>) ?? {}
  const clashes = (phase4.clashes as Record<string, unknown>[]) ?? []
  const deltas = (phase5?.data.deltas as Record<string, unknown>) ?? {}
  const fixes7 = (phase7.fixes as string[]) ?? []
  const violations7 = (phase7.violations as string[]) ?? []

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between border-b border-gray-800 px-8 py-4">
        <span className="font-bold text-purple-400">AI Music Analyzer</span>
        <Link
          to="/upload"
          className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-300 transition hover:bg-gray-700"
        >
          Analyze Another Track
        </Link>
      </nav>

      <main className="mx-auto max-w-5xl space-y-8 p-8">
        <div>
          <h1 className="text-3xl font-bold">Analysis Report</h1>
          <p className="mt-1 text-sm text-gray-500">Job ID: {id}</p>
        </div>

        <MixScore
          grade={pipeline.grade}
          score={pipeline.overall_score}
          topFixes={pipeline.top_fixes}
        />

        <StreamingReadiness lufs={lufs} />

        <FrequencyChart bands={bands} />

        <StemClash clashes={clashes} />

        {phase5 && phase5.status !== 'skipped' && Object.keys(deltas).length > 0 && (
          <ReferenceComparison deltas={deltas} />
        )}

        <GenreRadar gaps={phase6} />

        <ArrangementAdvisor fixes={fixes7} violations={violations7} />
      </main>
    </div>
  )
}
