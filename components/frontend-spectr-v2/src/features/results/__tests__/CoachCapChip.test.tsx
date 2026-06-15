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

  it('aria-label embeds visible text + remaining cue (WCAG 2.5.3, review-fix P14)', () => {
    // review-fix P14: aria-label must contain the visible text verbatim
    // so screen-reader content matches the visual chip (Label in Name).
    // The remaining cue is appended after the visible text.
    const html = renderToStaticMarkup(<CoachCapChip used={2} limit={3} />);
    expect(html).toContain(
      'aria-label="2 of 3 follow-ups · this analysis, 1 remaining"',
    );
  });

  it('aria-label handles the 0-remaining case (chip still renders)', () => {
    // Gate substitution is a separate concern (CoachGateInline); the chip
    // itself still renders at the limit so screen-reader users hear the
    // status when the input swaps to the gate.
    const html = renderToStaticMarkup(<CoachCapChip used={3} limit={3} />);
    expect(html).toContain(
      'aria-label="3 of 3 follow-ups · this analysis, 0 remaining"',
    );
    expect(html).toContain('3 of 3 follow-ups · this analysis');
  });

  it('default tone returns at used=1, limit=3 (2 remaining)', () => {
    // Amber rule is EXACTLY remaining === 1, not "≤ 1".
    const html = renderToStaticMarkup(<CoachCapChip used={1} limit={3} />);
    expect(html).toContain('class="pill"');
    expect(html).not.toContain('class="pill orange"');
  });

  it('does NOT carry role="status" (review-fix P13 — no spurious live-region announcements)', () => {
    // role="status" is an implicit aria-live region; the chip re-renders
    // on every successful POST and would announce repeatedly mid-stream.
    // The aria-label alone (WCAG 2.5.3) is the SR cue.
    const html = renderToStaticMarkup(<CoachCapChip used={0} limit={3} />);
    expect(html).not.toContain('role="status"');
  });
});
