import type { ReactNode } from 'react';
import { BrandMark } from 'spectr-frontend-v2';

function Stage({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: 'var(--bg)', padding: 24, borderRadius: 12, color: 'var(--text)' }}>{children}</div>
  );
}

/** The bare mark, as it sits inline in body text. */
export function Default() {
  return (
    <Stage>
      <BrandMark />
    </Stage>
  );
}

/** The glowing, cyan-bordered container used in the top nav, with wordmark. */
export function Lockup() {
  return (
    <Stage>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <BrandMark size={36} glow />
        <span className="mono" style={{ fontWeight: 700, fontSize: 18, letterSpacing: '0.18em' }}>
          SPECTR
        </span>
      </div>
    </Stage>
  );
}

/** Sizes from inline-icon to hero; glow opts in on the largest. */
export function Sizes() {
  return (
    <Stage>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <BrandMark size={18} />
        <BrandMark size={28} />
        <BrandMark size={48} glow />
      </div>
    </Stage>
  );
}
