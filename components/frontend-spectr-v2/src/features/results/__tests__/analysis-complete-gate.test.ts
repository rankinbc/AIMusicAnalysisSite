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

  // D10 fix1 (item 4) — the un-renamable signal: PATCH /songs/{id} lets a
  // guest rename their OWN song to start with "Demo: " too, which would
  // wrongly suppress the modal on the name check alone. The version's
  // storage key (VersionDto.filePath) is server-assigned and never
  // user-editable — mirrors the BFF's own "audio/demo/" check
  // (GuestLimits.cs / DemoSeeder.DemoAudioKey).
  describe('versionFilePath (the un-renamable signal)', () => {
    it('suppresses for a guest on the seeded demo storage key, even if the song was renamed off the "Demo: " prefix', () => {
      expect(
        shouldShowAnalysisCompleteModal({
          wantsToShow: true,
          isGuest: true,
          songName: 'My totally normal track',
          versionFilePath: 'audio/demo/source.wav',
        }),
      ).toBe(false);
    });

    it('shows for a guest whose OWN song happens to be named "Demo: …" but whose storage key is their own', () => {
      expect(
        shouldShowAnalysisCompleteModal({
          wantsToShow: true,
          isGuest: true,
          songName: 'Demo: My Own Upload',
          versionFilePath: 'audio/users/abc123/mix.wav',
        }),
      ).toBe(true);
    });

    it('falls back to the name-prefix check when the path is unknown (omitted/null)', () => {
      expect(
        shouldShowAnalysisCompleteModal({
          wantsToShow: true,
          isGuest: true,
          songName: 'Demo: Sample Report',
          // versionFilePath omitted entirely — exactOptionalPropertyTypes
          // forbids an explicit `undefined` on this optional field.
        }),
      ).toBe(false);
      expect(
        shouldShowAnalysisCompleteModal({
          wantsToShow: true,
          isGuest: true,
          songName: 'Demo: Sample Report',
          versionFilePath: null,
        }),
      ).toBe(false);
    });

    it('never suppresses for a real user even if the path looks like the demo key', () => {
      expect(
        shouldShowAnalysisCompleteModal({
          wantsToShow: true,
          isGuest: false,
          songName: 'Demo: Sample Report',
          versionFilePath: 'audio/demo/source.wav',
        }),
      ).toBe(true);
    });
  });
});
