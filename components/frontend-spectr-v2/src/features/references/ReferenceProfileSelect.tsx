// Reference Profile selector. One control, two source groups: the user's own
// reference sets (ReferenceSetDto — name + hue + memberCount) and built-in genre
// presets (phase-6 profile_source). Defaults to None, clearable. Designed to live
// inside a Radix Dialog: its own Esc/outside-click closes only the dropdown.

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';

import { useReferenceSets } from '../../api/hooks';
import type { SongReferenceProfile } from '../../api/types';
import { GENRE_PRESETS } from './genrePresets';
import r from './ReferenceProfileSelect.module.css';

interface Props {
  value: SongReferenceProfile | null;
  onChange: (value: SongReferenceProfile | null) => void;
}

const hueDot = (hue: number): CSSProperties =>
  ({ '--chip-hue': `hsl(${hue} 70% 60%)` }) as CSSProperties;

export function ReferenceProfileSelect({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { data: sets } = useReferenceSets();
  const profiles = sets ?? [];

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); // close the dropdown, not the parent dialog
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const select = (v: SongReferenceProfile | null) => {
    onChange(v);
    setOpen(false);
  };
  const clear = (e: ReactMouseEvent) => {
    e.stopPropagation();
    onChange(null);
  };

  return (
    <div className={r.refsel} ref={rootRef}>
      <button
        type="button"
        className={r.trigger}
        data-open={open ? 'true' : 'false'}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {value ? (
          <>
            <span
              className={value.kind === 'preset' ? r.diamond : r.dot}
              style={hueDot(value.hue)}
            />
            <span className={r.label}>{value.name}</span>
            <span
              className={r.clear}
              role="button"
              tabIndex={-1}
              aria-label="Clear reference profile"
              onClick={clear}
            >
              ×
            </span>
          </>
        ) : (
          <>
            <span className={`${r.placeholder} ${r.label}`}>None — analyze without a reference</span>
            <span className={r.caret}>▾</span>
          </>
        )}
      </button>

      {open && (
        <div className={r.panel} role="listbox">
          <button
            type="button"
            className={`${r.item} ${r.none}`}
            data-on={!value ? 'true' : 'false'}
            onClick={() => select(null)}
          >
            <span className={r.nm}>None</span>
            {!value && <span className={r.check}>✓</span>}
          </button>

          <div className={r.grouplabel}>My profiles</div>
          {profiles.length > 0 ? (
            profiles.map((pr) => {
              const hue = pr.hue ?? 168;
              const on = value?.kind === 'set' && value.id === pr.id;
              return (
                <button
                  key={pr.id}
                  type="button"
                  className={r.item}
                  data-on={on ? 'true' : 'false'}
                  onClick={() => select({ kind: 'set', id: pr.id, name: pr.name, hue })}
                >
                  <span className={r.dot} style={hueDot(hue)} />
                  <span className={r.nm}>{pr.name}</span>
                  {on ? <span className={r.check}>✓</span> : <span className={r.count}>{pr.memberCount}</span>}
                </button>
              );
            })
          ) : (
            <div className={r.empty}>
              <p>No reference profiles yet. Add a reference track to compare your mixes against.</p>
            </div>
          )}

          <div className={r.grouplabel}>Genre presets</div>
          {GENRE_PRESETS.map((pr) => {
            const on = value?.kind === 'preset' && value.id === pr.id;
            return (
              <button
                key={pr.id}
                type="button"
                className={r.item}
                data-on={on ? 'true' : 'false'}
                onClick={() => select({ kind: 'preset', id: pr.id, name: pr.name, hue: pr.hue })}
              >
                <span className={r.diamond} style={hueDot(pr.hue)} />
                <span className={r.nm}>{pr.name}</span>
                {on && <span className={r.check}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
