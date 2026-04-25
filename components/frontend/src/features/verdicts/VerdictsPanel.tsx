import type { Verdict } from "../../types/verdicts";
import { useVerdictStream } from "./useVerdictStream";
import { VerdictList } from "./VerdictList";
import { SummaryCard } from "./SummaryCard";
import { VerdictSkeleton } from "./VerdictSkeleton";

interface Props {
  jobId: string;
  sseToken: string;
  trackName: string;
  /** When provided, skip streaming and just render these (used for share view). */
  preloadedVerdicts?: Verdict[];
}

export function VerdictsPanel({
  jobId, sseToken, trackName, preloadedVerdicts,
}: Props) {
  // Always call the hook (rules of hooks). When preloadedVerdicts is set, the
  // page may unmount this component entirely; otherwise stream as normal.
  const stream = useVerdictStream(jobId, sseToken);

  const verdicts: Verdict[] = preloadedVerdicts
    ?? (stream.status === "complete"
        ? stream.finalVerdicts
        : [...stream.ruleVerdicts, ...stream.specialistVerdicts]);

  const completedSlugs = new Set(stream.specialistVerdicts.map(v => v.specialist));
  const pendingSlugs = (stream.routingPlan?.specialists_to_run ?? [])
    .map(s => s.name as string)
    .filter(slug => !completedSlugs.has(slug));

  return (
    <div className="space-y-6">
      <SummaryCard verdicts={verdicts} trackName={trackName} />
      <VerdictList verdicts={verdicts} />
      {!preloadedVerdicts && stream.status === "streaming" && pendingSlugs.length > 0 && (
        <div className="space-y-3">
          {pendingSlugs.map(slug => (
            <VerdictSkeleton key={slug} specialist={slug} />
          ))}
        </div>
      )}
      {!preloadedVerdicts && stream.error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded text-sm text-red-900">
          Verdict generation error: {stream.error}
        </div>
      )}
    </div>
  );
}
