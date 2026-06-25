import { Link, useNavigate } from '@tanstack/react-router';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

import {
  useArchiveSong,
  useDeleteSong,
  usePatchSong,
  useRestoreSong,
  useSongs,
} from '../../api/hooks';
import type { SongDto, SongVisibility } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { NewSongDialog } from '../../components/NewSongDialog';
import { SongEditDialog } from '../../components/SongEditDialog';
import { UnifiedUploadDialog } from '../../components/UnifiedUploadDialog';
import { CoverArt } from '../../ui/CoverArt';
import { hueFromId } from '../../ui/hueFromId';
import { formatRelative } from '../../ui/relativeTime';
import { SongVisual } from '../../ui/SongVisual';
import { visualFromDto } from '../../ui/songVisualModel';
import s from '../../routes/_app/library.module.css';
import {
  aggregateTags,
  FILTERS,
  latestVersion,
  matchesFilter,
  pillCounts,
  songMatchesTags,
  sortSongs,
  VIS_META,
  VIS_ORDER,
  visibilityOf,
  type SortKey,
  type VisFilterKey,
} from './library-helpers';

// Handlers the section supplies to every card/row. Visibility changes are NOT
// here — each card owns its own song-scoped `usePatchSong` (rules-of-hooks safe).
interface SongActions {
  onEdit: (song: SongDto) => void;
  onAddVersion: (song: SongDto) => void;
  onArchive: (song: SongDto) => void;
  onDelete: (song: SongDto) => void;
  onToggleTag: (name: string) => void;
}

const stop = (e: MouseEvent) => e.stopPropagation();

/** Song-scoped visibility PATCH + toast. One instance per card/row, so calling
 *  it in a list never violates the rules of hooks. */
function useVisibilityChange(song: SongDto): (visibility: SongVisibility) => void {
  const patch = usePatchSong(song.id);
  return (visibility) => {
    patch.mutate(
      { visibility },
      {
        onSuccess: () => toast.success(`Set "${song.name}" to ${VIS_META[visibility].label}`),
        onError: () => toast.error('Could not update visibility'),
      },
    );
  };
}

// ── Visibility badge ─────────────────────────────────────────────────────────
function VisBadge({
  visibility,
  badge = 'icon',
}: {
  visibility: SongVisibility;
  badge?: 'icon' | 'marker';
}) {
  const m = VIS_META[visibility];
  return (
    <span
      className={s.visBadge}
      data-vis={visibility}
      data-style={badge}
      title={`${m.label} — ${m.desc}`}
    >
      {badge === 'marker' ? (
        <span className={s.vmark} />
      ) : (
        <span className={s.glyph}>{m.glyph}</span>
      )}
      <span className={s.vlabel}>{m.label}</span>
    </span>
  );
}

// ── Version-sequence strip (display-only) ────────────────────────────────────
// One marker per version, the latest (highest versionNumber) accented; hover
// shows date/label. Not interactive — no per-marker navigation. The dashed rail
// behind the dots is where a future delta-connector (progress-over-versions)
// will render; see the `.vstripTrack::before` placeholder in the CSS module.
function VersionStrip({ versions }: { versions: SongDto['versions'] }) {
  if (versions.length === 0) {
    return (
      <div className={s.vstrip}>
        <span className={s.vstripEmpty}>no versions yet</span>
      </div>
    );
  }
  const latestNumber = versions.reduce((n, v) => Math.max(n, v.versionNumber), 0);
  return (
    <div className={s.vstrip}>
      <div className={s.vstripTrack}>
        {versions.map((v) => (
          <div
            className={s.vstripNode}
            key={v.id}
            data-latest={v.versionNumber === latestNumber}
          >
            <span className={s.vstripDot} />
            <span className={s.vstripTip}>
              <b>v{v.versionNumber}</b>
              {v.label ? ` · ${v.label}` : ''}{' '}
              <span>· {formatRelative(new Date(v.createdAt))}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniWave() {
  return (
    <div className={s.miniWave} aria-hidden="true">
      {Array.from({ length: 22 }).map((_, i) => {
        const v = 0.25 + (Math.sin(i * 0.7) * 0.5 + 0.5) * 0.65;
        return <div key={i} style={{ height: `${v * 100}%` }} />;
      })}
    </div>
  );
}

// ── Kebab menu ───────────────────────────────────────────────────────────────
// Open · Edit · Visibility ▸ · Add version · — · Archive/Unarchive · Delete.
// Portaled to <body> with fixed coords from the trigger rect so the card's
// overflow:hidden can never clip it. Flips up near the viewport bottom; the
// visibility submenu flips sides near an edge. Closes on outside-click/Esc/scroll.
function SongMenu({
  song,
  onOpen,
  onEdit,
  onAddVersion,
  onArchive,
  onDelete,
  onSetVisibility,
}: {
  song: SongDto;
  onOpen: () => void;
  onEdit: () => void;
  onAddVersion: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onSetVisibility: (visibility: SongVisibility) => void;
}) {
  const [open, setOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const trigRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const subTrigRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const vis = visibilityOf(song);

  const place = () => {
    const t = trigRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const W = 188;
    const H = 250;
    const M = 8;
    const left = Math.min(Math.max(M, r.right - W), window.innerWidth - W - M);
    let top = r.bottom + 5;
    if (top + H > window.innerHeight - M) top = Math.max(M, r.top - 5 - H);
    setPos({ top, left });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: globalThis.MouseEvent) => {
      const target = e.target as Node;
      if (trigRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
      setSubOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setSubOpen(false);
      }
    };
    const onScroll = () => {
      setOpen(false);
      setSubOpen(false);
    };
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
    if (subOpen && subTrigRef.current) {
      setFlip(subTrigRef.current.getBoundingClientRect().left < 210);
    }
  }, [subOpen]);

  const close = () => {
    setOpen(false);
    setSubOpen(false);
  };
  const item = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    close();
    fn();
  };

  const dropdown =
    open && pos
      ? createPortal(
          <div
            ref={menuRef}
            className={`${s.menuDropdown} ${s.menuPortal}`}
            role="menu"
            style={{ top: pos.top, left: pos.left }}
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" className={s.menuItem} role="menuitem" onClick={item(onOpen)}>
              <span className={s.miIco}>↗</span> Open
            </button>
            <button type="button" className={s.menuItem} role="menuitem" onClick={item(onEdit)}>
              <span className={s.miIco}>✎</span> Edit
            </button>
            <div
              className={s.submenu}
              onMouseEnter={() => {
                clearTimeout(closeTimer.current);
                setSubOpen(true);
              }}
              onMouseLeave={() => {
                closeTimer.current = setTimeout(() => setSubOpen(false), 160);
              }}
            >
              <button
                ref={subTrigRef}
                type="button"
                className={s.menuItem}
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={subOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  setSubOpen((v) => !v);
                }}
              >
                <span className={s.miIco}>{VIS_META[vis].glyph}</span> Visibility
                <span className={s.miCaret}>▸</span>
              </button>
              {subOpen && (
                <div className={`${s.submenuPanel}${flip ? ` ${s.flip}` : ''}`} role="menu">
                  {VIS_ORDER.map((key) => {
                    const m = VIS_META[key];
                    return (
                      <button
                        key={key}
                        type="button"
                        className={s.subItem}
                        role="menuitemradio"
                        aria-checked={vis === key}
                        data-vis={key}
                        onClick={item(() => onSetVisibility(key))}
                      >
                        <span className={s.glyph}>{m.glyph}</span>
                        <span className={s.siMain}>
                          <span className={s.siName}>{m.label}</span>
                          <span className={s.siDesc}>{m.desc}</span>
                        </span>
                        {vis === key && <span className={s.siCheck}>✓</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <button
              type="button"
              className={s.menuItem}
              role="menuitem"
              onClick={item(onAddVersion)}
            >
              <span className={s.miIco}>＋</span> Add version
            </button>
            <div className={s.menuSep} />
            <button type="button" className={s.menuItem} role="menuitem" onClick={item(onArchive)}>
              <span className={s.miIco}>↧</span> {song.archivedAt ? 'Unarchive' : 'Archive'}
            </button>
            <button
              type="button"
              className={`${s.menuItem} ${s.menuItemDanger}`}
              role="menuitem"
              onClick={item(onDelete)}
            >
              <span className={s.miIco}>⌫</span> Delete
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={s.menuWrap} onClick={(e) => e.stopPropagation()} role="presentation">
      <button
        ref={trigRef}
        type="button"
        className={s.menuTrigger}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="Song actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ⋮
      </button>
      {dropdown}
    </div>
  );
}

// ── Grid card ────────────────────────────────────────────────────────────────
function SongCard({
  song,
  selectedTags,
  actions,
}: {
  song: SongDto;
  selectedTags: ReadonlySet<string>;
  actions: SongActions;
}) {
  const navigate = useNavigate();
  const setVisibility = useVisibilityChange(song);
  const latest = latestVersion(song);
  const vcount = song.versions.length;
  const vis = visibilityOf(song);
  const hasDesc = Boolean(song.description && song.description.trim().length > 0);
  const tags = song.tags;

  const goToSong = () => {
    void navigate({ to: '/songs/$songId', params: { songId: song.id } });
  };
  const goToListen = () => {
    if (!latest) return;
    void navigate({ to: '/listen-rack/$versionId', params: { versionId: latest.id } });
  };
  const goToReport = () => {
    if (!song.latestResult) return;
    void navigate({
      to: '/songs/$songId/results/$jobId',
      params: { songId: song.id, jobId: song.latestResult.jobId },
    });
  };

  return (
    <article
      className={s.card}
      data-vis={vis}
      role="button"
      tabIndex={0}
      onClick={goToSong}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          goToSong();
        }
      }}
    >
      <div className={s.cover}>
        <CoverArt
          hue={hueFromId(song.id)}
          visual={visualFromDto(song.visualTemplate, song.visualPrimary, song.visualSecondary)}
          size="fluid"
          ratio={2.1}
        />
        <div className={s.coverOverlay}>
          <div className={s.coverTop}>
            <VisBadge visibility={vis} badge="icon" />
            <span className={s.vpill}>v{latest ? latest.versionNumber : 0}</span>
          </div>
          <div className={s.coverBottom}>
            <MiniWave />
            <button
              type="button"
              className={s.playRound}
              disabled={!latest}
              title={latest ? 'Play latest version' : 'No version to play'}
              onClick={(e) => {
                stop(e);
                goToListen();
              }}
            >
              ▶
            </button>
          </div>
        </div>
      </div>

      <div className={s.body}>
        <div className={s.titleRow}>
          <Link
            to="/songs/$songId"
            params={{ songId: song.id }}
            className={s.songName}
            onClick={stop}
          >
            {song.name}
          </Link>
          <div className={s.titleActions}>
            <SongMenu
              song={song}
              onOpen={goToSong}
              onEdit={() => actions.onEdit(song)}
              onAddVersion={() => actions.onAddVersion(song)}
              onArchive={() => actions.onArchive(song)}
              onDelete={() => actions.onDelete(song)}
              onSetVisibility={setVisibility}
            />
          </div>
        </div>
        {song.genreHint && (
          <div className={s.metaRow}>
            <span className={s.genreChip}>{song.genreHint}</span>
          </div>
        )}
        {hasDesc && <p className={s.descPeek}>{song.description}</p>}
        {tags.length > 0 && (
          <div className={s.cardTags}>
            {tags.slice(0, 4).map((t) => (
              <button
                key={t.id}
                type="button"
                className={s.cardTag}
                data-public={t.isPublic}
                data-on={selectedTags.has(t.name)}
                title={`Filter by #${t.name}`}
                onClick={(e) => {
                  stop(e);
                  actions.onToggleTag(t.name);
                }}
              >
                {t.name}
              </button>
            ))}
            {tags.length > 4 && (
              <span className={`${s.cardTag} ${s.cardTagMore}`}>+{tags.length - 4}</span>
            )}
          </div>
        )}
      </div>

      <VersionStrip versions={song.versions} />

      <div className={s.footer}>
        {song.latestResult ? (
          <button
            type="button"
            className={s.reportBtn}
            onClick={(e) => {
              stop(e);
              goToReport();
            }}
          >
            <span className={s.ico}>▦</span> Analysis Results
          </button>
        ) : (
          <span aria-hidden="true" />
        )}
        <div className={s.footMeta}>
          <span>{formatRelative(new Date(song.updatedAt))}</span>
          <span className={s.dotsep}>·</span>
          <span>
            {vcount} {vcount === 1 ? 'version' : 'versions'}
          </span>
        </div>
      </div>
    </article>
  );
}

// ── List row ─────────────────────────────────────────────────────────────────
function SongRow({ song, actions }: { song: SongDto; actions: SongActions }) {
  const navigate = useNavigate();
  const setVisibility = useVisibilityChange(song);
  const latest = latestVersion(song);
  const vcount = song.versions.length;
  const vis = visibilityOf(song);
  const hasDesc = Boolean(song.description && song.description.trim().length > 0);
  const visual = visualFromDto(song.visualTemplate, song.visualPrimary, song.visualSecondary);
  const fallbackHue = hueFromId(song.id);

  const goToSong = () => {
    void navigate({ to: '/songs/$songId', params: { songId: song.id } });
  };
  const goToListen = () => {
    if (!latest) return;
    void navigate({ to: '/listen-rack/$versionId', params: { versionId: latest.id } });
  };
  const goToReport = () => {
    if (!song.latestResult) return;
    void navigate({
      to: '/songs/$songId/results/$jobId',
      params: { songId: song.id, jobId: song.latestResult.jobId },
    });
  };

  return (
    <div
      className={s.row}
      data-vis={vis}
      role="button"
      tabIndex={0}
      onClick={goToSong}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          goToSong();
        }
      }}
    >
      <div className={s.rowCover}>
        <SongVisual
          template={visual?.template ?? 'aurora'}
          primary={visual?.primary ?? { l: 0.72, c: 0.18, h: fallbackHue }}
          secondary={visual?.secondary ?? { l: 0.46, c: 0.16, h: (fallbackHue + 60) % 360 }}
          mini
        />
      </div>
      <div className={s.rowMain}>
        <div className={s.rowNameLine}>
          <Link
            to="/songs/$songId"
            params={{ songId: song.id }}
            className={s.rowName}
            onClick={stop}
          >
            {song.name}
          </Link>
          <VisBadge visibility={vis} badge="marker" />
        </div>
        <span className={`mono ${s.rowSub}`}>
          {vcount} {vcount === 1 ? 'version' : 'versions'}
          {latest ? ` · v${latest.versionNumber}` : ''}
          {song.genreHint ? ` · ${song.genreHint}` : ''}
        </span>
      </div>
      <span className={s.rowDesc}>
        {hasDesc ? song.description : <span className={s.rowDescEmpty}>—</span>}
      </span>
      <div className={s.rowStrip}>
        <VersionStrip versions={song.versions} />
      </div>
      <div className={s.rowActions} onClick={stop} role="presentation">
        {song.latestResult && (
          <button
            type="button"
            className={s.rowReport}
            onClick={(e) => {
              stop(e);
              goToReport();
            }}
          >
            Analysis Results
          </button>
        )}
        <button
          type="button"
          className={s.rowPlay}
          disabled={!latest}
          title={latest ? 'Play latest version' : 'No version to play'}
          onClick={(e) => {
            stop(e);
            goToListen();
          }}
        >
          ▶
        </button>
      </div>
      <div className={s.rowMenu} onClick={stop} role="presentation">
        <SongMenu
          song={song}
          onOpen={goToSong}
          onEdit={() => actions.onEdit(song)}
          onAddVersion={() => actions.onAddVersion(song)}
          onArchive={() => actions.onArchive(song)}
          onDelete={() => actions.onDelete(song)}
          onSetVisibility={setVisibility}
        />
      </div>
    </div>
  );
}

type ViewMode = 'grid' | 'list';

/** The "Songs" section of the library. Owns its own query + dialog state; the
 *  /library shell renders the page wrapper and the Songs/References toggle. */
export function SongsLibrarySection() {
  const { data: songs, isLoading, error } = useSongs();
  const [newSongOpen, setNewSongOpen] = useState(false);
  const [uploadSongId, setUploadSongId] = useState<string | undefined>(undefined);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [filter, setFilter] = useState<VisFilterKey>('all');
  const [sort, setSort] = useState<SortKey>('recent');
  const [view, setView] = useState<ViewMode>('grid');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(() => new Set());
  const [editSong, setEditSong] = useState<SongDto | null>(null);
  const [deleteSong, setDeleteSong] = useState<SongDto | null>(null);

  const archive = useArchiveSong();
  const restore = useRestoreSong();
  const del = useDeleteSong();

  const list = useMemo(() => songs ?? [], [songs]);
  const allTags = useMemo(() => aggregateTags(list), [list]);
  const counts = useMemo(() => pillCounts(list, selectedTags), [list, selectedTags]);
  const filtered = useMemo(() => {
    const arr = list.filter((x) => matchesFilter(x, filter) && songMatchesTags(x, selectedTags));
    return sortSongs(arr, sort);
  }, [list, filter, sort, selectedTags]);

  const openUpload = (songId?: string) => {
    setUploadSongId(songId);
    setUploadOpen(true);
  };

  const toggleTag = (name: string) =>
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const handleArchive = async (song: SongDto) => {
    const archiving = song.archivedAt == null;
    try {
      if (archiving) await archive.mutateAsync(song.id);
      else await restore.mutateAsync(song.id);
      toast.success(`"${song.name}" ${archiving ? 'archived' : 'restored'}`);
    } catch {
      toast.error(`Could not ${archiving ? 'archive' : 'restore'} song`);
    }
  };

  const actions: SongActions = {
    onEdit: setEditSong,
    onAddVersion: (song) => openUpload(song.id),
    onArchive: (song) => void handleArchive(song),
    onDelete: setDeleteSong,
    onToggleTag: toggleTag,
  };

  if (isLoading) {
    return <p className={`mono ${s.status}`}>Loading library…</p>;
  }
  if (error) {
    return (
      <p className={s.error}>
        Could not load library: {error instanceof Error ? error.message : String(error)}
      </p>
    );
  }

  const uploadSong = list.find((x) => x.id === uploadSongId);
  const active = list.filter((x) => x.archivedAt == null);
  const versionCount = active.reduce((acc, song) => acc + song.versions.length, 0);
  const lastEdit = active.reduce<Date | null>((latest, song) => {
    const d = new Date(song.updatedAt);
    return !latest || d > latest ? d : latest;
  }, null);

  const emptyForTags = selectedTags.size > 0;

  return (
    <>
      <div className={s.header}>
        <div className={s.headerText}>
          <h1 className={s.title}>Your library</h1>
          <p className={s.subtitle}>
            {active.length} {active.length === 1 ? 'song' : 'songs'} · {versionCount}{' '}
            {versionCount === 1 ? 'version' : 'versions'}
            {lastEdit ? ` · last edit ${formatRelative(lastEdit)}` : ''}
          </p>
        </div>
        <div className={s.actions}>
          <select
            className={s.sort}
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort songs"
          >
            <option value="recent">recent</option>
            <option value="name">name</option>
            <option value="versions">versions</option>
          </select>
          <div className={s.viewToggle} role="group" aria-label="View mode">
            <button
              type="button"
              className={s.viewToggleBtn}
              data-active={view === 'grid'}
              onClick={() => setView('grid')}
            >
              grid
            </button>
            <button
              type="button"
              className={s.viewToggleBtn}
              data-active={view === 'list'}
              onClick={() => setView('list')}
            >
              list
            </button>
          </div>
          <button type="button" className="btn primary" onClick={() => setNewSongOpen(true)}>
            + New song
          </button>
        </div>
      </div>

      <div className={s.filters}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={s.filterPill}
            data-active={filter === f.key}
            data-vis={f.vis}
            onClick={() => setFilter(f.key)}
          >
            {f.key !== 'all' && f.key !== 'archived' && (
              <span className={s.glyph}>{VIS_META[f.key].glyph}</span>
            )}
            {f.label}
            <span className={s.filterPillCount}>{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {allTags.length > 0 && (
        <div className={s.subfilters}>
          <span className={s.subfiltersLabel}>tags</span>
          <div className={s.tagChips}>
            {allTags.map((t) => (
              <button
                key={t.name}
                type="button"
                className={s.tagChip}
                data-on={selectedTags.has(t.name)}
                data-public={t.isPublic}
                onClick={() => toggleTag(t.name)}
              >
                #{t.name}
                <span className={s.tcCount}>{t.count}</span>
              </button>
            ))}
            {selectedTags.size > 0 && (
              <button
                type="button"
                className={s.tagClear}
                onClick={() => setSelectedTags(new Set())}
              >
                clear ({selectedTags.size})
              </button>
            )}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <LibraryEmptyState
          filter={filter}
          emptyForTags={emptyForTags}
          isFirstRun={list.length === 0}
          onNewSong={() => setNewSongOpen(true)}
        />
      ) : view === 'list' ? (
        <div className={s.list}>
          {filtered.map((song) => (
            <SongRow key={song.id} song={song} actions={actions} />
          ))}
        </div>
      ) : (
        <div className={s.grid}>
          {filtered.map((song) => (
            <SongCard key={song.id} song={song} selectedTags={selectedTags} actions={actions} />
          ))}
        </div>
      )}

      <NewSongDialog
        open={newSongOpen}
        onOpenChange={setNewSongOpen}
        onCreated={(id) => openUpload(id)}
      />
      <UnifiedUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        {...(uploadSongId ? { songId: uploadSongId } : {})}
        {...(uploadSong?.genreHint ? { defaultGenre: uploadSong.genreHint } : {})}
      />
      {editSong && (
        <SongEditDialog
          open={editSong !== null}
          onOpenChange={(v) => {
            if (!v) setEditSong(null);
          }}
          song={editSong}
        />
      )}
      <ConfirmDialog
        open={deleteSong !== null}
        onOpenChange={(v) => {
          if (!v) setDeleteSong(null);
        }}
        title={`Delete "${deleteSong?.name}"?`}
        description={deleteCopy(deleteSong)}
        confirmLabel="Delete song"
        danger
        onConfirm={async () => {
          if (!deleteSong) return;
          try {
            await del.mutateAsync(deleteSong.id);
            toast.success(`"${deleteSong.name}" deleted`);
          } catch {
            toast.error('Could not delete song');
          }
        }}
        isPending={del.isPending}
      />
    </>
  );
}

function deleteCopy(song: SongDto | null): string {
  const n = song?.versions.length ?? 0;
  return `This permanently removes the song and all ${n} version${n === 1 ? '' : 's'}, including any analysis results. This can't be undone — to keep it but hide it, archive instead.`;
}

/** Empty state — drops the grade-specific copy; speaks to the active filter. */
function LibraryEmptyState({
  filter,
  emptyForTags,
  isFirstRun,
  onNewSong,
}: {
  filter: VisFilterKey;
  emptyForTags: boolean;
  isFirstRun: boolean;
  onNewSong: () => void;
}) {
  const vis: SongVisibility = filter === 'all' || filter === 'archived' ? 'shared' : filter;
  const glyph = emptyForTags
    ? '#'
    : filter === 'archived'
      ? '⌫'
      : filter === 'all'
        ? '♪'
        : VIS_META[filter].glyph;
  return (
    <div className={s.empty} data-vis={vis}>
      <div className={s.emptyGlyph}>{glyph}</div>
      <p className={s.emptyTitle}>{isFirstRun ? 'Your library starts here' : 'Nothing here'}</p>
      <p className={s.emptySub}>
        {isFirstRun
          ? 'Upload a track to get a full mix report — then listen to it through the rack and watch each version build up.'
          : emptyForTags
            ? 'No songs match these tags in this view. Clear the tag filter or pick a different visibility.'
            : 'No songs match this filter. Try another, or change a song’s visibility from its ⋮ menu.'}
      </p>
      {isFirstRun && (
        <button type="button" className={`btn primary ${s.emptyAction}`} onClick={onNewSong}>
          + New song
        </button>
      )}
    </div>
  );
}
