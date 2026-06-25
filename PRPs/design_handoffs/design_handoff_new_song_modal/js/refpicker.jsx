// refpicker.jsx — Reference Profile selector. One control, two source groups:
// the user's own reference sets (ReferenceSetDto: name + hue + memberCount) and
// built-in genre presets (phase-6 profile_source). Defaults to None, clearable.

// Sample reference sets — stand in for GET /reference-sets/. Hue dots match the
// References section chips (hsl via --chip-hue).
const MY_PROFILES = [
  { id: 'set-1', name: 'Festival Mains', hue: 168, count: 12 },
  { id: 'set-2', name: 'Late Night', hue: 280, count: 7 },
  { id: 'set-3', name: 'Warm Analog', hue: 30, count: 5 },
  { id: 'set-4', name: 'Vocal Pop', hue: 330, count: 9 },
];

// Built-in genre profiles — map to the existing phase-6 genre-profile concept.
const GENRE_PRESETS = [
  { id: 'trance', name: 'Trance', hue: 232 },
  { id: 'techno', name: 'Techno', hue: 196 },
  { id: 'hiphop', name: 'Hip-Hop', hue: 22 },
  { id: 'house', name: 'House', hue: 45 },
  { id: 'dnb', name: 'Drum & Bass', hue: 300 },
  { id: 'pop', name: 'Pop', hue: 330 },
];

function hueDot(hue) {
  return { ['--chip-hue']: `hsl(${hue} 70% 60%)` };
}

function ReferenceProfilePicker({ value, onChange, hasProfiles = true }) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const profiles = hasProfiles ? MY_PROFILES : [];
  const select = (v) => { onChange(v); setOpen(false); };
  const clear = (e) => { e.stopPropagation(); onChange(null); };

  return (
    <div className="refsel" ref={rootRef}>
      <button
        type="button"
        className="refsel-trigger"
        data-open={open ? 'true' : 'false'}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {value ? (
          <>
            {value.kind === 'preset'
              ? <span className="refsel-diamond" style={hueDot(value.hue)} />
              : <span className="refsel-dot" style={hueDot(value.hue)} />}
            <span className="refsel-label">{value.name}</span>
            <span className="refsel-clear" role="button" aria-label="Clear reference profile" onClick={clear}>×</span>
          </>
        ) : (
          <>
            <span className="placeholder refsel-label">None — analyze without a reference</span>
            <span className="caret">▾</span>
          </>
        )}
      </button>

      {open && (
        <div className="refsel-panel" role="listbox">
          <button
            type="button"
            className="refsel-item refsel-none"
            data-on={!value ? 'true' : 'false'}
            onClick={() => select(null)}
          >
            <span className="nm">None</span>
            {!value && <span className="refsel-check">✓</span>}
          </button>

          <div className="refsel-grouplabel">My profiles</div>
          {profiles.length > 0 ? (
            profiles.map((pr) => {
              const on = value?.kind === 'set' && value.id === pr.id;
              return (
                <button
                  key={pr.id}
                  type="button"
                  className="refsel-item"
                  data-on={on ? 'true' : 'false'}
                  onClick={() => select({ kind: 'set', id: pr.id, name: pr.name, hue: pr.hue })}
                >
                  <span className="refsel-dot" style={hueDot(pr.hue)} />
                  <span className="nm">{pr.name}</span>
                  {on ? <span className="refsel-check">✓</span> : <span className="refsel-count">{pr.count}</span>}
                </button>
              );
            })
          ) : (
            <div className="refsel-empty">
              <p>No reference profiles yet. Add a reference track to compare your mixes against.</p>
              <a href="#" onClick={(e) => e.preventDefault()}>+ Add a reference track</a>
            </div>
          )}

          <div className="refsel-grouplabel">Genre presets</div>
          {GENRE_PRESETS.map((pr) => {
            const on = value?.kind === 'preset' && value.id === pr.id;
            return (
              <button
                key={pr.id}
                type="button"
                className="refsel-item"
                data-on={on ? 'true' : 'false'}
                onClick={() => select({ kind: 'preset', id: pr.id, name: pr.name, hue: pr.hue })}
              >
                <span className="refsel-diamond" style={hueDot(pr.hue)} />
                <span className="nm">{pr.name}</span>
                {on && <span className="refsel-check">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { ReferenceProfilePicker, MY_PROFILES, GENRE_PRESETS });
