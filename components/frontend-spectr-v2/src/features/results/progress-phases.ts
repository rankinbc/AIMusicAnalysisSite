/* Shared phase constants for the progress surfaces — split from
 * ProgressStoryline.tsx (story 6.3) so the anon /analyze funnel can import
 * the explainers without tripping react-refresh's only-export-components
 * rule on the component file. */

// The 7 base pipeline phases, display-ready names persisted by the worker
// (audio_analysis pipeline PHASE_DEFS). Conditional/extra phases (ALS phase 8,
// "Mix Translation", structure_actor's "Arrangement") and any future rename
// are tolerated: an unrecognized in-flight phase renders as an appended row.
export const BASE_PHASES = [
  'Universal Mix Analysis',
  'Genre Detection',
  'Genre-Specific Scoring',
  'Stem Separation & Clash',
  'Reference Comparison',
  'Gap Analysis',
  'Arrangement Advice',
] as const;

// Story 12.8 (AC3): one-line explainer per phase. Typed against BASE_PHASES so
// a phase rename breaks the build here instead of silently orphaning its copy.
// Story 6.3 reuses these as the anon progress screen's rotating one-liners.
export const PHASE_EXPLAINERS: Record<(typeof BASE_PHASES)[number], string> = {
  'Universal Mix Analysis':
    'loudness, true peak, key, tempo and the measurements every genre shares.',
  'Genre Detection': 'which genre profile your track is judged against.',
  'Genre-Specific Scoring':
    "the measured values scored against that genre's reference ranges.",
  'Stem Separation & Clash': 'where instruments fight for the same frequencies.',
  'Reference Comparison':
    'your mix against a reference track when one is attached.',
  'Gap Analysis': 'the biggest measurable distances from the genre profile.',
  'Arrangement Advice': 'energy and structure over the timeline.',
};
