// D9 — where a freshly-started (or resumed) guest demo lands. Listen is
// hard desktop-gated below 1024px (ListenRackPage's own `max-width:
// 1023.98px` mobile notice), so anything narrower — including an unknown/0
// width, which fails safe as "phone" — sends the visitor to the report
// instead of a page it can't use.
import type { DemoTarget } from '../../api/types';

export const LISTEN_MIN_WIDTH = 1024;

export type DemoDestination =
  | { to: '/listen-rack/$versionId'; params: { versionId: string } }
  | { to: '/songs/$songId/results/$jobId'; params: { songId: string; jobId: string } };

export function demoDestination(target: DemoTarget, viewportWidth: number): DemoDestination {
  if (viewportWidth >= LISTEN_MIN_WIDTH) {
    return { to: '/listen-rack/$versionId', params: { versionId: target.versionId } };
  }
  return {
    to: '/songs/$songId/results/$jobId',
    params: { songId: target.songId, jobId: target.jobId },
  };
}
