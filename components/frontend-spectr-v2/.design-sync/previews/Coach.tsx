import type { ReactNode } from 'react';
import { Coach } from 'spectr-frontend-v2';

function Stage({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: 'var(--bg)', padding: 24, borderRadius: 12, color: 'var(--text)' }}>{children}</div>
  );
}

/** The hero mascot at its default size. */
export function Default() {
  return (
    <Stage>
      <Coach />
    </Stage>
  );
}

/** Idle vs. actively-responding — the EQ-bar mouth speeds up when thinking. */
export function States() {
  return (
    <Stage>
      <div style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
        <div style={{ display: 'grid', placeItems: 'center', gap: 8 }}>
          <Coach size={72} />
          <span className="label">idle</span>
        </div>
        <div style={{ display: 'grid', placeItems: 'center', gap: 8 }}>
          <Coach size={72} thinking />
          <span className="label">thinking</span>
        </div>
      </div>
    </Stage>
  );
}

/** Sizes, from list-row avatar up to hero. */
export function Sizes() {
  return (
    <Stage>
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end' }}>
        <Coach size={36} glow={false} />
        <Coach size={56} />
        <Coach size={88} />
      </div>
    </Stage>
  );
}
