// The DAW Plan excerpt on "Take it back to your DAW", produced by the app's own
// export generator so it can't drift from the real export format.
import { DEFAULT_EXPORT_OPTS, generateGamePlan } from '../results/export-generator';
import { verdictToMove } from '../results/move-model';
import { buildExamples } from './examples-model';

/** The exported Markdown for the first two worked examples, as the DAW Plan
 *  modal emits it at "Detailed" with track facts and streaming targets off. */
export function buildPlanExcerpt(): string {
  const moves = buildExamples()
    .slice(0, 2)
    .map((e) => verdictToMove(e.verdict));
  const { content } = generateGamePlan(
    {
      format: 'md',
      detail: 'detailed',
      order: 'order',
      opts: { ...DEFAULT_EXPORT_OPTS, facts: false, targets: false, data: false },
      selectedIds: new Set(moves.map((m) => m.id)),
    },
    moves,
    { bpm: null, key: null, lufs: null, genre: null },
    { trackName: 'Demo track' },
  );
  return content.trimEnd();
}
