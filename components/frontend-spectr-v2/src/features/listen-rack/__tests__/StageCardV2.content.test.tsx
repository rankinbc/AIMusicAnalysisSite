/* Spec D6 — the stage box shows ONE of two things, and the visualizer's ghost
 * placeholder only belongs in the box when the box is the visualizer's. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_VIZ, TRACK } from '../data';
import { StageCardV2 } from '../StageCardV2';
import type { LiveMeters } from '../useLiveMeters';

afterEach(cleanup);

const METERS: LiveMeters = { lufs: -9.2, tp: -0.8, corr: 0.7, gr: 0, out: -12, clip: false };

function renderStage(props: Partial<React.ComponentProps<typeof StageCardV2>> = {}) {
  return render(
    <StageCardV2
      playing={false}
      onPlay={vi.fn()}
      position={0}
      duration={240}
      onSeek={vi.fn()}
      mod={{}}
      order={[]}
      bypass={false}
      meters={METERS}
      stageHeight={210}
      showMeters={false}
      notes={TRACK.notes}
      activeNote={null}
      onNote={vi.fn()}
      showNotes={false}
      section={null}
      bpm={128}
      keyLabel="A#"
      getFrame={null}
      viz={DEFAULT_VIZ}
      stages={['eq']}
      setStages={vi.fn()}
      director={undefined}
      activeModules={[]}
      trackName="Neon Skyline"
      trackSub="Listen session"
      stageContent="findings"
      onStageContentChange={vi.fn()}
      bgViz={false}
      onBgVizChange={vi.fn()}
      findings={<div data-testid="board">the board</div>}
      {...props}
    />,
  );
}

describe('StageCardV2 stage content', () => {
  it('shows the board and marks the card, with no ghost placeholder', () => {
    const { container } = renderStage();
    expect(screen.getByTestId('board')).toBeTruthy();
    expect(container.querySelector('.lr-stagecard')?.getAttribute('data-stage')).toBe('findings');
    expect(container.querySelector('.lr-vizbg-ghost')).toBeNull();
  });

  it('switching to the visualizer swaps the box back', () => {
    const onStageContentChange = vi.fn();
    renderStage({ onStageContentChange });
    fireEvent.click(screen.getByRole('button', { name: 'Visualizer' }));
    expect(onStageContentChange).toHaveBeenCalledWith('visualizer');
  });

  // Ruling L7: "Visualizer" shows the visualizer IN THE BOX. The persisted
  // bgViz pref is about the FINDINGS view ("visuals behind the board"); letting
  // it drive this view too meant a first visit clicking "Visualizer" got the
  // frosted "playing in the background" placeholder and no visualizer.
  it('the visualizer view is IN THE BOX even with the background pref on', () => {
    const { container } = renderStage({ stageContent: 'visualizer', bgViz: true });
    expect(container.querySelector('.lr-vizbg-ghost')).toBeNull();
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(container.querySelector('.lr-stagecard')?.getAttribute('data-stage'))
      .toBe('visualizer');
    expect(screen.queryByTestId('board')).toBeNull();
  });

  it('its placement control sends the visuals back for THIS SESSION only', () => {
    const onBgVizChange = vi.fn();
    const { container } = renderStage({ stageContent: 'visualizer', bgViz: false, onBgVizChange });
    fireEvent.click(screen.getByTitle('Play full-screen in the background'));
    expect(container.querySelector('.lr-vizbg-ghost')).not.toBeNull();
    expect(onBgVizChange).not.toHaveBeenCalled(); // never persisted
  });

  it('without a findings node the content switch never appears (demo route)', () => {
    renderStage({ findings: undefined, stageContent: 'visualizer' });
    expect(screen.queryByRole('button', { name: 'Findings' })).toBeNull();
  });

  it('the stage content switch is a pressed-state group, not an unmanaged tablist', () => {
    renderStage();
    const group = screen.getByRole('group', { name: 'Stage content' });
    const findingsBtn = screen.getByRole('button', { name: 'Findings' });
    expect(group.contains(findingsBtn)).toBe(true);
    expect(findingsBtn.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Visualizer' }).getAttribute('aria-pressed'))
      .toBe('false');
  });

  it('the findings board is wrapped in .lr-findings-stage under data-stage="findings"', () => {
    const { container } = renderStage();
    const card = container.querySelector('.lr-stagecard');
    expect(card?.getAttribute('data-stage')).toBe('findings');
    const wrapper = card?.querySelector('.lr-findings-stage');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector('[data-testid="board"]')).not.toBeNull();
  });

  it('clicking the placement button in the findings context toggles bgViz', () => {
    const onBgVizChange = vi.fn();
    renderStage({ bgViz: false, onBgVizChange });
    fireEvent.click(screen.getByTitle('Play the visualizer full-screen behind the page'));
    expect(onBgVizChange).toHaveBeenCalledWith(true);
  });

  // VizStage owns a spectrogram trail buffer + particle refs, and in bgMode it
  // portals its canvas to document.body — a two-branch render (Findings vs.
  // Visualizer as structurally different subtrees) would unmount/remount all
  // of that on every switch. VizStage must be rendered from ONE call site so
  // React's positional reconciliation preserves it across the switch.
  // Ruling L7 moved the visualizer view in-box by default, so the node survives
  // only where bgMode stays ON across the switch: visualizer-in-background →
  // findings-with-background. (The reverse, findings-background → visualizer-
  // in-box, is a legitimate remount now — bgMode really does change.)
  it('VizStage keeps the same DOM node when the background survives the switch', () => {
    const { rerender } = renderStage({ stageContent: 'visualizer', bgViz: true });
    fireEvent.click(screen.getByTitle('Play full-screen in the background'));
    const before = document.body.querySelector('canvas');
    expect(before).not.toBeNull();

    rerender(
      <StageCardV2
        playing={false}
        onPlay={vi.fn()}
        position={0}
        duration={240}
        onSeek={vi.fn()}
        mod={{}}
        order={[]}
        bypass={false}
        meters={METERS}
        stageHeight={210}
        showMeters={false}
        notes={TRACK.notes}
        activeNote={null}
        onNote={vi.fn()}
        showNotes={false}
        section={null}
        bpm={128}
        keyLabel="A#"
        getFrame={null}
        viz={DEFAULT_VIZ}
        stages={['eq']}
        setStages={vi.fn()}
        director={undefined}
        activeModules={[]}
        trackName="Neon Skyline"
        trackSub="Listen session"
        stageContent="findings"
        onStageContentChange={vi.fn()}
        bgViz
        onBgVizChange={vi.fn()}
        findings={<div data-testid="board">the board</div>}
      />,
    );
    const after = document.body.querySelector('canvas');
    expect(after).not.toBeNull();
    expect(after).toBe(before);
  });
});
