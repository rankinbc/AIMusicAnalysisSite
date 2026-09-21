import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { PHASE_MATCH_SEQUENCE } from '../progress-phases';

// Fix round 1 (C1) drift guard — progress-phases.ts match keys are matched
// against the worker's LITERAL progress_cb phase strings, never a display
// label (the bug this fix round closes: the ALS row's label is "Ableton
// Project Analysis" but the worker always emits "ALS Analysis" — see
// audio_analysis/pipeline.py ~260, ~266, ~314, ~321). If a worker phase name
// is ever renamed without updating PHASE_MATCH_SEQUENCE, this test fails the
// frontend suite instead of the checklist silently breaking (duplicate rows,
// or a row that never reads "current").
//
// Path is relative to the frontend package root, per the fix brief. No
// try/catch around the read on purpose: an unreadable pipeline.py (e.g. a
// packaged build without the sibling analysis/ package) must FAIL this test,
// not skip it.
const TESTS_DIR = fileURLToPath(new URL('.', import.meta.url));
const PIPELINE_SOURCE = readFileSync(
  join(TESTS_DIR, '../../../../../analysis/src/audio_analysis/pipeline.py'),
  'utf-8',
);

describe('progress-phases match keys vs. the worker pipeline', () => {
  it('every match key appears verbatim as a quoted string literal in pipeline.py', () => {
    for (const key of PHASE_MATCH_SEQUENCE) {
      expect(PIPELINE_SOURCE).toContain(`"${key}"`);
    }
  });
});
