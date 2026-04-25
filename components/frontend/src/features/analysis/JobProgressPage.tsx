import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useJobStream } from './useJobStream'

const PHASE_NAMES = [
  'Universal Mix Analysis',
  'Genre Detection',
  'Genre-Specific Scoring',
  'Stem Separation & Clash',
  'Reference Comparison',
  'Gap Analysis',
  'Arrangement Advice',
]

export default function JobProgressPage() {
  // Route uses :id to match the path /jobs/:id defined in App.tsx
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { phase, pct, done, error } = useJobStream(id)

  // Auto-navigate to the report page once analysis is complete
  useEffect(() => {
    if (done && id) {
      const timer = setTimeout(() => navigate(`/jobs/${id}/report`), 500)
      return () => clearTimeout(timer)
    }
  }, [done, id, navigate])

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-2 text-3xl font-bold">Analyzing Your Track</h1>
        <p className="mb-10 text-gray-400">
          Running 7-phase analysis pipeline — this may take a few minutes.
        </p>

        {error && (
          <div className="mb-6 rounded-xl border border-red-700 bg-red-900/30 p-4 text-red-300">
            {error}
          </div>
        )}

        <div className="space-y-4">
          {PHASE_NAMES.map((name, i) => {
            const phaseNum = i + 1
            const isActive = phase === phaseNum
            const isComplete = phase > phaseNum || (done && phase >= phaseNum)
            const barWidth = isActive
              ? Math.round(pct * 100)
              : isComplete
              ? 100
              : 0

            return (
              <div
                key={phaseNum}
                className={`rounded-xl border p-4 transition-all ${
                  isActive
                    ? 'border-purple-500 bg-purple-900/20'
                    : isComplete
                    ? 'border-green-700 bg-green-900/10'
                    : 'border-gray-800 bg-gray-900/50'
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${
                        isComplete
                          ? 'bg-green-600'
                          : isActive
                          ? 'animate-pulse bg-purple-600'
                          : 'bg-gray-700'
                      }`}
                    >
                      {isComplete ? '✓' : phaseNum}
                    </span>
                    <span
                      className={`font-medium ${
                        isActive
                          ? 'text-white'
                          : isComplete
                          ? 'text-green-400'
                          : 'text-gray-500'
                      }`}
                    >
                      {name}
                    </span>
                  </div>
                  {isActive && (
                    <span className="text-sm text-purple-400">
                      {Math.round(pct * 100)}%
                    </span>
                  )}
                </div>
                <div className="h-1.5 w-full rounded-full bg-gray-800">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      isComplete ? 'bg-green-500' : 'bg-purple-500'
                    }`}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>

        {done && (
          <div className="mt-8 text-center">
            <p className="text-lg font-semibold text-green-400">
              Analysis complete! Loading your report…
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
