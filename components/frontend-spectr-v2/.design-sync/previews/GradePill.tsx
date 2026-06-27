import type { ReactNode } from 'react';
import { GradePill } from 'spectr-frontend-v2';

function Stage({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: 'var(--bg)', padding: 24, borderRadius: 12, color: 'var(--text)' }}>{children}</div>
  );
}

/** Every grade letter, A→F, each tinted by its own token color. */
export function Grades() {
  return (
    <Stage>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {['A', 'B', 'C', 'D', 'F'].map((g) => (
          <GradePill key={g} grade={g} />
        ))}
      </div>
    </Stage>
  );
}

/** The three sizes — list chip, default, and hero. */
export function Sizes() {
  return (
    <Stage>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
        <GradePill grade="A" size="sm" />
        <GradePill grade="A" size="md" />
        <GradePill grade="A" size="lg" />
      </div>
    </Stage>
  );
}

/** Unknown / not-yet-analyzed grade falls back to the neutral em-dash. */
export function NotAvailable() {
  return (
    <Stage>
      <GradePill grade={null} size="lg" />
    </Stage>
  );
}
