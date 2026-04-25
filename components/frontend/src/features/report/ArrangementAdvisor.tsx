interface ArrangementIssue {
  severity: string
  message: string
  section: string | null
  fix_suggestion: string
}

interface SectionScoreItem {
  section_type: string
  start_time: number
  end_time: number
  duration: number
  bars: number
  score: number
  time_range: string
  eight_bar_compliant: boolean
}

interface Props {
  // Rich ArrangementScore shape (new)
  overall_score?: number
  grade?: string
  suggestions?: string[]
  issues?: ArrangementIssue[]
  section_scores?: SectionScoreItem[]
  metadata?: {
    total_bars?: number
    section_count?: number
    detected_tempo?: number | null
    energy_contrast_db?: number | null
    has_intro?: boolean
    has_drop?: boolean
    has_breakdown?: boolean
    has_outro?: boolean
    has_buildup?: boolean
  }
  // Backward-compat (old shape, also present in new shape)
  fixes?: string[]
  violations?: string[]
}

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: 'text-red-400',
  WARNING: 'text-orange-300',
  SUGGESTION: 'text-blue-300',
}

const SECTION_COLOR: Record<string, string> = {
  intro: 'bg-slate-600',
  buildup: 'bg-cyan-700',
  drop: 'bg-orange-600',
  breakdown: 'bg-violet-700',
  outro: 'bg-gray-600',
  unknown: 'bg-gray-700',
}

export default function ArrangementAdvisor(props: Props) {
  const { overall_score, grade, suggestions, issues, section_scores, metadata, fixes, violations } = props

  const hasRichData = overall_score !== undefined && grade !== undefined
  const displayFixes = suggestions ?? fixes ?? []
  const displayViolations = violations ?? []

  if (!hasRichData && !displayFixes.length && !displayViolations.length) {
    return (
      <div className="rounded-xl border border-studio-border bg-studio-card px-5 py-4">
        <p className="text-sm text-green-400">Arrangement looks good — no structural issues found.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-studio-border bg-studio-card p-5 space-y-4">
      {/* Score header (rich mode only) */}
      {hasRichData && (
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold text-white">{Math.round(overall_score!)}</span>
          <span className={`text-lg font-bold ${
            grade === 'A' ? 'text-green-400' :
            grade === 'B' ? 'text-cyan-400' :
            grade === 'C' ? 'text-yellow-400' :
            grade === 'D' ? 'text-orange-400' : 'text-red-400'
          }`}>{grade}</span>
          <span className="text-xs text-studio-muted">Arrangement Score</span>
          {metadata?.energy_contrast_db != null && (
            <span className="ml-auto text-xs text-studio-muted">
              Energy contrast: {metadata.energy_contrast_db.toFixed(1)} dB
            </span>
          )}
        </div>
      )}

      {/* Section timeline (rich mode) */}
      {section_scores && section_scores.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-studio-muted">Section Timeline</p>
          <div className="flex gap-1 rounded overflow-hidden h-6">
            {section_scores.map((s, i) => (
              <div
                key={i}
                className={`${SECTION_COLOR[s.section_type] ?? 'bg-gray-700'} flex items-center justify-center`}
                style={{ flex: s.duration }}
                title={`${s.section_type} — ${s.bars} bars (${s.time_range})`}
              >
                <span className="text-white text-xs font-medium truncate px-1">{s.section_type.slice(0, 3)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Issues (rich mode) */}
      {issues && issues.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-studio-muted">Issues</p>
          <ul className="space-y-1.5">
            {issues.map((issue, i) => (
              <li key={i} className="text-sm space-y-0.5">
                <div className="flex items-start gap-2">
                  <span className={`shrink-0 font-metric font-bold ${SEVERITY_COLOR[issue.severity] ?? 'text-gray-400'}`}>!</span>
                  <span className={SEVERITY_COLOR[issue.severity] ?? 'text-gray-300'}>{issue.message}</span>
                </div>
                {issue.fix_suggestion && (
                  <p className="ml-4 text-xs text-studio-muted">{issue.fix_suggestion}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Fallback violations (old shape / no-rich-data mode) */}
      {!hasRichData && displayViolations.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-studio-muted">Structural issues</p>
          <ul className="space-y-1.5">
            {displayViolations.map((v, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-orange-300">
                <span className="mt-0.5 shrink-0 font-metric text-orange-500">!</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Suggestions / fixes */}
      {displayFixes.length > 0 && (
        <div className={(hasRichData && issues && issues.length > 0) || (!hasRichData && displayViolations.length > 0) ? 'border-t border-studio-border pt-4' : ''}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-studio-muted">Recommendations</p>
          <ol className="space-y-1.5">
            {displayFixes.map((fix, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                <span className="shrink-0 font-metric font-bold text-studio-amber">{i + 1}.</span>
                <span>{fix}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
