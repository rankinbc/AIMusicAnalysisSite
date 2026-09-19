/* Listen Rack v2 — notes sidebar: the track's timestamped notes. Ported from
 * the former session sidebar's notes-tab body + card chrome, now that the
 * rack is a private workbench with nothing else (chat/room) to put in a tab
 * strip. */
import type { TrackNote } from './data';
import { lrTime } from './lrUtil';

export function NotesSidebar({ notes, activeNote, onNote }: {
  notes: TrackNote[];
  activeNote: string | null;
  onNote: (n: TrackNote) => void;
}) {
  return (
    <aside className="lr-side">
      <div className="lr-sc">
        <div className="lr-sc-h">
          <span className="l">Notes</span>
          <span className="hint">{notes.length}</span>
        </div>
        <div className="lr-sc-b">
          {notes.length === 0 && (
            <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', padding: '4px 2px' }}>
              No notes on this version yet.
            </span>
          )}
          {notes.map((n) => (
            <button
              type="button"
              key={n.id}
              className={'lr-snote' + (activeNote === n.id ? ' on' : '')}
              onClick={() => onNote(n)}
            >
              <span className="tm">{lrTime(n.t)}</span>
              <span className="tx">{n.text}</span>
              {n.pinned && <span className="pin" title="pinned">●</span>}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
