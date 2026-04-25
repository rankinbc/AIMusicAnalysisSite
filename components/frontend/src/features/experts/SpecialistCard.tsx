import { useState } from 'react'
import ExpertOutput from './ExpertOutput'
import type { SpecialistName } from '../../types/api'
import { SPECIALIST_LABELS } from '../../types/api'

interface Props {
  name: SpecialistName
  recommended?: boolean
  output: string
  loading: boolean
  error?: string
  onRun: () => void
  onCancel: () => void
}

export default function SpecialistCard({
  name, recommended, output, loading, error, onRun, onCancel,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const label = SPECIALIST_LABELS[name]
  const hasOutput = !!output

  return (
    <div className={`rounded-lg border p-4 transition-colors ${
      recommended ? 'border-yellow-500/50 bg-yellow-500/5' : 'border-gray-700 bg-gray-900'
    }`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-100">{label}</span>
          {recommended && (
            <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-400">
              Recommended
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {hasOutput && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-xs text-gray-400 hover:text-gray-200"
            >
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          )}
          {loading ? (
            <button
              onClick={onCancel}
              className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={() => { onRun(); setExpanded(true) }}
              className="rounded bg-purple-600 px-2 py-1 text-xs text-white hover:bg-purple-500"
            >
              {hasOutput ? 'Re-run' : 'Run'}
            </button>
          )}
        </div>
      </div>

      {(expanded || loading) && (
        <ExpertOutput text={output} loading={loading} error={error} />
      )}
    </div>
  )
}
