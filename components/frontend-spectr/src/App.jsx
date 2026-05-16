import { useState, useCallback } from 'react';
import LoginPage from './components/LoginPage';
import UploadPage from './components/UploadPage';
import StemMappingPage from './components/StemMappingPage';
import ProcessingPage from './components/ProcessingPage';
import ResultsPage from './components/ResultsPage';
import ProfilePage from './components/ProfilePage';
import StickyPlayer from './components/StickyPlayer';
import GenreProfilePage from './components/GenreProfilePage';
import LibraryPage from './components/LibraryPage.jsx';
import SongDetailPage from './components/SongDetailPage.jsx';
import { getToken, setToken, getJobResults } from './api/client';
import { adaptResult } from './api/adapter';

export default function App() {
  const [page, setPage]         = useState(getToken() ? 'upload' : 'login');
  const [prevPage, setPrevPage] = useState('upload');
  const [file, setFile]         = useState(null);
  const [jobId, setJobId]       = useState(null);
  const [resultData, setResult] = useState(null);
  const [streamError, setStreamError] = useState('');
  const [stemMapping, setStemMapping] = useState(null);  // { proposed_mapping, als_track_names }
  const [songId, setSongId]           = useState(null);
  const [fromLibrary, setFromLibrary] = useState(false);

  const handleLogin = () => setPage('upload');

  const handleLogout = useCallback(() => {
    setToken(null);
    setFile(null);
    setJobId(null);
    setResult(null);
    setPage('login');
  }, []);

  const handleProfile = () => {
    setPrevPage(page);
    setPage('profile');
  };

  const handleJobStarted = (id, opts = {}) => {
    setJobId(id);
    setStemMapping(null);
    setFromLibrary(Boolean(opts.fromLibrary));
    setPage('processing');
  };

  const handleAwaitingMapping = (resp) => {
    setJobId(resp.job_id);
    setStemMapping({
      proposed_mapping: resp.proposed_mapping ?? [],
      als_track_names: resp.als_track_names ?? [],
    });
    setPage('stemMapping');
  };

  const handleMappingConfirmed = (id) => {
    setStemMapping(null);
    setJobId(id);
    setPage('processing');
  };

  const handleComplete = useCallback(async () => {
    try {
      const raw = await getJobResults(jobId);
      const adapted = adaptResult(raw, file?.name);
      setResult(adapted);
      setPage('results');
    } catch (err) {
      if (err.status === 401) handleLogout();
      else setStreamError(err.message ?? 'Failed to load results');
    }
  }, [jobId, file]);

  const handleStreamError = useCallback((err) => {
    if (err?.message?.includes('401') || err?.message?.includes('Unauthorized')) {
      handleLogout();
    } else {
      setStreamError('Analysis stream lost. Please try again.');
      setPage('upload');
    }
  }, []);

  const handleBack = () => {
    setJobId(null);
    setResult(null);
    setStreamError('');
    setPage('upload');
  };

  const handleViewJob = useCallback(async (id, filename, opts = {}) => {
    try {
      const raw     = await getJobResults(id);
      const adapted = adaptResult(raw, filename);
      setJobId(id);
      setResult(adapted);
      setFromLibrary(Boolean(opts.fromLibrary));
      setPage('results');
    } catch (err) {
      if (err.status === 401) handleLogout();
    }
  }, []);

  const handleOpenSong = (id) => {
    setSongId(id);
    setPage('songDetail');
  };

  const handleSavedToLibrary = (newSongId) => {
    setSongId(newSongId);
    setPage('songDetail');
  };

  return (
    <>
      {page === 'login'      && <LoginPage onLogin={handleLogin} />}
      {page === 'upload'     && (
        <UploadPage
          file={file} setFile={setFile}
          onJobStarted={handleJobStarted}
          onAwaitingMapping={handleAwaitingMapping}
          onLogout={handleLogout}
          onProfile={handleProfile}
          onLibrary={() => setPage('library')}
          onGenreProfiles={() => { setPrevPage('upload'); setPage('genreProfiles'); }}
          onViewResult={(adapted, id) => { setJobId(id); setResult(adapted); setFromLibrary(false); setPage('results'); }}
        />
      )}
      {page === 'library' && (
        <LibraryPage
          onOpenSong={handleOpenSong}
          onBack={() => setPage('upload')}
          onLogout={handleLogout}
        />
      )}
      {page === 'songDetail' && songId && (
        <SongDetailPage
          songId={songId}
          onBack={() => setPage('library')}
          onJobStarted={(id) => handleJobStarted(id, { fromLibrary: true })}
          onViewResult={(id, name) => handleViewJob(id, name, { fromLibrary: true })}
          onLogout={handleLogout}
        />
      )}
      {page === 'genreProfiles' && (
        <GenreProfilePage onBack={() => setPage(prevPage)} />
      )}
      {page === 'stemMapping' && stemMapping && (
        <StemMappingPage
          jobId={jobId}
          proposals={stemMapping.proposed_mapping}
          alsTrackNames={stemMapping.als_track_names}
          onConfirmed={handleMappingConfirmed}
          onLogout={handleLogout}
        />
      )}
      {page === 'processing' && (
        <ProcessingPage
          file={file}
          jobId={jobId}
          onComplete={handleComplete}
          onError={handleStreamError}
        />
      )}
      {page === 'results' && resultData && (
        <ResultsPage
          data={resultData}
          jobId={jobId}
          onBack={handleBack}
          onProfile={handleProfile}
          fromLibrary={fromLibrary}
          onSavedToLibrary={handleSavedToLibrary}
        />
      )}
      {page === 'results' && file && <StickyPlayer file={file} />}
      {page === 'profile' && (
        <ProfilePage onBack={() => setPage(prevPage)} onLogout={handleLogout} onViewJob={handleViewJob} />
      )}

      {streamError && page !== 'processing' && (
        <div className="fade-in" style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 400,
          padding: '14px 24px',
          background: 'rgba(244,63,94,0.12)',
          borderBottom: '1px solid rgba(244,63,94,0.4)',
          backdropFilter: 'blur(10px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
        }}>
          <span style={{ fontSize: 16 }}>⚠</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--red)', fontWeight: 600 }}>
            {streamError}
          </span>
          <button
            onClick={() => setStreamError('')}
            style={{
              background: 'none', border: '1px solid rgba(244,63,94,0.4)',
              color: 'var(--red)', borderRadius: 6,
              fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
              padding: '3px 10px', cursor: 'pointer', marginLeft: 8,
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
