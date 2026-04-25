import { useState, useCallback } from 'react';
import LoginPage from './components/LoginPage';
import UploadPage from './components/UploadPage';
import ProcessingPage from './components/ProcessingPage';
import ResultsPage from './components/ResultsPage';
import ProfilePage from './components/ProfilePage';
import StickyPlayer from './components/StickyPlayer';
import GenreProfilePage from './components/GenreProfilePage';
import { getToken, setToken, getJobResults } from './api/client';
import { adaptResult } from './api/adapter';

export default function App() {
  const [page, setPage]         = useState(getToken() ? 'upload' : 'login');
  const [prevPage, setPrevPage] = useState('upload');
  const [file, setFile]         = useState(null);
  const [jobId, setJobId]       = useState(null);
  const [resultData, setResult] = useState(null);
  const [streamError, setStreamError] = useState('');

  const handleLogin = () => setPage('upload');

  const handleLogout = () => {
    setToken(null);
    setFile(null);
    setJobId(null);
    setResult(null);
    setPage('login');
  };

  const handleProfile = () => {
    setPrevPage(page);
    setPage('profile');
  };

  const handleJobStarted = (id) => {
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

  const handleViewJob = useCallback(async (id, filename) => {
    try {
      const raw     = await getJobResults(id);
      const adapted = adaptResult(raw, filename);
      setJobId(id);
      setResult(adapted);
      setPage('results');
    } catch (err) {
      if (err.status === 401) handleLogout();
    }
  }, []);

  return (
    <>
      {page === 'login'      && <LoginPage onLogin={handleLogin} />}
      {page === 'upload'     && (
        <UploadPage
          file={file} setFile={setFile}
          onJobStarted={handleJobStarted}
          onLogout={handleLogout}
          onProfile={handleProfile}
          onGenreProfiles={() => { setPrevPage('upload'); setPage('genreProfiles'); }}
        />
      )}
      {page === 'genreProfiles' && (
        <GenreProfilePage onBack={() => setPage(prevPage)} />
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
