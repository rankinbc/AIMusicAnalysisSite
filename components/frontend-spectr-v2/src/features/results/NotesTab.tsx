import { useMemo, useState } from 'react';

import {
  useBookmarks,
  useCreateNote,
  useDeleteNote,
  useNotes,
} from '../../api/hooks';
import { useComments } from '../listen/useComments';
import { useBookmarkSignal } from '../listen/useBookmarkSignal';
import { useSessionHistory } from '../listen/useRoomSession';
import { Icon } from './Icon';
import {
  actorLabel,
  bookmarkMarkers,
  commentMarkers,
  densityCurve,
  densityPath,
  markerPct,
  mmss,
  noteMarkers,
  recapEmojiEvents,
  threadComments,
  type TimelineMarker,
} from './feedback-timeline-model';

// Notes / Feedback tab (v4): the owner's own version notes (existing CRUD),
// listener comments (threaded), the bookmark signal, and a 0:00→end feedback
// timeline. The emoji lane renders ONLY when ended-session recaps exist —
// there is deliberately no per-version recap endpoint (stub policy).

interface NotesTabProps {
  versionId: string | null;
  durationSec: number | undefined;
}

export function NotesTab({ versionId, durationSec }: NotesTabProps) {
  if (!versionId) {
    return (
      <div className="fb-empty">
        <div className="es-ic">
          <Icon name="message" size={20} />
        </div>
        <div className="es-t">No version attached</div>
        <div className="es-s">Notes and feedback live on a song version.</div>
      </div>
    );
  }
  return <NotesTabBody versionId={versionId} durationSec={durationSec ?? 0} />;
}

function NotesTabBody({ versionId, durationSec }: { versionId: string; durationSec: number }) {
  const notes = useNotes(versionId);
  const comments = useComments(versionId);
  const bookmarks = useBookmarks();
  const signal = useBookmarkSignal(versionId);
  const sessions = useSessionHistory(versionId);

  const threads = useMemo(() => threadComments(comments.data ?? []), [comments.data]);
  const cMarkers = useMemo(() => commentMarkers(comments.data ?? []), [comments.data]);
  const bMarkers = useMemo(
    () => bookmarkMarkers(bookmarks.data ?? [], versionId),
    [bookmarks.data, versionId],
  );
  const nMarkers = useMemo(() => noteMarkers(notes.data ?? []), [notes.data]);
  const emoji = useMemo(() => recapEmojiEvents(sessions.data ?? []), [sessions.data]);

  return (
    <div className="notes-stack">
      <div className="notes-cols">
        <OwnNotes versionId={versionId} />
        <ListenerComments
          threads={threads}
          signalCount={signal.data?.count ?? 0}
          signalNames={(signal.data?.identified ?? []).map(actorLabel)}
        />
      </div>
      {durationSec > 0 && (
        <FeedbackTimeline
          durationSec={durationSec}
          comments={cMarkers}
          bookmarks={bMarkers}
          notes={nMarkers}
          emoji={emoji}
        />
      )}
    </div>
  );
}

function OwnNotes({ versionId }: { versionId: string }) {
  const notes = useNotes(versionId);
  const create = useCreateNote(versionId);
  const del = useDeleteNote(versionId);
  const [draft, setDraft] = useState('');

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    create.mutate(
      { tSeconds: 0, text, pinned: false },
      { onSuccess: () => setDraft('') },
    );
  };

  return (
    <div className="card notes-card">
      <div className="card-hd">
        <span className="t">
          <span className="led" />
          Your notes
        </span>
        <span className="meta">only you see these</span>
      </div>
      <div className="notes-list">
        {(notes.data ?? []).length === 0 && (
          <p className="fbd-dataexp">No notes yet — jot what you hear while reviewing.</p>
        )}
        {(notes.data ?? []).map((n) => (
          <div className="note-row" key={n.id}>
            {n.tSeconds > 0 && <span className="mono t">{mmss(n.tSeconds)}</span>}
            <span className="txt">{n.text}</span>
            <button
              type="button"
              className="note-x"
              title="Delete note"
              onClick={() => del.mutate(n.id)}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="note-composer">
        <input
          placeholder="Add a note about this version…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <button
          type="button"
          className="btn sm"
          disabled={!draft.trim() || create.isPending}
          onClick={submit}
        >
          <Icon name="plus" size={12} />
          Add
        </button>
      </div>
    </div>
  );
}

function ListenerComments({
  threads,
  signalCount,
  signalNames,
}: {
  threads: ReturnType<typeof threadComments>;
  signalCount: number;
  signalNames: string[];
}) {
  return (
    <div className="card notes-card">
      <div className="card-hd">
        <span className="t">
          <span className="led" />
          Listener comments
        </span>
        <span className="meta">
          {signalCount > 0
            ? `${signalCount} bookmark${signalCount > 1 ? 's' : ''}${signalNames.length > 0 ? ` · ${signalNames.slice(0, 3).join(', ')}` : ''}`
            : 'from shared listens'}
        </span>
      </div>
      <div className="notes-list">
        {threads.length === 0 && (
          <p className="fbd-dataexp">
            No comments yet — share this version for a listen to gather feedback.
          </p>
        )}
        {threads.map(({ top, replies }) => (
          <div className="cmt" key={top.id}>
            <div className="cmt-hd">
              <span className="who">{actorLabel(top.author)}</span>
              {top.t != null && <span className="mono t">{mmss(top.t)}</span>}
              {top.status !== 'open' && <span className={`pill cmt-st ${top.status}`}>{top.status}</span>}
            </div>
            <p className="body">{top.body}</p>
            {replies.map((r) => (
              <div className="cmt reply" key={r.id}>
                <div className="cmt-hd">
                  <span className="who">{actorLabel(r.author)}</span>
                </div>
                <p className="body">{r.body}</p>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function FeedbackTimeline({
  durationSec,
  comments,
  bookmarks,
  notes,
  emoji,
}: {
  durationSec: number;
  comments: TimelineMarker[];
  bookmarks: TimelineMarker[];
  notes: TimelineMarker[];
  emoji: { t: number; emoji: string; count: number }[];
}) {
  const density = useMemo(() => densityCurve(emoji, durationSec), [emoji, durationSec]);
  const hasEmoji = emoji.length > 0;
  const lanes: { name: string; markers: TimelineMarker[]; tone: string }[] = [
    { name: 'Comments', markers: comments, tone: 'var(--blue)' },
    { name: 'Bookmarks', markers: bookmarks, tone: 'var(--yellow)' },
    { name: 'Notes', markers: notes, tone: 'var(--accent)' },
  ];
  return (
    <div className="card notes-card">
      <div className="card-hd">
        <span className="t">
          <span className="led" />
          Feedback timeline
        </span>
        <span className="meta">
          0:00 → {mmss(durationSec)}
        </span>
      </div>
      <div className="ftl">
        {hasEmoji && (
          <div className="ftl-lane emoji">
            <span className="ftl-name mono">Reactions</span>
            <div className="ftl-strip tall">
              <svg
                className="ftl-density"
                viewBox="0 0 100 24"
                preserveAspectRatio="none"
                aria-hidden
              >
                <path d={densityPath(density, 100, 24)} fill="rgba(0,229,176,.14)" stroke="rgba(0,229,176,.5)" strokeWidth="0.6" />
              </svg>
              {emoji.map((e, i) => (
                <span
                  key={i}
                  className="ftl-emoji"
                  style={{ left: `${markerPct(e.t, durationSec)}%` }}
                  title={`${e.emoji} ×${e.count} at ${mmss(e.t)}`}
                >
                  {e.emoji}
                </span>
              ))}
            </div>
          </div>
        )}
        {lanes.map(
          (lane) =>
            lane.markers.length > 0 && (
              <div className="ftl-lane" key={lane.name}>
                <span className="ftl-name mono">{lane.name}</span>
                <div className="ftl-strip">
                  {lane.markers.map((m, i) => (
                    <span
                      key={i}
                      className="ftl-dot"
                      style={{ left: `${markerPct(m.t, durationSec)}%`, background: lane.tone }}
                      title={`${m.label} · ${mmss(m.t)}${m.detail ? ` — ${m.detail}` : ''}`}
                    />
                  ))}
                </div>
              </div>
            ),
        )}
        {!hasEmoji && comments.length === 0 && bookmarks.length === 0 && notes.length === 0 && (
          <p className="fbd-dataexp" style={{ padding: '4px 2px 8px' }}>
            Timestamped comments, bookmarks and notes will land on this strip.
          </p>
        )}
      </div>
    </div>
  );
}
