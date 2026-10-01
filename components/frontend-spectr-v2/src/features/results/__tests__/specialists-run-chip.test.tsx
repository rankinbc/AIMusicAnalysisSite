// @vitest-environment jsdom
/* The Findings header's "N specialists run" chip opens the Specialist Team
 * modal at its "Already run" list (report surface only). */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { VerdictDto } from '../../../api/types';
import { FixBoard } from '../FixBoard';
import { SpecialistTeamModal } from '../SpecialistTeamModal';
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


function renderBoard(extra: Partial<React.ComponentProps<typeof FixBoard>> = {}) {
  return render(
    <FixBoard
      mode="findings"
      verdicts={[VERDICT]}
      moves={buildMoves({ verdicts: [VERDICT] })}
      committedIds={new Set<string>()}
      onToggleCommit={vi.fn()}
      checkedNoteIds={new Set<string>()}
      onToggleNote={vi.fn()}
      focusId={null}
      onConsumeFocus={vi.fn()}
      onShowFix={vi.fn()}
      onShowFinding={vi.fn()}
      {...extra}
    />,
  );
}

function renderModal(initialView?: 'roster' | 'ran') {
  return render(
    <SpecialistTeamModal
      ranSlugs={new Set(['low_end'])}
      runningSlugs={new Set<string>()}
      foundBySlug={new Map([['low_end', 1]])}
      verdicts={[VERDICT]}
      hasStems={false}
      credits={null}
      onRun={vi.fn()}
      onClose={vi.fn()}
      {...(initialView ? { initialView } : {})}
    />,
  );
}

describe('Findings header "N specialists run" chip', () => {
  it('shows the count with the tooltip and opens on click', () => {
    const onOpen = vi.fn();
    renderBoard({ specialistsRun: { count: 5, onOpen } });
    const chip = screen.getByRole('button', { name: /5 specialists run/ });
    expect(screen.getByRole('tooltip').textContent).toBe(
      'Run more specialists to discover more findings',
    );
    fireEvent.click(chip);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('uses the singular for one specialist', () => {
    renderBoard({ specialistsRun: { count: 1, onOpen: vi.fn() } });
    expect(screen.getByRole('button', { name: /1 specialist run/ })).toBeTruthy();
  });

  it('is absent when not supplied (Listen) and on the Actions board', () => {
    renderBoard();
    expect(screen.queryByText(/specialists? run/)).toBeNull();
    cleanup();
    renderBoard({ mode: 'actions', specialistsRun: { count: 3, onOpen: vi.fn() } });
    expect(screen.queryByText(/specialists? run/)).toBeNull();
  });
});

describe('chip on the empty Findings board', () => {
  it('still offers the chip when nothing surfaced', () => {
    renderBoard({ verdicts: [], moves: [], specialistsRun: { count: 0, onOpen: vi.fn() } });
    expect(screen.getByText('No issues found')).toBeTruthy();
    expect(screen.getByRole('button', { name: /0 specialists run/ })).toBeTruthy();
  });
});

describe('SpecialistTeamModal initialView', () => {
  it("'ran' opens with the Already run list expanded", () => {
    renderModal('ran');
    expect(screen.getByText('Already run').closest('button')?.textContent).toContain('▾');
    expect(document.querySelector('.spec-ranlist')).not.toBeNull();
  });

  it('defaults to the roster with Already run collapsed', () => {
    renderModal();
    expect(document.querySelector('.spec-ranlist')).toBeNull();
  });
});
