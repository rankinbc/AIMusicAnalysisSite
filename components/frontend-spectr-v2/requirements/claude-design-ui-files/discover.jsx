/* SPECTR — Discover, Public Profile, Publish-to-Discover
 *
 * Community surface (minimal):
 *   - Discover: browse + listen to public tracks others have published
 *   - Public Profile: customizable banner + bio + link + public tracks list
 *   - Publish modal: opt a song version into Discover with controls
 *
 * No comments, no follows, no likes. Tracks remain private by default.
 */

const { useState: useStateD, useMemo: useMemoD, useEffect: useEffectD } = React;

// ── Discover page ────────────────────────────────────────────────────────

function DiscoverPage({ tracks, users, genres, moods, licenses, onPlay, onOpenProfile }) {
  const [genre, setGenre] = useStateD('All');
  const [mood, setMood] = useStateD(null);
  const [license, setLicense] = useStateD('All licenses');
  const [sort, setSort] = useStateD('fresh');
  const [bpmRange, setBpmRange] = useStateD([0, 200]);
  const [search, setSearch] = useStateD('');

  const filtered = useMemoD(() => {
    let out = tracks.slice();
    if (genre !== 'All')       out = out.filter(t => t.genre === genre);
    if (mood)                  out = out.filter(t => t.moods.includes(mood));
    if (license !== 'All licenses') out = out.filter(t => t.license === license);
    out = out.filter(t => (t.bpm === 0 ? true : t.bpm >= bpmRange[0] && t.bpm <= bpmRange[1]));
    if (search)                out = out.filter(t => (t.title + users[t.artist]?.displayName + t.description).toLowerCase().includes(search.toLowerCase()));
    if (sort === 'fresh')      out.sort((a, b) => a.publishedDays - b.publishedDays);
    if (sort === 'plays')      out.sort((a, b) => b.plays - a.plays);
    if (sort === 'saves')      out.sort((a, b) => b.savesCount - a.savesCount);
    return out;
  }, [tracks, genre, mood, license, bpmRange, search, sort, users]);

  const fresh = [...tracks].sort((a, b) => a.publishedDays - b.publishedDays).slice(0, 3);

  return (
    <div style={{ maxWidth: 1360, margin: '0 auto', padding: '24px 24px 80px' }}>
      <DiscoverHero fresh={fresh} users={users} onPlay={onPlay} onOpenProfile={onOpenProfile} />

      {/* Filter bar */}
      <div className="card" style={{ padding: '14px 16px', marginBottom: 16, position: 'sticky', top: 60, zIndex: 5, backdropFilter: 'blur(8px)', background: 'rgba(15,24,40,0.94)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div className="nav-search" style={{ flex: '1 1 240px', minWidth: 200 }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color: 'var(--muted)' }}>
              <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M8 8l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by title, artist, mood…" />
          </div>
          <SelectChip label="Genre"   value={genre}   options={genres}   onChange={setGenre} />
          <SelectChip label="License" value={license} options={licenses} onChange={setLicense} />
          <BpmRangeChip range={bpmRange} onChange={setBpmRange} />
          <SortChip value={sort} onChange={setSort} />
        </div>
        {/* Mood chips */}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 10 }}>
          <MoodChip label="any mood" active={!mood} onClick={() => setMood(null)} />
          {moods.slice(0, 14).map(m => (
            <MoodChip key={m} label={m} active={mood === m} onClick={() => setMood(mood === m ? null : m)} />
          ))}
        </div>
      </div>

      {/* Results count */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: '0.10em', color: 'var(--muted)', textTransform: 'uppercase' }}>
          {filtered.length} TRACK{filtered.length === 1 ? '' : 'S'} {sort === 'fresh' ? '· FRESH' : sort === 'plays' ? '· MOST PLAYED' : '· MOST SAVED'}
        </span>
      </div>

      {/* Track grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 14,
      }}>
        {filtered.map(t => <DiscoverCard key={t.id} track={t} artist={users[t.artist]} onPlay={onPlay} onOpenProfile={onOpenProfile} />)}
      </div>
    </div>
  );
}

// ── Hero — "fresh today" featured row ──────────────────────────────────────

function DiscoverHero({ fresh, users, onPlay, onOpenProfile }) {
  return (
    <div className="card" style={{ overflow: 'hidden', marginBottom: 18 }}>
      <div style={{
        padding: '20px 26px',
        background: 'linear-gradient(135deg, rgba(0,229,176,0.08), rgba(167,139,250,0.06))',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--cyan)', textTransform: 'uppercase' }}>DISCOVER</div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em', marginTop: 4 }}>Tracks from the SPECTR community</div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.5 }}>
            Producers publishing their work for feedback, listening, and sync opportunities. Tracks stay private unless you publish them.
          </div>
        </div>
        <button className="btn primary sm" style={{ marginLeft: 'auto', flexShrink: 0 }}>+ Publish a track</button>
      </div>

      <div style={{ padding: 16 }}>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 10 }}>FRESH THIS WEEK</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {fresh.map(t => <FeaturedRow key={t.id} track={t} artist={users[t.artist]} onPlay={onPlay} onOpenProfile={onOpenProfile} />)}
        </div>
      </div>
    </div>
  );
}

function FeaturedRow({ track, artist, onPlay, onOpenProfile }) {
  return (
    <button onClick={() => onPlay(track)} style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: 10, borderRadius: 10,
      background: 'rgba(255,255,255,0.018)',
      border: '1px solid var(--border)',
      cursor: 'pointer', textAlign: 'left',
      transition: 'border-color .15s, background .15s',
    }}
    onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(0,229,176,0.32)'; e.currentTarget.style.background = 'rgba(255,255,255,0.035)'; }}
    onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'rgba(255,255,255,0.018)'; }}>
      <CoverArt hue={track.hue} size="md" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title}</div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
          <span onClick={e => { e.stopPropagation(); onOpenProfile(artist.handle); }} style={{ color: 'var(--cyan)', cursor: 'pointer' }}>@{artist.handle}</span>
          {' · '}{track.genre}{track.bpm ? ` · ${track.bpm} BPM` : ''}
        </div>
        <div className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 4 }}>
          {track.publishedDays === 0 ? 'today' : `${track.publishedDays}d ago`} · ▶ {track.plays}
        </div>
      </div>
      <span style={{
        width: 30, height: 30, borderRadius: '50%',
        background: 'var(--cyan)', color: '#06151a',
        display: 'grid', placeItems: 'center',
        fontSize: 11, fontWeight: 700, flexShrink: 0,
      }}>▶</span>
    </button>
  );
}

// ── Discover card ────────────────────────────────────────────────────────

function DiscoverCard({ track, artist, onPlay, onOpenProfile }) {
  const licenseColors = {
    'Sync-cleared':         'var(--cyan)',
    'Royalty-free':         'var(--green)',
    'Personal only':        'var(--yellow)',
    'All rights reserved':  'var(--muted)',
  };
  const lc = licenseColors[track.license] || 'var(--muted)';
  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      transition: 'border-color .15s, transform .15s',
    }}
    onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(0,229,176,0.32)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
    onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'translateY(0)'; }}>

      <button onClick={() => onPlay(track)} style={{ padding: 0, background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}>
        <div style={{ position: 'relative', aspectRatio: '2.0', overflow: 'hidden' }}>
          <CoverArt hue={track.hue} size="fluid" />
          <div style={{ position: 'absolute', inset: 0, padding: 10, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <span className="pill" style={{
                color: lc, background: `${lc}10`, border: `1px solid ${lc}44`,
                backdropFilter: 'blur(4px)', fontWeight: 700,
              }}>
                {track.license.replace('All rights reserved', '© only')}
              </span>
              <span className="pill" style={{ background: 'rgba(7,10,18,0.55)', backdropFilter: 'blur(4px)' }}>
                {track.lufs.toFixed(1)} LUFS
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', gap: 1.5, alignItems: 'flex-end', height: 22, opacity: 0.85 }}>
                {Array.from({ length: 26 }).map((_, i) => {
                  const v = 0.3 + (Math.sin(i * 0.6 + track.hue) * 0.5 + 0.5) * 0.7;
                  return <div key={i} style={{ width: 2, height: `${v * 100}%`, background: 'rgba(255,255,255,0.75)', borderRadius: 1 }} />;
                })}
              </div>
              <span style={{
                width: 28, height: 28, borderRadius: '50%',
                background: 'var(--cyan)', color: '#06151a',
                display: 'grid', placeItems: 'center',
                fontSize: 11, fontWeight: 700,
                boxShadow: '0 0 12px rgba(0,229,176,0.4)',
              }}>▶</span>
            </div>
          </div>
        </div>
      </button>

      {/* Title + artist */}
      <div style={{ padding: '12px 14px 8px' }}>
        <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title}</div>
        <button onClick={() => onOpenProfile(artist.handle)}
          className="mono" style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            fontSize: 11, color: 'var(--cyan)', marginTop: 3,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
          <span style={{ width: 16, height: 16, borderRadius: '50%',
            background: `linear-gradient(135deg, oklch(0.72 0.18 ${artist.avatarHue}), oklch(0.55 0.20 ${(artist.avatarHue + 60) % 360}))`,
            border: '1px solid rgba(255,255,255,0.1)',
          }} />
          <span>{artist.displayName} <span style={{ color: 'var(--muted)' }}>@{artist.handle}</span></span>
        </button>
      </div>

      <div style={{ padding: '0 14px 10px' }}>
        <div className="mono" style={{ fontSize: 10, color: 'var(--text-2)', display: 'flex', gap: 8 }}>
          <span>{track.genre}</span>
          {track.bpm > 0 && <><span style={{ color: 'var(--dim)' }}>·</span><span>{track.bpm} BPM</span></>}
          <span style={{ color: 'var(--dim)' }}>·</span>
          <span>{track.key}</span>
        </div>
        {track.moods && (
          <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
            {track.moods.map(m => (
              <span key={m} className="mono" style={{
                fontSize: 9, padding: '1px 6px', borderRadius: 4,
                background: 'rgba(167,139,250,0.06)',
                border: '1px solid rgba(167,139,250,0.22)',
                color: 'var(--violet)',
              }}>{m}</span>
            ))}
          </div>
        )}
      </div>

      <div style={{
        padding: '8px 14px 10px',
        borderTop: '1px solid var(--border)',
        background: 'rgba(255,255,255,0.012)',
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span className="mono" style={{ fontSize: 9, color: 'var(--dim)' }}>
          {track.publishedDays === 0 ? 'today' : `${track.publishedDays}d ago`}
        </span>
        <div style={{ display: 'flex', gap: 10 }}>
          <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>▶ {track.plays}</span>
          <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>★ {track.savesCount}</span>
        </div>
      </div>
    </div>
  );
}

// ── Filter chips ────────────────────────────────────────────────────────

function SelectChip({ label, value, options, onChange }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 10px 5px 12px', borderRadius: 7,
      background: 'rgba(255,255,255,0.025)',
      border: '1px solid var(--border)',
    }}>
      <span className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="mono" style={{
        background: 'transparent', border: 'none', color: 'var(--text)',
        fontSize: 11, fontFamily: 'JetBrains Mono, monospace', outline: 'none', cursor: 'pointer',
      }}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function BpmRangeChip({ range, onChange }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 12px', borderRadius: 7,
      background: 'rgba(255,255,255,0.025)',
      border: '1px solid var(--border)',
    }}>
      <span className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--muted)', textTransform: 'uppercase' }}>BPM</span>
      <input type="number" value={range[0]} onChange={e => onChange([+e.target.value || 0, range[1]])}
        className="mono" style={{
          width: 36, background: 'transparent', border: 'none', outline: 'none',
          color: 'var(--text)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
        }} />
      <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>–</span>
      <input type="number" value={range[1]} onChange={e => onChange([range[0], +e.target.value || 200])}
        className="mono" style={{
          width: 36, background: 'transparent', border: 'none', outline: 'none',
          color: 'var(--text)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
        }} />
    </div>
  );
}

function SortChip({ value, onChange }) {
  const opts = [
    { v: 'fresh', l: 'Fresh' },
    { v: 'plays', l: 'Most played' },
    { v: 'saves', l: 'Most saved' },
  ];
  return (
    <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 7, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.025)' }}>
      {opts.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)} className="mono" style={{
          fontSize: 10, fontWeight: 600, padding: '4px 9px', borderRadius: 5,
          color: value === o.v ? 'var(--text)' : 'var(--muted)',
          background: value === o.v ? 'var(--card-hover)' : 'transparent',
        }}>{o.l}</button>
      ))}
    </div>
  );
}

function MoodChip({ label, active, onClick }) {
  return (
    <button onClick={onClick} className="mono" style={{
      fontSize: 10, padding: '3px 9px', borderRadius: 999,
      background: active ? 'rgba(167,139,250,0.10)' : 'rgba(255,255,255,0.02)',
      border: `1px solid ${active ? 'rgba(167,139,250,0.40)' : 'var(--border)'}`,
      color: active ? 'var(--violet)' : 'var(--muted)',
      fontWeight: active ? 700 : 500,
    }}>{label}</button>
  );
}

// ── Public Listen view — minimal version of NowPlaying for someone else's track

function PublicListenView({ track, artist, onBack, onOpenProfile }) {
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const [playing, setPlaying] = useStateD(true);
  const [pos, setPos] = useStateD(28);
  const [bookmarked, setBookmarked] = useStateD(false);
  const [comments, setComments] = useStateD([
    { id: 'tc1', user: 'forge',   handle: 'forge',   t: 42,  text: 'That filtered intro is great — does it open into the kick at the right place?', avatarHue: 18,  postedAgo: '2h ago' },
    { id: 'tc2', user: 'vela',    handle: 'vela',    t: 128, text: 'Breakdown lands hard. Maybe a longer reverb tail going in?',                    avatarHue: 220, postedAgo: '1d ago' },
    { id: 'tc3', user: 'river',   handle: 'river',   t: 196, text: 'Second drop is fire 🔥 want to license this',                                   avatarHue: 195, postedAgo: '3d ago' },
  ]);
  const [draft, setDraft] = useStateD('');
  const lc = {
    'Sync-cleared':'var(--cyan)','Royalty-free':'var(--green)','Personal only':'var(--yellow)','All rights reserved':'var(--muted)'
  }[track.license] || 'var(--muted)';

  useEffectD(() => {
    if (!playing) return;
    const start = performance.now();
    const startPos = pos;
    let raf;
    function f() {
      const e = (performance.now() - start) / 1000;
      const p = startPos + e;
      if (p >= track.durationSec) { setPos(0); setPlaying(false); return; }
      setPos(p);
      raf = requestAnimationFrame(f);
    }
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [playing, track.durationSec]);

  const pct = pos / track.durationSec;
  return (
    <div style={{ maxWidth: 1360, margin: '0 auto', padding: '20px 24px 80px' }}>
      <button onClick={onBack} className="btn ghost sm" style={{ marginBottom: 14 }}>← Discover</button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
        <CoverArt hue={track.hue} size="md" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--muted)', textTransform: 'uppercase' }}>PUBLIC TRACK</div>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.01em', marginTop: 4 }}>{track.title}</div>
          <button onClick={() => onOpenProfile(artist.handle)} className="mono" style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            fontSize: 13, color: 'var(--cyan)', marginTop: 4,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ width: 18, height: 18, borderRadius: '50%',
              background: `linear-gradient(135deg, oklch(0.72 0.18 ${artist.avatarHue}), oklch(0.55 0.20 ${(artist.avatarHue + 60) % 360}))`,
            }} />
            <span style={{ fontWeight: 600 }}>{artist.displayName}</span>
            <span style={{ color: 'var(--muted)' }}>@{artist.handle}</span>
          </button>
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <span className="pill cyan">{track.genre}</span>
            {track.bpm > 0 && <span className="pill"><span className="mono">{track.bpm}</span> BPM</span>}
            <span className="pill"><span className="mono">{track.key}</span></span>
            <span className="pill" style={{ color: lc, borderColor: `${lc}44`, background: `${lc}10` }}>{track.license}</span>
            {track.allowDownload && <span className="pill green">Downloads allowed</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setBookmarked(b => !b)} className="btn sm" style={{
            background: bookmarked ? 'rgba(0,229,176,0.10)' : 'rgba(255,255,255,0.03)',
            borderColor: bookmarked ? 'rgba(0,229,176,0.40)' : 'var(--border)',
            color: bookmarked ? 'var(--cyan)' : 'var(--text-2)',
            fontWeight: bookmarked ? 700 : 600,
          }}>
            {bookmarked ? '★ Bookmarked' : '☆ Bookmark'}
          </button>
          {track.allowDownload && <button className="btn sm">⇣ Download</button>}
        </div>
      </div>

      {/* Hero spectrum + transport */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 18 }}>
        <SpectrumBars playing={playing} bpm={track.bpm || 120} style="mirrored" height={300} />
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
          {/* waveform */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 1, height: 54, position: 'relative', cursor: 'pointer' }}
            onClick={e => {
              const r = e.currentTarget.getBoundingClientRect();
              const p = (e.clientX - r.left) / r.width;
              setPos(p * track.durationSec);
            }}>
            {Array.from({ length: 200 }).map((_, i) => {
              const v = 0.3 + (Math.sin(i * 0.4 + track.hue * 0.1) * 0.5 + 0.5) * 0.65 + (Math.sin(i * 1.7) * 0.5 + 0.5) * 0.2;
              const played = i / 200 <= pct;
              return <div key={i} style={{ flex: 1, height: `${Math.max(8, v * 100)}%`, background: played ? 'var(--cyan)' : 'rgba(255,255,255,0.12)', borderRadius: 1 }} />;
            })}
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${pct * 100}%`, width: 2, background: 'white', opacity: 0.85, boxShadow: '0 0 8px rgba(0,229,176,0.8)' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12 }}>
            <button onClick={() => setPlaying(p => !p)} style={{
              width: 40, height: 40, borderRadius: '50%',
              background: 'var(--cyan)', color: '#06151a',
              display: 'grid', placeItems: 'center', fontSize: 13,
              boxShadow: playing ? '0 0 20px rgba(0,229,176,0.5)' : '0 0 10px rgba(0,229,176,0.25)',
            }}>{playing ? '⏸' : '▶'}</button>
            <span className="mono" style={{ fontSize: 12 }}>
              <span style={{ color: 'var(--cyan)' }}>{fmt(pos)}</span><span style={{ color: 'var(--muted)' }}> / {fmt(track.durationSec)}</span>
            </span>
            <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>
              ▶ {track.plays} · ★ {track.savesCount}
            </span>
          </div>
        </div>
      </div>

      {/* Track description */}
      {track.description && (
        <div className="card card-body" style={{ marginBottom: 18 }}>
          <SectionTitle accent="var(--cyan)">About this track</SectionTitle>
          <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6 }}>{track.description}</p>
          <div style={{ display: 'flex', gap: 5, marginTop: 12, flexWrap: 'wrap' }}>
            {track.moods.map(m => (
              <span key={m} className="mono" style={{
                fontSize: 10, padding: '3px 8px', borderRadius: 5,
                background: 'rgba(167,139,250,0.06)',
                border: '1px solid rgba(167,139,250,0.22)',
                color: 'var(--violet)',
              }}>{m}</span>
            ))}
          </div>
        </div>
      )}

      {/* Preview-adjustment tool rail — works on public tracks too */}
      <ToolsRail track={track} />

      {/* Public comments — leave timestamped feedback for the artist */}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-hd">
          <SectionTitle accent="var(--violet)" style={{ marginBottom: 0 }}>
            Comments · <span style={{ color: 'var(--text-2)' }}>{comments.length}</span>
          </SectionTitle>
          <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>visible to {artist.displayName} and anyone listening</span>
        </div>
        <div style={{ padding: '8px 8px 12px' }}>
          {comments.map(c => (
            <div key={c.id} style={{
              display: 'flex', gap: 12, padding: '10px 14px',
              borderRadius: 8,
            }}>
              <button onClick={() => onOpenProfile(c.handle)} style={{
                width: 32, height: 32, borderRadius: '50%',
                background: `linear-gradient(135deg, oklch(0.72 0.18 ${c.avatarHue}), oklch(0.55 0.20 ${(c.avatarHue + 60) % 360}))`,
                color: '#06151a', display: 'grid', placeItems: 'center',
                fontWeight: 800, fontSize: 13, flexShrink: 0,
                border: 'none', cursor: 'pointer',
              }}>
                {c.user[0].toUpperCase()}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <button onClick={() => onOpenProfile(c.handle)} className="mono" style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    fontSize: 12, fontWeight: 700, color: 'var(--text)',
                  }}>@{c.user}</button>
                  <button onClick={() => setPos(c.t)} className="mono" style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    fontSize: 10, color: 'var(--violet)',
                  }}>@{fmt(c.t)}</button>
                  <span className="mono" style={{ fontSize: 9, color: 'var(--dim)' }}>· {c.postedAgo}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.45 }}>{c.text}</div>
              </div>
            </div>
          ))}
          {/* New comment */}
          <div style={{
            margin: '8px 8px 0',
            padding: '10px 12px',
            border: '1px solid var(--border)',
            borderRadius: 8,
            display: 'flex', gap: 10, alignItems: 'center',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--cyan), var(--violet))',
              color: '#06151a', display: 'grid', placeItems: 'center',
              fontWeight: 800, fontSize: 11, flexShrink: 0,
            }}>M</div>
            <input value={draft} onChange={e => setDraft(e.target.value)}
              placeholder={`Leave a timestamped comment for @${artist.handle}…`}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--text)', fontSize: 13, fontFamily: 'inherit',
              }} />
            <span className="mono" style={{ fontSize: 10, color: 'var(--violet)' }}>@ {fmt(pos)}</span>
            <button onClick={() => {
              if (!draft.trim()) return;
              setComments(c => [...c, {
                id: 'tc' + Date.now(), user: 'maek', handle: 'maek', t: Math.floor(pos),
                text: draft.trim(), avatarHue: 168, postedAgo: 'just now',
              }]);
              setDraft('');
            }} className="btn sm primary" style={{ padding: '4px 12px', fontSize: 11 }}>Post</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Public profile page ───────────────────────────────────────────────────

function PublicProfilePage({ user, tracks, allUsers, onBack, onPlay, onOpenProfile, onEditPublicProfile }) {
  const userTracks = tracks.filter(t => t.artist === user.handle);
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 0 80px' }}>
      {/* Banner */}
      <div style={{
        height: 180, position: 'relative', overflow: 'hidden',
        background: `linear-gradient(135deg, oklch(0.32 0.16 ${user.bannerHue}), oklch(0.16 0.08 ${(user.bannerHue + 40) % 360}))`,
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 6px)',
          opacity: 0.5,
        }} />
        <button onClick={onBack} className="btn ghost sm" style={{
          position: 'absolute', top: 18, left: 24,
          background: 'rgba(7,10,18,0.6)', backdropFilter: 'blur(6px)',
        }}>← Back</button>
        {user.isYou && (
          <button onClick={onEditPublicProfile} className="btn sm" style={{
            position: 'absolute', top: 18, right: 24,
            background: 'rgba(7,10,18,0.6)', backdropFilter: 'blur(6px)',
          }}>✎ Edit public profile</button>
        )}
      </div>

      <div style={{ padding: '0 28px', marginTop: -38, position: 'relative' }}>
        <div style={{
          width: 76, height: 76, borderRadius: '50%',
          background: `linear-gradient(135deg, oklch(0.72 0.18 ${user.avatarHue}), oklch(0.55 0.20 ${(user.avatarHue + 60) % 360}))`,
          display: 'grid', placeItems: 'center',
          color: '#06151a', fontWeight: 800, fontSize: 32,
          border: '4px solid var(--bg)',
          boxShadow: '0 0 24px -6px rgba(0,0,0,0.6)',
        }}>{user.displayName[0]}</div>

        <div style={{ marginTop: 14, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.01em' }}>{user.displayName}</span>
              <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>@{user.handle}</span>
              {user.isYou && <span className="pill cyan">that's you</span>}
            </div>
            {user.bio && <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 6, lineHeight: 1.5, maxWidth: 620 }}>{user.bio}</p>}
            <div style={{ display: 'flex', gap: 14, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              {user.link && (
                <a href="#" className="mono" style={{ fontSize: 11, color: 'var(--cyan)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5 }}>
                  ↗ <span>{user.link}</span>
                </a>
              )}
              <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
                {userTracks.length} public track{userTracks.length === 1 ? '' : 's'}
              </span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>
                joined {user.joinedMonths} mo ago
              </span>
            </div>
          </div>
        </div>

        {/* Tracks list */}
        <div style={{ marginTop: 28 }}>
          <SectionTitle accent="var(--cyan)">Public tracks</SectionTitle>
          {userTracks.length === 0 ? (
            <div className="card card-body" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
              <div style={{ fontSize: 14, marginBottom: 6 }}>No public tracks yet.</div>
              {user.isYou && <div className="mono" style={{ fontSize: 11 }}>Publish a song from its detail page to make it appear here.</div>}
            </div>
          ) : (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14,
            }}>
              {userTracks.map(t => (
                <DiscoverCard key={t.id} track={t} artist={user} onPlay={onPlay} onOpenProfile={onOpenProfile} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Publish-to-Discover modal ─────────────────────────────────────────────

function PublishToDiscoverModal({ song, genres, moods, licenses, onClose, onPublish }) {
  const cur = song.versions.find(v => v.current) || song.versions[song.versions.length - 1];
  const [form, setForm] = useStateD({
    versionV:    cur.v,
    title:       song.name,
    artist:      'Mae Karlsson',
    genre:       song.genre,
    description: '',
    moods:       [],
    license:     'Sync-cleared',
    allowDownload: false,
    showAnalysis: false,
    anonymous:   false,
  });
  function field(k, v) { setForm(f => ({ ...f, [k]: v })); }
  function toggleMood(m) {
    setForm(f => ({ ...f, moods: f.moods.includes(m) ? f.moods.filter(x => x !== m) : [...f.moods, m] }));
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(7,10,18,0.78)',
      backdropFilter: 'blur(8px)',
      zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
      animation: 'fadeIn 0.18s ease both',
    }}>
      <div className="card" style={{
        width: '100%', maxWidth: 640,
        maxHeight: 'calc(100vh - 40px)', overflowY: 'auto',
        animation: 'modalIn 0.2s ease both',
      }}>
        <style>{`@keyframes modalIn { from { opacity: 0; transform: scale(0.97) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }`}</style>

        <div style={{
          padding: '16px 22px',
          borderBottom: '1px solid var(--border)',
          background: 'linear-gradient(135deg, rgba(0,229,176,0.08), rgba(167,139,250,0.06))',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 9,
            background: 'rgba(0,229,176,0.14)',
            border: '1px solid rgba(0,229,176,0.4)',
            color: 'var(--cyan)', display: 'grid', placeItems: 'center',
            fontSize: 18, fontWeight: 800,
          }}>★</div>
          <div style={{ flex: 1 }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--cyan)', textTransform: 'uppercase' }}>PUBLISH TO DISCOVER</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>Share {song.name} with the SPECTR community</div>
          </div>
          <button onClick={onClose} className="btn ghost sm" style={{ color: 'var(--muted)' }}>✕</button>
        </div>

        <div style={{ padding: 22 }}>
          {/* Version */}
          <FormSection label="WHICH VERSION">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {song.versions.map(v => (
                <button key={v.v} onClick={() => field('versionV', v.v)} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 12px', borderRadius: 7,
                  background: form.versionV === v.v ? 'rgba(0,229,176,0.10)' : 'rgba(255,255,255,0.025)',
                  border: `1px solid ${form.versionV === v.v ? 'rgba(0,229,176,0.40)' : 'var(--border)'}`,
                  cursor: 'pointer',
                }}>
                  <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: form.versionV === v.v ? 'var(--cyan)' : 'var(--text-2)' }}>v{v.v}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{v.label || <span style={{ color: 'var(--muted)' }}>(unlabeled)</span>}</span>
                  <GradePill grade={v.grade} size="sm" />
                </button>
              ))}
            </div>
          </FormSection>

          {/* Title + artist */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <FormSection label="DISPLAY TITLE">
              <FormInput value={form.title} onChange={v => field('title', v)} placeholder="Aurora" />
            </FormSection>
            <FormSection label={form.anonymous ? 'ARTIST · HIDDEN' : 'ARTIST DISPLAY NAME'}>
              {form.anonymous ? (
                <div style={{
                  padding: '8px 12px',
                  background: 'rgba(167,139,250,0.06)',
                  border: '1px dashed rgba(167,139,250,0.32)',
                  borderRadius: 7,
                  color: 'var(--violet)',
                  fontSize: 13, fontFamily: 'JetBrains Mono, monospace',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{ fontSize: 14 }}>👤</span>
                  <span>Anonymous</span>
                  <span className="mono" style={{ fontSize: 9, color: 'var(--muted)', marginLeft: 'auto' }}>not linked to your profile</span>
                </div>
              ) : (
                <FormInput value={form.artist} onChange={v => field('artist', v)} placeholder="Mae Karlsson" />
              )}
            </FormSection>
          </div>

          {/* Genre */}
          <FormSection label="GENRE">
            <select value={form.genre} onChange={e => field('genre', e.target.value)} style={fieldStyle}>
              {genres.filter(g => g !== 'All').map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </FormSection>

          {/* Moods */}
          <FormSection label={`MOODS · ${form.moods.length} selected`}>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {moods.slice(0, 16).map(m => (
                <button key={m} onClick={() => toggleMood(m)} className="mono" style={{
                  fontSize: 10, padding: '4px 9px', borderRadius: 999,
                  background: form.moods.includes(m) ? 'rgba(167,139,250,0.12)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${form.moods.includes(m) ? 'rgba(167,139,250,0.40)' : 'var(--border)'}`,
                  color: form.moods.includes(m) ? 'var(--violet)' : 'var(--muted)',
                  fontWeight: form.moods.includes(m) ? 700 : 500,
                }}>{m}</button>
              ))}
            </div>
          </FormSection>

          {/* Description */}
          <FormSection label="DESCRIPTION (OPTIONAL)">
            <textarea value={form.description} onChange={e => field('description', e.target.value)}
              placeholder="1–2 sentences — what should listeners know about this track?"
              style={{ ...fieldStyle, minHeight: 72, resize: 'vertical' }} />
          </FormSection>

          {/* License */}
          <FormSection label="LICENSE">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
              {licenses.filter(l => l !== 'All licenses').map(l => (
                <button key={l} onClick={() => field('license', l)} style={{
                  padding: '8px 11px', borderRadius: 7, textAlign: 'left',
                  background: form.license === l ? 'rgba(0,229,176,0.06)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${form.license === l ? 'rgba(0,229,176,0.40)' : 'var(--border)'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 12, height: 12, borderRadius: '50%', border: `2px solid ${form.license === l ? 'var(--cyan)' : 'var(--border)'}`, background: form.license === l ? 'var(--cyan)' : 'transparent', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{l}</span>
                  </div>
                  <div className="mono" style={{ fontSize: 9, color: 'var(--muted)', marginTop: 3, marginLeft: 18 }}>
                    {l === 'Sync-cleared' && 'Others may license for film/video — you keep ownership.'}
                    {l === 'Royalty-free' && 'Free for any use, with attribution.'}
                    {l === 'Personal only' && 'Listen only — no commercial use.'}
                    {l === 'All rights reserved' && '© All rights reserved.'}
                  </div>
                </button>
              ))}
            </div>
          </FormSection>

          {/* Toggles */}
          <FormSection label="OPTIONS">
            <FormToggle label="Publish anonymously"                        hint="Track won't link back to your profile. Comments are still public to anyone listening." value={form.anonymous}     onChange={v => field('anonymous', v)} />
            <FormToggle label="Allow listeners to download the file"       hint="WAV / FLAC / MP3 depending on what you uploaded."                                       value={form.allowDownload} onChange={v => field('allowDownload', v)} />
            <FormToggle label="Show the full analysis report publicly"     hint="Grade, fix queue, AI Coach findings visible to anyone listening."                       value={form.showAnalysis}  onChange={v => field('showAnalysis', v)} />
          </FormSection>
        </div>

        <div style={{
          padding: '14px 22px',
          borderTop: '1px solid var(--border)',
          background: 'rgba(255,255,255,0.012)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', flex: 1 }}>
            You can unpublish or edit anytime from the song page.
          </span>
          <button onClick={onClose} className="btn sm">Cancel</button>
          <button onClick={() => onPublish(form)} className="btn primary sm">Publish to Discover →</button>
        </div>
      </div>
    </div>
  );
}

const fieldStyle = {
  width: '100%',
  background: 'rgba(7,10,18,0.5)',
  border: '1px solid var(--border)',
  borderRadius: 7,
  padding: '8px 12px',
  color: 'var(--text)',
  fontSize: 13,
  fontFamily: "'Syne', sans-serif",
  outline: 'none',
};

function FormSection({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function FormInput({ value, onChange, placeholder }) {
  return <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={fieldStyle} />;
}

function FormToggle({ label, hint, value, onChange }) {
  return (
    <label style={{
      display: 'flex', gap: 12, alignItems: 'flex-start',
      padding: '10px 12px',
      background: 'rgba(255,255,255,0.018)',
      border: '1px solid var(--border)',
      borderRadius: 7,
      cursor: 'pointer',
      marginBottom: 6,
    }}>
      <span style={{
        width: 32, height: 18, borderRadius: 999,
        background: value ? 'var(--cyan)' : 'var(--dim)',
        position: 'relative',
        transition: 'background .15s',
        flexShrink: 0, marginTop: 1,
      }}>
        <span style={{
          position: 'absolute', top: 2, left: value ? 16 : 2,
          width: 14, height: 14, borderRadius: '50%',
          background: '#06151a',
          transition: 'left .15s',
        }} />
      </span>
      <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} style={{ display: 'none' }} />
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        {hint && <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{hint}</div>}
      </div>
    </label>
  );
}

// ── Public Profile editor (lightweight) ──────────────────────────────────

function EditPublicProfileModal({ user, onClose, onSave }) {
  const [form, setForm] = useStateD({
    displayName: user.displayName,
    bio: user.bio || '',
    link: user.link || '',
    bannerHue: user.bannerHue,
  });
  function f(k, v) { setForm(s => ({ ...s, [k]: v })); }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(7,10,18,0.78)',
      backdropFilter: 'blur(8px)',
      zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
      animation: 'fadeIn 0.18s ease both',
    }}>
      <div className="card" style={{ width: '100%', maxWidth: 520, overflow: 'hidden' }}>
        <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--cyan)', textTransform: 'uppercase' }}>EDIT PUBLIC PROFILE</div>
          <button onClick={onClose} className="btn ghost sm" style={{ color: 'var(--muted)', marginLeft: 'auto' }}>✕</button>
        </div>

        <div style={{ padding: 22 }}>
          <FormSection label="DISPLAY NAME">
            <FormInput value={form.displayName} onChange={v => f('displayName', v)} placeholder="Public-facing name" />
          </FormSection>
          <FormSection label="BIO (1–2 LINES)">
            <textarea value={form.bio} onChange={e => f('bio', e.target.value)} maxLength={140}
              placeholder="What you make, where you are, what you're open to. Optional."
              style={{ ...fieldStyle, minHeight: 56, resize: 'vertical' }} />
            <div className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 4, textAlign: 'right' }}>{form.bio.length}/140</div>
          </FormSection>
          <FormSection label="LINK (OPTIONAL)">
            <FormInput value={form.link} onChange={v => f('link', v)} placeholder="soundcloud.com/you · yourwebsite.com" />
          </FormSection>
          <FormSection label="BANNER COLOR">
            <div style={{ display: 'flex', gap: 8 }}>
              {[168, 220, 18, 38, 195, 264, 320, 145].map(h => (
                <button key={h} onClick={() => f('bannerHue', h)} style={{
                  width: 40, height: 28, borderRadius: 6,
                  background: `linear-gradient(135deg, oklch(0.32 0.16 ${h}), oklch(0.16 0.08 ${(h + 40) % 360}))`,
                  border: form.bannerHue === h ? '2px solid var(--cyan)' : '1px solid var(--border)',
                  cursor: 'pointer',
                }} />
              ))}
            </div>
          </FormSection>
          <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>
            🔒 Your private profile, library, references, and notes always stay private. Only what you publish to Discover shows here.
          </div>
        </div>

        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="btn sm">Cancel</button>
          <button onClick={() => onSave(form)} className="btn primary sm">Save</button>
        </div>
      </div>
    </div>
  );
}

window.DiscoverPage = DiscoverPage;
window.PublicListenView = PublicListenView;
window.PublicProfilePage = PublicProfilePage;
window.PublishToDiscoverModal = PublishToDiscoverModal;
window.EditPublicProfileModal = EditPublicProfileModal;
