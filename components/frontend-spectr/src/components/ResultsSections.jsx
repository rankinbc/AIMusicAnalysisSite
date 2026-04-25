import { useState } from 'react';
import { card, Label, sevColor, sevBg } from './primitives';

// ── Inline chart helpers (no external deps) ────────────────────────────────

function FreqMiniChart({ bands, genreMedianBands }) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 16, height: 3, background: 'var(--cyan)', borderRadius: 2, opacity: 0.8 }} />
          <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>your track</span>
        </div>
        {genreMedianBands && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 16, height: 3, background: 'rgba(255,255,255,0.18)', borderRadius: 2 }} />
            <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>genre median</span>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 5, alignItems: 'flex-end', height: 80 }}>
        {bands.map((b, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
            <div style={{ width: '100%', height: 66, display: 'flex', alignItems: 'flex-end', position: 'relative' }}>
              {genreMedianBands?.[i] != null && (
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  height: `${Math.max(3, genreMedianBands[i] * 100)}%`,
                  background: 'rgba(255,255,255,0.11)', borderRadius: '3px 3px 0 0',
                }} />
              )}
              <div className="fill-h" style={{
                width: '100%', height: `${Math.max(3, b.v * 100)}%`,
                borderRadius: '3px 3px 0 0', position: 'relative',
                background: b.warn
                  ? 'linear-gradient(to top, var(--orange), rgba(251,146,60,0.22))'
                  : 'linear-gradient(to top, var(--cyan), rgba(0,229,176,0.18))',
                boxShadow: b.warn ? '0 0 5px rgba(251,146,60,0.3)' : 'none',
                animationDelay: `${i * 0.05}s`,
              }} />
            </div>
            <div className="mono" style={{ fontSize: 9, color: b.warn ? 'var(--orange)' : 'var(--muted)', marginTop: 3 }}>{b.n}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LufsMiniChart({ lufs, genreMedianLufs, streaming }) {
  const min = -20, max = 0;
  const toPct = v => `${Math.max(2, Math.min(97, ((v - min) / (max - min)) * 100))}%`;
  const lufsColor = lufs <= -14 ? 'var(--green)' : lufs <= -9 ? 'var(--yellow)' : 'var(--red)';
  const targets = [-9, -14, -16];

  return (
    <div>
      <div style={{ position: 'relative', height: 24, background: 'var(--dim)', borderRadius: 4, marginBottom: 14, overflow: 'visible' }}>
        {targets.map(t => (
          <div key={t} style={{ position: 'absolute', top: -5, bottom: -5, left: toPct(t), width: 1, background: 'rgba(255,255,255,0.13)', zIndex: 2 }}>
            <div className="mono" style={{ position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)', fontSize: 8, color: 'var(--dim)', whiteSpace: 'nowrap' }}>{t}</div>
          </div>
        ))}
        {genreMedianLufs != null && (
          <div style={{ position: 'absolute', top: -3, bottom: -3, left: toPct(genreMedianLufs), width: 2, background: 'rgba(167,139,250,0.6)', borderRadius: 1, zIndex: 3 }} />
        )}
        <div className="fill-w" style={{
          position: 'absolute', left: 0, height: '100%', borderRadius: 4,
          width: toPct(lufs),
          background: lufsColor, boxShadow: `0 0 8px ${lufsColor}44`, zIndex: 1,
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
          Your LUFS: <span style={{ color: lufsColor }}>{lufs.toFixed(1)}</span>
        </div>
        {genreMedianLufs != null && (
          <div className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
            Genre median: <span style={{ color: 'var(--violet)' }}>{genreMedianLufs.toFixed(1)}</span>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {streaming.map(row => {
          const pass = row.yours <= row.target + 1;
          const c = pass ? 'var(--green)' : 'var(--red)';
          return (
            <div key={row.p} className="mono" style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, color: c, background: `${c}18`, border: `1px solid ${c}44` }}>
              {pass ? '✓' : '✗'} {row.p}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StemsMiniChart({ clashes }) {
  if (!clashes?.length) {
    return <div className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>No stem clashes detected.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {clashes.slice(0, 3).map((c, i) => {
        const col = c.sev === 'severe' ? 'var(--red)' : 'var(--orange)';
        return (
          <div key={i} style={{ padding: '10px 12px', borderRadius: 6, background: `${col}0d`, border: `1px solid ${col}30`, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div className="mono" style={{ fontSize: 10, color: col, background: `${col}18`, border: `1px solid ${col}44`, padding: '1px 6px', borderRadius: 999, flexShrink: 0, marginTop: 1 }}>
              {c.sev.toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{c.a} × {c.b}</div>
              <div className="mono" style={{ fontSize: 10, color: col, marginTop: 2 }}>{c.range}</div>
              {c.fix && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{c.fix}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── FixCard ────────────────────────────────────────────────────────────────

export function FixCard({ fix, i, chartData }) {
  const [open, setOpen]         = useState(false);
  const [showCoach, setShowCoach] = useState(false);

  const rankColor = i === 0 ? 'var(--orange)' : i === 1 ? 'rgba(251,146,60,0.5)' : 'rgba(100,116,139,0.45)';
  const borderColor = sevColor(fix.sev);
  const hasChart = fix.chartType && fix.chartType !== 'none';
  const hasCoach = Boolean(fix.coachFix && fix.coachFix !== fix.body);

  return (
    <div className="fade-up" style={{
      background: 'var(--card)', borderRadius: 10,
      border: '1px solid var(--border)', borderLeft: `3px solid ${borderColor}`,
      marginBottom: 10, overflow: 'hidden',
      animationDelay: `${i * 0.07}s`,
    }}>
      <div style={{ padding: '16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          {/* Rank */}
          <div className="mono" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, color: rankColor, flexShrink: 0, marginTop: 1 }}>
            {String(i + 1).padStart(2, '0')}
          </div>
          {/* Content */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.4 }}>{fix.title}</div>
            {fix.metricLine && (
              <div className="mono" style={{ fontSize: 11, color: 'var(--cyan)', marginTop: 5 }}>{fix.metricLine}</div>
            )}
          </div>
          {/* Badge */}
          {fix.badge && (
            <div className="mono" style={{
              fontSize: 10, flexShrink: 0,
              color: borderColor, background: sevBg(fix.sev),
              border: `1px solid ${borderColor}44`,
              padding: '2px 8px', borderRadius: 999,
            }}>
              {fix.badge}
            </div>
          )}
        </div>

        {/* Toggles */}
        {(hasCoach || hasChart) && (
          <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
            {hasCoach && (
              <button onClick={() => setShowCoach(v => !v)} style={{ fontSize: 11, color: 'var(--muted)', background: 'none', padding: 0, border: 'none', cursor: 'pointer' }}>
                {showCoach ? '↑ hide coach' : '↓ coach says…'}
              </button>
            )}
            {hasChart && (
              <button onClick={() => setOpen(v => !v)} style={{ fontSize: 11, color: 'var(--muted)', background: 'none', padding: 0, border: 'none', cursor: 'pointer' }}>
                {open ? 'hide chart ↑' : 'show why ↓'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Coach panel */}
      {showCoach && (
        <div className="slide-down" style={{ borderTop: '1px solid var(--border)', padding: '12px 18px', background: 'rgba(0,229,176,0.04)' }}>
          <div style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--muted)', lineHeight: 1.65, borderLeft: '2px solid rgba(0,229,176,0.3)', paddingLeft: 10 }}>
            "{fix.coachFix}"
          </div>
        </div>
      )}

      {/* Chart panel */}
      {open && hasChart && chartData && (
        <div className="slide-down" style={{ borderTop: '1px solid var(--border)', padding: '16px 18px', background: 'rgba(255,255,255,0.02)' }}>
          {fix.chartType === 'frequency' && (
            <FreqMiniChart bands={chartData.frequency.bands} genreMedianBands={chartData.frequency.genreMedianBands} />
          )}
          {fix.chartType === 'lufs' && (
            <LufsMiniChart lufs={chartData.loudness.integrated} genreMedianLufs={chartData.genreMedianLufs} streaming={chartData.streaming} />
          )}
          {fix.chartType === 'stems' && (
            <StemsMiniChart clashes={chartData.clashes} />
          )}
        </div>
      )}
    </div>
  );
}

// ── StreamingTable ────────────────────────────────────────────────────────

export function StreamingTable({ data }) {
  return (
    <div style={card({ marginBottom: 16, padding: 0, overflow: 'hidden' })}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Label style={{ marginBottom: 0 }}>Streaming Readiness</Label>
        <div className="mono" style={{ fontSize: 10, color: data.streamingPassCount >= 3 ? 'var(--green)' : 'var(--orange)' }}>
          {data.streamingPassCount}/{data.streaming.length} pass
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {data.streaming.map((row, i) => {
          const bad = row.yours > row.target + 1;
          const col = bad ? 'var(--red)' : 'var(--green)';
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', borderBottom: i < data.streaming.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ width: 90, fontWeight: 600, fontSize: 13 }}>{row.p}</div>
              <div className="mono" style={{ width: 60, fontSize: 11, color: 'var(--muted)' }}>{row.target} LUFS</div>
              <div style={{ flex: 1, height: 5, background: 'var(--dim)', borderRadius: 3, overflow: 'hidden' }}>
                <div className="fill-w" style={{
                  height: '100%', borderRadius: 3,
                  width: `${Math.min(100, Math.abs(row.yours) / 20 * 100)}%`,
                  background: col, boxShadow: `0 0 5px ${col}55`,
                }} />
              </div>
              <div className="mono" style={{ width: 42, fontSize: 12, color: col, fontWeight: 500 }}>{row.yours}</div>
              <div className="mono" style={{ fontSize: 10, width: 50, textAlign: 'right', color: col }}>{bad ? 'FAIL' : 'PASS'}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── FrequencyBars (with genre median ghost) ────────────────────────────────

export function FrequencyBars({ data }) {
  return (
    <div style={card({ marginBottom: 16 })}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 4 }}>
        <Label style={{ marginBottom: 0 }}>Frequency Balance</Label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 14, height: 3, background: 'rgba(255,255,255,0.15)', borderRadius: 2 }} />
            <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>{data.genre?.name} median</span>
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
            Clarity <span style={{ color: 'var(--text)' }}>{data.frequency.clarity}/100</span>
          </div>
          <div className="mono" style={{ fontSize: 11, padding: '2px 10px', borderRadius: 999, background: 'var(--violet-dim)', color: 'var(--violet)', border: '1px solid var(--violet)' }}>
            {data.frequency.label}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 5, alignItems: 'flex-end', height: 90, marginTop: 12 }}>
        {data.frequency.bands.map((b, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
            <div className="mono" style={{ fontSize: 9, color: b.warn ? 'var(--orange)' : 'var(--muted)', marginBottom: 2 }}>
              {Math.round(b.v * 100)}
            </div>
            <div style={{ width: '100%', display: 'flex', justifyContent: 'center', position: 'relative', height: 56 }}>
              {data.frequency.genreMedianBands?.[i] != null && (
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  height: `${Math.max(3, data.frequency.genreMedianBands[i] * 100)}%`,
                  background: 'rgba(255,255,255,0.09)',
                  borderRadius: '3px 3px 0 0',
                }} />
              )}
              <div className="fill-h" style={{
                width: '100%', borderRadius: '3px 3px 0 0',
                height: `${b.v * 100}%`, position: 'absolute', bottom: 0,
                background: b.warn
                  ? 'linear-gradient(to top, var(--orange), rgba(251,146,60,0.25))'
                  : 'linear-gradient(to top, var(--cyan), rgba(0,229,176,0.2))',
                boxShadow: b.warn ? '0 0 6px rgba(251,146,60,0.4)' : '0 0 4px rgba(0,229,176,0.3)',
                animationDelay: `${i * 0.06}s`,
              }} />
              {b.warn && <div style={{ position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%)', fontSize: 8, color: 'var(--orange)' }}>▲</div>}
            </div>
            <div className="mono" style={{ fontSize: 9, color: b.warn ? 'var(--orange)' : 'var(--muted)', textAlign: 'center' }}>{b.n}</div>
            <div className="mono" style={{ fontSize: 8, color: 'var(--dim)', textAlign: 'center' }}>{b.hz}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── StereoCard (tri-readout) ───────────────────────────────────────────────

export function StereoCard({ data }) {
  const corrLabel = data.stereo.correlation >= 0.8 ? 'Tight' : data.stereo.correlation >= 0.5 ? 'Healthy' : 'Loose';
  const widthLabel = data.stereo.width >= 70 ? 'Wide' : data.stereo.width >= 40 ? 'Moderate' : 'Narrow';
  const monoRaw = data.stereo.monoCompat ?? (data.stereo.monoSafe ? 0.8 : 0.4);
  const monoLabel = monoRaw >= 0.8 ? 'Excellent' : monoRaw >= 0.6 ? 'Good' : 'Check phase';

  const metrics = [
    { label: 'Correlation', sub: 'L/R phase', display: data.stereo.correlation.toFixed(2), pct: Math.max(0, Math.min(100, data.stereo.correlation * 100)), note: corrLabel, ok: data.stereo.correlation >= 0.5 },
    { label: 'Stereo Width', sub: 'signal spread', display: `${data.stereo.width}%`, pct: data.stereo.width, note: widthLabel, ok: data.stereo.width >= 20 && data.stereo.width <= 92 },
    { label: 'Mono Compat', sub: 'fold survival', display: `${Math.round(monoRaw * 100)}%`, pct: monoRaw * 100, note: monoLabel, ok: monoRaw >= 0.6 },
  ];

  return (
    <div style={card({ marginBottom: 0 })}>
      <Label>Stereo Health</Label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {metrics.map((m, i) => {
          const col = m.ok ? 'var(--cyan)' : 'var(--red)';
          return (
            <div key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{m.label}</span>
                  <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>{m.sub}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 500, color: col }}>{m.display}</span>
                  <span className="mono" style={{ fontSize: 9, color: `${col}88`, marginLeft: 6 }}>{m.note}</span>
                </div>
              </div>
              <div style={{ height: 4, background: 'var(--dim)', borderRadius: 3, overflow: 'hidden' }}>
                <div className="fill-w" style={{
                  height: '100%', borderRadius: 3,
                  width: `${m.pct}%`,
                  background: col, boxShadow: `0 0 5px ${col}44`,
                  animationDelay: `${i * 0.1 + 0.15}s`,
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── TrackNumbers — general track stats grid ────────────────────────────────

export function TrackNumbers({ data }) {
  const lufs    = data.loudness.integrated;
  const lufsColor = lufs <= -14 ? 'var(--cyan)' : lufs <= -9 ? 'var(--yellow)' : 'var(--red)';
  const genMed  = data.genreMedianLufs;

  const tp      = data.loudness.truePeak ?? -1.0;
  const tpColor = tp <= -1.0 ? 'var(--cyan)' : tp <= -0.5 ? 'var(--yellow)' : 'var(--red)';

  const dr      = data.loudness.dynamicRange ?? 6;
  const drColor = dr >= 8 ? 'var(--cyan)' : dr >= 4 ? 'var(--yellow)' : 'var(--orange)';

  const rms     = data.loudness.rms ?? -14;

  const dance     = data.danceScore;
  const danceColor = dance == null ? 'var(--muted)' : dance >= 75 ? 'var(--cyan)' : dance >= 50 ? 'var(--yellow)' : 'var(--orange)';

  const sw      = data.stereo?.width ?? 0;
  const swColor = sw >= 40 ? 'var(--cyan)' : sw >= 20 ? 'var(--yellow)' : 'var(--orange)';
  const mc      = Math.round((data.stereo?.monoCompat ?? 0.5) * 100);
  const mcColor = mc >= 70 ? 'var(--cyan)' : mc >= 50 ? 'var(--yellow)' : 'var(--orange)';

  const pct     = data.percentile != null ? Math.round(data.percentile) : null;

  const stats = [
    {
      label: 'LUFS',
      value: `${lufs.toFixed(1)}`,
      sub: genMed != null ? `genre med ${genMed.toFixed(1)}` : 'integrated',
      color: lufsColor,
    },
    {
      label: 'Danceability',
      value: dance != null ? dance : '—',
      sub: dance >= 75 ? 'high energy' : dance >= 50 ? 'moderate' : 'low energy',
      color: danceColor,
    },
    {
      label: 'True Peak',
      value: `${tp.toFixed(1)} dBTP`,
      sub: tp >= -0.5 ? 'clipping risk' : 'safe',
      color: tpColor,
    },
    {
      label: 'Dyn Range',
      value: `${dr.toFixed(1)} LU`,
      sub: dr >= 8 ? 'good' : dr >= 4 ? 'compressed' : 'heavy limiting',
      color: drColor,
    },
    {
      label: 'RMS',
      value: `${rms.toFixed(1)} dB`,
      sub: 'average level',
      color: 'var(--muted)',
    },
    {
      label: 'Stereo Width',
      value: `${sw}%`,
      sub: sw >= 40 ? 'wide' : 'narrow',
      color: swColor,
    },
    {
      label: 'Mono Compat',
      value: `${mc}%`,
      sub: mc >= 70 ? 'safe' : 'check mono',
      color: mcColor,
    },
    {
      label: 'Percentile',
      value: pct != null ? `${pct}th` : '—',
      sub: data.genre?.name ?? 'genre',
      color: 'var(--violet)',
    },
  ];

  return (
    <div style={card({ marginBottom: 0 })}>
      <Label style={{ marginBottom: 14 }}>Track Numbers</Label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {stats.map((s, i) => (
          <div key={i} style={{
            padding: '10px 12px',
            background: 'rgba(255,255,255,0.022)',
            borderRadius: 8,
            border: '1px solid var(--border)',
          }}>
            <div className="mono" style={{ fontSize: 8, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 5 }}>
              {s.label}
            </div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: s.color, lineHeight: 1.1 }}>
              {s.value}
            </div>
            {s.sub && (
              <div className="mono" style={{ fontSize: 8, color: 'rgba(100,116,139,0.45)', marginTop: 4 }}>
                {s.sub}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── StemClashes ────────────────────────────────────────────────────────────

export function StemClashes({ data }) {
  if (!data.clashes || data.clashes.length === 0) {
    return (
      <div style={card({ marginBottom: 16 })}>
        <Label>Stem Frequency Clashes</Label>
        <div className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>No significant stem clashes detected.</div>
      </div>
    );
  }
  return (
    <div style={card({ marginBottom: 16 })}>
      <Label>Stem Frequency Clashes</Label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {data.clashes.map((c, i) => (
          <div key={i} style={{
            padding: 16, borderRadius: 8,
            background: c.sev === 'severe' ? 'var(--red-dim)' : 'var(--orange-dim)',
            border: `1px solid ${c.sev === 'severe' ? 'rgba(244,63,94,0.2)' : 'rgba(251,146,60,0.2)'}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 14, padding: '3px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.06)' }}>{c.a}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>×</span>
              <span style={{ fontWeight: 700, fontSize: 14, padding: '3px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.06)' }}>{c.b}</span>
              <span className="mono" style={{ fontSize: 11, color: c.sev === 'severe' ? 'var(--red)' : 'var(--orange)', marginLeft: 'auto' }}>{c.range}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', width: 60 }}>overlap</div>
              <div style={{ flex: 1, height: 5, background: 'var(--dim)', borderRadius: 3, overflow: 'hidden' }}>
                <div className="fill-w" style={{
                  height: '100%', borderRadius: 3, width: `${c.pct}%`,
                  background: c.sev === 'severe' ? 'var(--red)' : 'var(--orange)',
                  animationDelay: `${i * 0.1 + 0.3}s`,
                }} />
              </div>
              <div className="mono" style={{ fontSize: 12, color: c.sev === 'severe' ? 'var(--red)' : 'var(--orange)', width: 36, textAlign: 'right' }}>{c.pct}%</div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              <span style={{ color: 'var(--cyan)', marginRight: 6 }}>Fix:</span>{c.fix}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ArrangementSection ─────────────────────────────────────────────────────

const SECTION_COLORS = {
  intro: '#1e293b', buildup: 'rgba(34,211,238,0.45)', drop: 'rgba(249,115,22,0.65)',
  breakdown: 'rgba(167,139,250,0.55)', outro: '#1e293b',
};

export function ArrangementSection({ data }) {
  const hasSections = data.arrangement.sections?.length > 0;
  const total = hasSections ? data.arrangement.sections.reduce((s, x) => s + x.bars, 0) : 0;

  return (
    <div style={card({ marginBottom: 16 })}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Label style={{ marginBottom: 0 }}>Arrangement</Label>
        <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
          Score <span style={{ color: data.arrangement.score >= 70 ? 'var(--cyan)' : 'var(--orange)' }}>{data.arrangement.score}</span>/100
        </div>
      </div>
      {hasSections && (
        <>
          <div style={{ display: 'flex', gap: 3, height: 52, marginBottom: 16 }}>
            {data.arrangement.sections.map((sec, i) => (
              <div key={i} style={{
                width: `${(sec.bars / total) * 100}%`,
                background: SECTION_COLORS[sec.t] || '#1e293b',
                borderRadius: 5, display: 'flex', alignItems: 'flex-end', padding: '4px 5px',
                border: sec.flag ? '1px solid rgba(251,146,60,0.5)' : '1px solid transparent',
                overflow: 'hidden', position: 'relative',
              }}>
                <div className="mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap', overflow: 'hidden' }}>{sec.l}</div>
                {sec.flag && <div style={{ position: 'absolute', top: 4, right: 4, width: 5, height: 5, borderRadius: '50%', background: 'var(--orange)' }} />}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
            {Object.entries(SECTION_COLORS).map(([k, c]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: c, border: '1px solid rgba(255,255,255,0.1)' }} />
                <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'capitalize' }}>{k}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.arrangement.issues.length > 0
          ? data.arrangement.issues.map((iss, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, fontSize: 13 }}>
                <span style={{ color: 'var(--orange)', flexShrink: 0 }}>▲</span>
                <span style={{ color: 'var(--muted)' }}>{iss}</span>
              </div>
            ))
          : <div className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>No arrangement issues detected.</div>
        }
      </div>
    </div>
  );
}

// ── GapAnalysis ────────────────────────────────────────────────────────────

function RangeBar({ g, animDelay }) {
  if (g.userVal == null || g.acceptableRange == null) {
    // Fallback: simple percentile bar
    const col = g.sev === 'critical' ? 'var(--red)' : g.sev === 'warning' ? 'var(--orange)' : 'var(--cyan)';
    return (
      <div style={{ flex: 1, height: 6, background: 'var(--dim)', borderRadius: 3, overflow: 'hidden' }}>
        <div className="fill-w" style={{ height: '100%', borderRadius: 3, width: `${g.pct}%`, background: col, animationDelay: animDelay }} />
      </div>
    );
  }

  const span = (g.acceptableRange[1] - g.acceptableRange[0]) * 1.8;
  const barMin = g.acceptableRange[0] - span * 0.4;
  const barMax = g.acceptableRange[1] + span * 0.4;
  const barSpan = barMax - barMin || 1;
  const toPct = v => `${Math.max(0, Math.min(100, ((v - barMin) / barSpan) * 100)).toFixed(1)}%`;

  const zoneLeft  = toPct(g.acceptableRange[0]);
  const zoneWidth = `${Math.max(0, Math.min(100, ((g.acceptableRange[1] - g.acceptableRange[0]) / barSpan) * 100)).toFixed(1)}%`;
  const dotLeft   = toPct(g.userVal);
  const dotColor  = g.inRange ? 'var(--cyan)' : g.sev === 'critical' ? 'var(--red)' : 'var(--orange)';

  return (
    <div style={{ flex: 1, position: 'relative', height: 16, display: 'flex', alignItems: 'center' }}>
      {/* Track */}
      <div style={{ position: 'absolute', left: 0, right: 0, height: 5, background: 'var(--dim)', borderRadius: 3 }} />
      {/* Acceptable zone */}
      <div style={{ position: 'absolute', left: zoneLeft, width: zoneWidth, height: 5, background: 'rgba(0,229,176,0.2)', border: '1px solid rgba(0,229,176,0.35)', borderRadius: 3 }} />
      {/* Mean tick */}
      <div style={{ position: 'absolute', left: toPct(g.mean), width: 2, height: 10, background: 'rgba(255,255,255,0.25)', borderRadius: 1, transform: 'translateX(-50%)' }} />
      {/* User dot */}
      <div style={{ position: 'absolute', left: dotLeft, width: 10, height: 10, borderRadius: '50%', background: dotColor, boxShadow: `0 0 6px ${dotColor}`, transform: 'translateX(-50%)', zIndex: 2 }} />
    </div>
  );
}

function fmtVal(val, unit) {
  if (val == null) return '—';
  const n = unit === ' BPM' ? val.toFixed(1) : Math.abs(val) < 10 ? val.toFixed(3) : val.toFixed(1);
  return n + unit;
}

function fmtDelta(delta, unit) {
  if (delta == null) return null;
  const sign = delta >= 0 ? '+' : '';
  const n = Math.abs(delta) < 10 ? delta.toFixed(2) : delta.toFixed(1);
  return sign + n + unit;
}

export function GapAnalysis({ data }) {
  const overall = Math.round(data.percentile ?? 50);
  const overallCol = overall >= 70 ? 'var(--cyan)' : overall >= 40 ? 'var(--yellow)' : 'var(--orange)';
  const overallLabel = overall >= 70 ? 'top 30%' : overall >= 50 ? 'mid range' : overall >= 30 ? 'bottom half' : 'bottom 30%';

  return (
    <div style={card({ marginBottom: 16 })}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
        <Label style={{ marginBottom: 0 }}>Genre Profile Ranking</Label>
        <div style={{ textAlign: 'right' }}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>vs professional {data.genre?.name || 'genre'} releases</div>
          {data.profileSource && (
            <div className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 2 }}>{data.profileSource}</div>
          )}
        </div>
      </div>

      {/* Overall percentile hero */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 20, padding: '14px 16px', borderRadius: 10, background: `${overallCol}0d`, border: `1px solid ${overallCol}33` }}>
        <span className="mono" style={{ fontSize: 44, fontWeight: 700, lineHeight: 1, color: overallCol }}>{overall}</span>
        <div>
          <div className="mono" style={{ fontSize: 12, color: overallCol }}>th percentile overall</div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{overallLabel} among professional {data.genre?.name || 'genre'} releases</div>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 20, height: 5, background: 'rgba(0,229,176,0.2)', border: '1px solid rgba(0,229,176,0.35)', borderRadius: 2 }} />
          <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>acceptable range (P10–P90)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 2, height: 10, background: 'rgba(255,255,255,0.25)', borderRadius: 1 }} />
          <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>genre mean</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--cyan)' }} />
          <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>your track</span>
        </div>
      </div>

      {/* Per-metric rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {data.gap.map((g, i) => {
          const col = g.inRange ? 'var(--cyan)' : g.sev === 'critical' ? 'var(--red)' : 'var(--orange)';
          const deltaStr = fmtDelta(g.delta, g.unit);
          return (
            <div key={i}>
              {/* Row header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: g.inRange ? 'var(--text)' : 'var(--text)', minWidth: 130 }}>{g.n}</span>
                <span className="mono" style={{ fontSize: 9, padding: '1px 7px', borderRadius: 999, color: col, background: `${col}18`, border: `1px solid ${col}44` }}>
                  {g.inRange ? 'IN RANGE' : g.sev.toUpperCase()}
                </span>
                {g.pct != null && (
                  <span className="mono" style={{ fontSize: 9, color: 'var(--muted)', marginLeft: 'auto' }}>{g.pct}th pct</span>
                )}
              </div>
              {/* Range bar */}
              <RangeBar g={g} animDelay={`${i * 0.05 + 0.3}s`} />
              {/* Values row */}
              <div style={{ display: 'flex', gap: 20, marginTop: 6, flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 10 }}>
                  <span style={{ color: 'var(--muted)' }}>yours  </span>
                  <span style={{ color: col, fontWeight: 600 }}>{fmtVal(g.userVal, g.unit)}</span>
                </span>
                {g.mean != null && (
                  <span className="mono" style={{ fontSize: 10 }}>
                    <span style={{ color: 'var(--muted)' }}>genre mean  </span>
                    <span style={{ color: 'var(--text)' }}>{fmtVal(g.mean, g.unit)}</span>
                    {g.std != null && <span style={{ color: 'var(--dim)' }}> ±{Math.abs(g.std) < 10 ? g.std.toFixed(2) : g.std.toFixed(1)}{g.unit}</span>}
                  </span>
                )}
                {g.acceptableRange && (
                  <span className="mono" style={{ fontSize: 10 }}>
                    <span style={{ color: 'var(--muted)' }}>range  </span>
                    <span style={{ color: 'var(--text)' }}>{fmtVal(g.acceptableRange[0], g.unit)} – {fmtVal(g.acceptableRange[1], g.unit)}</span>
                  </span>
                )}
                {deltaStr && (
                  <span className="mono" style={{ fontSize: 10, marginLeft: 'auto' }}>
                    <span style={{ color: 'var(--muted)' }}>Δ  </span>
                    <span style={{ color: col }}>{deltaStr}</span>
                  </span>
                )}
              </div>
              {g.description && (
                <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, fontStyle: 'italic' }}>{g.description}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
