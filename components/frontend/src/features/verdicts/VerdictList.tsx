import { useMemo, useState } from "react";
import type { Verdict, Severity } from "../../types/verdicts";
import { VerdictCard } from "./VerdictCard";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "blockers", label: "Blockers" },  // critical + severe
  { id: "low_end", label: "Low End" },
  { id: "stereo_phase", label: "Stereo" },
  { id: "loudness", label: "Loudness" },
  { id: "dynamics", label: "Dynamics" },
] as const;
type FilterId = typeof FILTERS[number]["id"];

const BLOCKER_SEVERITIES: Severity[] = ["critical", "severe"];

interface Props {
  verdicts: Verdict[];
}

export function VerdictList({ verdicts }: Props) {
  const [active, setActive] = useState<FilterId>("all");

  const filtered = useMemo(() => {
    if (active === "all") return verdicts;
    if (active === "blockers")
      return verdicts.filter(v => BLOCKER_SEVERITIES.includes(v.severity));
    return verdicts.filter(v => v.category === active);
  }, [verdicts, active]);

  return (
    <section>
      <div className="flex gap-2 flex-wrap mb-4">
        {FILTERS.map(f => (
          <button
            key={f.id}
            type="button"
            onClick={() => setActive(f.id)}
            className={`text-xs px-3 py-1 rounded-full border ${
              active === f.id
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No verdicts in this filter.</p>
        ) : (
          filtered.map(v => <VerdictCard key={v.verdict_id} verdict={v} />)
        )}
      </div>
    </section>
  );
}
