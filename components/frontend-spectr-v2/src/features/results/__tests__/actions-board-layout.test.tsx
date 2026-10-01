// @vitest-environment jsdom
/* Owner ask (2026-10-01): on the report's Actions board the list must start at
 * the TOP of the section — the "N queued" bar and the "What this adds up to"
 * panel used to stack above it (and pushed the fix detail down too). They now
 * live in a compact footer UNDER the list, and the merged chain is a single
 * expandable line. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { VerdictDto } from '../../../api/types';
import { FixBoard } from '../FixBoard';
import { MergedChainPanel } from '../MergedChainPanel';
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
  where: null, refines: null,
  priorityBase: null, priorityCategoryWeight: null, priorityScopeMultiplier: null,
  scope: null, createdAt: '2026-09-19T00:00:00Z',
  userState: { dismissed: false, applied: false, feedback: null },
};
const MOVES = buildMoves({ verdicts: [VERDICT] });
// A limiter op compiles to a rack device, so the merged line has a device name.
const LIMITER: VerdictDto = {
  ...VERDICT, id: 'v2', problemId: 'p2',
  fix: {
    target: { name: 'Master bus' },
    expected_outcome: 'Peaks stay under -1 dBTP.',
    dsp_chain: [{ type: 'limiter', params: { ceiling_db: -1 } }],
  },
};
const LIMITER_MOVES = buildMoves({ verdicts: [LIMITER] });

function renderBoard(extra: Partial<React.ComponentProps<typeof FixBoard>> = {}) {
  return render(
    <FixBoard
      mode="actions"
      verdicts={[VERDICT]}
      moves={MOVES}
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

describe('Actions board layout', () => {
  it('the list header is the first thing in the list column; the footer comes after the rows', () => {
    const { container } = renderBoard({ listFooter: <div data-testid="qfoot">5 queued</div> });
    const list = container.querySelector('.fixboard > .fb-list')!;
    expect(list.firstElementChild?.classList.contains('fb-lh')).toBe(true);
    const row = container.querySelector('.fb-row')!;
    const foot = screen.getByTestId('qfoot');
    expect(list.contains(foot)).toBe(true);
    // DOCUMENT_POSITION_FOLLOWING: the footer renders after the action rows.
    expect(row.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the board is exactly [list, detail] and the detail opens on its content, no empty boxes above', () => {
    const { container } = renderBoard({ listFooter: <span>x</span> });
    const kids = [...container.querySelector('.fixboard')!.children];
    expect(kids.map((k) => k.className.split(' ')[0])).toEqual(['fb-list', 'fb-detail']);
    const first = container.querySelector('.fb-detail .fbd-scroll')!.firstElementChild!;
    expect(first.className).toBe('fbd-toplab');
    expect(first.textContent).toBe('Fix');
  });

  it('renders no footer container when none is given (Listen surface unchanged)', () => {
    const { container } = renderBoard({ surface: 'listen' });
    expect(container.querySelector('.fb-lfoot')).toBeNull();
  });

  it('Select all sits on the title row, not among the filters', () => {
    const { container } = renderBoard();
    const btn = screen.getByText('Select all');
    expect(btn.parentElement?.classList.contains('fb-lh')).toBe(true);
    expect(container.querySelector('.fb-filters')?.contains(btn)).toBe(false);
  });
});

describe('MergedChainPanel (one-line queue summary)', () => {
  it('collapsed: one line with the queued count and device names; details on demand', () => {
    render(<MergedChainPanel committed={LIMITER_MOVES} />);
    const line = screen.getByRole('button', { expanded: false });
    expect(line.textContent).toContain('1 queued');
    expect(line.textContent).toMatch(/limiter/i);
    expect(screen.queryByText(/What this adds up to/)).toBeNull();
    fireEvent.click(line);
    expect(screen.getByText(/What this adds up to/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /1 queued/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('queued moves that compile to no rack device: just the count, no expander', () => {
    render(<MergedChainPanel committed={MOVES} />);
    expect(screen.getByText('1 queued')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('empty queue: a single hint line, no expander', () => {
    render(<MergedChainPanel committed={[]} />);
    expect(screen.getByText('Queue fixes to unlock these')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
