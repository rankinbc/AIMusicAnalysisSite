/* SPECTR — Profile / Personal page
 *
 * Top-right avatar opens this. Tabs: Overview, Library, References (★ new),
 * Activity, Settings. The References tab is the featured new feature —
 * producers save reference tracks (YouTube/Spotify/file) once and reuse them
 * across all their mixes instead of re-uploading each time.
 */

const { useState: useStateP } = React;

function ProfilePage({ profile, library, references, sets, publicProfile, bookmarks, onOpenSong, onCompare, onOpenPublicProfile, onPlayPublicTrack, onOpenPublicProfilePage }) {
  const [tab, setTab] = useStateP('references');

  return (
    <div style={{ maxWidth: 1360, margin: '0 auto', padding: '24px 24px 80px' }}>
      <ProfileHeader profile={profile} publicProfile={publicProfile} onOpenPublicProfile={onOpenPublicProfile} />
      <ProfileTabs current={tab} onChange={setTab} profile={profile} bookmarks={bookmarks} />

      {tab === 'overview'   && <ProfileOverview profile={profile} library={library} references={references} />}
      {tab === 'library'    && <ProfileLibrary library={library} onOpenSong={onOpenSong} />}
      {tab === 'references' && <ReferencesTab references={references} sets={sets} onCompare={onCompare} />}
      {tab === 'bookmarks'  && <BookmarksTab bookmarks={bookmarks} onPlayPublicTrack={onPlayPublicTrack} onOpenPublicProfilePage={onOpenPublicProfilePage} />}
      {tab === 'activity'   && <ProfileActivity profile={profile} />}
      {tab === 'settings'   && <ProfileSettings profile={profile} />}
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────

function ProfileHeader({ profile, publicProfile, onOpenPublicProfile }) {
  const s = profile.stats;
  return (
    <div className="card" style={{ overflow: 'hidden', marginBottom: 18 }}>
      <div style={{
        position: 'relative',
        background: 'linear-gradient(135deg, rgba(0,229,176,0.10) 0%, rgba(167,139,250,0.06) 60%, transparent 100%)',
        padding: '24px 28px',
        display: 'flex', alignItems: 'center', gap: 22,
      }}>
        <div style={{
          width: 84, height: 84, borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--cyan) 0%, var(--violet) 100%)',
          display: 'grid', placeItems: 'center',
          color: '#06151a', fontWeight: 800, fontSize: 36,
          boxShadow: '0 0 0 4px rgba(7,10,18,0.8), 0 0 24px -6px rgba(0,229,176,0.5)',
          flexShrink: 0,
        }}>{profile.initial}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.01em' }}>{profile.name}</span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{profile.handle}</span>
            <span className="pill cyan" style={{ marginLeft: 6 }}>{profile.plan}</span>
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
            {profile.email} · {profile.joined}
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 14 }}>
            <ProfileStat label="Songs"      value={s.songs} />
            <ProfileStat label="Versions"   value={s.versions} />
            <ProfileStat label="References" value={s.references} accent="violet" />
            <ProfileStat label="Analyses"   value={s.analyses} />
            <ProfileStat label="Plays"      value={s.plays} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
          <div style={{
            padding: '8px 14px', borderRadius: 7,
            border: '1px solid var(--border)',
            background: 'rgba(255,255,255,0.025)',
            minWidth: 220,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--muted)', textTransform: 'uppercase' }}>This month</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--cyan)' }}>
                {profile.usage.analysesThisMonth}<span style={{ color: 'var(--muted)' }}>/{profile.usage.analysesCap}</span>
              </span>
            </div>
            <div style={{ height: 4, background: 'var(--dim)', borderRadius: 2 }}>
              <div style={{
                height: '100%',
                width: `${(profile.usage.analysesThisMonth / profile.usage.analysesCap) * 100}%`,
                background: 'var(--cyan)', borderRadius: 2,
              }} />
            </div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 4 }}>
              analyses · resets May 31
            </div>
          </div>
          <span className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--muted)', textTransform: 'uppercase' }}>
            🔒 Private to you
          </span>
          {onOpenPublicProfile && (
            <button onClick={onOpenPublicProfile} className="btn sm" style={{
              background: 'rgba(167,139,250,0.08)',
              borderColor: 'rgba(167,139,250,0.32)',
              color: 'var(--violet)',
              fontSize: 11,
            }}>
              View your public profile →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileStat({ label, value, accent }) {
  return (
    <div>
      <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: accent === 'violet' ? 'var(--violet)' : 'var(--text)', lineHeight: 1 }}>{value}</div>
      <div className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--muted)', textTransform: 'uppercase', marginTop: 4 }}>{label}</div>
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────

function ProfileTabs({ current, onChange, profile, bookmarks }) {
  const tabs = [
    { id: 'overview',   label: 'Overview',   badge: null },
    { id: 'library',    label: 'Library',    badge: profile.stats.songs },
    { id: 'references', label: 'References', badge: profile.stats.references, badgeTone: 'violet', featured: true },
    { id: 'bookmarks',  label: 'Bookmarks',  badge: bookmarks?.length || 0, badgeTone: 'cyan' },
    { id: 'activity',   label: 'Activity',   badge: null },
    { id: 'settings',   label: 'Settings',   badge: null },
  ];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      marginBottom: 22, borderBottom: '1px solid var(--border)',
      padding: '0 2px',
    }}>
      {tabs.map(t => {
        const active = current === t.id;
        const badgeColor = t.badgeTone === 'violet' ? 'var(--violet)' : 'var(--cyan)';
        return (
          <button key={t.id} onClick={() => onChange(t.id)} style={{
            padding: '12px 16px',
            fontSize: 13, fontWeight: 600, letterSpacing: '0.02em',
            color: active ? 'var(--text)' : 'var(--muted)',
            borderBottom: active ? '2px solid var(--cyan)' : '2px solid transparent',
            marginBottom: -1,
            display: 'flex', alignItems: 'center', gap: 8,
            transition: 'color .15s',
          }}>
            {t.featured && <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--violet)', boxShadow: '0 0 8px var(--violet)',
              animation: 'pulseGlow 1.8s ease-in-out infinite',
            }} />}
            <span>{t.label}</span>
            {t.badge != null && (
              <span className="mono" style={{
                fontSize: 9, padding: '1px 6px', borderRadius: 999,
                background: active ? `${badgeColor}1a` : 'rgba(255,255,255,0.04)',
                color: active ? badgeColor : 'var(--muted)',
                border: `1px solid ${active ? `${badgeColor}40` : 'var(--border)'}`,
                fontWeight: 700,
              }}>{t.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────

function ProfileOverview({ profile, library, references }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div className="card card-body">
          <SectionTitle accent="var(--cyan)">Recent songs</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {library.slice(0, 4).map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', borderRadius: 7 }}>
                <CoverArt hue={s.hue} size="sm" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{s.versionCount} versions · {s.genre}</div>
                </div>
                <GradePill grade={s.grade} size="sm" />
              </div>
            ))}
          </div>
        </div>

        <div className="card card-body">
          <SectionTitle accent="var(--violet)">Most-used references</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[...references].filter(r => r.analyzed).sort((a, b) => b.used - a.used).slice(0, 4).map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', borderRadius: 7 }}>
                <CoverArt hue={r.hue} size="sm" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{r.artist} · used in {r.used} comparisons</div>
                </div>
                <span className="pill violet">{r.lufs.toFixed(1)} LUFS</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div className="card card-body">
          <SectionTitle accent="var(--cyan)">Usage</SectionTitle>
          <UsageRow label="Analyses"        value={profile.usage.analysesThisMonth}  cap={profile.usage.analysesCap}  unit="" />
          <UsageRow label="Specialist runs" value={profile.usage.specialistsCalls}   cap={profile.usage.specialistsCap}  unit="" />
          <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: 'rgba(0,229,176,0.04)', border: '1px solid rgba(0,229,176,0.18)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--cyan)' }}>{profile.plan} plan</div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 4 }}>
              50 analyses/mo · unlimited library size · 500 specialist runs · unlimited references
            </div>
            <button className="btn sm" style={{ marginTop: 8 }}>Manage plan</button>
          </div>
        </div>

        <div className="card card-body">
          <SectionTitle accent="var(--cyan)">Recent activity</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {profile.activity.slice(0, 5).map((a, i) => <ActivityRow act={a} key={i} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function UsageRow({ label, value, cap, unit }) {
  const pct = (value / cap) * 100;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>
          {value}<span style={{ color: 'var(--muted)' }}>/{cap}{unit}</span>
        </span>
      </div>
      <div style={{ height: 4, background: 'var(--dim)', borderRadius: 2 }}>
        <div className="fill-w" style={{ height: '100%', width: `${pct}%`, background: pct < 70 ? 'var(--cyan)' : pct < 90 ? 'var(--yellow)' : 'var(--orange)', borderRadius: 2 }} />
      </div>
    </div>
  );
}

function ActivityRow({ act }) {
  const map = {
    analysis: { color: 'var(--cyan)',   glyph: '◐' },
    upload:   { color: 'var(--cyan)',   glyph: '↑' },
    ref:      { color: 'var(--violet)', glyph: '★' },
    compare:  { color: 'var(--violet)', glyph: '⇄' },
    song:     { color: 'var(--green)',  glyph: '✦' },
  };
  const m = map[act.kind] || map.analysis;
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{
        width: 22, height: 22, borderRadius: '50%',
        background: `${m.color}14`, border: `1px solid ${m.color}40`,
        color: m.color, display: 'grid', placeItems: 'center',
        fontSize: 11, flexShrink: 0, marginTop: 2,
      }}>{m.glyph}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{act.text}</div>
        <div className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 2 }}>{act.t}</div>
      </div>
    </div>
  );
}

// ── Library tab (embed of LibraryPage but without its own header) ─────────

function ProfileLibrary({ library, onOpenSong }) {
  // Just call LibraryPage — but suppress its outer padding? It already has its own header.
  // Easiest: render in-place. The styling will work fine.
  return <window.LibraryPage library={library} onOpenSong={onOpenSong} />;
}

// ── Bookmarks tab — public tracks the user has saved for later ───────────

function BookmarksTab({ bookmarks, onPlayPublicTrack, onOpenPublicProfilePage }) {
  if (!bookmarks || bookmarks.length === 0) {
    return (
      <div className="card card-body" style={{ textAlign: 'center', padding: 56 }}>
        <div style={{
          width: 52, height: 52, borderRadius: 13,
          background: 'rgba(0,229,176,0.06)',
          border: '1px solid rgba(0,229,176,0.32)',
          color: 'var(--cyan)',
          display: 'grid', placeItems: 'center',
          margin: '0 auto 14px',
          fontSize: 24,
        }}>☆</div>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>No bookmarks yet</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5, maxWidth: 360, margin: '0 auto' }}>
          When you're listening to other producers' tracks on Discover, tap <span style={{ color: 'var(--cyan)' }}>☆ Bookmark</span> to save them here. Bookmarks don't go into your library — they're just for revisiting later.
        </div>
      </div>
    );
  }
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: '0.10em', color: 'var(--muted)', textTransform: 'uppercase' }}>
          {bookmarks.length} BOOKMARKED TRACK{bookmarks.length === 1 ? '' : 'S'}
        </span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>not part of your library · listening only</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {bookmarks.map(b => (
          <BookmarkCard key={b.track.id} bookmark={b} onPlay={onPlayPublicTrack} onOpenProfile={onOpenPublicProfilePage} />
        ))}
      </div>
    </div>
  );
}

function BookmarkCard({ bookmark, onPlay, onOpenProfile }) {
  const { track, artist, bookmarkedAgo } = bookmark;
  return (
    <button onClick={() => onPlay(track)} style={{
      textAlign: 'left',
      padding: 0,
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 12, overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      cursor: 'pointer',
      transition: 'border-color .15s, transform .15s',
    }}
    onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(0,229,176,0.32)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
    onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'translateY(0)'; }}>
      <div style={{ position: 'relative', aspectRatio: '2.0', overflow: 'hidden' }}>
        <CoverArt hue={track.hue} size="fluid" />
        <div style={{ position: 'absolute', inset: 0, padding: 10, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="pill cyan" style={{ background: 'rgba(7,10,18,0.55)', backdropFilter: 'blur(4px)', fontWeight: 700 }}>★ BOOKMARKED</span>
            <span className="pill" style={{ background: 'rgba(7,10,18,0.55)', backdropFilter: 'blur(4px)' }}>{track.lufs.toFixed(1)} LUFS</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', gap: 1.5, alignItems: 'flex-end', height: 22, opacity: 0.85 }}>
              {Array.from({ length: 22 }).map((_, i) => {
                const v = 0.3 + (Math.sin(i * 0.6 + track.hue) * 0.5 + 0.5) * 0.7;
                return <div key={i} style={{ width: 2, height: `${v * 100}%`, background: 'rgba(255,255,255,0.75)', borderRadius: 1 }} />;
              })}
            </div>
            <span style={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'var(--cyan)', color: '#06151a',
              display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700,
              boxShadow: '0 0 12px rgba(0,229,176,0.4)',
            }}>▶</span>
          </div>
        </div>
      </div>
      <div style={{ padding: '12px 14px 8px' }}>
        <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title}</div>
        <div onClick={e => { e.stopPropagation(); onOpenProfile(artist.handle); }}
          className="mono" style={{
            fontSize: 11, color: 'var(--cyan)', marginTop: 3,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
          <span style={{ width: 16, height: 16, borderRadius: '50%',
            background: `linear-gradient(135deg, oklch(0.72 0.18 ${artist.avatarHue}), oklch(0.55 0.20 ${(artist.avatarHue + 60) % 360}))`,
            border: '1px solid rgba(255,255,255,0.1)',
          }} />
          <span>{artist.displayName} <span style={{ color: 'var(--muted)' }}>@{artist.handle}</span></span>
        </div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 8, display: 'flex', gap: 8 }}>
          <span>{track.genre}</span>
          {track.bpm > 0 && <><span style={{ color: 'var(--dim)' }}>·</span><span>{track.bpm} BPM</span></>}
          <span style={{ color: 'var(--dim)' }}>·</span>
          <span>{track.key}</span>
        </div>
      </div>
      <div style={{ padding: '8px 14px 10px', borderTop: '1px solid var(--border)', background: 'rgba(255,255,255,0.012)', display: 'flex', justifyContent: 'space-between' }}>
        <span className="mono" style={{ fontSize: 9, color: 'var(--dim)' }}>bookmarked {bookmarkedAgo}</span>
        <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>▶ {track.plays}</span>
      </div>
    </button>
  );
}

// ── References tab ────────────────────────────────────────────────────────

function ReferencesTab({ references, sets, onCompare }) {
  const [filter, setFilter] = useStateP('all');
  const [view, setView] = useStateP('grid');
  const [showAdd, setShowAdd] = useStateP(true);
  const [addMode, setAddMode] = useStateP('url');

  const filtered = filter === 'all'
    ? references
    : sets.find(s => s.id === filter)
      ? references.filter(r => sets.find(s => s.id === filter).refIds.includes(r.id))
      : references.filter(r => r.genre === filter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Add Reference featured zone */}
      {showAdd && (
        <AddReferenceZone mode={addMode} onMode={setAddMode} onClose={() => setShowAdd(false)} />
      )}

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <FilterChip label="All references" active={filter === 'all'} onClick={() => setFilter('all')} count={references.length} />
        {sets.map(s => (
          <FilterChip key={s.id} label={s.name} count={s.count} active={filter === s.id} onClick={() => setFilter(s.id)} color="var(--violet)" icon="★" />
        ))}
        {[...new Set(references.map(r => r.genre))].filter(g => g !== '—').map(g => (
          <FilterChip key={g} label={g} active={filter === g} onClick={() => setFilter(g)} count={references.filter(r => r.genre === g).length} muted />
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {!showAdd && <button onClick={() => setShowAdd(true)} className="btn sm primary">+ Add reference</button>}
          <button className="btn sm">＋ New set</button>
        </div>
      </div>

      {/* Reference grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 14,
      }}>
        {filtered.map(r => <ReferenceCard key={r.id} ref_={r} onCompare={onCompare} />)}
      </div>
    </div>
  );
}

function FilterChip({ label, count, active, onClick, color = 'var(--cyan)', icon, muted }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 7,
      padding: '6px 11px', borderRadius: 7,
      background: active ? `${color}12` : 'rgba(255,255,255,0.025)',
      border: `1px solid ${active ? `${color}40` : 'var(--border)'}`,
      fontSize: 12, fontWeight: 600,
      color: active ? 'var(--text)' : muted ? 'var(--muted)' : 'var(--text-2)',
    }}>
      {icon && <span style={{ color, fontSize: 10 }}>{icon}</span>}
      <span>{label}</span>
      {count != null && <span className="mono" style={{ fontSize: 9, color: active ? color : 'var(--muted)' }}>{count}</span>}
    </button>
  );
}

// ── Add reference zone (the new-user delight) ─────────────────────────────

function AddReferenceZone({ mode, onMode, onClose }) {
  return (
    <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
      <div style={{
        padding: '16px 22px',
        background: 'linear-gradient(135deg, rgba(167,139,250,0.10), rgba(0,229,176,0.06))',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 9,
          background: 'rgba(167,139,250,0.14)',
          border: '1px solid rgba(167,139,250,0.4)',
          color: 'var(--violet)',
          display: 'grid', placeItems: 'center',
          fontSize: 18, fontWeight: 800,
        }}>★</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Save reference tracks once — reuse forever</div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2, lineHeight: 1.5 }}>
            Paste a YouTube/Spotify URL or upload a file. We'll analyze it once and you can compare any of your mixes against it from any version page.
          </div>
        </div>
        <button onClick={onClose} className="btn ghost sm" style={{ color: 'var(--muted)' }}>✕</button>
      </div>

      <div style={{ display: 'flex', gap: 2, padding: '12px 14px 0', borderBottom: '1px solid var(--border)' }}>
        {[
          { id: 'url',  label: 'Paste a link',  hint: 'YouTube · Spotify · SoundCloud · Apple Music' },
          { id: 'file', label: 'Upload a file', hint: 'WAV · MP3 · FLAC (up to 200 MB)' },
          { id: 'bulk', label: 'Bulk paste',    hint: 'One URL per line — we\'ll process them all' },
        ].map(m => (
          <button key={m.id} onClick={() => onMode(m.id)} className="mono" style={{
            padding: '8px 14px', borderRadius: '6px 6px 0 0',
            fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
            color: mode === m.id ? 'var(--violet)' : 'var(--muted)',
            background: mode === m.id ? 'rgba(167,139,250,0.08)' : 'transparent',
            borderBottom: mode === m.id ? '2px solid var(--violet)' : '2px solid transparent',
            marginBottom: -1,
            textTransform: 'uppercase',
          }}>{m.label}</button>
        ))}
      </div>

      <div style={{ padding: 18 }}>
        {mode === 'url' && <UrlPasteInput />}
        {mode === 'file' && <FileDropZone />}
        {mode === 'bulk' && <BulkPasteInput />}
      </div>
    </div>
  );
}

function UrlPasteInput() {
  const [url, setUrl] = useStateP('');
  const inferred = detectSource(url);
  return (
    <div>
      <div style={{
        display: 'flex', gap: 8, padding: 8,
        background: 'rgba(7,10,18,0.5)',
        border: `1px solid ${url ? 'rgba(167,139,250,0.32)' : 'var(--border)'}`,
        borderRadius: 9,
        transition: 'border-color .15s',
      }}>
        {inferred && <SourceBadge source={inferred} />}
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="paste a youtube.com / spotify.com / soundcloud.com link"
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--text)', fontSize: 13,
            fontFamily: 'JetBrains Mono, monospace',
          }} />
        <button className="btn primary sm" disabled={!url}>Analyze + save →</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>Try:</span>
        {['youtube.com/watch?v=…', 'spotify.com/track/…', 'soundcloud.com/…'].map(p => (
          <span key={p} className="mono" style={{
            fontSize: 10, padding: '2px 7px', borderRadius: 4,
            background: 'rgba(255,255,255,0.025)', border: '1px solid var(--border)',
            color: 'var(--muted)',
          }}>{p}</span>
        ))}
        <span className="mono" style={{ fontSize: 10, color: 'var(--dim)', marginLeft: 'auto' }}>analysis takes 30–60s · we cache results</span>
      </div>
    </div>
  );
}

function FileDropZone() {
  return (
    <label style={{
      display: 'block',
      border: '1.5px dashed rgba(167,139,250,0.32)',
      borderRadius: 10,
      padding: '32px 24px',
      textAlign: 'center',
      cursor: 'pointer',
      background: 'rgba(167,139,250,0.04)',
      transition: 'background .15s, border-color .15s',
    }}
    onMouseOver={e => { e.currentTarget.style.background = 'rgba(167,139,250,0.08)'; e.currentTarget.style.borderColor = 'rgba(167,139,250,0.5)'; }}
    onMouseOut={e => { e.currentTarget.style.background = 'rgba(167,139,250,0.04)'; e.currentTarget.style.borderColor = 'rgba(167,139,250,0.32)'; }}>
      <input type="file" multiple accept="audio/*" style={{ display: 'none' }} />
      <div style={{
        width: 44, height: 44, borderRadius: 11,
        background: 'rgba(167,139,250,0.14)', color: 'var(--violet)',
        display: 'grid', placeItems: 'center', margin: '0 auto 12px',
        fontSize: 22,
      }}>↑</div>
      <div style={{ fontSize: 14, fontWeight: 700 }}>Drop audio files here</div>
      <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>WAV / MP3 / FLAC · up to 200 MB · multiple OK</div>
    </label>
  );
}

function BulkPasteInput() {
  const [text, setText] = useStateP('https://youtube.com/watch?v=xyz\nhttps://spotify.com/track/abc\nhttps://soundcloud.com/artist/track');
  const lines = text.split('\n').filter(Boolean);
  return (
    <div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="One URL per line…"
        style={{
          width: '100%', minHeight: 110,
          background: 'rgba(7,10,18,0.5)',
          border: '1px solid var(--border)', borderRadius: 8,
          padding: '10px 12px',
          color: 'var(--text)', fontSize: 12,
          fontFamily: 'JetBrains Mono, monospace',
          resize: 'vertical', outline: 'none',
        }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <span className="mono" style={{ fontSize: 11, color: 'var(--violet)' }}>{lines.length} URL{lines.length === 1 ? '' : 's'} detected</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>~{lines.length * 45}s to analyze</span>
        <button className="btn primary sm" style={{ marginLeft: 'auto' }} disabled={!lines.length}>Analyze {lines.length} track{lines.length === 1 ? '' : 's'} →</button>
      </div>
    </div>
  );
}

// ── Reference card ────────────────────────────────────────────────────────

function ReferenceCard({ ref_, onCompare }) {
  const r = ref_;
  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      transition: 'border-color .15s, transform .15s',
    }}
    onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(167,139,250,0.32)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
    onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'translateY(0)'; }}>

      {/* Cover with source badge */}
      <div style={{ position: 'relative', aspectRatio: '2.2', overflow: 'hidden' }}>
        <CoverArt hue={r.hue} size="fluid" />
        <div style={{ position: 'absolute', inset: 0, padding: 10, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <SourceBadge source={r.source} />
            {r.used > 0 && (
              <span className="pill violet" style={{ background: 'rgba(7,10,18,0.55)', backdropFilter: 'blur(4px)' }}>
                used {r.used}×
              </span>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', gap: 1.5, alignItems: 'flex-end', height: 18, opacity: 0.7 }}>
              {Array.from({ length: 20 }).map((_, i) => {
                const v = 0.3 + (Math.sin(i * 0.7 + r.hue) * 0.5 + 0.5) * 0.7;
                return <div key={i} style={{ width: 2, height: `${v * 100}%`, background: 'rgba(255,255,255,0.75)', borderRadius: 1 }} />;
              })}
            </div>
            {r.analyzed && (
              <span className="pill violet" style={{ background: 'rgba(7,10,18,0.55)', backdropFilter: 'blur(4px)' }}>
                {r.lufs.toFixed(1)} LUFS
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={{ padding: '12px 14px 8px' }}>
        <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{r.artist}</div>
      </div>

      <div style={{ padding: '4px 14px 10px' }}>
        {r.analyzed ? (
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-2)', display: 'flex', gap: 8 }}>
            <span>{r.genre}</span>
            <span style={{ color: 'var(--dim)' }}>·</span>
            <span>{r.bpm} BPM</span>
            <span style={{ color: 'var(--dim)' }}>·</span>
            <span>{r.key}</span>
          </div>
        ) : r.analyzing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <EQDots count={3} color="var(--violet)" height={10} />
            <span className="mono" style={{ fontSize: 10, color: 'var(--violet)' }}>analyzing baseline…</span>
          </div>
        ) : (
          <span className="mono" style={{ fontSize: 10, color: 'var(--orange)' }}>pending analysis</span>
        )}

        {r.tags && r.tags.length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
            {r.tags.map(t => (
              <span key={t} className="mono" style={{
                fontSize: 9, padding: '1px 6px', borderRadius: 4,
                background: 'rgba(255,255,255,0.025)',
                border: '1px solid var(--border)',
                color: 'var(--muted)',
              }}>#{t}</span>
            ))}
          </div>
        )}
      </div>

      {/* Footer with primary action */}
      <div style={{
        padding: '10px 14px',
        borderTop: '1px solid var(--border)',
        background: 'rgba(255,255,255,0.012)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        {r.analyzed ? (
          <button onClick={() => onCompare(r)} className="btn sm" style={{
            flex: 1, justifyContent: 'center',
            background: 'rgba(167,139,250,0.08)',
            borderColor: 'rgba(167,139,250,0.32)',
            color: 'var(--violet)',
            fontWeight: 700,
          }}>
            ⇄ Compare to my tracks
          </button>
        ) : r.analyzing ? (
          <button disabled className="btn sm" style={{ flex: 1, justifyContent: 'center', opacity: 0.5 }}>
            <EQDots count={3} color="var(--muted)" height={9} />
            <span style={{ marginLeft: 6 }}>Analyzing…</span>
          </button>
        ) : (
          <button className="btn primary sm" style={{ flex: 1, justifyContent: 'center' }}>
            Analyze baseline →
          </button>
        )}
        <button className="btn ghost sm" title="Edit" style={{ padding: '4px 8px' }}>⋯</button>
      </div>
    </div>
  );
}

// ── Source helpers ────────────────────────────────────────────────────────

function detectSource(url) {
  if (!url) return null;
  if (url.includes('youtube') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('spotify')) return 'spotify';
  if (url.includes('soundcloud')) return 'soundcloud';
  if (url.includes('apple') || url.includes('music.apple')) return 'apple';
  return 'file';
}

function SourceBadge({ source }) {
  const map = {
    youtube:    { color: '#ff5252', label: 'YT', title: 'YouTube' },
    spotify:    { color: '#1db954', label: 'SP', title: 'Spotify' },
    soundcloud: { color: '#ff7700', label: 'SC', title: 'SoundCloud' },
    apple:      { color: '#fa57c1', label: 'AM', title: 'Apple Music' },
    file:       { color: '#64748b', label: '▤',  title: 'File upload' },
  };
  const m = map[source] || map.file;
  return (
    <span title={m.title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 7px',
      borderRadius: 5,
      background: 'rgba(7,10,18,0.55)',
      backdropFilter: 'blur(4px)',
      border: `1px solid ${m.color}66`,
      color: m.color,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 9, fontWeight: 800,
      letterSpacing: '0.04em',
    }}>{m.label}</span>
  );
}

// ── Activity tab ──────────────────────────────────────────────────────────

function ProfileActivity({ profile }) {
  return (
    <div className="card card-body">
      <SectionTitle accent="var(--cyan)">Recent activity</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {profile.activity.map((a, i) => <ActivityRow act={a} key={i} />)}
      </div>
    </div>
  );
}

// ── Settings ──────────────────────────────────────────────────────────────

function ProfileSettings({ profile }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div className="card card-body">
          <SectionTitle accent="var(--cyan)">Profile</SectionTitle>
          <SettingRow label="Display name" value={profile.name} />
          <SettingRow label="Handle" value={profile.handle} />
          <SettingRow label="Email" value={profile.email} />
        </div>
        <div className="card card-body">
          <SectionTitle accent="var(--cyan)">Default analysis</SectionTitle>
          <SettingRow label="Default reference" value="Anjuna 2024 club masters" />
          <SettingRow label="Default streaming target" value="Spotify (-14 LUFS)" />
          <SettingRow label="Auto-run AI specialists" value="Off — run manually" />
        </div>
      </div>
      <div className="card card-body">
        <SectionTitle accent="var(--orange)">Danger zone</SectionTitle>
        <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 12 }}>
          Export all your data or delete your account. Account deletion has a 30-day restore window.
        </p>
        <button className="btn sm" style={{ marginBottom: 6 }}>⇣ Export all data</button>
        <button className="btn sm" style={{ color: 'var(--red)', borderColor: 'rgba(244,63,94,0.32)', background: 'rgba(244,63,94,0.06)' }}>Delete account</button>
      </div>
    </div>
  );
}

function SettingRow({ label, value }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '160px minmax(0, 1fr) auto',
      alignItems: 'center',
      gap: 14,
      padding: '12px 0',
      borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{
        fontSize: 13, color: 'var(--text)',
        textAlign: 'right',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{value}</span>
      <button className="btn ghost sm" style={{ color: 'var(--muted)', fontSize: 11, padding: '4px 10px' }}>Edit</button>
    </div>
  );
}

window.ProfilePage = ProfilePage;
window.BookmarksTab = BookmarksTab;
