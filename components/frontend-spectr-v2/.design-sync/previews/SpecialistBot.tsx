import type { ReactNode } from 'react';
import { SpecialistBot } from 'spectr-frontend-v2';

function Stage({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: 'var(--bg)', padding: 24, borderRadius: 12, color: 'var(--text)' }}>{children}</div>
  );
}

/** The alternate mascot — domed helmet, headphone pods, visor EQ mouth. */
export function Default() {
  return (
    <Stage>
      <SpecialistBot size={56} />
    </Stage>
  );
}

/** Idle vs. actively responding (the visor bars speed up when thinking). */
export function States() {
  return (
    <Stage>
      <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
        <div style={{ display: 'grid', placeItems: 'center', gap: 8 }}>
          <SpecialistBot size={56} />
          <span className="label">idle</span>
        </div>
        <div style={{ display: 'grid', placeItems: 'center', gap: 8 }}>
          <SpecialistBot size={56} thinking />
          <span className="label">thinking</span>
        </div>
      </div>
    </Stage>
  );
}

/** Sizes — chip avatar through hero; smallest drops the glow. */
export function Sizes() {
  return (
    <Stage>
      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end' }}>
        <SpecialistBot size={28} glow={false} />
        <SpecialistBot size={44} />
        <SpecialistBot size={64} />
      </div>
    </Stage>
  );
}
