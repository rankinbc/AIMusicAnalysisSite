// Actions that are never charged credits, on any tier. Copy only — no
// numbers. Kept beside the pricing page (not in a component file) so tests
// and the section read one list.
export const ALWAYS_FREE: ReadonlyArray<{ name: string; detail: string }> = [
  {
    name: 'Retry after a failure',
    detail: 'If an analysis fails on our side, the re-run is on us.',
  },
  {
    name: 'Per-phase re-run',
    detail: 'Re-running a single analysis phase never costs credits.',
  },
  {
    name: 'Reference analysis',
    detail: 'Upload a reference track to compare your mix against.',
  },
  {
    name: 'Coach brief',
    detail: 'The coach’s opening read of your mix comes with every analysis.',
  },
  {
    name: 'Auto-run specialists',
    detail: 'The specialists triage picks for your track run as part of the analysis.',
  },
];
