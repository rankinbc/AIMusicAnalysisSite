// ── Wave-3 E6.3/E6.4/E6.5 — provenance handles threaded from the route ─────
/** The song's latest report — powers "View Report" + the coach hand-off link. */
export interface ReportRef { songId: string; jobId: string }
/** Which analysis feeds the Stats rail (E6.3 mismatch labeling). */
export interface StatsSource { mismatch: boolean; versionNumber: number | null }
