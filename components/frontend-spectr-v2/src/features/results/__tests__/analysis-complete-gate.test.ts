import { describe, expect, it } from 'vitest';

import { shouldShowAnalysisCompleteModal } from '../analysis-complete-gate';

// D10 addendum (f) — a guest opening the seeded demo report must not see
// the "Analysis complete" modal (its Re-analyze CTA is pointless on a demo
// track, and it overflows at phone width). Gated at the ReportView call
// site — NOT inside AnalysisCompleteModal.tsx/.module.css, which are
// off-limits (another session's uncommitted work). Pure function so the
// decision is testable without mounting ReportView or touching
// sessionStorage/DOM.

describe('shouldShowAnalysisCompleteModal', () => {
  it('shows for a real user on their own track when not yet seen', () => {
    expect(
      shouldShowAnalysisCompleteModal({ wantsToShow: true, isGuest: false, songName: 'My track' }),
    ).toBe(true);
  });

  it('never shows once already seen this session, guest or not', () => {
    expect(
      shouldShowAnalysisCompleteModal({ wantsToShow: false, isGuest: false, songName: 'My track' }),
    ).toBe(false);
    expect(
      shouldShowAnalysisCompleteModal({
        wantsToShow: false,
        isGuest: true,
        songName: 'Demo: Sample Report',
      }),
    ).toBe(false);
  });

  it('suppresses for a guest on the seeded demo song (BFF DemoSeeder.DemoSongPrefix)', () => {
    expect(
      shouldShowAnalysisCompleteModal({
        wantsToShow: true,
        isGuest: true,
        songName: 'Demo: Sample Report',
      }),
    ).toBe(false);
  });

  it('still shows for a guest on a track THEY uploaded (not the demo song)', () => {
    expect(
      shouldShowAnalysisCompleteModal({ wantsToShow: true, isGuest: true, songName: 'My upload' }),
    ).toBe(true);
  });

  it('still shows for a real user even if they renamed a song to start with "Demo: "', () => {
    // Only a GUEST on the demo-prefixed song is suppressed — a real user's
    // own song sharing that prefix is a coincidence, not the seeded demo.
    expect(
      shouldShowAnalysisCompleteModal({ wantsToShow: true, isGuest: false, songName: 'Demo: mine' }),
    ).toBe(true);
  });

  it('matches the prefix, not an exact-name equality (title may vary/localize)', () => {
    expect(
      shouldShowAnalysisCompleteModal({
        wantsToShow: true,
        isGuest: true,
        songName: 'Demo: Anything Else',
      }),
    ).toBe(false);
  });

  it('a song merely containing "Demo:" without the exact prefix still shows', () => {
    expect(
      shouldShowAnalysisCompleteModal({ wantsToShow: true, isGuest: true, songName: 'My Demo: Track' }),
    ).toBe(true);
  });
});
