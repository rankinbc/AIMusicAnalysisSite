// @vitest-environment jsdom
/* Min-priority slider: inline left of the Filter button, default 50. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { VerdictDto } from '../../../api/types';
import { FixBoard } from '../FixBoard';
import { countActiveFilters, DEFAULT_MIN_PRIORITY, EMPTY_FILTERS } from '../fix-board-helpers';

afterEach(cleanup);

const VERDICT: VerdictDto = {
  id: 'v1', analysisId: 'a1', specialist: 'low_end', promptVersion: '1', model: 'test',
  severity: 'critical', category: 'low_end', confidence: 0.8, priorityScore: 120,
  impact: null, chartType: null, headline: 'Sub is masking the kick',
  summary: 'Too much 40 Hz under the kick.', body: null, metricLine: null,
  whyItMatters: null, presetName: null, evidence: null,
  fix: {
    target: { name: 'Master bus' },
    expected_outcome: 'The kick reads again.',
    dsp_chain: [{ type: 'eq', params: { freq: 45, gain_db: -3, q: 1 } }],
  },
  sources: null, problemId: 'p1', kind: 'fault', source: 'rule_engine',
  dataTier: 'audio_only', fixable: true, suspected: false,
  where: { start_seconds: 83, end_seconds: 101 }, refines: null,
  priorityBase: null, priorityCategoryWeight: null, priorityScopeMultiplier: null,
  scope: null, createdAt: '2026-09-19T00:00:00Z',
  userState: { dismissed: false, applied: false, feedback: null },
};


const LOW: VerdictDto = {
  ...VERDICT,
  id: 'v2',
  problemId: 'p2',
  priorityScore: 30,
  severity: 'minor',
  headline: 'Hi-hats a touch bright',
};

function renderBoard(verdicts: VerdictDto[]) {
  return render(
    <FixBoard
      mode="findings"
      verdicts={verdicts}
      moves={[]}
      committedIds={new Set<string>()}
      onToggleCommit={vi.fn()}
      checkedNoteIds={new Set<string>()}
      onToggleNote={vi.fn()}
      focusId={null}
      onConsumeFocus={vi.fn()}
      onShowFix={vi.fn()}
      onShowFinding={vi.fn()}
    />,
  );
}

describe('min-priority slider', () => {
  it('defaults to 50 and is not counted as a menu filter', () => {
    expect(DEFAULT_MIN_PRIORITY).toBe(50);
    expect(EMPTY_FILTERS.minPriority).toBe(50);
    expect(countActiveFilters(EMPTY_FILTERS)).toBe(0);
  });

  it('sits before the Filter button, hides low findings by default, and can be turned off', () => {
    renderBoard([VERDICT, LOW]);
    const slider = screen.getByRole('slider', { name: 'Minimum priority' }) as HTMLInputElement;
    const filterBtn = screen.getByRole('button', { name: /Filter/ });
    expect(slider.compareDocumentPosition(filterBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slider.value).toBe('50');
    expect(screen.queryByText('Hi-hats a touch bright')).toBeNull();
    expect(screen.getAllByText('Sub is masking the kick').length).toBeGreaterThan(0);

    fireEvent.change(slider, { target: { value: '0' } });
    expect(screen.getAllByText('Hi-hats a touch bright').length).toBeGreaterThan(0);
  });

  it('is not inside the Filter menu any more', () => {
    renderBoard([VERDICT, LOW]);
    fireEvent.click(screen.getByRole('button', { name: /Filter/ }));
    expect(screen.getAllByRole('slider')).toHaveLength(1);
  });
});
