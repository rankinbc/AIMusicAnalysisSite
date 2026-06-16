import { useState } from 'react';
import s from './NotesPanel.module.css';

export interface UiNote {
  id: string;
  timePct: number;
  body: string;
  pinned: boolean;
}

interface Props {
  notes: UiNote[];
  duration: number;
  position: number;
  activeNote: string | null;
  pending: boolean;
  onSeekToNote: (id: string) => void;
  onAdd: (text: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s2 = Math.floor(sec % 60);
  return `${m}:${s2.toString().padStart(2, '0')}`;
}

export function NotesPanel(props: Props) {
  const { notes, duration, position, activeNote, pending } = props;
  const [input, setInput] = useState('');

  const submit = () => {
    const t = input.trim();
    if (!t) return;
    props.onAdd(t);
    setInput('');
  };

  return (
    <div className={s.panel}>
      <ul className={s.list}>
        {notes.length === 0 && <li className={s.empty}>No notes yet. Mark a moment below.</li>}
        {notes.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              className={s.row}
              data-active={activeNote === n.id}
              onClick={() => props.onSeekToNote(n.id)}
            >
              <span className={s.rowIcon}>{n.pinned ? '★' : '·'}</span>
              <span className={`${s.rowTime} mono`}>@{formatTime(n.timePct * duration)}</span>
              <span className={s.rowBody}>{n.body}</span>
            </button>
            <div className={s.rowActions}>
              <button type="button" onClick={() => props.onTogglePin(n.id, n.pinned)} aria-label={n.pinned ? 'Unpin' : 'Pin'}>
                {n.pinned ? '★' : '☆'}
              </button>
              <button type="button" onClick={() => props.onDelete(n.id)} aria-label="Delete">×</button>
            </div>
          </li>
        ))}
      </ul>
      <div className={s.inputRow}>
        <input
          className={s.input}
          value={input}
          placeholder="What did you hear?"
          aria-label="Add note at current position"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
        <span className={`${s.inputTime} mono`}>@{formatTime(position)}</span>
        <button type="button" className="btn primary sm" disabled={!input.trim() || pending} onClick={submit}>
          Save
        </button>
      </div>
    </div>
  );
}
