import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useState, useRef, type MouseEvent } from 'react';
import { toast } from 'sonner';

import { useArchiveSong, useSongs } from '../../api/hooks';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { NewSongDialog } from '../../components/NewSongDialog';
import { SongEditDialog } from '../../components/SongEditDialog';
import { UnifiedUploadDialog } from '../../components/UnifiedUploadDialog';
import { normalizeGrade } from '../results/helpers/grade';
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
        <div className={s.empty}>
          <p className={s.emptyTitle}>
            {list.length === 0 ? 'No songs yet.' : 'No songs match this filter.'}
          </p>
          <p className={`mono ${s.emptySubtitle}`}>
            {list.length === 0
              ? 'Upload your first track to kick off an analysis.'
              : 'Try a different filter or upload another track.'}
          </p>
          {list.length === 0 && (
            <button
              type="button"
              className={`btn primary ${s.emptyAction}`}
              onClick={() => setNewSongOpen(true)}
            >
              + New song
            </button>
          )}
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const goToSong = () => {
    void navigate({ to: '/songs/$songId', params: { songId: song.id } });
  };

  const currentVersion = song.versions.find((v) => v.isCurrent) ?? song.versions.at(-1);
  const goToListen = (e: MouseEvent) => {
    e.stopPropagation();
    if (!currentVersion) return;
    void navigate({
      to: '/listen/$versionId',
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
            <div className={s.menuWrap} ref={menuRef}>
              <button
                type="button"
                className={s.menuTrigger}
                onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
                aria-label="Song actions"
              >
                ⋮
              </button>
              {menuOpen && (
                <div
                  className={s.menuDropdown}
                  onMouseLeave={() => setMenuOpen(false)}
                >
                  <button type="button" className={s.menuItem} onClick={(e) => { stop(e); setMenuOpen(false); onEdit(); }}>
                    Edit
                  </button>
                  <button type="button" className={`${s.menuItem} ${s.menuItemDanger}`} onClick={(e) => { stop(e); setMenuOpen(false); onArchive(); }}>
                    Archive
                  </button>
                </div>
              )}
            </div>
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
