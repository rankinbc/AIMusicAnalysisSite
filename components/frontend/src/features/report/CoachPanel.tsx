interface CoachPanelProps {
  coachName: string
  coachIntro: string
  coachedFixes: string[]
}

export default function CoachPanel({ coachName, coachIntro, coachedFixes }: CoachPanelProps) {
  if (!coachedFixes.length) return null

  return (
    <div className="rounded-xl border border-studio-border bg-studio-card p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-studio-sky/20 border border-studio-sky/30 font-metric text-base font-bold text-studio-sky">
          {coachName[0] ?? 'C'}
        </div>
        <div>
          <p className="text-sm font-semibold text-white">{coachName}</p>
          <p className="text-xs text-studio-muted">Mix Coach</p>
        </div>
      </div>
      {coachIntro && (
        <p className="mb-4 text-sm italic text-slate-400 leading-relaxed border-l-2 border-studio-sky/30 pl-3">
          {coachIntro}
        </p>
      )}
      <ol className="space-y-3">
        {coachedFixes.map((fix, i) => (
          <li key={i} className="flex gap-3">
            <span className="mt-0.5 shrink-0 font-metric font-bold text-studio-amber text-sm">{i + 1}.</span>
            <p className="text-sm text-gray-300 leading-relaxed">{fix}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}
