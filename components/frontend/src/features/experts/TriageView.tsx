import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { TriageResult, SpecialistName } from '../../types/api'
import { SPECIALIST_LABELS } from '../../types/api'
import SpecialistCard from './SpecialistCard'
import type { ExpertAnalysisState } from './useExpertAnalysis'

interface Props {
  triage: TriageResult
  state: ExpertAnalysisState
  showAll: boolean
  onShowAll: () => void
}

export default function TriageView({ triage, state, showAll, onShowAll }: Props) {
  const { recommended_specialists } = triage
  const [triageExpanded, setTriageExpanded] = useState(false)

  const specialistsToShow = showAll
    ? (Object.keys(SPECIALIST_LABELS) as SpecialistName[])
    : (recommended_specialists as SpecialistName[])

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-white">Triage Report</h3>
          <button
            onClick={() => setTriageExpanded(e => !e)}
            className="text-xs text-gray-400 hover:text-gray-200"
          >
            {triageExpanded ? 'Collapse' : 'Show full report'}
          </button>
        </div>
        {triageExpanded && (
          <div className="prose prose-sm prose-invert mt-3 max-w-none rounded-md bg-gray-800 p-4 text-xs">
            <ReactMarkdown>{triage.text}</ReactMarkdown>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-white">
            {showAll ? 'All Specialists' : `Recommended (${recommended_specialists.length})`}
          </h3>
          {!showAll && (
            <button
              onClick={onShowAll}
              className="text-xs text-gray-400 hover:text-gray-200"
            >
              Show all 23 →
            </button>
          )}
        </div>

        {specialistsToShow.map(name => (
          <SpecialistCard
            key={name}
            name={name as SpecialistName}
            recommended={recommended_specialists.includes(name)}
            output={state.specialistOutputs[name as SpecialistName] ?? ''}
            loading={state.specialistLoading[name as SpecialistName] ?? false}
            error={state.specialistErrors[name as SpecialistName]}
            onRun={() => state.runSpecialist(name as SpecialistName)}
            onCancel={() => state.cancelSpecialist(name as SpecialistName)}
          />
        ))}
      </div>
    </div>
  )
}
