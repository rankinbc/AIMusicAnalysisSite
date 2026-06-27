import type { ReactNode } from 'react';
import { ProgressTimeline } from 'spectr-frontend-v2';

function Stage({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: 'var(--bg)', padding: 24, borderRadius: 12, color: 'var(--text)' }}>{children}</div>
  );
}

const HISTORY = [
  { versionNumber: 1, label: 'rough mix', score: 62, grade: 'C', createdAt: '2026-05-02T10:00:00Z', isCurrent: false },
  { versionNumber: 2, label: 'low-end pass', score: 68, grade: 'C', createdAt: '2026-05-09T10:00:00Z', isCurrent: false },
  { versionNumber: 3, label: 'wider stereo', score: 71, grade: 'B', createdAt: '2026-05-18T10:00:00Z', isCurrent: false },
  { versionNumber: 4, label: 'vocal balance', score: 79, grade: 'B', createdAt: '2026-05-27T10:00:00Z', isCurrent: false },
  { versionNumber: 5, label: 'master v2', score: 86, grade: 'A', createdAt: '2026-06-04T10:00:00Z', isCurrent: true },
];

/** The score-over-versions chart that headlines the song detail page. */
export function FiveVersions() {
  return (
    <Stage>
      <ProgressTimeline versions={HISTORY} />
    </Stage>
  );
}

/** A single analyzed version still draws its labelled point and grade bands. */
export function SingleVersion() {
  return (
    <Stage>
      <ProgressTimeline versions={[HISTORY[4]]} />
    </Stage>
  );
}

/** Empty state — bands render, with the "no scored versions" hint. */
export function NoScoresYet() {
  return (
    <Stage>
      <ProgressTimeline
        versions={[
          { versionNumber: 1, label: 'upload', score: null, grade: null, createdAt: '2026-06-20T10:00:00Z', isCurrent: true },
        ]}
      />
    </Stage>
  );
}
