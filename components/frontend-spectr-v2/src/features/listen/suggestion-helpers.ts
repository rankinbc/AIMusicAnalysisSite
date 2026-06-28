// SPECTR · Listen V3 (PRP-3 / story 11.2) — pure helpers for reviewer suggestions.
// Kept separate from the card component so chain-summary + partition + gating are
// unit-testable without a render. `SuggestionDto.chain` is `unknown` on the wire.
import type { SuggestionDto } from '../../api/types';

/** Readable module order of a proposed chain (e.g. ['Eq', 'Compressor']). Tolerant
 *  of the `unknown` wire shape — returns [] when there's no usable `order` array. */
export function chainSummary(chain: unknown): string[] {
  if (!chain || typeof chain !== 'object') return [];
  const order = (chain as { order?: unknown }).order;
  if (!Array.isArray(order)) return [];
  return order.filter((x): x is string => typeof x === 'string' && x.length > 0).map(prettyEffect);
}

function prettyEffect(id: string): string {
  return id.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface PartitionedSuggestions {
  /** commentId -> its suggestion (rendered inline in that comment thread). */
  byCommentId: Map<string, SuggestionDto>;
  /** suggestions not tied to a comment (rendered in the standalone list). */
  standalone: SuggestionDto[];
}

export function partitionSuggestions(suggestions: SuggestionDto[]): PartitionedSuggestions {
  const byCommentId = new Map<string, SuggestionDto>();
  const standalone: SuggestionDto[] = [];
  for (const sg of suggestions) {
    if (sg.commentId) byCommentId.set(sg.commentId, sg);
    else standalone.push(sg);
  }
  return { byCommentId, standalone };
}

/** AC2 — only the owner can accept/reject, and only while the suggestion is still
 *  open (proposed/auditioned); accepted/rejected ones are terminal. */
export function canActOnSuggestion(status: SuggestionDto['status'], isOwner: boolean): boolean {
  return isOwner && (status === 'proposed' || status === 'auditioned');
}
