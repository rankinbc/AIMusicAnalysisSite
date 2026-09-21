// D10 addendum (f) — pure call-site decision for whether ReportView opens
// the "Analysis complete" teaser modal. Lives here (NOT inside
// AnalysisCompleteModal.tsx) because that component's files are off-limits
// — another session's uncommitted work. A guest opening the seeded demo
// report must not see it: its "Re-analyze" CTA is pointless on a demo
// track, and it overflows at phone width.
//
// The prefix mirrors the BFF's DemoSeeder.DemoSongPrefix ("Demo: ") exactly
// — the seeded song is always named that way, and a real user's own song
// that happens to start the same way is a coincidence we must NOT suppress
// for (hence `isGuest` gates this too, not the name alone).
const DEMO_SONG_PREFIX = 'Demo: ';
// D10 fix1 (item 4) — the un-renamable signal: `PATCH /songs/{id}` lets a
// guest rename their OWN song to start with "Demo: " too, which would
// wrongly suppress the modal on the name check alone. The version's storage
// key is server-assigned and never user-editable — mirrors the BFF's own
// check (GuestLimits.cs / DemoSeeder.DemoAudioKey: "audio/demo/source.wav").
const DEMO_STORAGE_PREFIX = 'audio/demo/';

export function shouldShowAnalysisCompleteModal(params: {
  /** Whatever the caller's own "not yet seen this session" check produced
   *  (e.g. sessionStorage) — kept as an input so this stays pure. */
  wantsToShow: boolean;
  isGuest: boolean;
  songName: string;
  /** VersionDto.filePath, when the caller already has it loaded — the
   *  authoritative (un-renamable) signal. Falls back to the (renamable)
   *  name-prefix check when omitted/unknown. */
  versionFilePath?: string | null;
}): boolean {
  if (!params.wantsToShow) return false;
  if (!params.isGuest) return true;
  const isDemoTrack =
    params.versionFilePath != null
      ? params.versionFilePath.startsWith(DEMO_STORAGE_PREFIX)
      : params.songName.startsWith(DEMO_SONG_PREFIX);
  return !isDemoTrack;
}
