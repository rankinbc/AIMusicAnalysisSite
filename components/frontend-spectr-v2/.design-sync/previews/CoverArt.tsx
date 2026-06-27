import type { ReactNode } from 'react';
import { CoverArt } from 'spectr-frontend-v2';

function Stage({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: 'var(--bg)', padding: 24, borderRadius: 12, color: 'var(--text)' }}>{children}</div>
  );
}

const EMERALD = { l: 0.74, c: 0.15, h: 172 };
const INDIGO = { l: 0.46, c: 0.16, h: 270 };

/** The hero cover at large size with a chosen Aurora visual. */
export function Aurora() {
  return (
    <Stage>
      <CoverArt size="lg" visual={{ template: 'aurora', primary: EMERALD, secondary: INDIGO }} />
    </Stage>
  );
}

/** A handful of the CSS-rendered cover templates at card size. */
export function Templates() {
  const tmpls = ['eq', 'vinyl', 'skyline', 'cassette'] as const;
  return (
    <Stage>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        {tmpls.map((t) => (
          <CoverArt key={t} size="md" visual={{ template: t, primary: EMERALD, secondary: INDIGO }} />
        ))}
      </div>
    </Stage>
  );
}

/** Legacy hue fallback (no chosen visual) — the Aurora gradient from a hue. */
export function HueFallback() {
  return (
    <Stage>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <CoverArt size="md" hue={168} />
        <CoverArt size="md" hue={285} />
        <CoverArt size="md" hue={25} />
      </div>
    </Stage>
  );
}

/** Children render as an overlay — e.g. a now-playing caption. */
export function WithOverlay() {
  return (
    <Stage>
      <CoverArt size="lg" visual={{ template: 'eq', primary: EMERALD, secondary: INDIGO }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            padding: 14,
            background: 'linear-gradient(transparent, rgba(0,0,0,0.55))',
          }}
        >
          <span className="label" style={{ color: 'rgba(255,255,255,0.85)' }}>Now playing</span>
          <span style={{ fontWeight: 700, fontSize: 17, color: '#fff' }}>Midnight Drive</span>
        </div>
      </CoverArt>
    </Stage>
  );
}
