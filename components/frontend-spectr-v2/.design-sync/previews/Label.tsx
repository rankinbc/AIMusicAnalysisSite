import type { ReactNode } from 'react';
import { Label } from 'spectr-frontend-v2';

function Stage({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: 'var(--bg)', padding: 24, borderRadius: 12, color: 'var(--text)' }}>{children}</div>
  );
}

/** The mono, letter-spaced eyebrow label on its own. */
export function Default() {
  return (
    <Stage>
      <Label>Mix score</Label>
    </Stage>
  );
}

/** As it's used — a caption above a value. */
export function OverValues() {
  return (
    <Stage>
      <div style={{ display: 'flex', gap: 36 }}>
        <div>
          <Label>Loudness</Label>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>
            -9.2 <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>LUFS</span>
          </div>
        </div>
        <div>
          <Label>True peak</Label>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>
            -1.1 <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>dBTP</span>
          </div>
        </div>
        <div>
          <Label>Dynamic range</Label>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>
            8.4 <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>LU</span>
          </div>
        </div>
      </div>
    </Stage>
  );
}
