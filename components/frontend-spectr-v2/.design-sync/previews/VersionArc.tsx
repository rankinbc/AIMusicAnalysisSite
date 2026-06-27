import type { ReactNode } from 'react';
import { VersionArc } from 'spectr-frontend-v2';

function Stage({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: 'var(--bg)', padding: 24, borderRadius: 12, color: 'var(--text)' }}>{children}</div>
  );
}

const VERSIONS = [
  { versionNumber: 1, score: 62, grade: 'C' },
  { versionNumber: 2, score: 68, grade: 'C' },
  { versionNumber: 3, score: 71, grade: 'B' },
  { versionNumber: 4, score: 79, grade: 'B' },
  { versionNumber: 5, score: 86, grade: 'A' },
];

/** The sparkline + grade-chip strip that sits on each library song card. */
export function Default() {
  return (
    <Stage>
      <div style={{ width: 240 }}>
        <VersionArc versions={VERSIONS} delta={7} />
      </div>
    </Stage>
  );
}

/** Compact variant for dense rows. */
export function Compact() {
  return (
    <Stage>
      <div style={{ width: 240 }}>
        <VersionArc versions={VERSIONS} delta={7} compact />
      </div>
    </Stage>
  );
}

/** A regression shows the delta in red. */
export function Regression() {
  return (
    <Stage>
      <div style={{ width: 240 }}>
        <VersionArc
          versions={[
            { versionNumber: 1, score: 81, grade: 'A' },
            { versionNumber: 2, score: 74, grade: 'B' },
          ]}
          delta={-7}
        />
      </div>
    </Stage>
  );
}

/** No scored versions yet — chips still list every version. */
export function NoScores() {
  return (
    <Stage>
      <div style={{ width: 240 }}>
        <VersionArc versions={[{ versionNumber: 1, score: null, grade: null }]} />
      </div>
    </Stage>
  );
}
