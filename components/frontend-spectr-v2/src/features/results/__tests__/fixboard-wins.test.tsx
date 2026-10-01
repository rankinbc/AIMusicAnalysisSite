// @vitest-environment jsdom
/* Wins: highlighted green, never a fix (no Actions entry, no apply/note
 * controls, no "Applicable Fix Available" / "Show Suggested Fix"). */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { VerdictDto } from '../../../api/types';
import { FixBoard } from '../FixBoard';
import { buildMoves } from '../move-model';

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


// A win that still carries a fix payload (specialists sometimes attach one).
const WIN: VerdictDto = {
  ...VERDICT,
  id: 'w1',
  problemId: 'pw',
  severity: 'win',
  priorityScore: 200,
  headline: 'Phase-safe and fully mono-compatible',
};

function renderBoard(mode: 'findings' | 'actions', verdicts: VerdictDto[]) {
  return render(
    <FixBoard
      mode={mode}
      verdicts={verdicts}
      moves={buildMoves({ verdicts })}
      committedIds={new Set<string>()}
      onToggleCommit={vi.fn()}
      checkedNoteIds={new Set<string>(['w1'])}
      onToggleNote={vi.fn()}
      focusId={null}
      onConsumeFocus={vi.fn()}
      onShowFix={vi.fn()}
      onShowFinding={vi.fn()}
      onAskCoach={vi.fn()}
    />,
  );
}

function rowFor(headline: string): HTMLElement {
  const row = screen.getAllByText(headline)
    .map((el) => el.closest('.fb-row'))
    .find((el): el is HTMLElement => el != null);
  if (!row) throw new Error(`no row for ${headline}`);
  return row;
}

describe('win findings', () => {
  it('never become moves, even with a fix payload', () => {
    const moves = buildMoves({ verdicts: [VERDICT, WIN] });
    expect(moves.some((m) => m.verdictId === 'w1')).toBe(false);
    expect(moves.some((m) => m.verdictId === 'v1')).toBe(true);
  });

  it('are highlighted green with no apply or note checkbox', () => {
    renderBoard('findings', [VERDICT, WIN]);
    const win = rowFor('Phase-safe and fully mono-compatible');
    expect(win.className).toContain('win');
    expect(win.querySelector('.fr-ckbox')).toBeNull();
    expect(win.textContent).not.toContain('observation');
    const fault = rowFor('Sub is masking the kick');
    expect(fault.className).not.toContain('win');
    expect(fault.querySelector('.fr-ckbox')).not.toBeNull();
  });

  it('show no fix affordances in the detail', () => {
    renderBoard('findings', [VERDICT, WIN]);
    fireEvent.click(rowFor('Phase-safe and fully mono-compatible'));
    expect(screen.queryByText('Applicable Fix Available')).toBeNull();
    expect(screen.queryByText('Show Suggested Fix')).toBeNull();
  });

  it('never appear on the Actions board, even if checked as a note', () => {
    renderBoard('actions', [VERDICT, WIN]);
    expect(screen.queryByText('Phase-safe and fully mono-compatible')).toBeNull();
  });
});
