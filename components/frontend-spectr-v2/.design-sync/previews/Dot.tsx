import type { ReactNode } from 'react';
import { Dot } from 'spectr-frontend-v2';

function Stage({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: 'var(--bg)', padding: 24, borderRadius: 12, color: 'var(--text)' }}>{children}</div>
  );
}

const ROWS = [
  { tone: 'cyan', label: 'Live · processing' },
  { tone: 'violet', label: 'Rendering verdict' },
  { tone: 'orange', label: 'Needs attention' },
  { tone: 'red', label: 'Analysis failed' },
] as const;

/** The glowing status dot in each tone, with the labels it pairs with. */
export function Tones() {
  return (
    <Stage>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {ROWS.map((r) => (
          <div key={r.tone} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Dot tone={r.tone} />
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
              {r.label}
            </span>
          </div>
        ))}
      </div>
    </Stage>
  );
}

/** Inline beside text — the default cyan pulse. */
export function Inline() {
  return (
    <Stage>
      <span
        className="mono"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--text-2)' }}
      >
        <Dot /> streaming now
      </span>
    </Stage>
  );
}
