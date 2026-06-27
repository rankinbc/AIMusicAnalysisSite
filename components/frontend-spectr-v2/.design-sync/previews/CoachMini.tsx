import type { ReactNode } from 'react';
import { CoachMini } from 'spectr-frontend-v2';

function Stage({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: 'var(--bg)', padding: 24, borderRadius: 12, color: 'var(--text)' }}>{children}</div>
  );
}

/** The compact line-art bust. */
export function Default() {
  return (
    <Stage>
      <CoachMini size={40} />
    </Stage>
  );
}

/** Tinted to match a surface accent. */
export function Colors() {
  return (
    <Stage>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <CoachMini size={32} color="#00e5b0" />
        <CoachMini size={32} color="#a78bfa" />
        <CoachMini size={32} color="#fb923c" />
        <CoachMini size={32} color="#60a5fa" />
      </div>
    </Stage>
  );
}

/** As an avatar in a list row. */
export function ListRow() {
  return (
    <Stage>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <CoachMini size={24} />
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>The Coach</div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>your mix assistant</div>
        </div>
      </div>
    </Stage>
  );
}
