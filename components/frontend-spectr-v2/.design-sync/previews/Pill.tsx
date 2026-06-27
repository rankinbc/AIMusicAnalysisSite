import type { ReactNode } from 'react';
import { Pill, Dot } from 'spectr-frontend-v2';

// SPECTR is a dark-theme system: every component is designed to sit on the app
// background (var(--bg)). The preview card chrome is light, so each cell stages
// its content on the DS surface to render the components faithfully.
function Stage({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: 'var(--bg)', padding: 24, borderRadius: 12, color: 'var(--text)' }}>{children}</div>
  );
}

/** Every tone, captioned with the kind of label the app actually uses. */
export function Tones() {
  return (
    <Stage>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Pill>draft</Pill>
        <Pill tone="cyan">analyzing</Pill>
        <Pill tone="violet">pro</Pill>
        <Pill tone="orange">needs work</Pill>
        <Pill tone="red">critical</Pill>
        <Pill tone="green">release ready</Pill>
        <Pill tone="yellow">queued</Pill>
      </div>
    </Stage>
  );
}

/** Pills composed with a status Dot — the live/processing affordance. */
export function WithStatusDot() {
  return (
    <Stage>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Pill tone="cyan">
          <Dot tone="cyan" /> live
        </Pill>
        <Pill tone="violet">
          <Dot tone="violet" /> rendering
        </Pill>
        <Pill tone="orange">
          <Dot tone="orange" /> clipping
        </Pill>
      </div>
    </Stage>
  );
}

/** Metadata pills as they read on a results header. */
export function TrackMeta() {
  return (
    <Stage>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Pill className="mono">128 BPM</Pill>
        <Pill className="mono">A minor</Pill>
        <Pill tone="cyan" className="mono">-9.2 LUFS</Pill>
        <Pill tone="green" className="mono">danceability 84</Pill>
      </div>
    </Stage>
  );
}
