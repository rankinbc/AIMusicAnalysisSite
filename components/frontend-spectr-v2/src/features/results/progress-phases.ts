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

// ── Fix round 1 (C1) ─────────────────────────────────────────────────────
// A row's `label` is display copy; its `matchKey` is the LITERAL string the
// worker's progress_cb emits (see audio_analysis/pipeline.py). The two must
// never be conflated — that conflation was the bug: the ALS row's label is
// "Ableton Project Analysis" but the worker always emits "ALS Analysis"
// (pipeline.py ~260, ~266, ~314, ~321), for EVERY job, .als or not. Rows
// with no real worker phase behind them (Per-Stem Analysis) carry no
// matchKey and are never matched.
export const ALS_PHASE_LABEL = 'Ableton Project Analysis';
/** Literal worker string for phase 8 (pipeline.py ~260/~266/~314/~321). */
export const ALS_MATCH_KEY = 'ALS Analysis';
/** Literal worker string for phase 4 (pipeline.py PHASE_DEFS[3]) — the same
 *  regardless of hasStems; only the display label changes with stems. */
export const CLASH_MATCH_KEY = 'Stem Separation & Clash';

// Canonical worker phase-callback sequence, in phaseIndex order (0-7) — every
// entry is a literal string the worker emits, never a display label.
// ProgressStorylineView matches `currentPhase` against this array, not
// against any row's `label`.
export const PHASE_MATCH_SEQUENCE = [...BASE_PHASES, ALS_MATCH_KEY] as const;

const CLASH_NO_STEMS_EXPLAINER = 'where parts of your mix compete for the same frequencies.';
const ALS_RUNS_EXPLAINER = 'naming the exact tracks and devices in your Ableton project.';

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
  /** The literal worker progress_cb string this row corresponds to — only
   *  set on 'runs' rows that map to a real analysis step (see the C1 note
   *  above). Never equal to `label` when the two diverge (the ALS row). */
  matchKey?: string;
  /** One-line explainer, only on 'runs' rows — feeds both the anon /analyze
   *  rotating line and the "How analysis works" block so neither surface
   *  describes a phase differently from how it actually ran. */
  explainer?: string;
}

export function buildProgressPlan({
  hasStems,
  hasReference,
  hasAls,
}: ProgressPlanInputs): ProgressRow[] {
  const rows: ProgressRow[] = [
    {
      key: 'universal-mix',
      label: 'Universal Mix Analysis',
      kind: 'runs',
      phaseIndex: 0,
      matchKey: 'Universal Mix Analysis',
      explainer: PHASE_EXPLAINERS['Universal Mix Analysis'],
    },
    {
      key: 'genre-detection',
      label: 'Genre Detection',
      kind: 'runs',
      phaseIndex: 1,
      matchKey: 'Genre Detection',
      explainer: PHASE_EXPLAINERS['Genre Detection'],
    },
    {
      key: 'genre-scoring',
      label: 'Genre-Specific Scoring',
      kind: 'runs',
      phaseIndex: 2,
      matchKey: 'Genre-Specific Scoring',
      explainer: PHASE_EXPLAINERS['Genre-Specific Scoring'],
    },
    hasStems
      ? {
          key: 'clash',
          label: 'Stem Analysis & Clash',
          kind: 'runs',
          phaseIndex: 3,
          matchKey: CLASH_MATCH_KEY,
          explainer: PHASE_EXPLAINERS['Stem Separation & Clash'],
        }
      : {
          key: 'clash',
          label: 'Frequency Clash Check',
          kind: 'runs',
          phaseIndex: 3,
          matchKey: CLASH_MATCH_KEY,
          explainer: CLASH_NO_STEMS_EXPLAINER,
        },
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
      ? {
          key: 'reference',
          label: 'Reference Comparison',
          kind: 'runs',
          phaseIndex: 4,
          matchKey: 'Reference Comparison',
          explainer: PHASE_EXPLAINERS['Reference Comparison'],
        }
      : {
          key: 'reference',
          label: 'Reference Comparison',
          kind: 'not-included',
          benefit:
            'Add a reference track to see how your mix measures up to a record you love: loudness, tone and width, side by side.',
        },
  );

  rows.push(
    {
      key: 'gap-analysis',
      label: 'Gap Analysis',
      kind: 'runs',
      phaseIndex: 5,
      matchKey: 'Gap Analysis',
      explainer: PHASE_EXPLAINERS['Gap Analysis'],
    },
    {
      key: 'arrangement',
      label: 'Arrangement Advice',
      kind: 'runs',
      phaseIndex: 6,
      matchKey: 'Arrangement Advice',
      explainer: PHASE_EXPLAINERS['Arrangement Advice'],
    },
  );

  rows.push(
    hasAls
      ? {
          key: 'als',
          label: ALS_PHASE_LABEL,
          kind: 'runs',
          phaseIndex: 7,
          matchKey: ALS_MATCH_KEY,
          explainer: ALS_RUNS_EXPLAINER,
        }
      : {
          key: 'als',
          label: ALS_PHASE_LABEL,
          kind: 'not-included',
          benefit:
            'Add your Ableton project (.als) to get advice that names your actual tracks and devices.',
        },
  );

  return rows;
}
