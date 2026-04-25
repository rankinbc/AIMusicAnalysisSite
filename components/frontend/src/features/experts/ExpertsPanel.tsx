import { useState } from 'react'
import { useExpertAnalysis } from './useExpertAnalysis'
import TriageView from './TriageView'

interface Props {
  jobId: string
}

export default function ExpertsPanel({ jobId }: Props) {
  const state = useExpertAnalysis(jobId)
  const [showAll, setShowAll] = useState(false)

  return (
    <div className="rounded-2xl bg-gray-900 p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">Expert Analysis</h2>
          <p className="mt-1 text-sm text-gray-400">
            Run AI specialists against your analysis for deep-dive fixes.
            Start with Triage to find which experts matter most.
          </p>
        </div>

        {!state.triage && (
          <button
            onClick={state.runTriage}
            disabled={state.triageLoading}
            className="shrink-0 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
          >
            {state.triageLoading ? 'Running triage…' : 'Run Triage'}
          </button>
        )}
      </div>

      {state.triageError && (
        <p className="mb-4 rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">
          {state.triageError}
        </p>
      )}

      {state.triageLoading && !state.triage && (
        <div className="space-y-2">
          <div className="h-4 w-3/4 animate-pulse rounded bg-gray-800" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-gray-800" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-gray-800" />
        </div>
      )}

      {state.triage && (
        <TriageView
          triage={state.triage}
          state={state}
          showAll={showAll}
          onShowAll={() => setShowAll(true)}
        />
      )}
    </div>
  )
}
