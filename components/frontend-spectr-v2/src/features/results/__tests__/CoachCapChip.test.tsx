import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CoachCapChip } from '../CoachCapChip';

// Story 1.9 / Task 4.5 / UX-DR16 — caps chip.
// Visual rules: chip turns orange (amber) when remaining === 1. ARIA:
// aria-label carries the same `N remaining` cue sighted users get from
// the color (NFR — color never the only channel).

describe('CoachCapChip', () => {
  it('renders default tone at used=0, limit=3 (no remaining-warning)', () => {
    const html = renderToStaticMarkup(<CoachCapChip used={0} limit={3} />);
    // Default tone → bare `.pill` with no additional tone class.
    expect(html).toContain('class="pill"');
    expect(html).not.toContain('class="pill orange"');
    expect(html).toContain('0 of 3 follow-ups · this analysis');
  });

  it('renders orange tone at used=2, limit=3 (1 remaining → amber)', () => {
    const html = renderToStaticMarkup(<CoachCapChip used={2} limit={3} />);
    expect(html).toContain('class="pill orange"');
  });

  it('aria-label includes used/limit/remaining triplet at 1 remaining', () => {
    const html = renderToStaticMarkup(<CoachCapChip used={2} limit={3} />);
    expect(html).toContain(
      'aria-label="Coach follow-ups: 2 used of 3 available, 1 remaining"',
    );
  });

  it('aria-label handles the 0-remaining case (chip still renders)', () => {
    // Gate substitution is a separate concern (CoachGateInline); the chip
    // itself still renders at the limit so screen-reader users hear the
    // status when the input swaps to the gate.
    const html = renderToStaticMarkup(<CoachCapChip used={3} limit={3} />);
    expect(html).toContain(
      'aria-label="Coach follow-ups: 3 used of 3 available, 0 remaining"',
    );
    expect(html).toContain('3 of 3 follow-ups · this analysis');
  });

  it('default tone returns at used=1, limit=3 (2 remaining)', () => {
    // Amber rule is EXACTLY remaining === 1, not "≤ 1".
    const html = renderToStaticMarkup(<CoachCapChip used={1} limit={3} />);
    expect(html).toContain('class="pill"');
    expect(html).not.toContain('class="pill orange"');
  });

  it('renders the status role for the screen-reader announcement', () => {
    const html = renderToStaticMarkup(<CoachCapChip used={0} limit={3} />);
    expect(html).toContain('role="status"');
  });
});
