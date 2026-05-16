import { useEffect, useState } from 'react';
import { listSongs } from '../api/songs.js';
import { saveToLibrary } from '../api/client.js';

export default function SaveToLibraryModal({ jobId, onCancel, onSaved }) {
  const [tab, setTab] = useState('new');  // 'new' | 'existing'
  const [name, setName] = useState('');
  const [songs, setSongs] = useState([]);
  const [songId, setSongId] = useState('');
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (tab === 'existing' && songs.length === 0) {
      listSongs().then(setSongs).catch(() => setSongs([]));
    }
  }, [tab, songs.length]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const body = tab === 'new'
      ? { action: 'new_song', name: name.trim(), label: label || undefined, notes: notes || undefined }
      : { action: 'add_to_song', song_id: songId, label: label || undefined, notes: notes || undefined };
    try {
      const r = await saveToLibrary(jobId, body);
      onSaved(r);
    } catch (e) {
      if (e.message?.includes('410')) setErr('This recording has expired — please re-upload to save it.');
      else if (e.message?.includes('409') && tab === 'new') setErr('You already have a song with that name.');
      else setErr(e.message || 'Save failed');
      setBusy(false);
    }
  }

  const canSubmit = tab === 'new' ? name.trim().length > 0 : songId.length > 0;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Save to Library</h2>
        <div className="tabs">
          <button type="button" className={tab === 'new' ? 'active' : ''} onClick={() => setTab('new')}>New song</button>
          <button type="button" className={tab === 'existing' ? 'active' : ''} onClick={() => setTab('existing')}>Add to existing</button>
        </div>
        {tab === 'new' ? (
          <label>Song name
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
        ) : (
          <label>Choose song
            <select value={songId} onChange={(e) => setSongId(e.target.value)}>
              <option value="">— pick one —</option>
              {songs.map((s) => <option key={s.song_id} value={s.song_id}>{s.name}</option>)}
            </select>
          </label>
        )}
        <label>Version label (optional)
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} />
        </label>
        <label>Notes (optional)
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </label>
        {err && <p className="error">{err}</p>}
        <div className="actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" disabled={!canSubmit || busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
