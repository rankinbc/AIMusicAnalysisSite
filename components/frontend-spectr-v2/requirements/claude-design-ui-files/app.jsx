/* SPECTR — App shell + nav + tweaks. */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "density": "regular",
  "visualizer": "mirrored",
  "viewMode": "producer"
}/*EDITMODE-END*/;

const { useState } = React;

function App() {
  const [tab, setTab] = useState('results');
  const [selectedSongId, setSelectedSongId] = useState(null);
  const [compareRef, setCompareRef] = useState(null);
  const [publicTrack, setPublicTrack] = useState(null);
  const [publicProfileHandle, setPublicProfileHandle] = useState(null);
  const [bookmarks, setBookmarks] = useState([
    // Pre-seed with one example so the tab isn't empty
    {
      track: { id: 'p4', title: 'Carrier Wave', artist: 'forge', genre: 'Techno', moods: ['driving','industrial'], bpm: 134, key: 'F# min', durationSec: 412, lufs: -8.6, license: 'Sync-cleared', allowDownload: false, plays: 312, savesCount: 42, publishedDays: 5, hue: 18 },
      artist: { handle: 'forge', displayName: 'Anya Forge', avatarHue: 18, bannerHue: 18 },
      bookmarkedAgo: '3d ago',
    },
  ]);
  const [publishingSongId, setPublishingSongId] = useState(null);
  const [editingPublicProfile, setEditingPublicProfile] = useState(false);
  const [publicProfile, setPublicProfile] = useState({
    handle: 'maek',
    displayName: 'Mae Karlsson',
    bio: 'Progressive house producer based in Stockholm. Ableton Live. Open to syncs and remixes.',
    avatarHue: 168,
    bannerHue: 168,
    accent: 'cyan',
    link: 'soundcloud.com/maek',
    joinedMonths: 5,
    isYou: true,
  });
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const { TRACK, LIBRARY, REFERENCES, REFERENCE_SETS, PROFILE,
          DISCOVER_TRACKS, DISCOVER_GENRES, DISCOVER_MOODS, DISCOVER_LICENSES,
          PUBLIC_USERS, YOUR_PUBLIC_TRACK_IDS } = window.SPECTR_DATA;

  // Merge in the user's editable public profile into PUBLIC_USERS lookup
  const usersLookup = { ...PUBLIC_USERS, [publicProfile.handle]: publicProfile };
  const selectedSong = LIBRARY.find(s => s.id === selectedSongId);
  const publishingSong = LIBRARY.find(s => s.id === publishingSongId);

  const screenLabel =
    tab === 'discover' ? '06 Discover' :
    tab === 'compare'  ? '05 Compare' :
    tab === 'profile'  ? '04 Profile' :
    tab === 'library'  ? '03 Library' :
    tab === 'listen'   ? '02 Listen' : '01 Results';

  function changeTab(next) {
    setTab(next);
    if (next !== 'library')  setSelectedSongId(null);
    if (next !== 'compare')  setCompareRef(null);
    if (next !== 'discover') { setPublicTrack(null); setPublicProfileHandle(null); }
  }

  return (
    <div className="app-shell" data-screen-label={screenLabel}>
      <Topnav tab={tab} onTab={changeTab} />

      {tab === 'results' && (
        <ResultsPage
          track={TRACK}
          tweak={t}
          songContext={LIBRARY[0]}
          onBackToSong={() => { setSelectedSongId(LIBRARY[0].id); setTab('library'); }}
        />
      )}
      {tab === 'listen'  && <NowPlaying  track={TRACK} tweak={t} />}
      {tab === 'library' && !selectedSong && (
        <LibraryPage library={LIBRARY} onOpenSong={setSelectedSongId} />
      )}
      {tab === 'library' && selectedSong && (
        <SongDetailPage
          song={selectedSong}
          onBack={() => setSelectedSongId(null)}
          onOpenAnalysis={() => setTab('results')}
          onPublish={() => setPublishingSongId(selectedSong.id)}
        />
      )}
      {tab === 'profile' && (
        <ProfilePage
          profile={PROFILE}
          library={LIBRARY}
          references={REFERENCES}
          sets={REFERENCE_SETS}
          publicProfile={publicProfile}
          bookmarks={bookmarks}
          onOpenSong={(id) => { setTab('library'); setSelectedSongId(id); }}
          onCompare={(ref) => { setCompareRef(ref); setTab('compare'); }}
          onOpenPublicProfile={() => { setTab('discover'); setPublicProfileHandle(publicProfile.handle); }}
          onPlayPublicTrack={(track) => { setTab('discover'); setPublicTrack(track); }}
          onOpenPublicProfilePage={(handle) => { setTab('discover'); setPublicProfileHandle(handle); }}
        />
      )}
      {tab === 'compare' && compareRef && (
        <ComparePage
          track={TRACK}
          reference={compareRef}
          onBack={() => { setTab('profile'); setCompareRef(null); }}
        />
      )}
      {tab === 'discover' && !publicTrack && !publicProfileHandle && (
        <DiscoverPage
          tracks={DISCOVER_TRACKS}
          users={usersLookup}
          genres={DISCOVER_GENRES}
          moods={DISCOVER_MOODS}
          licenses={DISCOVER_LICENSES}
          onPlay={(track) => setPublicTrack(track)}
          onOpenProfile={(handle) => setPublicProfileHandle(handle)}
        />
      )}
      {tab === 'discover' && publicTrack && (
        <PublicListenView
          track={publicTrack}
          artist={usersLookup[publicTrack.artist]}
          onBack={() => setPublicTrack(null)}
          onOpenProfile={(handle) => { setPublicTrack(null); setPublicProfileHandle(handle); }}
        />
      )}
      {tab === 'discover' && publicProfileHandle && !publicTrack && (
        <PublicProfilePage
          user={usersLookup[publicProfileHandle]}
          tracks={DISCOVER_TRACKS}
          allUsers={usersLookup}
          onBack={() => setPublicProfileHandle(null)}
          onPlay={(track) => setPublicTrack(track)}
          onOpenProfile={(handle) => setPublicProfileHandle(handle)}
          onEditPublicProfile={() => setEditingPublicProfile(true)}
        />
      )}

      {/* Modals */}
      {publishingSong && (
        <PublishToDiscoverModal
          song={publishingSong}
          genres={DISCOVER_GENRES}
          moods={DISCOVER_MOODS}
          licenses={DISCOVER_LICENSES}
          onClose={() => setPublishingSongId(null)}
          onPublish={(form) => { setPublishingSongId(null); changeTab('discover'); }}
        />
      )}
      {editingPublicProfile && (
        <EditPublicProfileModal
          user={publicProfile}
          onClose={() => setEditingPublicProfile(false)}
          onSave={(form) => { setPublicProfile(p => ({ ...p, ...form })); setEditingPublicProfile(false); }}
        />
      )}

      <MiniPlayer track={TRACK} onExpand={() => setTab('listen')} />

      <TweaksPanel title="Tweaks">
        <TweakSection label="Layout" />
        <TweakRadio label="Density" value={t.density}
                    options={['compact', 'regular']}
                    onChange={v => setTweak('density', v)} />
        <TweakSection label="Now Playing" />
        <TweakRadio label="Visualizer" value={t.visualizer}
                    options={['bars', 'mirrored', 'radial']}
                    onChange={v => setTweak('visualizer', v)} />
        <TweakSection label="Audience" />
        <TweakRadio label="Mode" value={t.viewMode}
                    options={['producer', 'listener']}
                    onChange={v => setTweak('viewMode', v)} />
      </TweaksPanel>
    </div>
  );
}

// ── Top nav ───────────────────────────────────────────────────────────────

function Topnav({ tab, onTab }) {
  return (
    <nav className="topnav">
      <div className="brand">
        <span className="mark"><BrandMark size={14} /></span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1 }}>
          <span>SPECTR</span>
          <span className="mono" style={{
            fontSize: 8,
            fontWeight: 500,
            letterSpacing: '0.18em',
            color: 'var(--muted)',
            textTransform: 'uppercase',
          }}>AI Music Analysis</span>
        </div>
      </div>
      <div className="nav-tabs">
        <button className={tab === 'results'  ? 'active' : ''} onClick={() => onTab('results')}>Report</button>
        <button className={tab === 'listen'   ? 'active' : ''} onClick={() => onTab('listen')}>Listen</button>
        <button className={tab === 'library'  ? 'active' : ''} onClick={() => onTab('library')}>Library</button>
        <button className={tab === 'discover' ? 'active' : ''} onClick={() => onTab('discover')}>Discover</button>
      </div>

      <div className="nav-right">
        <div className="nav-search">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color: 'var(--muted)' }}>
            <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 8l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input placeholder="Search your tracks, notes, fixes…" />
          <span className="mono" style={{ fontSize: 9, color: 'var(--dim)', padding: '1px 5px', border: '1px solid var(--border)', borderRadius: 3 }}>⌘K</span>
        </div>
        <button className="nav-icon-btn" title="Notifications">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 6a4 4 0 1 1 8 0v3l1 1H2l1-1V6z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M5 11a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
        <button className="btn primary sm">+ Upload</button>
        <button onClick={() => onTab('profile')}
          title="Open profile"
          style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--cyan) 0%, var(--violet) 100%)',
            display: 'grid', placeItems: 'center',
            color: '#06151a', fontWeight: 800, fontSize: 12,
            cursor: 'pointer', border: 'none',
            boxShadow: '0 0 0 2px var(--bg), 0 0 0 3px rgba(0,229,176,0.0)',
            transition: 'box-shadow .15s',
          }}
          onMouseOver={e => e.currentTarget.style.boxShadow = '0 0 0 2px var(--bg), 0 0 0 3px rgba(0,229,176,0.5)'}
          onMouseOut={e => e.currentTarget.style.boxShadow = '0 0 0 2px var(--bg), 0 0 0 3px rgba(0,229,176,0.0)'}>
          M
        </button>
      </div>
    </nav>
  );
}

// ── Persistent mini player at the bottom — minimal, since Listen has a big one
function MiniPlayer({ track, onExpand }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 40,
      background: 'rgba(7,10,18,0.94)',
      backdropFilter: 'blur(14px)',
      borderTop: '1px solid var(--border)',
      padding: '10px 24px',
      display: 'flex', alignItems: 'center', gap: 16,
    }}>
      <button onClick={() => setPlaying(p => !p)} style={{
        width: 36, height: 36, borderRadius: '50%',
        background: 'var(--cyan)', color: '#06151a',
        display: 'grid', placeItems: 'center',
        boxShadow: playing ? '0 0 16px rgba(0,229,176,0.5)' : 'none',
      }}>
        <span style={{ fontSize: 12 }}>{playing ? '⏸' : '▶'}</span>
      </button>
      <CoverArt hue={168} size="sm" />
      <div style={{ minWidth: 180 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>{track.name}</div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
          {track.bpm} BPM · {track.key} · {track.genre.name}
        </div>
      </div>

      {/* Tiny waveform */}
      <div style={{ flex: 1, height: 28, display: 'flex', alignItems: 'center', gap: 1 }}>
        {Array.from({ length: 120 }).map((_, i) => {
          const v = 0.2 + (Math.sin(i * 0.4) * 0.5 + 0.5) * 0.6 + (Math.sin(i * 1.7) * 0.5 + 0.5) * 0.2;
          const played = i / 120 < 0.18;
          return <div key={i} style={{
            flex: 1, height: `${v * 100}%`,
            background: played ? 'var(--cyan)' : 'rgba(255,255,255,0.13)',
            borderRadius: 1,
          }} />;
        })}
      </div>

      <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>0:48 / 4:28</div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn sm" style={{ padding: '6px 10px' }}>EQ</button>
        <button onClick={onExpand} className="btn sm primary" style={{ padding: '6px 12px' }}>Open ↗</button>
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
