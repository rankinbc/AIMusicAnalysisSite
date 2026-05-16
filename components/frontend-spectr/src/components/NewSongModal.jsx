import { useState } from 'react';
import { createSong } from '../api/songs.js';

const GENRES = ['', 'trance', 'house', 'techno', 'dnb', 'progressive'];

export default function NewSongModal({ onCancel, onCreated, onError }) {
  const [name, setName] = useState('');
  const [genre, setGenre] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setErr(null);
    try {
      const song = await createSong({ name: name.trim(), genre_hint: genre || undefined });
      onCreated(song);
    } catch (e) {
      const msg = e?.message?.includes('409') ? 'You already have a song with that name.' : (e.message || 'Failed to create song');
      setErr(msg);
      onError?.(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>New Song</h2>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={200} required />
        </label>
        <label>
          Genre (optional)
          <select value={genre} onChange={(e) => setGenre(e.target.value)}>
            {GENRES.map((g) => <option key={g} value={g}>{g || '— none —'}</option>)}
          </select>
        </label>
        {err && <p className="error">{err}</p>}
        <div className="actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create'}</button>
        </div>
      </form>
    </div>
  );
}
