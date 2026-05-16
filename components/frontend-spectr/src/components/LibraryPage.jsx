import { useEffect, useState } from 'react';
import { listSongs } from '../api/songs.js';
import SongCard from './SongCard.jsx';
import NewSongModal from './NewSongModal.jsx';

export default function LibraryPage({ onOpenSong, onBack, onLogout }) {
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      setSongs(await listSongs());
    } catch (e) {
      if (e.message?.includes('401')) onLogout?.();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  function handleCreated(song) {
    setShowNew(false);
    onOpenSong(song.song_id);
  }

  return (
    <div className="library-page">
      <div className="header">
        <button onClick={onBack}>← Back</button>
        <h1>Your Library</h1>
        <button className="primary" onClick={() => setShowNew(true)}>+ New Song</button>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : songs.length === 0 ? (
        <div className="empty">
          <p>No songs yet.</p>
          <button className="primary" onClick={() => setShowNew(true)}>+ Create your first song</button>
        </div>
      ) : (
        <div className="grid">
          {songs.map((s) => <SongCard key={s.song_id} song={s} onOpen={onOpenSong} />)}
        </div>
      )}

      {showNew && (
        <NewSongModal
          onCancel={() => setShowNew(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
