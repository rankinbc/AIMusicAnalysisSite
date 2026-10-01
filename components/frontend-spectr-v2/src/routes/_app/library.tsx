import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';

import { SongsLibrarySection } from '../../features/library/SongsLibrarySection';
import { guestMayOpenLibrary } from '../../features/library/library-guard';
import { ReferenceLibrarySection } from '../../features/references/ReferenceLibrarySection';
import s from './library.module.css';

export const Route = createFileRoute('/_app/library')({
  // Owner ruling 2026-10-01: a guest gets the library only once they have
  // uploaded a track of their own (the seeded demo song doesn't count) —
  // otherwise back to the landing page. See library-guard.ts.
  beforeLoad: async ({ context }) => {
    if (!(await guestMayOpenLibrary(context))) throw redirect({ to: '/' });
  },
  component: LibraryPage,
});

type LibraryMode = 'songs' | 'references';

const MODES: { key: LibraryMode; label: string }[] = [
  { key: 'songs', label: 'Songs' },
  { key: 'references', label: 'References' },
];

/** Shell for the library page. Hosts the Songs / References segmented toggle
 *  and renders the active section; each section owns its own data + header. */
function LibraryPage() {
  const [mode, setMode] = useState<LibraryMode>('songs');

  return (
    <div className={s.page}>
      <div className={s.modeBar}>
        <div className={s.modeToggle} role="tablist" aria-label="Library section">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={mode === m.key}
              className={s.modeToggleBtn}
              data-active={mode === m.key}
              onClick={() => setMode(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'songs' ? <SongsLibrarySection /> : <ReferenceLibrarySection />}
    </div>
  );
}
