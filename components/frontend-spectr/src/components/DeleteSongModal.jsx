import { useState } from 'react';
import { deleteSong } from '../api/songs.js';

export default function DeleteSongModal({ song, onCancel, onDeleted }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const matches = typed.trim() === song.name;

  async function submit(e) {
    e.preventDefault();
    if (!matches) return;
    setBusy(true); setErr(null);
    try {
      await deleteSong(song.song_id);
      onDeleted(song.song_id);
    } catch (e) {
      setErr(e.message || 'Failed to delete'); setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Delete song?</h2>
        <p>This will archive <strong>{song.name}</strong>. You can restore it within 30 days.</p>
        <label>
          Type the song name to confirm:
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </label>
        {err && <p className="error">{err}</p>}
        <div className="actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" disabled={!matches || busy}>{busy ? 'Deleting…' : 'Delete'}</button>
        </div>
      </form>
    </div>
  );
}
