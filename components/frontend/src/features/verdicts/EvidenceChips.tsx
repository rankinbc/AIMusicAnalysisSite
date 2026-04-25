import type { Evidence } from "../../types/verdicts";

export function EvidenceChips({ evidence }: { evidence: Evidence[] }) {
  if (evidence.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {evidence.map((e, i) => (
        <span
          key={`${e.metric}-${i}`}
          title={`${e.metric}${e.value !== null && e.value !== undefined ? ` = ${e.value}` : ""}`}
          className="inline-block bg-slate-100 border border-slate-300 rounded px-2 py-0.5 text-xs"
        >
          {e.label}
        </span>
      ))}
    </div>
  );
}
