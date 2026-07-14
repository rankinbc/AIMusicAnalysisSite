import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SuggestModeChip, type SuggestModeChipProps } from '../SuggestModeChip';

function render(over: Partial<SuggestModeChipProps> = {}) {
  const props: SuggestModeChipProps = {
    playing: true, abSide: 'draft', submitting: false,
    onToggleAb: () => {}, onSubmit: () => {}, onDiscard: () => {},
    ...over,
  };
  return renderToStaticMarkup(<SuggestModeChip {...props} />);
}

describe('SuggestModeChip (story 11.12)', () => {
  it('renders Submit + Discard + the A/B toggle', () => {
    const html = render();
    expect(html).toContain('SUGGESTING');
    expect(html).toContain('Submit suggestion');
    expect(html).toContain('Discard');
    expect(html).toContain('A/B: hearing DRAFT');
  });

  it('nudges "press play" while paused (AC7)', () => {
    expect(render({ playing: false })).toContain('press play to hear your draft');
    expect(render({ playing: true })).not.toContain('press play to hear your draft');
  });

  it('labels the ORIGINAL side and warns editing is parked (AC8)', () => {
    const html = render({ abSide: 'original' });
    expect(html).toContain('A/B: hearing ORIGINAL');
    expect(html).toContain('flip back to keep editing');
  });

  it('disables BOTH Submit and Discard while the POST is in flight', () => {
    const html = render({ submitting: true });
    // Per-button pins — a whole-markup 'disabled' check would stay green if
    // Discard lost its guard (the submit-vs-discard race).
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Sending…<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Discard<\/button>/);
  });
});
