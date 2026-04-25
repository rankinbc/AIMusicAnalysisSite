import { useState, useEffect } from 'react';
import { getGenreProfiles, getGenreProfile } from '../api/client';
import { Label, EQLoader } from './primitives';

// ── constants ──────────────────────────────────────────────────────────────

const GENRES = [
  { key: 'trance',      label: 'Trance' },
  { key: 'house',       label: 'House' },
  { key: 'techno',      label: 'Techno' },
  { key: 'dnb',         label: 'D&B' },
  { key: 'progressive', label: 'Progressive' },
];

// Features surfaced first; the rest collapse under "show more"
const PRIMARY = [
  'tempo', 'stereo_width', 'phase_correlation', 'pumping_score',
  'four_on_floor_score', 'spectral_brightness', 'trance_score', 'energy_progression',
];

const FEATURE_LABELS = {
  tempo:                      'Tempo',
  tempo_stability:            'Tempo Stability',
  tempo_score:                'Tempo Score',
  stereo_width:               'Stereo Width',
  phase_correlation:          'Phase Corr.',
  pumping_score:              'Pumping Score',
  pumping_modulation_depth_db:'Pumping Depth (dB)',
  pumping_regularity:         'Pumping Regularity',
  four_on_floor_score:        '4-on-Floor Score',
  four_on_floor_strength:     '4-on-Floor Strength',
  offbeat_hihat_score:        'Offbeat Hi-Hat',
  offbeat_hihat_strength:     'Hi-Hat Strength',
  spectral_brightness:        'Spectral Brightness',
  trance_score:               'Genre Score',
  energy_progression:         'Energy Progression',
  energy_range:               'Energy Range',
  energy_std:                 'Energy Std Dev',
  avg_energy:                 'Avg Energy',
  supersaw_score:             'Supersaw Score',
  acid_303_score:             'Acid/303 Score',
  acid_filter_sweep_score:    'Filter Sweep',
  acid_resonance_score:       'Resonance Score',
  acid_glide_score:           'Glide Score',
};

// ── helpers ────────────────────────────────────────────────────────────────

function fmt(v, feat) {
  if (feat === 'tempo' || feat === 'pumping_modulation_depth_db') return v.toFixed(1);
  return Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3);
}

function pct(v, min, max) {
  return Math.max(0, Math.min(100, ((v - min) / (max - min || 1)) * 100));
}

function buildDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ── RangeBar ───────────────────────────────────────────────────────────────

function RangeBar({ stats, delay = 0 }) {
  const { min, max, p10, p25, p50, p75, p90 } = stats;

  const p10x = pct(p10, min, max);
  const p25x = pct(p25, min, max);
  const p50x = pct(p50, min, max);
  const p75x = pct(p75, min, max);
  const p90x = pct(p90, min, max);

  return (
    <div style={{ position: 'relative', height: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 4, overflow: 'hidden' }}>
      {/* P10–P90 acceptable band */}
      <div
        className="fill-w"
        style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `${p10x}%`, width: `${p90x - p10x}%`,
          background: 'rgba(0,229,176,0.13)',
          animationDelay: `${delay}s`,
        }}
      />
      {/* IQR (P25–P75) with gradient */}
      <div
        className="fill-w"
        style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `${p25x}%`, width: `${p75x - p25x}%`,
          background: 'linear-gradient(90deg, rgba(0,229,176,0.28), rgba(0,229,176,0.5))',
          animationDelay: `${delay + 0.08}s`,
        }}
      />
      {/* Median tick */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0,
        left: `${p50x}%`, width: 2,
        background: 'var(--cyan)',
        boxShadow: '0 0 5px rgba(0,229,176,0.8)',
        transform: 'translateX(-1px)',
      }} />
    </div>
  );
}

// ── FeatureRow ─────────────────────────────────────────────────────────────

function FeatureRow({ name, stats, delay }) {
  const label = FEATURE_LABELS[name] ?? name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return (
    <div
      className="fade-up"
      style={{
        display: 'grid', gridTemplateColumns: '148px 1fr 110px',
        alignItems: 'center', gap: 16, padding: '10px 0',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        animationDelay: `${delay}s`,
      }}
    >
      <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </div>
      <RangeBar stats={stats} delay={delay} />
      <div className="mono" style={{ textAlign: 'right', fontSize: 11 }}>
        <span style={{ color: 'var(--cyan)' }}>{fmt(stats.mean, name)}</span>
        <span style={{ color: 'var(--muted)' }}> ±{fmt(stats.std, name)}</span>
      </div>
    </div>
  );
}

// ── PresetChip ─────────────────────────────────────────────────────────────

function PresetChip({ label, value }) {
  return (
    <div style={{
      flex: 1, minWidth: 120,
      background: 'rgba(167,139,250,0.06)',
      border: '1px solid rgba(167,139,250,0.18)',
      borderRadius: 8, padding: '10px 14px',
    }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'rgba(167,139,250,0.6)', textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </div>
      <div className="mono" style={{ fontSize: 15, fontWeight: 500, color: '#a78bfa' }}>
        {value}
      </div>
    </div>
  );
}

// ── ProfileDetail ──────────────────────────────────────────────────────────

function ProfileDetail({ detail }) {
  const [expanded, setExpanded] = useState(false);

  const primaryEntries  = PRIMARY.map(k => [k, detail.feature_statistics[k]]).filter(([, v]) => v);
  const secondaryEntries = Object.entries(detail.feature_statistics).filter(([k]) => !PRIMARY.includes(k));

  const date = buildDate(detail.created_date);
  const p = detail.preset;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* Meta row */}
      <div className="fade-up" style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
        {[
          ['Tracks', String(detail.track_count)],
          ['Features', String(Object.keys(detail.feature_statistics).length)],
          ['Profile', detail.profile_name],
          ['Built', date],
        ].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <span className="mono" style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--muted)', textTransform: 'uppercase' }}>{k}</span>
            <span className="mono" style={{ fontSize: 13, color: 'var(--text)' }}>{v}</span>
          </div>
        ))}
      </div>

      {/* Preset targets */}
      {p && (
        <div className="fade-up" style={{ animationDelay: '0.06s' }}>
          <Label>Preset targets</Label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <PresetChip label="Target LUFS" value={`${p.target_lufs} dBFS`} />
            <PresetChip label="BPM range"   value={`${p.bpm_min} – ${p.bpm_max}`} />
            <PresetChip label="Correlation" value={`${p.correlation_min} – ${p.correlation_max}`} />
            <PresetChip label="Bass mono"   value={`≤ ${p.bass_mono_below_hz} Hz`} />
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="fade-up" style={{ display: 'flex', alignItems: 'center', gap: 20, animationDelay: '0.1s' }}>
        <Label style={{ marginBottom: 0 }}>Feature distributions</Label>
        <div style={{ display: 'flex', gap: 16, marginLeft: 'auto' }}>
          {[
            { w: 20, opacity: 'rgba(0,229,176,0.13)', label: 'P10–P90' },
            { w: 14, opacity: 'rgba(0,229,176,0.5)',  label: 'IQR' },
          ].map(({ w, opacity, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: w, height: 6, borderRadius: 3, background: opacity }} />
              <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em' }}>{label}</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 2, height: 10, borderRadius: 1, background: 'var(--cyan)', boxShadow: '0 0 4px var(--cyan)' }} />
            <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em' }}>Median</span>
          </div>
          <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>mean ±std →</span>
        </div>
      </div>

      {/* Primary features */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '4px 20px' }}>
        {primaryEntries.map(([name, stats], i) => (
          <FeatureRow key={name} name={name} stats={stats} delay={0.12 + i * 0.05} />
        ))}
      </div>

      {/* Secondary (collapsed) */}
      {secondaryEntries.length > 0 && (
        <>
          <button
            onClick={() => setExpanded(v => !v)}
            className="mono"
            style={{
              alignSelf: 'flex-start', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 11, letterSpacing: '0.1em', color: 'var(--muted)',
              textTransform: 'uppercase', padding: 0,
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--muted)'}
          >
            {expanded ? '▲ Hide' : '▼ Show'} {secondaryEntries.length} additional features
          </button>

          {expanded && (
            <div className="slide-down" style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '4px 20px' }}>
              {secondaryEntries.map(([name, stats], i) => (
                <FeatureRow key={name} name={name} stats={stats} delay={i * 0.04} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── GenreProfilePage ───────────────────────────────────────────────────────

export default function GenreProfilePage({ onBack }) {
  const [summaries,    setSummaries]    = useState([]);
  const [activeGenre,  setActiveGenre]  = useState('trance');
  const [detail,       setDetail]       = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');

  // Load list of available genres
  useEffect(() => {
    getGenreProfiles().then(setSummaries).catch(() => {});
  }, []);

  // Load profile when genre tab changes
  useEffect(() => {
    const s = summaries.find(x => x.genre === activeGenre);
    if (!s?.has_profile) { setDetail(null); return; }

    setLoading(true);
    setError('');
    getGenreProfile(activeGenre)
      .then(setDetail)
      .catch(e => setError(e.message ?? 'Failed to load profile'))
      .finally(() => setLoading(false));
  }, [activeGenre, summaries]);

  const activeSummary = summaries.find(s => s.genre === activeGenre);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* Nav */}
      <nav style={{ padding: '20px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'rgba(7,10,18,0.94)', backdropFilter: 'blur(12px)', zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 22, letterSpacing: '0.22em', color: 'var(--cyan)' }}>SPECTR</div>
          <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
          <div className="mono" style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--muted)' }}>Genre Intelligence</div>
        </div>
        <button
          onClick={onBack}
          style={{ background: 'none', color: 'var(--muted)', fontSize: 12, padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', transition: 'color 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--muted)'}
        >
          ← Back
        </button>
      </nav>

      <div style={{ flex: 1, maxWidth: 920, width: '100%', margin: '0 auto', padding: '48px 32px' }}>

        {/* Page heading */}
        <div className="fade-up" style={{ marginBottom: 36 }}>
          <h1 style={{ fontWeight: 800, fontSize: 'clamp(26px, 4vw, 38px)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Genre Reference <span style={{ color: 'var(--cyan)' }}>Profiles</span>
          </h1>
          <p style={{ color: 'var(--muted)', marginTop: 10, fontSize: 14, maxWidth: 520, lineHeight: 1.6 }}>
            Statistical distributions from professionally mastered reference tracks.
            Phase 6 uses these to place your mix against genre norms.
          </p>
        </div>

        {/* Genre tabs */}
        <div className="fade-up" style={{ display: 'flex', gap: 6, marginBottom: 36, animationDelay: '0.07s', flexWrap: 'wrap' }}>
          {GENRES.map(({ key, label }) => {
            const active = key === activeGenre;
            const hasData = summaries.find(s => s.genre === key)?.has_profile ?? false;
            return (
              <button
                key={key}
                onClick={() => { setActiveGenre(key); setDetail(null); }}
                style={{
                  padding: '8px 20px', borderRadius: 999, fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', transition: 'all 0.18s',
                  background: active ? 'var(--cyan-dim)' : 'transparent',
                  border: `1px solid ${active ? 'var(--cyan)' : 'var(--border)'}`,
                  color: active ? 'var(--cyan)' : hasData ? 'var(--muted)' : 'rgba(100,116,139,0.45)',
                  boxShadow: active ? '0 0 12px rgba(0,229,176,0.15)' : 'none',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--text)'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.color = hasData ? 'var(--muted)' : 'rgba(100,116,139,0.45)'; }}
              >
                {label}
                {!hasData && summaries.length > 0 && (
                  <span className="mono" style={{ marginLeft: 5, fontSize: 9, opacity: 0.4 }}>—</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: 20 }}>
            <EQLoader count={12} height={36} color="rgba(0,229,176,0.4)" />
            <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              Loading profile…
            </div>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div style={{ background: 'var(--red-dim)', border: '1px solid rgba(244,63,94,0.25)', borderRadius: 10, padding: '16px 20px', color: 'var(--red)', fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* No profile available */}
        {!loading && !error && activeSummary && !activeSummary.has_profile && (
          <div className="fade-up" style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '52px 40px', textAlign: 'center' }}>
            <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'center', opacity: 0.3 }}>
              <EQLoader count={8} height={28} color="var(--muted)" />
            </div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>
              No profile for <span style={{ color: 'var(--cyan)' }}>{activeSummary.display_name}</span> yet
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6, maxWidth: 400, margin: '0 auto 20px' }}>
              Add reference tracks to{' '}
              <span className="mono" style={{ fontSize: 12, color: 'rgba(167,139,250,0.7)', background: 'rgba(167,139,250,0.08)', padding: '2px 6px', borderRadius: 4 }}>
                data/reference_library/{activeGenre}/
              </span>{' '}
              and run the reference profiler to generate one.
            </p>
          </div>
        )}

        {/* Profile detail */}
        {!loading && !error && detail && <ProfileDetail detail={detail} />}

      </div>
    </div>
  );
}
