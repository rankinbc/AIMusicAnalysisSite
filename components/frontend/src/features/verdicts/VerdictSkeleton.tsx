export function VerdictSkeleton({ specialist }: { specialist: string }) {
  return (
    <div className="border border-slate-200 rounded-md p-4 bg-slate-50 animate-pulse">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-5 w-20 bg-slate-200 rounded" />
        <div className="text-xs text-slate-500">{specialist} analyzing…</div>
      </div>
      <div className="h-4 w-3/4 bg-slate-200 rounded mb-2" />
      <div className="h-3 w-1/2 bg-slate-200 rounded" />
    </div>
  );
}
