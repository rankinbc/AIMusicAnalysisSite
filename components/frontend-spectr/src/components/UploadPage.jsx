import { useState, useRef, useCallback, useEffect } from 'react';
import { WaveformSVG } from './primitives';
import { useWaveform } from '../hooks/useWaveform';
import { uploadTrack } from '../api/client';

const GENRES = ['Trance', 'House', 'Techno', 'D&B', 'Progressive', 'Other'];
const GENRE_API_KEY = { Trance: 'trance', House: 'house', Techno: 'techno', 'D&B': 'dnb', Progressive: 'progressive' };

export default function UploadPage({ file, setFile, onJobStarted, onAwaitingMapping, onLogout, onGenreProfiles, onProfile, onViewResult, onLibrary }) {
  const [genre, setGenre] = useState('Trance');
  const [trackName, setTrackName] = useState('');
  const [hasRef, setHasRef] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [refFile, setRefFile] = useState(null);
  const [alsFile, setAlsFile] = useState(null);
  const [alsError, setAlsError] = useState('');
  const [stems, setStems] = useState([]);
  const [stemError, setStemError] = useState('');
  const [referenceStems, setReferenceStems] = useState([]);
  const [refStemError, setRefStemError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [error, setError] = useState('');
  const inputRef = useRef();
  const refInputRef = useRef();
  const alsInputRef = useRef();
  const stemsInputRef = useRef();
  const refStemsInputRef = useRef();

  // Auto-fill track name from filename when file is selected
  useEffect(() => {
    if (file && !trackName) {
      setTrackName(file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '));
    }
  }, [file]);

  const STEM_EXT = ['.flac', '.wav'];
  const STEM_MAX_PER_FILE = 100 * 1024 * 1024;
  const STEM_MAX_TOTAL    = 1024 * 1024 * 1024;
  const STEM_MAX_COUNT    = 30;

  function validateStems(files) {
    if (files.length === 0) return '';
    if (files.length > STEM_MAX_COUNT) return `Maximum ${STEM_MAX_COUNT} stem files (you selected ${files.length}).`;
    let total = 0;
    for (const f of files) {
      const lower = f.name.toLowerCase();
      if (!STEM_EXT.some(ext => lower.endsWith(ext))) return `${f.name}: only FLAC and WAV stems are supported`;
      if (f.size > STEM_MAX_PER_FILE) return `${f.name}: exceeds 100 MB`;
      total += f.size;
    }
    if (total > STEM_MAX_TOTAL) return 'Total stem size exceeds 1 GB';
    return '';
  }

  function handleStemsChange(fileList, target) {
    const files = Array.from(fileList ?? []);
    const err = validateStems(files);
    if (target === 'ref') {
      setRefStemError(err);
      setReferenceStems(err ? [] : files);
    } else {
      setStemError(err);
      setStems(err ? [] : files);
    }
  }

  function handleAlsChange(f) {
    if (!f) { setAlsFile(null); setAlsError(''); return; }
    if (!f.name.toLowerCase().endsWith('.als')) {
      setAlsError('Must be an Ableton Live Set (.als) file');
      setAlsFile(null);
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      setAlsError('ALS file too large (max 50 MB)');
      setAlsFile(null);
      return;
    }
    setAlsFile(f);
    setAlsError('');
  }

  const { waveform, loading: waveLoading } = useWaveform(file, 90);

  const handleDrop = useCallback(e => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  }, [setFile]);

  const handleAnalyze = async () => {
    if (!file) return;
    setError('');
    setUploading(true);
    setUploadPct(0);
    try {
      const genreHint = GENRE_API_KEY[genre] ?? null;
      const resp = await uploadTrack(
        file, refFile, alsFile,
        pct => setUploadPct(Math.round(pct * 100)),
        genreHint, trackName,
        stems, referenceStems,
      );
      if (resp.status === 'AWAITING_STEM_MAPPING') {
        onAwaitingMapping?.(resp);
      } else {
        onJobStarted(resp.job_id);
      }
    } catch (err) {
      setError(err.message ?? 'Upload failed');
      setUploading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <nav style={{ padding: '20px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'rgba(7,10,18,0.94)', backdropFilter: 'blur(12px)', zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 22, letterSpacing: '0.22em', color: 'var(--cyan)' }}>SPECTR</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={onLibrary} style={{ background: 'none', color: 'var(--cyan)', fontSize: 12, padding: '5px 10px', border: '1px solid var(--cyan)', borderRadius: 6, cursor: 'pointer' }}>
            Library
          </button>
          <button onClick={onGenreProfiles} style={{ background: 'none', color: 'var(--muted)', fontSize: 12, padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>
            Genre profiles
          </button>
          <button onClick={onProfile} style={{ background: 'none', color: 'var(--muted)', fontSize: 12, padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>
            Profile
          </button>
          <button onClick={onLogout} style={{ background: 'none', color: 'var(--muted)', fontSize: 12, padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>
            Sign out
          </button>
        </div>
      </nav>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 24px' }}>
        <div className="fade-up" style={{ textAlign: 'center', marginBottom: 48 }}>
          <h1 style={{ fontWeight: 800, fontSize: 'clamp(34px, 6vw, 60px)', lineHeight: 1.05, letterSpacing: '-0.02em' }}>
            Music Analysis
          </h1>
          <p style={{ color: 'var(--muted)', marginTop: 16, fontSize: 17, fontWeight: 400 }}>
            Deep analysis across loudness, frequency, genre DNA, stems, arrangement, and more.
          </p>
        </div>

        {/* Upload zone */}
        <div
          className="fade-up"
          style={{
            width: '100%', maxWidth: 560,
            border: `2px dashed ${dragging ? 'var(--cyan)' : 'rgba(0,229,176,0.22)'}`,
            borderRadius: 16, padding: '48px 32px', textAlign: 'center', cursor: 'pointer',
            background: dragging ? 'var(--cyan-dim)' : 'rgba(0,229,176,0.02)',
            transition: 'background 0.2s, border-color 0.2s',
            animation: dragging ? 'none' : 'borderBreath 3.5s ease-in-out infinite',
          }}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => !file && !uploading && inputRef.current.click()}
        >
          <input ref={inputRef} type="file" accept=".wav,.mp3,.aiff,.flac,.aif" style={{ display: 'none' }}
            onChange={e => setFile(e.target.files[0])} />

          {file ? (
            <div onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', height: 52, gap: 1, marginBottom: 14 }}>
                {waveLoading
                  ? <div className="mono" style={{ width: '100%', textAlign: 'center', fontSize: 11, color: 'var(--muted)' }}>reading waveform…</div>
                  : (waveform ?? []).map((v, i) => (
                      <div key={i} style={{
                        flex: 1, height: `${Math.max(6, v * 100)}%`,
                        background: 'var(--cyan)', opacity: 0.65, borderRadius: 1,
                        boxShadow: '0 0 2px rgba(0,229,176,0.3)',
                      }} />
                    ))
                }
              </div>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--cyan)', marginBottom: 4 }}>{file.name}</div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
                {(file.size / 1024 / 1024).toFixed(1)} MB
                {file.name.match(/\.(\w+)$/) && (
                  <span style={{ marginLeft: 8, textTransform: 'uppercase' }}>
                    {file.name.match(/\.(\w+)$/)[1]}
                  </span>
                )}
              </div>
              {!uploading && (
                <button onClick={() => setFile(null)} style={{
                  marginTop: 10, background: 'none', color: 'var(--muted)', fontSize: 12,
                  fontFamily: 'JetBrains Mono, monospace',
                }}>remove</button>
              )}
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                <WaveformSVG />
              </div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>Drop your track here</div>
              <div style={{ color: 'var(--muted)', marginTop: 6, fontSize: 14 }}>
                or <span style={{ color: 'var(--cyan)' }}>browse files</span>
              </div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 12, letterSpacing: '0.08em' }}>
                WAV · MP3 · AIFF · FLAC
              </div>
            </div>
          )}
        </div>

        {/* Track name input */}
        <div className="fade-up" style={{ marginTop: 20, width: '100%', maxWidth: 560, animationDelay: '0.08s' }}>
          <input
            type="text"
            placeholder="Track name (auto-filled from filename)"
            value={trackName}
            onChange={e => setTrackName(e.target.value)}
            style={{
              width: '100%', padding: '10px 14px', borderRadius: 8,
              background: 'var(--surface)', border: '1px solid var(--border)',
              color: 'var(--text)', fontSize: 13, outline: 'none',
              fontFamily: 'JetBrains Mono, monospace', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Genre pills */}
        <div className="fade-up" style={{ marginTop: 24, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', animationDelay: '0.1s' }}>
          {GENRES.map(g => (
            <button key={g} onClick={() => setGenre(g)} style={{
              padding: '7px 18px', borderRadius: 999, fontSize: 13, fontWeight: 600,
              background: genre === g ? 'var(--cyan-dim)' : 'transparent',
              border: `1px solid ${genre === g ? 'var(--cyan)' : 'var(--border)'}`,
              color: genre === g ? 'var(--cyan)' : 'var(--muted)',
              transition: 'all 0.2s',
            }}>{g}</button>
          ))}
        </div>

        {/* Reference track */}
        <div className="fade-up" style={{ marginTop: 16, animationDelay: '0.15s' }}>
          {!hasRef ? (
            <button onClick={() => setHasRef(true)} style={{
              background: 'none', color: 'var(--muted)', fontSize: 13,
              borderBottom: '1px dashed var(--dim)', paddingBottom: 2,
            }}>+ Upload reference track (optional)</button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input ref={refInputRef} type="file" accept=".wav,.mp3,.aiff,.flac,.aif" style={{ display: 'none' }}
                onChange={e => setRefFile(e.target.files[0])} />
              <div style={{
                padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)',
                background: 'var(--surface)', fontSize: 13, color: 'var(--muted)', cursor: 'pointer',
              }} onClick={() => refInputRef.current.click()}>
                {refFile ? refFile.name : 'Choose reference track'}
              </div>
              <button onClick={() => { setHasRef(false); setRefFile(null); }}
                style={{ background: 'none', color: 'var(--muted)', fontSize: 12 }}>✕</button>
            </div>
          )}
        </div>

        {/* ALS project file */}
        <div className="fade-up" style={{ marginTop: 12, animationDelay: '0.2s' }}>
          <input ref={alsInputRef} type="file" accept=".als" style={{ display: 'none' }}
            onChange={e => handleAlsChange(e.target.files[0] ?? null)} />
          {alsFile ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}>
              <span className="mono" style={{ fontSize: 12, color: 'var(--cyan)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {alsFile.name}
              </span>
              <button onClick={() => handleAlsChange(null)}
                style={{ background: 'none', color: 'var(--muted)', fontSize: 12 }}>✕</button>
            </div>
          ) : (
            <button onClick={() => alsInputRef.current.click()} style={{
              background: 'none', color: 'var(--muted)', fontSize: 13,
              borderBottom: '1px dashed var(--dim)', paddingBottom: 2,
            }}>+ Add Ableton project file (optional)</button>
          )}
          {alsError && (
            <div className="mono" style={{ marginTop: 6, fontSize: 11, color: 'var(--red)' }}>{alsError}</div>
          )}
        </div>

        {/* Stems (optional) */}
        <div className="fade-up" style={{ marginTop: 12, animationDelay: '0.22s', width: '100%', maxWidth: 560 }}>
          <input ref={stemsInputRef} type="file" accept=".flac,.wav" multiple style={{ display: 'none' }}
            onChange={e => handleStemsChange(e.target.files, 'mix')} />
          {stems.length === 0 ? (
            <button onClick={() => stemsInputRef.current.click()} style={{
              background: 'none', color: 'var(--muted)', fontSize: 13,
              borderBottom: '1px dashed var(--dim)', paddingBottom: 2,
            }}>+ Add stems (optional, up to 30, for per-stem analysis)</button>
          ) : (
            <div style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  {stems.length} stem{stems.length === 1 ? '' : 's'} ·{' '}
                  {(stems.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1)} MB
                </span>
                <button onClick={() => { setStems([]); setStemError(''); }}
                  style={{ background: 'none', color: 'var(--muted)', fontSize: 12 }}>✕</button>
              </div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--cyan)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {stems.map(s => s.name).join('  ·  ')}
              </div>
            </div>
          )}
          {stemError && (
            <div className="mono" style={{ marginTop: 6, fontSize: 11, color: 'var(--red)' }}>{stemError}</div>
          )}
        </div>

        {/* Reference stems (only if reference track is set) */}
        {hasRef && refFile && (
          <div className="fade-up" style={{ marginTop: 8, animationDelay: '0.24s', width: '100%', maxWidth: 560 }}>
            <input ref={refStemsInputRef} type="file" accept=".flac,.wav" multiple style={{ display: 'none' }}
              onChange={e => handleStemsChange(e.target.files, 'ref')} />
            {referenceStems.length === 0 ? (
              <button onClick={() => refStemsInputRef.current.click()} style={{
                background: 'none', color: 'var(--muted)', fontSize: 12,
                borderBottom: '1px dashed var(--dim)', paddingBottom: 2,
              }}>+ Reference stems (optional, enables per-stem reference comparison)</button>
            ) : (
              <div style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                    Ref: {referenceStems.length} stem{referenceStems.length === 1 ? '' : 's'}
                  </span>
                  <button onClick={() => { setReferenceStems([]); setRefStemError(''); }}
                    style={{ background: 'none', color: 'var(--muted)', fontSize: 12 }}>✕</button>
                </div>
              </div>
            )}
            {refStemError && (
              <div className="mono" style={{ marginTop: 6, fontSize: 11, color: 'var(--red)' }}>{refStemError}</div>
            )}
          </div>
        )}

        {/* Upload progress */}
        {uploading && (
          <div className="fade-in" style={{ marginTop: 24, width: '100%', maxWidth: 400 }}>
            <div style={{ height: 3, background: 'var(--dim)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', background: 'var(--cyan)', borderRadius: 2,
                width: `${uploadPct}%`, transition: 'width 0.3s ease',
                boxShadow: '0 0 8px var(--cyan)',
              }} />
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, textAlign: 'center' }}>
              Uploading… {uploadPct}%
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mono fade-in" style={{ marginTop: 16, fontSize: 12, color: 'var(--red)', background: 'var(--red-dim)', border: '1px solid rgba(244,63,94,0.2)', borderRadius: 8, padding: '10px 18px' }}>
            {error}
          </div>
        )}

        {/* CTA */}
        {!uploading && (
          <button
            className="fade-up"
            onClick={handleAnalyze}
            disabled={!file || !!stemError || !!refStemError}
            style={{
              marginTop: 32, padding: '16px 56px', borderRadius: 10,
              background: file ? 'var(--cyan)' : 'rgba(0,229,176,0.25)',
              color: '#070a12', fontSize: 16, fontWeight: 800, letterSpacing: '0.04em',
              boxShadow: file ? '0 0 32px rgba(0,229,176,0.3)' : 'none',
              transition: 'all 0.2s', animationDelay: '0.2s',
              cursor: file ? 'pointer' : 'not-allowed',
            }}
            onMouseEnter={e => { if (file) { e.currentTarget.style.boxShadow = '0 0 48px rgba(0,229,176,0.5)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = file ? '0 0 32px rgba(0,229,176,0.3)' : 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            Analyze Track
          </button>
        )}

        <p className="mono fade-up" style={{ marginTop: 12, fontSize: 11, color: 'var(--muted)', animationDelay: '0.25s' }}>
          {file ? 'analysis typically takes 60–90 seconds' : 'drop or browse to get started'}
        </p>
      </div>
    </div>
  );
}
