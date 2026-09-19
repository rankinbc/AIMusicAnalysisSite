import { useMemo, useState } from 'react';

import { useCreateNote, useDeleteNote, useNotes } from '../../api/hooks';
import { Icon } from './Icon';
import { markerPct, mmss, noteMarkers, type TimelineMarker } from './feedback-timeline-model';

// Notes tab (v4): the owner's own timestamped version notes, plus a 0:00→end
// strip showing where they land on the track.

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
        <div className="es-s">Notes live on a song version.</div>
      </div>
    );
  }
  return <NotesTabBody versionId={versionId} durationSec={durationSec ?? 0} />;
}

function NotesTabBody({ versionId, durationSec }: { versionId: string; durationSec: number }) {
  const notes = useNotes(versionId);
  const nMarkers = useMemo(() => noteMarkers(notes.data ?? []), [notes.data]);

  return (
    <div className="notes-stack">
      <OwnNotes versionId={versionId} />
      {durationSec > 0 && <NotesTimeline durationSec={durationSec} notes={nMarkers} />}
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

function NotesTimeline({
  durationSec,
  notes,
}: {
  durationSec: number;
  notes: TimelineMarker[];
}) {
  return (
    <div className="card notes-card">
      <div className="card-hd">
        <span className="t">
          <span className="led" />
          Notes timeline
        </span>
        <span className="meta">
          0:00 → {mmss(durationSec)}
        </span>
      </div>
      <div className="ftl">
        {notes.length > 0 ? (
          <div className="ftl-lane">
            <span className="ftl-name mono">Notes</span>
            <div className="ftl-strip">
              {notes.map((m, i) => (
                <span
                  key={i}
                  className="ftl-dot"
                  style={{ left: `${markerPct(m.t, durationSec)}%`, background: 'var(--accent)' }}
                  title={`${m.label} · ${mmss(m.t)}${m.detail ? ` — ${m.detail}` : ''}`}
                />
              ))}
            </div>
          </div>
        ) : (
          <p className="fbd-dataexp" style={{ padding: '4px 2px 8px' }}>
            Timestamped notes will land on this strip.
          </p>
        )}
      </div>
    </div>
  );
}
