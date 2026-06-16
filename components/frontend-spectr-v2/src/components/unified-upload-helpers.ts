import type { ConfirmStemItem, StemRole } from '../api/types';

// Pure orchestration helpers for the unified-upload flow. Kept out of the dialog
// so they're unit-testable and so react-refresh stays happy (no component export).

export type DispatchPath = 'stems' | 'analyze';

/**
 * Which single dispatch closes the upload: when stems are attached the analysis is
 * dispatched by /stems/confirm; otherwise by /versions/{id}/analyze. Exactly one of
 * the two ever fires — that's the "analyzed once" guarantee.
 */
export function decideDispatchPath(opts: { hasStems: boolean }): DispatchPath {
  return opts.hasStems ? 'stems' : 'analyze';
}

/**
 * Build the confirm payload for the review-OFF path straight from the worker's
 * detected roles. A stem the classifier couldn't place falls back to 'other'.
 */
export function buildAutoConfirmPayload(
  stems: ReadonlyArray<{ id: string; detectedRole: StemRole | null }>,
): ConfirmStemItem[] {
  return stems.map((s) => ({ id: s.id, confirmedRole: s.detectedRole ?? 'other' }));
}
