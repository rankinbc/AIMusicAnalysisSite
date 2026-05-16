import { useEffect, useState } from 'react';
import { getSong } from '../api/songs.js';
import { analyzeVersion, deleteVersion } from '../api/versions.js';
import VersionRow from './VersionRow.jsx';
import AddVersionModal from './AddVersionModal.jsx';
import DeleteSongModal from './DeleteSongModal.jsx';

export default function SongDetailPage({ songId, onBack, onJobStarted, onViewResult, onLogout }) {
  const [song, setSong] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [busyVersion, setBusyVersion] = useState(null);

  async function reload() {
    setLoading(true); setErr(null);
    try {
      setSong(await getSong(songId));
    } catch (e) {
      if (e.message?.includes('401')) onLogout?.();
      else setErr(e.message || 'Failed to load song');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, [songId]);

  async function handleAnalyze(versionId) {
    setBusyVersion(versionId);
    try {
      const r = await analyzeVersion(versionId);
      onJobStarted(r.job_id);
    } catch (e) {
      if (e.message?.includes('409')) setErr('Analysis already running for this version.');
      else setErr(e.message || 'Analyze failed');
      setBusyVersion(null);
    }
  }

  async function handleDeleteVersion(versionId) {
    if (!confirm('Delete this version? This is permanent.')) return;
    try {
      await deleteVersion(versionId);
      await reload();
    } catch (e) {
      setErr(e.message || 'Delete failed');
    }
  }

  function handleVersionAdded() {
    setShowAdd(false);
    reload();
  }

  if (loading) return <div className="song-detail">Loading…</div>;
  if (!song) return <div className="song-detail">Not found</div>;

  return (
    <div className="song-detail">
      <div className="header">
        <button onClick={onBack}>← Library</button>
        <h1>{song.name}</h1>
        <button className="danger" onClick={() => setShowDelete(true)}>Delete</button>
      </div>

      {song.genre_hint && <p className="genre">Genre: {song.genre_hint}</p>}
      {err && <p className="error">{err}</p>}

      <div className="versions">
        <div className="versions-header">
          <h2>Versions ({song.version_count})</h2>
          <button className="primary" onClick={() => setShowAdd(true)}>+ Add Version</button>
        </div>
        {song.versions.length === 0 ? (
          <p>No versions yet. Click "+ Add Version" to upload one.</p>
        ) : (
          song.versions.map((v) => (
            <VersionRow
              key={v.version_id}
              version={v}
              busy={busyVersion === v.version_id}
              onAnalyze={handleAnalyze}
              onView={(jobId) => onViewResult(jobId, song.name)}
              onDelete={handleDeleteVersion}
            />
          ))
        )}
      </div>

      {showAdd && (
        <AddVersionModal
          song={song}
          onCancel={() => setShowAdd(false)}
          onAdded={handleVersionAdded}
        />
      )}
      {showDelete && (
        <DeleteSongModal
          song={song}
          onCancel={() => setShowDelete(false)}
          onDeleted={() => onBack()}
        />
      )}
    </div>
  );
}
