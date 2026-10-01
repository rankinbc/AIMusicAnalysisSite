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

function tab(name: RegExp) {
  return screen.getByRole('tab', { name });
}

describe('SpecialistTeamModal initialView', () => {
  it("'ran' opens on the Already run tab", () => {
    renderModal('ran');
    expect(tab(/Already run/).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toContain('Low End');
  });

  it('defaults to a group tab', () => {
    renderModal();
    expect(tab(/Already run/).getAttribute('aria-selected')).toBe('false');
    expect(tab(/Spectrum/).getAttribute('aria-selected')).toBe('true');
  });
});

describe('SpecialistTeamModal tabs', () => {
  function renderRoster(opts: { running?: string[]; onRun?: () => void } = {}) {
    const onRun = opts.onRun ?? vi.fn();
    render(
      <SpecialistTeamModal
        ranSlugs={new Set(['low_end'])}
        runningSlugs={new Set(opts.running ?? [])}
        foundBySlug={new Map([['low_end', 1]])}
        suggestedSlugs={new Set(['spatial'])}
        verdicts={[VERDICT]}
        hasStems={false}
        credits={null}
        onRun={onRun}
        onClose={vi.fn()}
      />,
    );
    return onRun;
  }

  it('opens on the tab holding a recommended specialist, which is highlighted', () => {
    renderRoster();
    expect(tab(/Stereo/).getAttribute('aria-selected')).toBe('true');
    expect(tab(/Stereo/).className).toContain('rec');
    const rows = screen.getByRole('tabpanel').querySelectorAll('.spec-ranrow');
    // Recommended sorts to the top of its tab.
    expect(rows[0]?.textContent).toContain('Spatial');
    expect(rows[0]?.className).toContain('rec');
    expect(rows[0]?.textContent).toContain('Recommended for this track');
  });

  it('switching tabs shows that group; a run specialist shows its findings', () => {
    renderRoster();
    fireEvent.click(tab(/Spectrum/));
    const row = screen.getByRole('button', { name: /Low End/ });
    expect(row.textContent).toContain('Sub is masking the kick');
    expect(row.textContent).toContain('1 finding');
  });

  it('pins running specialists at the top and first in their tab', () => {
    renderRoster({ running: ['dynamics', 'humanization'] });
    expect(screen.getByText('Running now')).toBeTruthy();
    const pinned = document.querySelector('.spec-running')?.textContent ?? '';
    expect(pinned).toContain('Dynamics');
    expect(pinned).toContain('Humanization');
    fireEvent.click(tab(/^Dynamics/));
    const rows = screen.getByRole('tabpanel').querySelectorAll('.spec-ranrow');
    expect(rows[0]?.textContent).toContain('Dynamics');
    expect(rows[1]?.textContent).toContain('Humanization');
  });

  it('has no Running now section when nothing runs', () => {
    renderRoster();
    expect(screen.queryByText('Running now')).toBeNull();
  });

  it('selecting a row arms the run button', () => {
    const onRun = renderRoster();
    fireEvent.click(tab(/^Dynamics/));
    fireEvent.click(screen.getByRole('button', { name: /^Dynamics.*Not run yet/ }));
    fireEvent.click(screen.getByRole('button', { name: /Run · 1 cr/ }));
    expect(onRun).toHaveBeenCalledWith('dynamics');
  });
});
