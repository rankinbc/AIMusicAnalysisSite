// @vitest-environment jsdom
/* Spec D2/D9: the same board, mounted on Listen, must offer no way to write
 * server state and must not tell the reader to go to the page they are on.
 * The report surface stays exactly as it was. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { VerdictDto } from '../../../api/types';
import { FixBoard } from '../FixBoard';
import { buildMoves, type Move } from '../move-model';

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

const MOVES: Move[] = buildMoves({ verdicts: [VERDICT] });

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

describe('FixBoard surface="report" (unchanged)', () => {
  it('keeps the server-write actions and the send-to-Listen copy', () => {
    renderBoard({
      onAskCoach: vi.fn(), onIgnore: vi.fn(), onMarkApplied: vi.fn(), onRate: vi.fn(),
    });
    expect(screen.getByText('Mark applied')).toBeTruthy();
    expect(screen.getByText('Rate this Suggestion')).toBeTruthy();
    expect(screen.getByText('Add to fix rack')).toBeTruthy();
    expect(screen.getByText('Add to apply live on the Listen page')).toBeTruthy();
  });
});

describe('FixBoard surface="listen"', () => {
  it('offers no server-state write at all', () => {
    renderBoard({ surface: 'listen' });
    expect(screen.queryByText('Mark applied')).toBeNull();
    expect(screen.queryByText('Rate this Suggestion')).toBeNull();
    expect(screen.queryByText(/Ask the coach about this/i)).toBeNull();
  });

  it('applies to the rack instead of queueing for a page you are already on', () => {
    renderBoard({ surface: 'listen' });
    expect(screen.getByText('Apply live')).toBeTruthy();
    expect(screen.getByText('Apply it to hear it on the rack now')).toBeTruthy();
    expect(screen.queryByText(/Listen page/)).toBeNull();
  });

  it('shows the jump affordance only when the finding carries a range', () => {
    const go = vi.fn();
    renderBoard({
      surface: 'listen',
      seek: { label: (v) => (v.where?.start_seconds != null ? '1:23–1:41' : null), go },
    });
    const chip = screen.getByTitle('Jump to this moment in the track');
    expect(chip.textContent).toContain('1:23–1:41');
    // F5 — the visible text is a bare timestamp and `title` is not a name.
    expect(chip.getAttribute('aria-label')).toBe('Jump to 1:23–1:41');
    chip.click();
    expect(go).toHaveBeenCalledWith(VERDICT);
  });

  it('renders nothing at all when the finding has no range', () => {
    renderBoard({ surface: 'listen', seek: { label: () => null, go: vi.fn() } });
    expect(screen.queryByTitle('Jump to this moment in the track')).toBeNull();
  });

  // The FINDINGS detail pane is a different component (FindingDetail) fed by a
  // different prop-thread inside FixBoard — pin it too, or a dropped
  // `surface`/`seek` there would pass every test above.
  it('findings mode: same gating — seek chip present, ask-the-coach gone', () => {
    const go = vi.fn();
    renderBoard({
      mode: 'findings',
      surface: 'listen',
      seek: { label: (v) => (v.where?.start_seconds != null ? '1:23–1:41' : null), go },
    });
    const chip = screen.getByTitle('Jump to this moment in the track');
    expect(chip.textContent).toContain('1:23–1:41');
    expect(chip.getAttribute('aria-label')).toBe('Jump to 1:23–1:41'); // F5, FindingDetail too
    chip.click();
    expect(go).toHaveBeenCalledWith(VERDICT);
    expect(screen.queryByText(/Ask the coach/i)).toBeNull();
  });

  it('findings mode on the report surface still offers ask-the-coach and no seek chip', () => {
    renderBoard({ mode: 'findings', onAskCoach: vi.fn(), onIgnore: vi.fn() });
    expect(screen.getAllByText(/Ask the coach/i).length).toBeGreaterThan(0);
    expect(screen.queryByTitle('Jump to this moment in the track')).toBeNull();
  });

  // F6 — the fix-less row's report affordances (note checkbox, ignore) are
  // server/report concepts. Pin their ABSENCE on Listen: a dropped `surface`
  // check would otherwise reintroduce a control that writes nothing.
  it('findings mode: a verdict with no fix shows neither a note checkbox nor an ignore icon', () => {
    const noFix: VerdictDto = { ...VERDICT, id: 'v2', problemId: 'p2', fix: null, fixable: false };
    render(
      <FixBoard
        mode="findings"
        surface="listen"
        verdicts={[noFix]}
        moves={buildMoves({ verdicts: [noFix] })}
        committedIds={new Set<string>()}
        onToggleCommit={vi.fn()}
        checkedNoteIds={new Set<string>()}
        onToggleNote={vi.fn()}
        focusId={null}
        onConsumeFocus={vi.fn()}
        onShowFix={vi.fn()}
        onShowFinding={vi.fn()}
        onIgnore={vi.fn()}
      />,
    );
    expect(screen.getAllByText('Sub is masking the kick').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.fr-ckbox')).toHaveLength(0);
    expect(screen.queryByText(/Ignore this finding/i)).toBeNull();
  });
});

// F3 — under the D8 carried-preset lock the board only DIMMED its apply
// controls with pointer-events:none. A keyboard user could still focus and
// activate them; the handler no-opped and nothing conveyed the state.
describe('FixBoard applyLocked (F3)', () => {
  it('actions mode: the apply button is really disabled', () => {
    const onToggleCommit = vi.fn();
    renderBoard({ surface: 'listen', applyLocked: true, onToggleCommit });
    const apply = screen.getByText('Apply live').closest('button');
    expect(apply?.disabled).toBe(true);
    apply?.click();
    expect(onToggleCommit).not.toHaveBeenCalled();
  });

  it('actions mode: the row add control is aria-disabled and inert', () => {
    const onToggleCommit = vi.fn();
    const { container } = renderBoard({ surface: 'listen', applyLocked: true, onToggleCommit });
    const add = container.querySelector('.fr-add') as HTMLElement;
    expect(add.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(add);
    expect(onToggleCommit).not.toHaveBeenCalled();
  });

  it('findings mode: the row checkbox is out of the tab order and Enter does nothing', () => {
    const onToggleCommit = vi.fn();
    const { container } = renderBoard({
      mode: 'findings', surface: 'listen', applyLocked: true, onToggleCommit,
    });
    const ckbox = container.querySelector('.fr-ckbox') as HTMLElement;
    expect(ckbox.getAttribute('aria-disabled')).toBe('true');
    expect(ckbox.getAttribute('tabindex')).toBe('-1');
    fireEvent.keyDown(ckbox, { key: 'Enter' });
    fireEvent.click(ckbox);
    expect(onToggleCommit).not.toHaveBeenCalled();
  });

  it('WITHOUT applyLocked the report surface is byte-for-byte what it was', () => {
    const onToggleCommit = vi.fn();
    const { container } = renderBoard({ mode: 'findings', onToggleCommit });
    const ckbox = container.querySelector('.fr-ckbox') as HTMLElement;
    expect(ckbox.getAttribute('aria-disabled')).toBeNull();
    expect(ckbox.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(ckbox, { key: 'Enter' });
    expect(onToggleCommit).toHaveBeenCalled();
  });
});
