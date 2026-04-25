import type { Verdict } from "../../types/verdicts";

interface Props {
  verdicts: Verdict[];
  trackName: string;
}

export function SummaryCard({ verdicts, trackName }: Props) {
  const top3 = verdicts.slice(0, 3);
  const blockers = verdicts.filter(v => v.severity === "critical" || v.severity === "severe").length;
  const wins = verdicts.filter(v => v.severity === "win").length;
  const ready = blockers === 0;

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-5 mb-6">
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-slate-900">{trackName}</h2>
        <span className={`text-sm font-semibold ${
          ready ? "text-green-700" : "text-red-700"
        }`}>
          {ready ? "✓ Release-ready" : `✗ ${blockers} blocker${blockers === 1 ? "" : "s"}`}
        </span>
      </header>
      <div className="text-xs text-slate-500 mb-3">
        {verdicts.length} findings · {wins} thing{wins === 1 ? "" : "s"} working well
      </div>
      {top3.length > 0 && (
        <>
          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
            Top {top3.length} fix{top3.length === 1 ? "" : "es"}
          </div>
          <ol className="space-y-1.5 list-decimal list-inside text-sm text-slate-800">
            {top3.map(v => <li key={v.verdict_id}>{v.headline}</li>)}
          </ol>
        </>
      )}
    </section>
  );
}
