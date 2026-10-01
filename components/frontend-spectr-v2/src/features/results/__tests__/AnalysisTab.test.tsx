// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FinalJson, VerdictsListResponse } from '../../../api/types';
import { AnalysisTab } from '../AnalysisTab';
import type { InProgressItem } from '../analysis-tab-model';

const fj: FinalJson = {
  coached_fixes: ['I found 13 hard-clipped samples at the master output. Pull the limiter ceiling back 1–2 dB.'],
  phases: [
    { phase: 1, name: 'p1', status: 'ok', data: { lufs: -14.2, bpm: 144, detected_key: 'G#' } },
    { phase: 4, name: 'p4', status: 'ok', data: { clashes: [], stems: {} } },
    { phase: 5, name: 'p5', status: 'ok', data: { status: 'skipped' } },
    { phase: 8, name: 'p8', status: 'skipped', data: {} },
  ],
};

const verdictsData: VerdictsListResponse = {
  verdicts: [],
  specialists: [{ slug: 'loudness', status: 'idle' }],
  routingPlan: {
    specialistsToRun: [{ name: 'loudness', priority: 1, focus: 'True peak over the ceiling' }],
    skip: [],
    rationale: '',
    estimatedTotalTokens: 0,
  },
};

function renderTab(over: Partial<Parameters<typeof AnalysisTab>[0]> = {}) {
  const onAddInputs = vi.fn();
  render(
    <AnalysisTab
      fj={fj}
      songName="Paper Moon"
      files={undefined}
      verdictsData={verdictsData}
      runningSlugs={new Set()}
      hasStems={false}
      inProgress={[]}
      onAddInputs={onAddInputs}
      {...over}
    />,
  );
  return { onAddInputs };
}

afterEach(cleanup);

describe('AnalysisTab', () => {
  it('shows the Still working strip only while something is in progress', () => {
    renderTab();
    expect(screen.queryByRole('status')).toBeNull();
    cleanup();

    const inProgress: InProgressItem[] = [{ key: 'spec:loudness', label: 'Loudness is listening' }];
    renderTab({ inProgress, runningSlugs: new Set(['loudness']) });
    const status = screen.getByRole('status');
    expect(within(status).getByText('Still working')).toBeTruthy();
    expect(within(status).getByText('Loudness is listening')).toBeTruthy();
  });

  it('renders the top tips, and hides the section when there are none', () => {
    renderTab();
    expect(screen.getByRole('heading', { name: /start here/i })).toBeTruthy();
    expect(screen.getByText(/13 hard-clipped samples/)).toBeTruthy();
    cleanup();

    renderTab({ fj: { ...fj, coached_fixes: [], top_fixes: [] } });
    expect(screen.queryByRole('heading', { name: /start here/i })).toBeNull();
  });

  it('opens the matching upload dialog from a missing input', () => {
    const { onAddInputs } = renderTab();
    const stemsRow = screen.getByText('Stems').closest('li')!;
    fireEvent.click(within(stemsRow).getByRole('button', { name: 'Add' }));
    expect(onAddInputs).toHaveBeenCalledWith('stems');
    // The mix is always analyzed — never offered as an add.
    const mixRow = screen.getByText('Mix').closest('li')!;
    expect(within(mixRow).queryByRole('button')).toBeNull();
  });

  it('lists a suggested specialist with its triage focus', () => {
    renderTab();
    const specs = screen.getByRole('heading', { name: 'Specialists' }).closest('section')!;
    expect(within(specs).getByText('Loudness')).toBeTruthy();
    expect(within(specs).getByText('suggested')).toBeTruthy();
    expect(within(specs).getByText('True peak over the ceiling')).toBeTruthy();
  });
});
