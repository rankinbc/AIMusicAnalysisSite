// Task G6 (item 3) / fix round 1 (I2) — pure decision extracted from
// songs.$songId.results.$jobId.tsx (its own module, not just a local
// function in the route file) so the guest "explore the demo while yours
// analyzes" link is unit-testable without mounting the whole route
// (useJob/useSongs/useVersion/… hook graph) AND without tripping
// react-refresh/only-export-components — that route file already exports
// `Route` (non-component) alongside the `DemoWaitingLink` component, the
// same combination `listen-rack.$versionId.tsx` uses; adding a THIRD,
// non-component function export on top of that is what triggers the lint,
// not `Route` + one component alone.
//
// `stage` mirrors exactly which JSX branch ResultsPage renders:
// complete/failed/awaiting_stem_mapping all early-return BEFORE ever
// reaching the in-progress storyline, so the link must never resolve for
// those — 'in_progress' is the only stage that can produce a link.
export type ResultsStage = 'complete' | 'failed' | 'awaiting_stem_mapping' | 'in_progress';

export interface LibrarySongForWaitingLink {
  id: string;
  name: string;
  latestResult: { jobId: string } | null;
}

export function resolveDemoWaitingLink(params: {
  isGuest: boolean;
  stage: ResultsStage;
  librarySongs: LibrarySongForWaitingLink[] | undefined;
}): { songId: string; jobId: string } | null {
  if (!params.isGuest || params.stage !== 'in_progress') return null;
  const demoSong = params.librarySongs?.find((sg) => sg.name.startsWith('Demo: '));
  if (!demoSong?.latestResult) return null;
  return { songId: demoSong.id, jobId: demoSong.latestResult.jobId };
}
