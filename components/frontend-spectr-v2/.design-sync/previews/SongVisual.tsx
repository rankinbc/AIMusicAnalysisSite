import type { ReactNode } from 'react';
import { SongVisual } from 'spectr-frontend-v2';

function Stage({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: 'var(--bg)', padding: 24, borderRadius: 12, color: 'var(--text)' }}>{children}</div>
  );
}

const EMERALD = { l: 0.74, c: 0.15, h: 172 };
const INDIGO = { l: 0.46, c: 0.16, h: 270 };
const ROSE = { l: 0.72, c: 0.19, h: 352 };
const AMBER = { l: 0.76, c: 0.16, h: 70 };

// SongVisual fills its (relative) parent, so each cell wraps it in a sized frame.
function Frame({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: 'relative', width: 132, height: 132, borderRadius: 12, overflow: 'hidden' }}>
      {children}
    </div>
  );
}

/** The CSS-rendered cover scenes (the coach-image templates are omitted). */
export function Templates() {
  const tmpls = ['aurora', 'eq', 'vinyl', 'skyline', 'cassette', 'boombox'] as const;
  return (
    <Stage>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        {tmpls.map((t) => (
          <div key={t} style={{ display: 'grid', gap: 6, justifyItems: 'center' }}>
            <Frame>
              <SongVisual template={t} primary={EMERALD} secondary={INDIGO} />
            </Frame>
            <span className="label">{t}</span>
          </div>
        ))}
      </div>
    </Stage>
  );
}

/** Same template, different color pairs — every stop derives from the two colors. */
export function ColorPairs() {
  return (
    <Stage>
      <div style={{ display: 'flex', gap: 14 }}>
        <Frame>
          <SongVisual template="aurora" primary={EMERALD} secondary={INDIGO} />
        </Frame>
        <Frame>
          <SongVisual template="aurora" primary={ROSE} secondary={INDIGO} />
        </Frame>
        <Frame>
          <SongVisual template="eq" primary={AMBER} secondary={ROSE} />
        </Frame>
      </div>
    </Stage>
  );
}
