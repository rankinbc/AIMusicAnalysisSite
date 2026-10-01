// D9 — where a freshly-started (or resumed) guest demo lands. Owner ruling
// 2026-10-01: always the demo song's results page, on every screen size — the
// findings, actions and coach are the first impression; Listen is one click
// away from the report (and stays desktop-gated on its own page).
import type { DemoTarget } from '../../api/types';

export type DemoDestination = {
  to: '/songs/$songId/results/$jobId';
  params: { songId: string; jobId: string };
};

export function demoDestination(target: DemoTarget): DemoDestination {
  return {
    to: '/songs/$songId/results/$jobId',
    params: { songId: target.songId, jobId: target.jobId },
  };
}
