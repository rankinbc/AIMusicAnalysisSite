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

// ── Task G0 — an honest progress checklist ──────────────────────────────────
// The checklist must not claim optional analyses (stems, reference, .als) are
// running when the visitor never supplied that input. buildProgressPlan turns
// the three yes/no inputs into the ordered row list the UI renders; rows for
// analyses that didn't run show as "not-included" with a benefit line instead
// of pretending they're in progress.

/** The Ableton-project phase (8th, conditional — only runs with an .als). Not
 *  part of BASE_PHASES (which is the fixed 7-phase base pipeline), but it IS
 *  a literal worker-reported phase name, same as any BASE_PHASES entry. */
export const ALS_PHASE_NAME = 'Ableton Project Analysis';

// Full worker phase-name sequence used to match `currentPhase` against a row:
// the 7 base phases plus the ALS phase. Position is the `phaseIndex` contract
// — display labels below may differ from these names (e.g. "Frequency Clash
// Check" vs "Stem Separation & Clash"), but phaseIndex always ties back here.
export const PHASE_SEQUENCE = [...BASE_PHASES, ALS_PHASE_NAME] as const;

export interface ProgressPlanInputs {
  hasStems: boolean;
  hasReference: boolean;
  hasAls: boolean;
}

export interface ProgressRow {
  key: string;
  label: string;
  kind: 'runs' | 'not-included';
  benefit?: string;
  phaseIndex?: number;
}

export function buildProgressPlan({
  hasStems,
  hasReference,
  hasAls,
}: ProgressPlanInputs): ProgressRow[] {
  const rows: ProgressRow[] = [
    { key: 'universal-mix', label: 'Universal Mix Analysis', kind: 'runs', phaseIndex: 0 },
    { key: 'genre-detection', label: 'Genre Detection', kind: 'runs', phaseIndex: 1 },
    { key: 'genre-scoring', label: 'Genre-Specific Scoring', kind: 'runs', phaseIndex: 2 },
    hasStems
      ? { key: 'clash', label: 'Stem Analysis & Clash', kind: 'runs', phaseIndex: 3 }
      : { key: 'clash', label: 'Frequency Clash Check', kind: 'runs', phaseIndex: 3 },
  ];

  if (!hasStems) {
    rows.push({
      key: 'per-stem',
      label: 'Per-Stem Analysis',
      kind: 'not-included',
      benefit:
        'Upload your stems to see which instruments are fighting each other, with balance and width advice for each one.',
    });
  }

  rows.push(
    hasReference
      ? { key: 'reference', label: 'Reference Comparison', kind: 'runs', phaseIndex: 4 }
      : {
          key: 'reference',
          label: 'Reference Comparison',
          kind: 'not-included',
          benefit:
            'Add a reference track to see how your mix measures up to a record you love: loudness, tone and width, side by side.',
        },
  );

  rows.push(
    { key: 'gap-analysis', label: 'Gap Analysis', kind: 'runs', phaseIndex: 5 },
    { key: 'arrangement', label: 'Arrangement Advice', kind: 'runs', phaseIndex: 6 },
  );

  rows.push(
    hasAls
      ? { key: 'als', label: ALS_PHASE_NAME, kind: 'runs', phaseIndex: 7 }
      : {
          key: 'als',
          label: ALS_PHASE_NAME,
          kind: 'not-included',
          benefit:
            'Add your Ableton project (.als) to get advice that names your actual tracks and devices.',
        },
  );

  return rows;
}
