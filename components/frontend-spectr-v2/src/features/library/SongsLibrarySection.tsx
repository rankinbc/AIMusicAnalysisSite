import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState, useRef, type MouseEvent } from 'react';
import { toast } from 'sonner';

import { useArchiveSong, useSongs } from '../../api/hooks';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { NewSongDialog } from '../../components/NewSongDialog';
import { SongEditDialog } from '../../components/SongEditDialog';
import { UnifiedUploadDialog } from '../../components/UnifiedUploadDialog';
import { normalizeGrade, gradeColor } from '../results/helpers/grade';
import { CoverArt } from '../../ui/CoverArt';
import { hueFromId } from '../../ui/hueFromId';
import { GradePill } from '../../ui/GradePill';
import { Pill } from '../../ui/Pill';
import { VersionArc, type VersionArcPoint } from '../../ui/VersionArc';
import { formatRelative } from '../../ui/relativeTime';
import s from '../../routes/_app/library.module.css';
import type { SongDto } from '../../api/types';

type FilterKey = 'all' | 'a' | 'b' | 'needs' | 'progress' | 'archived';
type SortKey = 'updated' | 'name' | 'grade';
type ViewMode = 'grid' | 'list';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'all' },
  { key: 'a', label: 'A grade' },
  { key: 'b', label: 'B grade' },
  { key: 'needs', label: 'Needs work' },
  { key: 'progress', label: 'In progress' },
  { key: 'archived', label: 'Archived' },
];

function matchesFilter(song: SongDto, filter: FilterKey): boolean {
  const grade = normalizeGrade(song.latestResult?.grade);
  switch (filter) {
    case 'all':
      return song.archivedAt == null;
    case 'a':
      return song.archivedAt == null && grade === 'A';
    case 'b':
      return song.archivedAt == null && grade === 'B';
    case 'needs':
      return song.archivedAt == null && (grade === 'C' || grade === 'D' || grade === 'F');
    case 'progress':
      return song.archivedAt == null && song.latestResult == null;
    case 'archived':
      return song.archivedAt != null;
    default:
      return true;
  }
}

/** The "Songs" section of the library. Owns its own query + dialog state; the
 *  /library shell renders the page wrapper and the Songs/References toggle. */
export function SongsLibrarySection() {
  const { data: songs, isLoading, error } = useSongs();
  const [newSongOpen, setNewSongOpen] = useState(false);
  const [uploadSongId, setUploadSongId] = useState<string | undefined>(undefined);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sort, setSort] = useState<SortKey>('updated');
  const [view, setView] = useState<ViewMode>('grid');
  const [editSong, setEditSong] = useState<SongDto | null>(null);
  const [archiveSong, setArchiveSong] = useState<SongDto | null>(null);
  const archive = useArchiveSong();

  const openUpload = (songId?: string) => {
    setUploadSongId(songId);
    setUploadOpen(true);
  };

  const list = useMemo(() => songs ?? [], [songs]);

  const counts = useMemo(() => {
    const out: Record<FilterKey, number> = {
      all: 0,
      a: 0,
      b: 0,
      needs: 0,
      progress: 0,
      archived: 0,
    };
    for (const song of list) {
      for (const k of Object.keys(out) as FilterKey[]) {
        if (matchesFilter(song, k)) out[k] += 1;
      }
    }
    return out;
  }, [list]);

  const filtered = useMemo(() => {
    const arr = list.filter((x) => matchesFilter(x, filter));
    arr.sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'grade': {
          const ga = normalizeGrade(a.latestResult?.grade) ?? 'Z';
          const gb = normalizeGrade(b.latestResult?.grade) ?? 'Z';
          return ga.localeCompare(gb);
        }
        case 'updated':
        default:
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });
    return arr;
  }, [list, filter, sort]);

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
  const versionCount = list.reduce((acc, song) => acc + song.versions.length, 0);
  const lastEdit = list.reduce<Date | null>((latest, song) => {
    const d = new Date(song.updatedAt);
    return !latest || d > latest ? d : latest;
  }, null);

  return (
    <>
      <div className={s.header}>
        <div className={s.headerText}>
          <h1 className={s.title}>Your library</h1>
          <p className={s.subtitle}>
            {list.length} {list.length === 1 ? 'song' : 'songs'} · {versionCount}{' '}
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
            <option value="updated">recent</option>
            <option value="name">name</option>
            <option value="grade">grade</option>
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
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            <span className={s.filterPillCount}>{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <LibraryEmptyState
          isFirstRun={list.length === 0}
          onNewSong={() => setNewSongOpen(true)}
        />
      ) : view === 'list' ? (
        <div className={s.list}>
          {filtered.map((song) => (
            <SongRow
              key={song.id}
              song={song}
              onEdit={() => setEditSong(song)}
              onArchive={() => setArchiveSong(song)}
            />
          ))}
        </div>
      ) : (
        <div className={s.grid}>
          {filtered.map((song) => (
            <SongCard
              key={song.id}
              song={song}
              onUpload={() => openUpload(song.id)}
              onEdit={() => setEditSong(song)}
              onArchive={() => setArchiveSong(song)}
            />
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
          onOpenChange={(v) => { if (!v) setEditSong(null); }}
          song={editSong}
        />
      )}
      <ConfirmDialog
        open={archiveSong !== null}
        onOpenChange={(v) => { if (!v) setArchiveSong(null); }}
        title="Archive song"
        description={`Archive "${archiveSong?.name}"? It will be hidden from your library but not deleted.`}
        confirmLabel="Archive"
        onConfirm={async () => {
          if (!archiveSong) return;
          try {
            await archive.mutateAsync(archiveSong.id);
            toast.success(`"${archiveSong.name}" archived`);
          } catch {
            toast.error('Could not archive song');
          }
        }}
        isPending={archive.isPending}
      />
    </>
  );
}

function SongCard({
  song,
  onEdit,
  onArchive,
}: {
  song: SongDto;
  onUpload: () => void;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const navigate = useNavigate();
  const hue = hueFromId(song.id);
  const versionCount = song.versions.length;
  const versionPoints: VersionArcPoint[] = song.versions.map((v) => ({
    versionNumber: v.versionNumber,
    score: v.versionNumber === versionCount ? song.latestResult?.score ?? null : null,
    grade: v.versionNumber === versionCount ? song.latestResult?.grade ?? null : null,
  }));
  const grade = song.latestResult?.grade;
  const updated = new Date(song.updatedAt);

  const goToSong = () => {
    void navigate({ to: '/songs/$songId', params: { songId: song.id } });
  };

  const currentVersion = song.versions.find((v) => v.isCurrent) ?? song.versions.at(-1);
  const goToListen = (e: MouseEvent) => {
    e.stopPropagation();
    if (!currentVersion) return;
    void navigate({
      to: '/listen-rack/$versionId',
      params: { versionId: currentVersion.id },
    });
  };

  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <div
      className={s.card}
      onClick={goToSong}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          goToSong();
        }
      }}
    >
      <div className={s.cover}>
        <CoverArt hue={hue} size="fluid" ratio={2.1} />
        <div className={s.coverOverlay}>
          <div className={s.coverTop}>
            {grade ? <GradePill grade={grade} size="sm" /> : <span />}
            <Pill tone="cyan" className={s.versionPillCorner}>
              v{versionCount}
            </Pill>
          </div>
          <div className={s.coverBottom}>
            <div className={s.miniWave} aria-hidden="true">
              {Array.from({ length: 24 }).map((_, i) => {
                const v = 0.25 + (Math.sin(i * 0.7) * 0.5 + 0.5) * 0.65;
                return <div key={i} style={{ height: `${v * 100}%` }} />;
              })}
            </div>
            <button
              type="button"
              className={s.playRound}
              onClick={goToListen}
              disabled={!currentVersion}
              title={currentVersion ? 'Open in Listen' : 'No version to play'}
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
          <div className={s.titleActions} onClick={stop} onKeyDown={undefined} role="presentation">
            <SongMenu onEdit={onEdit} onArchive={onArchive} />
          </div>
        </div>
        <p className={s.cardMeta}>
          {[song.genreHint, song.latestResult?.score != null ? `${song.latestResult.score}/100` : null]
            .filter(Boolean)
            .join(' · ') || '— no analysis yet'}
        </p>
        {song.tags.length > 0 && (
          <div className={s.cardTags}>
            {song.tags.slice(0, 4).map((t) => (
              <span key={t.id} className={s.cardTag} data-public={t.isPublic}>
                {t.name}
              </span>
            ))}
            {song.tags.length > 4 && (
              <span className={s.cardTag}>+{song.tags.length - 4}</span>
            )}
          </div>
        )}
      </div>

      <div className={s.arc}>
        <VersionArc versions={versionPoints} compact />
      </div>

      <div className={s.footer}>
        <span>{formatRelative(updated)}</span>
        <span>{versionCount} v</span>
      </div>
    </div>
  );
}

/** Kebab menu shared by the grid card and list row (Edit / Archive). Owns its
 *  own open state and closes on outside click. Callers wrap it in a
 *  click-stopping container so opening the menu never triggers row navigation. */
function SongMenu({ onEdit, onArchive }: { onEdit: () => void; onArchive: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div className={s.menuWrap} ref={ref}>
      <button
        type="button"
        className={s.menuTrigger}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-label="Song actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ⋮
      </button>
      {open && (
        <div className={s.menuDropdown} role="menu">
          <button
            type="button"
            className={s.menuItem}
            role="menuitem"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onEdit(); }}
          >
            Edit
          </button>
          <button
            type="button"
            className={`${s.menuItem} ${s.menuItemDanger}`}
            role="menuitem"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onArchive(); }}
          >
            Archive
          </button>
        </div>
      )}
    </div>
  );
}

/** Compact grade-chip strip for the list row. Only the latest version carries a
 *  known grade (from latestResult); earlier versions render as muted markers
 *  until each has its own analysis. */
function VersionStrip({ versions, latestGrade }: { versions: SongDto['versions']; latestGrade: string | null }) {
  return (
    <div className={s.versionStrip} aria-hidden="true">
      {versions.map((v, i) => {
        const isLast = i === versions.length - 1;
        const grade = isLast ? normalizeGrade(latestGrade) : null;
        const color = grade ? gradeColor(grade) : 'var(--muted)';
        return (
          <span
            key={v.id}
            className={`mono ${s.versionChip}`}
            style={{ color, borderColor: `${color}30`, background: `${color}14` }}
          >
            {grade ?? '·'}
          </span>
        );
      })}
    </div>
  );
}

/** List-view row — the same iteration story as the card, laid out horizontally. */
function SongRow({
  song,
  onEdit,
  onArchive,
}: {
  song: SongDto;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const navigate = useNavigate();
  const hue = hueFromId(song.id);
  const versionCount = song.versions.length;
  const currentVersion = song.versions.find((v) => v.isCurrent) ?? song.versions.at(-1);
  const grade = song.latestResult?.grade;

  const goToSong = () => {
    void navigate({ to: '/songs/$songId', params: { songId: song.id } });
  };
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <div
      className={s.row}
      onClick={goToSong}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          goToSong();
        }
      }}
    >
      <CoverArt hue={hue} size="sm" />
      <div className={s.rowMain}>
        <Link
          to="/songs/$songId"
          params={{ songId: song.id }}
          className={s.rowName}
          onClick={stop}
        >
          {song.name}
        </Link>
        <span className={`mono ${s.rowSub}`}>
          {versionCount} {versionCount === 1 ? 'version' : 'versions'}
          {currentVersion ? ` · last v${currentVersion.versionNumber}` : ''}
          {currentVersion?.label ? ` · ${currentVersion.label}` : ''}
        </span>
      </div>
      <span className={`mono ${s.rowMeta}`}>
        {[song.genreHint, song.latestResult?.score != null ? `${song.latestResult.score}/100` : null]
          .filter(Boolean)
          .join(' · ') || '— no analysis yet'}
      </span>
      <VersionStrip versions={song.versions} latestGrade={grade ?? null} />
      <div className={s.rowGrade}>
        {grade ? <GradePill grade={grade} size="sm" /> : <span className={`mono ${s.rowSub}`}>—</span>}
      </div>
      <div className={s.rowActions} onClick={stop} onKeyDown={undefined} role="presentation">
        <SongMenu onEdit={onEdit} onArchive={onArchive} />
      </div>
    </div>
  );
}

/** Designed empty state — previews the filled shape (ghost cards) so a new
 *  library hints at what it becomes, with a single primary CTA. */
function LibraryEmptyState({
  isFirstRun,
  onNewSong,
}: {
  isFirstRun: boolean;
  onNewSong: () => void;
}) {
  return (
    <div className={s.empty}>
      <div className={s.emptyPreview} aria-hidden="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className={s.ghostCard}>
            <div className={s.ghostCover}>
              <CoverArt hue={168 + i * 56} size="fluid" ratio={2.1} />
            </div>
            <div className={s.ghostBody}>
              <div className={s.ghostLine} style={{ width: `${70 - i * 12}%` }} />
              <div className={s.ghostLine} style={{ width: '40%', opacity: 0.6 }} />
            </div>
            <div className={s.ghostArc} />
          </div>
        ))}
      </div>
      <p className={s.emptyTitle}>
        {isFirstRun ? 'Your library starts here' : 'No songs match this filter'}
      </p>
      <p className={`mono ${s.emptySubtitle}`}>
        {isFirstRun
          ? 'Upload a track to get a graded mix report — then watch each version climb the arc.'
          : 'Try a different filter, or upload another track.'}
      </p>
      {isFirstRun && (
        <button type="button" className={`btn primary ${s.emptyAction}`} onClick={onNewSong}>
          + New song
        </button>
      )}
    </div>
  );
}
