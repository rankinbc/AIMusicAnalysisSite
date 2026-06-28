import { useRef, useState } from 'react';

import type { BookmarkDto } from '../../api/types';
import { bookmarksForVersion, markerPct } from './bookmarks-helpers';
import { useCreateBookmark, useDeleteBookmark, useMyBookmarks } from './useBookmarks';
import { useBookmarkSignal } from './useBookmarkSignal';
import s from './BookmarksRail.module.css';

function fmt(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const r = Math.floor(sec % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}

interface BookmarksRailProps {
  versionId: string;
  durationSeconds: number;
  position: number;
  onSeek: (t: number) => void;
  isOwner: boolean;
}

/**
 * Story 11.3 — timestamped bookmarks for the version. Markers align to the
 * transport timeline (click → seek); add at the playhead with an optional note;
 * per-bookmark name-toggle (server upsert) + note-edit (delete+recreate, no PATCH)
 * + delete. Owner sees the aggregate bookmark signal (count + opted-in names).
 */
export function BookmarksRail({ versionId, durationSeconds, position, onSeek, isOwner }: BookmarksRailProps) {
  const myQ = useMyBookmarks();
  const createMut = useCreateBookmark();
  const deleteMut = useDeleteBookmark();
  // AC4: the owner-only signal request is gated by `enabled` — a non-owner never fires it.
  const signalQ = useBookmarkSignal(versionId, isOwner);

  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  // Closing the editor unmounts the input, which fires its onBlur. Without this
  // guard that blur re-invokes commitNote (double delete+recreate), and Escape —
  // which also closes the editor — would commit instead of cancel. The ref is
  // synchronous so it blocks the same-tick blur a state flag can't (review 11.3).
  const editCommitted = useRef(false);

  const bookmarks = bookmarksForVersion(myQ.data ?? [], versionId);

  const openEdit = (b: BookmarkDto) => {
    editCommitted.current = false;
    setEditing(b.id);
    setEditText(b.note ?? '');
  };

  const add = () => {
    if (createMut.isPending) return;
    createMut.mutate(
      { targetVersionId: versionId, t: Number.isFinite(position) ? Math.round(position) : 0, note: note.trim() || null },
      { onSuccess: () => setNote('') },
    );
  };

  // Server upsert toggles identity_visible on a repeat (same version + t) POST.
  const toggleName = (b: BookmarkDto) =>
    createMut.mutate({ targetVersionId: versionId, t: b.t, identityVisible: !b.identityVisible });

  // No PATCH endpoint — edit a note by deleting and recreating at the same moment.
  // Runs at most once per edit session (Enter, then the unmount blur, can't both fire).
  const commitNote = (b: BookmarkDto) => {
    if (editCommitted.current) return;
    editCommitted.current = true;
    setEditing(null);
    const next = editText.trim() || null;
    if (next === (b.note ?? null)) return; // unchanged — skip the delete+recreate
    deleteMut.mutate(b.id, {
      onSuccess: () =>
        createMut.mutate({
          targetVersionId: versionId,
          t: b.t,
          note: next,
          identityVisible: b.identityVisible,
        }),
    });
  };

  // Escape cancels: mark committed so the unmount blur is a no-op, then close.
  const cancelEdit = () => {
    editCommitted.current = true;
    setEditing(null);
  };

  return (
    <div className={s.rail}>
      <div className={s.head}>
        <span className="label">Bookmarks · {bookmarks.length}</span>
        {isOwner && signalQ.data && (
          <span className={s.signal} title={signalQ.data.identified.map((a) => a.handle ?? a.displayName ?? 'anon').join(', ')}>
            ♥ {signalQ.data.count} saved
            {signalQ.data.identified.length > 0 && ` · ${signalQ.data.identified.length} named`}
          </span>
        )}
      </div>

      <div className={s.track} aria-hidden>
        {bookmarks.map((b) => {
          const pct = markerPct(b.t, durationSeconds);
          if (pct == null) return null;
          return (
            <button
              key={b.id}
              type="button"
              // Decorative duplicate of the accessible list seek buttons below; the
              // track is aria-hidden, so keep these out of the tab order to avoid a
              // focusable-inside-aria-hidden conflict (WCAG 4.1.2, review 11.3).
              tabIndex={-1}
              className={s.marker}
              style={{ left: `${pct}%` }}
              title={b.note ?? fmt(b.t)}
              onClick={() => onSeek(b.t as number)}
            >
              ★
            </button>
          );
        })}
      </div>

      <div className={s.addRow}>
        <input
          className={s.noteInput}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (!e.nativeEvent.isComposing && e.key === 'Enter') add(); }}
          placeholder="note (optional)"
        />
        <button type="button" className="btn sm primary" onClick={add} disabled={createMut.isPending}>
          ★ Bookmark @ {fmt(position)}
        </button>
      </div>

      {bookmarks.length === 0 ? (
        <div className={s.empty}>No bookmarks yet — mark a moment you love.</div>
      ) : (
        <ul className={s.list}>
          {bookmarks.map((b) => (
            <li key={b.id} className={s.item}>
              <button type="button" className={s.at} onClick={() => onSeek(b.t ?? 0)}>@{fmt(b.t)}</button>
              {editing === b.id ? (
                <input
                  className={s.noteInput}
                  value={editText}
                  autoFocus
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === 'Enter') commitNote(b);
                    else if (e.key === 'Escape') cancelEdit();
                  }}
                  onBlur={() => commitNote(b)}
                />
              ) : (
                <button
                  type="button"
                  className={s.note}
                  onClick={() => openEdit(b)}
                >
                  {b.note || <span className={s.noteEmpty}>add a note</span>}
                </button>
              )}
              <button type="button" className={s.act} onClick={() => toggleName(b)} title="show your name to the owner">
                {b.identityVisible ? 'named' : 'anon'}
              </button>
              <button type="button" className={`${s.act} ${s.del}`} onClick={() => deleteMut.mutate(b.id)}>delete</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
