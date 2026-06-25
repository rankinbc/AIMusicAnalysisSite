// library.jsx — the redesigned Songs library: cover-led card + list row, the
// per-song visibility badge, a display-only version-sequence strip, visibility
// filter pills + tag-refine row, the kebab menu (portaled so it can never be
// clipped by the card) with a Visibility submenu, and compact edit / delete
// dialogs. Grades/scores are gone entirely (pill, score text, version arc).
//
// Mirrors features/library/SongsLibrarySection.tsx structure so the recreation
// maps file-for-file. Mock interactions (open / play / results) emit toasts in
// place of router navigation.

const { useState, useEffect, useLayoutEffect, useRef, useMemo } = React;

// ── Visibility badge ─────────────────────────────────────────────────────────
function VisBadge({ visibility, badge = 'icon' }) {
  const m = VIS_META[visibility];
  return (
    <span className="visBadge" data-vis={visibility} data-style={badge} title={`${m.label} — ${m.desc}`}>
      {badge === 'marker' ? <span className="vmark" /> : <span className="glyph">{m.glyph}</span>}
      <span className="vlabel">{m.label}</span>
    </span>
  );
}

// ── Version-sequence strip (display-only) ────────────────────────────────────
function VersionStrip({ versions, shape = 'dots' }) {
  if (!versions || versions.length === 0) {
    return <div className="vstrip"><span className="vstrip-empty">no versions yet</span></div>;
  }
  return (
    <div className="vstrip" data-shape={shape}>
      <div className="vstrip-track">
        {/* Each marker is one version. Latest is accented. Hover → date/label.
            Display-only: the strip is not interactive (no per-marker nav). The
            dashed rail is where future delta-connectors will render. */}
        {versions.map((v) => (
          <div className="vstrip-node" key={v.id} data-latest={v.isCurrent}>
            <span className="vstrip-dot" />
            <span className="vstrip-tip">
              <b>v{v.versionNumber}</b>{v.label ? ` · ${v.label}` : ''} <span>· {formatRelative(v.createdAt)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniWave() {
  return (
    <div className="miniWave" aria-hidden="true">
      {Array.from({ length: 22 }).map((_, i) => {
        const v = 0.25 + (Math.sin(i * 0.7) * 0.5 + 0.5) * 0.65;
        return <div key={i} style={{ height: `${v * 100}%` }} />;
      })}
    </div>
  );
}

// ── Kebab menu ───────────────────────────────────────────────────────────────
// Open · Edit · Visibility ▸ · Add version · ── · Archive · Delete
// The dropdown is portaled to <body> and positioned with fixed coords from the
// trigger rect, so the card's overflow:hidden can never clip it. It flips up
// near the viewport bottom and the visibility submenu flips side near an edge.
function SongMenu({ song, onOpen, onEdit, onAddVersion, onArchive, onDelete, onSetVisibility }) {
  const [open, setOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const [pos, setPos] = useState(null);
  const trigRef = useRef(null);
  const menuRef = useRef(null);
  const subTrigRef = useRef(null);
  const closeTimer = useRef(null);

  const place = () => {
    const t = trigRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const W = 188, H = 250, M = 8;
    let left = Math.min(Math.max(M, r.right - W), window.innerWidth - W - M);
    let top = r.bottom + 5;
    if (top + H > window.innerHeight - M) top = Math.max(M, r.top - 5 - H);
    setPos({ top, left });
  };

  useLayoutEffect(() => { if (open) place(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (trigRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false); setSubOpen(false);
    };
    const onEsc = (e) => { if (e.key === 'Escape') { setOpen(false); setSubOpen(false); } };
    const onScroll = () => { setOpen(false); setSubOpen(false); };
    window.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onEsc);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onEsc);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  useEffect(() => {
    if (subOpen && subTrigRef.current) setFlip(subTrigRef.current.getBoundingClientRect().left < 210);
  }, [subOpen]);

  const close = () => { setOpen(false); setSubOpen(false); };
  const item = (fn) => (e) => { e.stopPropagation(); close(); fn(); };

  const dropdown = open && pos ? ReactDOM.createPortal(
    <div
      ref={menuRef} className="menuDropdown menuPortal" role="menu"
      style={{ top: pos.top, left: pos.left }} onClick={(e) => e.stopPropagation()}
    >
      <button type="button" className="menuItem" role="menuitem" onClick={item(onOpen)}>
        <span className="mi-ico">↗</span> Open
      </button>
      <button type="button" className="menuItem" role="menuitem" onClick={item(onEdit)}>
        <span className="mi-ico">✎</span> Edit
      </button>
      <div
        className="submenu"
        onMouseEnter={() => { clearTimeout(closeTimer.current); setSubOpen(true); }}
        onMouseLeave={() => { closeTimer.current = setTimeout(() => setSubOpen(false), 160); }}
      >
        <button
          ref={subTrigRef} type="button" className="menuItem" role="menuitem"
          aria-haspopup="menu" aria-expanded={subOpen}
          onClick={(e) => { e.stopPropagation(); setSubOpen((v) => !v); }}
        >
          <span className="mi-ico">{VIS_META[song.visibility].glyph}</span> Visibility
          <span className="mi-caret">▸</span>
        </button>
        {subOpen && (
          <div className={`submenuPanel${flip ? ' flip' : ''}`} role="menu">
            {VIS_ORDER.map((key) => {
              const m = VIS_META[key];
              return (
                <button
                  key={key} type="button" className="subItem" role="menuitemradio"
                  aria-checked={song.visibility === key} data-vis={key}
                  onClick={item(() => onSetVisibility(key))}
                >
                  <span className="glyph">{m.glyph}</span>
                  <span className="si-main">
                    <span className="si-name">{m.label}</span>
                    <span className="si-desc">{m.desc}</span>
                  </span>
                  {song.visibility === key && <span className="si-check">✓</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <button type="button" className="menuItem" role="menuitem" onClick={item(onAddVersion)}>
        <span className="mi-ico">＋</span> Add version
      </button>
      <div className="menuSep" />
      <button type="button" className="menuItem" role="menuitem" onClick={item(onArchive)}>
        <span className="mi-ico">↧</span> {song.archivedAt ? 'Unarchive' : 'Archive'}
      </button>
      <button type="button" className="menuItem danger" role="menuitem" onClick={item(onDelete)}>
        <span className="mi-ico">⌫</span> Delete
      </button>
    </div>,
    document.body,
  ) : null;

  return (
    <div className="menuWrap" onClick={(e) => e.stopPropagation()}>
      <button
        ref={trigRef} type="button" className="menuTrigger"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-label="Song actions" aria-haspopup="menu" aria-expanded={open}
      >⋮</button>
      {dropdown}
    </div>
  );
}

// ── Grid card ────────────────────────────────────────────────────────────────
function SongCard({ song, tweaks, on, selectedTags }) {
  const latest = song.versions.find((v) => v.isCurrent) ?? song.versions.at(-1);
  const vcount = song.versions.length;
  const hasDesc = tweaks.peek && song.description && song.description.trim().length > 0;
  const tags = song.tags ?? [];

  const open = () => on.open(song);
  const stop = (e) => e.stopPropagation();

  return (
    <article
      className="card" data-vis={song.visibility} role="button" tabIndex={0}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
    >
      <div className="cover">
        <div className="cover-vis">
          <SongVisual template={song.visualTemplate} p={song.visualPrimary} s={song.visualSecondary} />
        </div>
        <div className="coverOverlay">
          <div className="coverTop">
            <VisBadge visibility={song.visibility} badge={tweaks.badge} />
            <span className="vpill">v{latest ? latest.versionNumber : 0}</span>
          </div>
          <div className="coverBottom">
            <MiniWave />
            <button
              type="button" className="playRound" disabled={!latest}
              title={latest ? 'Play latest version' : 'No version to play'}
              onClick={(e) => { stop(e); on.play(song, latest); }}
            >▶</button>
          </div>
        </div>
      </div>

      <div className="body">
        <div className="titleRow">
          <a href="#" className="songName" onClick={(e) => { stop(e); e.preventDefault(); open(); }}>{song.name}</a>
          <div className="titleActions">
            <SongMenu song={song} {...on.menu(song)} />
          </div>
        </div>
        {song.genreHint && (
          <div className="metaRow">
            <span className="genreChip">{song.genreHint}</span>
          </div>
        )}
        {hasDesc && <p className="descPeek">{song.description}</p>}
        {tags.length > 0 && (
          <div className="cardTags">
            {tags.slice(0, 4).map((t) => (
              <button
                key={t.id} type="button" className="cardTag"
                data-public={t.isPublic} data-on={selectedTags?.has(t.name)}
                title={`Filter by #${t.name}`}
                onClick={(e) => { stop(e); on.toggleTag(t.name); }}
              >{t.name}</button>
            ))}
            {tags.length > 4 && <span className="cardTag more">+{tags.length - 4}</span>}
          </div>
        )}
      </div>

      {tweaks.strip !== 'off' && <VersionStrip versions={song.versions} shape={tweaks.strip} />}

      <div className="footer">
        {song.latestResult ? (
          <button type="button" className="reportBtn" onClick={(e) => { stop(e); on.report(song); }}>
            <span className="ico">▦</span> Analysis Results
          </button>
        ) : <span aria-hidden="true" />}
        <div className="footMeta">
          <span>{formatRelative(song.updatedAt)}</span>
          <span className="dotsep">·</span>
          <span>{vcount} {vcount === 1 ? 'version' : 'versions'}</span>
        </div>
      </div>
    </article>
  );
}

// ── List row ─────────────────────────────────────────────────────────────────
function SongRow({ song, tweaks, on }) {
  const latest = song.versions.find((v) => v.isCurrent) ?? song.versions.at(-1);
  const vcount = song.versions.length;
  const hasDesc = song.description && song.description.trim().length > 0;
  const stop = (e) => e.stopPropagation();
  const open = () => on.open(song);

  return (
    <div
      className="row" data-vis={song.visibility} role="button" tabIndex={0}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
    >
      <div className="rowCover">
        <SongVisual template={song.visualTemplate} p={song.visualPrimary} s={song.visualSecondary} mini />
      </div>
      <div className="rowMain">
        <div className="rowNameLine">
          <a href="#" className="rowName" onClick={(e) => { stop(e); e.preventDefault(); open(); }}>{song.name}</a>
          <VisBadge visibility={song.visibility} badge={tweaks.badge === 'label' ? 'label' : 'marker'} />
        </div>
        <span className="rowSub">
          {vcount} {vcount === 1 ? 'version' : 'versions'}{latest ? ` · v${latest.versionNumber}` : ''}{song.genreHint ? ` · ${song.genreHint}` : ''}
        </span>
      </div>
      <span className="rowDesc">{hasDesc ? song.description : <span style={{ color: 'var(--dim)' }}>—</span>}</span>
      <div className="rowStrip">
        <VersionStrip versions={song.versions} shape={tweaks.strip === 'off' ? 'dots' : tweaks.strip} />
      </div>
      <div className="rowActions" onClick={stop}>
        {song.latestResult && (
          <button type="button" className="rowReport" onClick={(e) => { stop(e); on.report(song); }}>Analysis Results</button>
        )}
        <button
          type="button" className="rowPlay" disabled={!latest}
          title={latest ? 'Play latest version' : 'No version to play'}
          onClick={(e) => { stop(e); on.play(song, latest); }}
        >▶</button>
      </div>
      <div className="rowMenu" onClick={stop}>
        <SongMenu song={song} {...on.menu(song)} />
      </div>
    </div>
  );
}

// ── Compact edit dialog (name · genre · visibility) ──────────────────────────
function EditDialog({ song, onClose, onSave }) {
  const [name, setName] = useState(song.name);
  const [genre, setGenre] = useState(song.genreHint ?? '');
  const [visibility, setVisibility] = useState(song.visibility);

  useEffect(() => {
    const onEsc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" data-vis={visibility} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button type="button" className="dialog-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="dialog-hd">
          <div className="dialog-title">Edit song</div>
          <div className="dialog-desc">Name, genre and who can see it. (Cover &amp; tags live in the full editor.)</div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="ed-name">Name</label>
          <input id="ed-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="ed-genre">Genre hint</label>
          <input id="ed-genre" className="input" value={genre} placeholder="e.g. Techno" onChange={(e) => setGenre(e.target.value)} />
        </div>
        <div className="field">
          <span className="field-label">Visibility</span>
          <div className="visSeg">
            {VIS_ORDER.map((key) => {
              const m = VIS_META[key];
              return (
                <button
                  key={key} type="button" className="visSegBtn" data-vis={key} data-on={visibility === key}
                  onClick={() => setVisibility(key)}
                >
                  <span className="vs-top"><span className="glyph">{m.glyph}</span>{m.label}</span>
                  <span className="vs-desc">{m.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button
            type="button" className="btn primary"
            onClick={() => onSave({ ...song, name: name.trim() || song.name, genreHint: genre.trim() || null, visibility })}
          >Save changes</button>
        </div>
      </div>
    </div>
  );
}

// ── Delete confirm dialog (destructive) ──────────────────────────────────────
function DeleteDialog({ song, onClose, onConfirm }) {
  const n = song.versions.length;
  useEffect(() => {
    const onEsc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog dialog-sm" data-vis={song.visibility} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button type="button" className="dialog-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="dialog-hd">
          <div className="dialog-title">Delete “{song.name}”?</div>
          <div className="dialog-desc">
            This permanently removes the song and all {n} version{n === 1 ? '' : 's'}, including any analysis results. This can’t be undone — to keep it but hide it, archive instead.
          </div>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn danger" onClick={() => onConfirm(song)}>Delete song</button>
        </div>
      </div>
    </div>
  );
}

// ── Filters ──────────────────────────────────────────────────────────────────
const FILTERS = [
  { key: 'all', label: 'All', vis: 'shared' },
  { key: 'private', label: 'Private', vis: 'private' },
  { key: 'shared', label: 'Shared', vis: 'shared' },
  { key: 'public', label: 'Public', vis: 'public' },
  { key: 'archived', label: 'Archived', vis: 'private' },
];
function matchesFilter(song, key) {
  if (key === 'all') return song.archivedAt == null;
  if (key === 'archived') return song.archivedAt != null;
  return song.archivedAt == null && song.visibility === key;
}

// ── Library view (the SongsLibrarySection equivalent) ────────────────────────
function LibraryView({ tweaks, setTweak, onToast }) {
  const [songs, setSongs] = useState(LIBRARY);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('recent');
  const [selectedTags, setSelectedTags] = useState(() => new Set());
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const view = tweaks.view;

  const tagMatch = (s) => selectedTags.size === 0 || (s.tags ?? []).some((t) => selectedTags.has(t.name));

  // Tag chips: unique tag names across active songs, with how many carry each.
  const allTags = useMemo(() => {
    const map = new Map();
    for (const s of songs) {
      if (s.archivedAt != null) continue;
      for (const t of s.tags ?? []) {
        const cur = map.get(t.name) ?? { name: t.name, isPublic: false, count: 0 };
        cur.count += 1; cur.isPublic = cur.isPublic || t.isPublic;
        map.set(t.name, cur);
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [songs]);

  // Pill counts reflect the active tag filter so the numbers always match the grid.
  const counts = useMemo(() => {
    const out = {};
    for (const f of FILTERS) out[f.key] = songs.filter((s) => matchesFilter(s, f.key) && tagMatch(s)).length;
    return out;
  }, [songs, selectedTags]);

  const filtered = useMemo(() => {
    const arr = songs.filter((s) => matchesFilter(s, filter) && tagMatch(s));
    arr.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'versions') return b.versions.length - a.versions.length;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    return arr;
  }, [songs, filter, sort, selectedTags]);

  const active = songs.filter((s) => s.archivedAt == null);
  const versionTotal = active.reduce((n, s) => n + s.versions.length, 0);
  const lastEdit = active.reduce((d, s) => {
    const t = new Date(s.updatedAt); return !d || t > d ? t : d;
  }, null);

  const toggleTag = (name) => setSelectedTags((prev) => {
    const next = new Set(prev);
    next.has(name) ? next.delete(name) : next.add(name);
    return next;
  });

  const setVisibility = (song, key) => {
    setSongs((list) => list.map((s) => (s.id === song.id ? { ...s, visibility: key } : s)));
    onToast(<>Set <b>“{song.name}”</b> to {VIS_META[key].label}</>, { vis: key });
  };
  const archive = (song) => {
    const archiving = song.archivedAt == null;
    setSongs((list) => list.map((s) => (s.id === song.id ? { ...s, archivedAt: archiving ? new Date().toISOString() : null } : s)));
    onToast(<><b>“{song.name}”</b> {archiving ? 'archived' : 'restored'}</>, {});
  };
  const confirmDelete = (song) => {
    setSongs((list) => list.filter((s) => s.id !== song.id));
    setDeleting(null);
    onToast(<><b>“{song.name}”</b> deleted</>, {});
  };
  const saveEdit = (next) => {
    setSongs((list) => list.map((s) => (s.id === next.id ? next : s)));
    setEditing(null);
    onToast(<>Saved <b>“{next.name}”</b></>, { vis: next.visibility });
  };

  // Handlers passed to every card/row.
  const on = {
    open: (song) => onToast(<>Opening <b>“{song.name}”</b></>, {}),
    play: (song, v) => v && onToast(<>Playing <b>“{song.name}”</b> v{v.versionNumber} in the listening room</>, {}),
    report: (song) => onToast(<>Opening analysis results for <b>“{song.name}”</b></>, {}),
    toggleTag,
    menu: (song) => ({
      onOpen: () => on.open(song),
      onEdit: () => setEditing(song),
      onAddVersion: () => onToast(<>Add a version to <b>“{song.name}”</b></>, {}),
      onArchive: () => archive(song),
      onDelete: () => setDeleting(song),
      onSetVisibility: (key) => setVisibility(song, key),
    }),
  };

  const emptyForTags = selectedTags.size > 0;

  return (
    <div className="page">
      <div className="modeBar">
        <div className="modeToggle" role="group" aria-label="Library section">
          <button type="button" className="modeToggleBtn" data-active="true">Songs</button>
          <button type="button" className="modeToggleBtn" onClick={() => onToast(<>References — separate section</>, {})}>References</button>
        </div>
      </div>

      <div className="header">
        <div className="headerText">
          <h1 className="title">Your library</h1>
          <p className="subtitle">
            {active.length} {active.length === 1 ? 'song' : 'songs'} · {versionTotal} {versionTotal === 1 ? 'version' : 'versions'}
            {lastEdit ? ` · last edit ${formatRelative(lastEdit)}` : ''}
          </p>
        </div>
        <div className="actions">
          <select className="sort mono" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort songs">
            <option value="recent">recent</option>
            <option value="name">name</option>
            <option value="versions">versions</option>
          </select>
          <div className="viewToggle" role="group" aria-label="View mode">
            <button type="button" className="viewToggleBtn" data-active={view === 'grid'} onClick={() => setTweak('view', 'grid')}>grid</button>
            <button type="button" className="viewToggleBtn" data-active={view === 'list'} onClick={() => setTweak('view', 'list')}>list</button>
          </div>
          <button type="button" className="btn primary" onClick={() => onToast(<>New song dialog</>, {})}>+ New song</button>
        </div>
      </div>

      <div className="filters">
        {FILTERS.map((f) => (
          <button
            key={f.key} type="button" className="filterPill" data-active={filter === f.key} data-vis={f.vis}
            onClick={() => setFilter(f.key)}
          >
            {f.key !== 'all' && f.key !== 'archived' && <span className="glyph">{VIS_META[f.key].glyph}</span>}
            {f.label}
            <span className="filterPillCount">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {allTags.length > 0 && (
        <div className="subfilters">
          <span className="subfilters-label">tags</span>
          <div className="tagChips">
            {allTags.map((t) => (
              <button
                key={t.name} type="button" className="tagChip"
                data-on={selectedTags.has(t.name)} data-public={t.isPublic}
                onClick={() => toggleTag(t.name)}
              >
                #{t.name}<span className="tc-count">{t.count}</span>
              </button>
            ))}
            {selectedTags.size > 0 && (
              <button type="button" className="tagClear" onClick={() => setSelectedTags(new Set())}>
                clear ({selectedTags.size})
              </button>
            )}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="empty" data-vis={filter === 'all' || filter === 'archived' ? 'shared' : filter}>
          <div className="emptyGlyph">{emptyForTags ? '#' : filter === 'archived' ? '⌫' : filter === 'all' ? '♪' : VIS_META[filter].glyph}</div>
          <p className="emptyTitle">Nothing here</p>
          <p className="emptySub">
            {emptyForTags
              ? 'No songs match these tags in this view. Clear the tag filter or pick a different visibility.'
              : 'No songs match this filter. Try another, or change a song’s visibility from its ⋮ menu.'}
          </p>
        </div>
      ) : view === 'list' ? (
        <div className="list">
          {filtered.map((song) => <SongRow key={song.id} song={song} tweaks={tweaks} on={on} />)}
        </div>
      ) : (
        <div className="grid" style={{ '--card-min': `${tweaks.cardMin}px` }}>
          {filtered.map((song) => <SongCard key={song.id} song={song} tweaks={tweaks} on={on} selectedTags={selectedTags} />)}
        </div>
      )}

      {editing && <EditDialog song={editing} onClose={() => setEditing(null)} onSave={saveEdit} />}
      {deleting && <DeleteDialog song={deleting} onClose={() => setDeleting(null)} onConfirm={confirmDelete} />}
    </div>
  );
}

Object.assign(window, { LibraryView, VisBadge, VersionStrip, SongCard, SongRow });
