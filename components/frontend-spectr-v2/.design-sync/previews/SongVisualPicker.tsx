import type { ReactNode } from 'react';
import { SongVisualPicker } from 'spectr-frontend-v2';

function Stage({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: 'var(--bg)', padding: 24, borderRadius: 12, color: 'var(--text)' }}>{children}</div>
  );
}

const EMERALD = { l: 0.74, c: 0.15, h: 172 };
const INDIGO = { l: 0.46, c: 0.16, h: 270 };

/**
 * The full cover-art picker: live library-card preview, template thumbnails +
 * Shuffle, and the primary/secondary swatch rows. Controlled — here pinned to
 * a fixed value (onChange is a no-op for the static preview).
 */
export function Picker() {
  return (
    <Stage>
      <div style={{ width: 380 }}>
        <SongVisualPicker
          name="Midnight Drive"
          value={{ template: 'aurora', primary: EMERALD, secondary: INDIGO }}
          onChange={() => {}}
        />
      </div>
    </Stage>
  );
}
