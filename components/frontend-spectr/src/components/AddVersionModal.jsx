import { useState } from 'react';
import { createVersion } from '../api/versions.js';

export default function AddVersionModal({ song, onCancel, onAdded }) {
  const [file, setFile] = useState(null);
  const [reference, setReference] = useState(null);
  const [als, setAls] = useState(null);
  const [stems, setStems] = useState([]);
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const v = await createVersion(song.song_id, {
        file, reference, als,
        stems: stems.length ? stems : undefined,
        label: label || undefined, notes: notes || undefined,
        onProgress: setProgress,
      });
      onAdded(v);
    } catch (e) {
      setErr(e.message || 'Upload failed'); setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Add Version to {song.name}</h2>
        <label>Audio (required)
          <input type="file" accept=".mp3,.flac,.wav" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
        </label>
        <label>Reference (optional)
          <input type="file" accept=".mp3,.flac,.wav" onChange={(e) => setReference(e.target.files?.[0] ?? null)} />
        </label>
        <label>ALS project (optional)
          <input type="file" accept=".als" onChange={(e) => setAls(e.target.files?.[0] ?? null)} />
        </label>
        <label>Stems (optional, 1–50 files)
          <input type="file" accept=".flac,.wav" multiple onChange={(e) => setStems(Array.from(e.target.files || []))} />
        </label>
        <label>Label
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder="e.g. after mastering" />
        </label>
        <label>Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </label>
        {busy && <progress value={progress} max={1} />}
        {err && <p className="error">{err}</p>}
        <div className="actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" disabled={!file || busy}>{busy ? 'Uploading…' : 'Add Version'}</button>
        </div>
      </form>
    </div>
  );
}
