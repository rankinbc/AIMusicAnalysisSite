// modal.jsx — the New Song dialog. Owns the create form (Name required; the
// rest optional) and the visual picker (template + 2 colors + shuffle, live
// preview). The same field group is intended to power create + edit.

const GENRE_SUGGESTIONS = ['Trance', 'Techno', 'House', 'Hip-Hop', 'Pop', 'Drum & Bass', 'Ambient', 'Lo-fi'];

// Thumbnail picker — one mini live-render per template (replaces the old 2-way
// segmented control now that there are six). Selection is a static ring so it
// reads correctly even where CSS transitions are paused (e.g. static capture).
function TemplateThumbs({ value, p, s, onChange }) {
  return (
    <div className="tmpl-grid" role="radiogroup" aria-label="Visual template">
      {TEMPLATES.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={t.id === value}
          data-on={t.id === value ? 'true' : 'false'}
          className="tmpl-thumb"
          onClick={() => onChange(t.id)}
          title={t.label}
        >
          <span className="tmpl-thumb-vis">
            <SongVisual template={t.id} p={p} s={s} mini />
          </span>
          <span className="tmpl-thumb-label">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

function SwatchRow({ value, onChange, label }) {
  const cur = colorKey(value);
  return (
    <div className="control-block">
      <span className="eyebrow">{label}</span>
      <div className="swatch-row" role="radiogroup" aria-label={label}>
        {PALETTE.map((col) => {
          const on = colorKey(col) === cur;
          return (
            <button
              key={colorKey(col)}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`color ${Math.round(col.h)}°`}
              className="swatch"
              data-on={on ? 'true' : 'false'}
              style={{ background: swatchColor(col), color: swatchColor(col) }}
              onClick={() => onChange(col)}
            />
          );
        })}
      </div>
    </div>
  );
}

// Visual picker: live preview + template thumbnails + shuffle + 2 color rows.
function VisualPicker({ name, vis, setVis }) {
  const shuffle = () => setVis(randomVisual());
  return (
    <div className="visual-col">
      <div className="preview-wrap">
        <CardPreview name={name} template={vis.template} p={vis.p} s={vis.s} />
      </div>
      <div className="control-block">
        <div className="control-head">
          <span className="eyebrow">Template</span>
          <button type="button" className="shuffle-link" onClick={shuffle}>
            <span className="ico" aria-hidden="true">⟳</span> Shuffle
          </button>
        </div>
        <TemplateThumbs value={vis.template} p={vis.p} s={vis.s} onChange={(template) => setVis({ ...vis, template })} />
      </div>
      <SwatchRow label="Primary" value={vis.p} onChange={(p) => setVis({ ...vis, p })} />
      <SwatchRow label="Secondary" value={vis.s} onChange={(s) => setVis({ ...vis, s })} />
    </div>
  );
}

// Secondary fields — shared between the always-visible layout and the
// "More options" disclosure so the markup stays identical in both modes.
function SecondaryFields({ description, setDescription, genre, setGenre, refProfile, setRefProfile, idPrefix }) {
  return (
    <>
      <div className="field">
        <label className="field-label" htmlFor={`${idPrefix}-desc`}>
          Description <span className="field-opt">optional</span>
          <span className="field-count">{description.length}/500</span>
        </label>
        <textarea
          id={`${idPrefix}-desc`}
          className="input"
          rows={3}
          maxLength={500}
          placeholder="Notes to self — direction, references, what to fix next…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${idPrefix}-genre`}>
          Genre hint <span className="field-opt">optional · helps analysis</span>
        </label>
        <input
          id={`${idPrefix}-genre`}
          className="input"
          maxLength={50}
          placeholder="e.g. Melodic techno"
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
        />
        <div className="genre-suggest">
          {GENRE_SUGGESTIONS.map((g) => (
            <button
              key={g}
              type="button"
              className="suggest-chip"
              data-on={genre.trim().toLowerCase() === g.toLowerCase() ? 'true' : 'false'}
              onClick={() => setGenre(genre.trim().toLowerCase() === g.toLowerCase() ? '' : g)}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="field-label">
          Reference profile <span className="field-opt">optional · default comparison</span>
        </label>
        <ReferenceProfilePicker value={refProfile} onChange={setRefProfile} />
      </div>
    </>
  );
}

function NewSongModal({ tweaks, onClose, onCreated }) {
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [genre, setGenre] = React.useState('');
  const [refProfile, setRefProfile] = React.useState(null);
  const [vis, setVis] = React.useState(randomVisual); // randomized on open
  const [pending, setPending] = React.useState(false);
  const [discOpen, setDiscOpen] = React.useState(false);
  const nameRef = React.useRef(null);

  React.useEffect(() => { nameRef.current?.focus(); }, []);

  const canSubmit = name.trim().length > 0 && !pending;

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim() || pending) return;
    setPending(true);
    window.setTimeout(() => {
      onCreated({
        name: name.trim(),
        description: description.trim() || null,
        genreHint: genre.trim() || null,
        referenceProfile: refProfile,
        visual: { template: vis.template, primaryColor: vis.p, secondaryColor: vis.s },
      });
    }, 900);
  };

  const place = tweaks.place || 'left';
  const useDisclosure = tweaks.disclosure === 'more';

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !pending) onClose(); }}>
      <form
        className="dialog"
        data-density={tweaks.density || 'regular'}
        style={{ ['--dialog-w']: `${tweaks.width || 700}px` }}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label="New song"
      >
        <button type="button" className="dialog-close" aria-label="Close" onClick={() => !pending && onClose()}>✕</button>

        <div className="dialog-hd">
          <h2 className="dialog-title">New song</h2>
          <p className="dialog-desc">
            Name it and go — everything else is optional. You can upload its first version right after.
          </p>
        </div>

        <div className="ns-grid" data-place={place}>
          <VisualPicker name={name} vis={vis} setVis={setVis} />

          <div className="fields-col">
            <div className="field">
              <label className="field-label" htmlFor="ns-name">
                Name <span className="field-req">required</span>
              </label>
              <input
                id="ns-name"
                ref={nameRef}
                className="input input-name"
                maxLength={200}
                placeholder="Untitled song"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
              />
            </div>

            {useDisclosure ? (
              <>
                <button type="button" className="disclose" data-open={discOpen ? 'true' : 'false'} onClick={() => setDiscOpen((v) => !v)}>
                  <span className="chev">▶</span>
                  More options
                  <span className="count">description · genre · reference</span>
                </button>
                {discOpen && (
                  <div className="disclose-body">
                    <SecondaryFields
                      description={description} setDescription={setDescription}
                      genre={genre} setGenre={setGenre}
                      refProfile={refProfile} setRefProfile={setRefProfile}
                      idPrefix="ns"
                    />
                  </div>
                )}
              </>
            ) : (
              <SecondaryFields
                description={description} setDescription={setDescription}
                genre={genre} setGenre={setGenre}
                refProfile={refProfile} setRefProfile={setRefProfile}
                idPrefix="ns"
              />
            )}
          </div>
        </div>

        <div className="dialog-actions">
          <span className="spacer">Press ⏎ to create</span>
          <button type="button" className="btn" onClick={() => !pending && onClose()} disabled={pending}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {pending ? <><span className="ico spinning" aria-hidden="true">⟳</span> Creating…</> : 'Create song'}
          </button>
        </div>
      </form>
    </div>
  );
}

Object.assign(window, { NewSongModal });
