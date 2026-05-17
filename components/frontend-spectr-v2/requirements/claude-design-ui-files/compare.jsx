/* SPECTR — Compare to Reference
 *
 * Side-by-side view: a user's track (left) vs a saved reference (right).
 * Shows metric deltas, frequency overlay, and suggested adjustments to
 * close the gap. Entry points: ReferenceCard "Compare" action, or
 * (future) AI Coach loudness finding "Compare to reference".
 */

const { useState: useStateCmp } = React;

function ComparePage({ track, reference, onBack, onPickTrack, onPickReference }) {
  return (
    <div style={{ maxWidth: 1360, margin: '0 auto', padding: '20px 24px 80px' }}>
      <button onClick={onBack} className="btn ghost sm" style={{ marginBottom: 14 }}>← Back</button>

      <CompareHeader track={track} reference={reference} onPickTrack={onPickTrack} onPickReference={onPickReference} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
        <TrackCard side="yours" track={track} />
        <ReferenceSide reference={reference} />
      </div>

      <CompareWaveforms track={track} reference={reference} />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: 20, marginTop: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <MetricsDeltaCard track={track} reference={reference} />
          <FrequencyOverlayCard track={track} reference={reference} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <FitScoreCard track={track} reference={reference} />
          <SuggestionsCard track={track} reference={reference} />
        </div>
      </div>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────

function CompareHeader({ track, reference }) {
  return (
    <div className="card" style={{
      marginBottom: 16, overflow: 'hidden',
      background: 'linear-gradient(135deg, rgba(0,229,176,0.06), rgba(167,139,250,0.06))',
    }}>
      <div style={{ padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 11,
          background: 'rgba(167,139,250,0.14)',
          border: '1px solid rgba(167,139,250,0.4)',
          color: 'var(--violet)',
          display: 'grid', placeItems: 'center',
          fontSize: 22,
        }}>⇄</div>
        <div style={{ flex: 1 }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--muted)', textTransform: 'uppercase' }}>COMPARE TO REFERENCE</div>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em', marginTop: 4 }}>
            Closing the gap to <span style={{ color: 'var(--violet)' }}>{reference.title}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
            Your <span style={{ color: 'var(--cyan)' }}>{track.name}</span> vs <span style={{ color: 'var(--violet)' }}>{reference.artist}</span> — see exactly where they differ and what to adjust.
          </div>
        </div>
        <button className="btn sm">⇣ Export delta as PDF</button>
        <button className="btn primary sm">★ Save as match target</button>
      </div>
    </div>
  );
}

// ── Side-by-side track headers ────────────────────────────────────────────

function TrackCard({ side, track }) {
  const accent = side === 'yours' ? 'var(--cyan)' : 'var(--violet)';
  return (
    <div className="card" style={{ padding: 16, borderTop: `2px solid ${accent}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <CoverArt hue={168} size="md" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mono" style={{ fontSize: 9, letterSpacing: '0.18em', color: accent, textTransform: 'uppercase' }}>
            YOUR TRACK
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.name}</div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{track.genre.name} · {track.bpm} BPM · {track.key}</div>
        </div>
        <button className="btn ghost sm" style={{ color: 'var(--muted)' }}>↓ swap</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 14 }}>
        <MicroMetric label="LUFS"  value={track.loudness.integrated.toFixed(1)} accent={accent} />
        <MicroMetric label="Peak"  value={track.loudness.truePeak.toFixed(1)}  accent={accent} unit="dBTP" />
        <MicroMetric label="DR"    value={track.loudness.dynamicRange.toFixed(1)} accent={accent} unit="LU" />
        <MicroMetric label="Width" value={`${track.stereo.width}%`} accent={accent} />
      </div>
    </div>
  );
}

function ReferenceSide({ reference }) {
  return (
    <div className="card" style={{ padding: 16, borderTop: '2px solid var(--violet)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <CoverArt hue={reference.hue} size="md" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="mono" style={{ fontSize: 9, letterSpacing: '0.18em', color: 'var(--violet)', textTransform: 'uppercase' }}>
              REFERENCE
            </span>
            <SourceBadge source={reference.source} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{reference.title}</div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{reference.artist} · {reference.bpm} BPM · {reference.key}</div>
        </div>
        <button className="btn ghost sm" style={{ color: 'var(--muted)' }}>↓ swap</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 14 }}>
        <MicroMetric label="LUFS"  value={reference.lufs.toFixed(1)} accent="var(--violet)" />
        <MicroMetric label="Peak"  value={reference.truePeak.toFixed(1)} accent="var(--violet)" unit="dBTP" />
        <MicroMetric label="DR"    value={reference.dynamicRange.toFixed(1)} accent="var(--violet)" unit="LU" />
        <MicroMetric label="Width" value={`${reference.width}%`} accent="var(--violet)" />
      </div>
    </div>
  );
}

function MicroMetric({ label, value, unit, accent }) {
  return (
    <div>
      <div className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ display: 'baseline', marginTop: 3 }}>
        <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: accent }}>{value}</span>
        {unit && <span className="mono" style={{ fontSize: 9, color: 'var(--muted)', marginLeft: 3 }}>{unit}</span>}
      </div>
    </div>
  );
}

// ── Synced waveforms ──────────────────────────────────────────────────────

function CompareWaveforms({ track, reference }) {
  const [playing, setPlaying] = useStateCmp(false);
  return (
    <div className="card card-body">
      <SectionTitle accent="var(--violet)" right={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => setPlaying(p => !p)} style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'var(--cyan)', color: '#06151a',
            display: 'grid', placeItems: 'center',
            fontSize: 11, fontWeight: 700,
            boxShadow: playing ? '0 0 14px rgba(0,229,176,0.5)' : 'none',
          }}>{playing ? '⏸' : '▶'}</button>
          <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>synced playback</span>
        </div>
      }>
        Side-by-side waveforms
      </SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <WaveformRow label="YOURS"     accent="var(--cyan)"   hue={168} amp={1.0} />
        <WaveformRow label="REFERENCE" accent="var(--violet)" hue={reference.hue} amp={0.92} />
      </div>
    </div>
  );
}

function WaveformRow({ label, accent, hue, amp }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span className="mono" style={{ fontSize: 9, letterSpacing: '0.18em', color: accent, fontWeight: 700, width: 70 }}>{label}</span>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1, height: 42 }}>
        {Array.from({ length: 220 }).map((_, i) => {
          const v = (0.35 + (Math.sin(i * 0.4 + hue * 0.1) * 0.5 + 0.5) * 0.55 + (Math.sin(i * 1.7) * 0.5 + 0.5) * 0.2) * amp;
          return <div key={i} style={{
            flex: 1, height: `${Math.max(8, v * 100)}%`,
            background: accent, opacity: 0.65 + (i % 5) * 0.04,
            borderRadius: 1,
          }} />;
        })}
      </div>
      <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', width: 50, textAlign: 'right' }}>4:28</span>
    </div>
  );
}

// ── Metrics delta card ────────────────────────────────────────────────────

function MetricsDeltaCard({ track, reference }) {
  // Build the delta rows
  const rows = [
    { label: 'Integrated LUFS',  yours: track.loudness.integrated,    ref: reference.lufs,          unit: ' LUFS', better: 'higher', notes: 'higher LUFS = louder master' },
    { label: 'True peak',        yours: track.loudness.truePeak,      ref: reference.truePeak,      unit: ' dBTP', better: 'neutral', notes: 'safety ceiling' },
    { label: 'Dynamic range',    yours: track.loudness.dynamicRange,  ref: reference.dynamicRange,  unit: ' LU',   better: 'match',  notes: 'higher = more dynamic' },
    { label: 'Stereo width',     yours: track.stereo.width,           ref: reference.width,         unit: '%',     better: 'match',  notes: '' },
    { label: 'Correlation',      yours: track.stereo.correlation,     ref: reference.correlation,   unit: '',      better: 'higher', notes: 'mono-safety' },
    { label: 'BPM',              yours: track.bpm,                    ref: reference.bpm,           unit: ' BPM',  better: 'match',  notes: 'tempo' },
  ];

  return (
    <div className="card">
      <div className="card-hd">
        <SectionTitle accent="var(--violet)" style={{ marginBottom: 0 }}>
          Metric deltas
        </SectionTitle>
        <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>negative = match the reference</span>
      </div>
      <div style={{ padding: '4px 16px 14px' }}>
        {rows.map(r => <DeltaRow row={r} key={r.label} />)}
      </div>
    </div>
  );
}

function DeltaRow({ row }) {
  const delta = row.yours - row.ref;
  const absDelta = Math.abs(delta);
  // direction interpretation
  let tone = 'neutral';
  if (row.better === 'match') tone = absDelta < (typeof row.yours === 'number' && Math.abs(row.yours) > 10 ? 2 : 0.4) ? 'good' : 'off';
  if (row.better === 'higher') tone = delta >= 0 ? 'good' : 'off';
  if (row.better === 'lower')  tone = delta <= 0 ? 'good' : 'off';

  const col = tone === 'good' ? 'var(--cyan)' : tone === 'off' ? 'var(--orange)' : 'var(--muted)';
  const fmt = (v) => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
  const sign = delta > 0 ? '+' : '';

  // Build a sliding scale for visualization
  const rangeMin = Math.min(row.yours, row.ref) - absDelta * 0.6;
  const rangeMax = Math.max(row.yours, row.ref) + absDelta * 0.6;
  const span = rangeMax - rangeMin || 1;
  const yPct = ((row.yours - rangeMin) / span) * 100;
  const rPct = ((row.ref - rangeMin)   / span) * 100;

  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{row.label}</span>
        {row.notes && <span className="mono" style={{ fontSize: 9, color: 'var(--dim)' }}>{row.notes}</span>}
        <span className="mono" style={{
          marginLeft: 'auto',
          fontSize: 12, fontWeight: 700, color: col,
        }}>{sign}{fmt(delta)}{row.unit}</span>
      </div>
      {/* Bar */}
      <div style={{ position: 'relative', height: 14 }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)', height: 3, background: 'var(--dim)', borderRadius: 2 }} />
        {/* Connector */}
        <div style={{
          position: 'absolute', top: '50%', transform: 'translateY(-50%)',
          left: `${Math.min(yPct, rPct)}%`,
          width: `${Math.abs(yPct - rPct)}%`,
          height: 3,
          background: col, opacity: 0.5, borderRadius: 2,
        }} />
        {/* Yours dot */}
        <div title={`yours: ${fmt(row.yours)}${row.unit}`} style={{
          position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)',
          left: `${yPct}%`,
          width: 12, height: 12, borderRadius: '50%',
          background: 'var(--cyan)', boxShadow: '0 0 6px rgba(0,229,176,0.6)',
          border: '2px solid var(--bg)',
        }} />
        {/* Reference dot */}
        <div title={`reference: ${fmt(row.ref)}${row.unit}`} style={{
          position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)',
          left: `${rPct}%`,
          width: 12, height: 12, borderRadius: '50%',
          background: 'var(--violet)', boxShadow: '0 0 6px rgba(167,139,250,0.6)',
          border: '2px solid var(--bg)',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        <span className="mono" style={{ fontSize: 10 }}>
          <span style={{ color: 'var(--muted)' }}>yours </span>
          <span style={{ color: 'var(--cyan)', fontWeight: 600 }}>{fmt(row.yours)}{row.unit}</span>
        </span>
        <span className="mono" style={{ fontSize: 10 }}>
          <span style={{ color: 'var(--muted)' }}>reference </span>
          <span style={{ color: 'var(--violet)', fontWeight: 600 }}>{fmt(row.ref)}{row.unit}</span>
        </span>
      </div>
    </div>
  );
}

// ── Frequency overlay ────────────────────────────────────────────────────

function FrequencyOverlayCard({ track, reference }) {
  // Reuse track frequency, fabricate a slightly different reference curve
  const yours = track.frequency.bands.map(b => b.v);
  // Reference: tighter low end, brighter top end (typical commercial)
  const refCurve = [0.55, 0.78, 0.72, 0.66, 0.62, 0.58, 0.54, 0.48];
  const labels = track.frequency.bands.map(b => ({ n: b.n, hz: b.hz }));

  return (
    <div className="card card-body">
      <SectionTitle accent="var(--cyan)" right={
        <div style={{ display: 'flex', gap: 12 }}>
          <Legend2 swatch="var(--cyan)" label="yours" />
          <Legend2 swatch="var(--violet)" label="reference" />
        </div>
      }>
        Frequency overlay
      </SectionTitle>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 140 }}>
        {labels.map((b, i) => {
          const y = yours[i];
          const r = refCurve[i];
          const diff = y - r;
          const diffCol = Math.abs(diff) < 0.08 ? 'var(--cyan)' : Math.abs(diff) < 0.15 ? 'var(--yellow)' : 'var(--orange)';
          return (
            <div key={i} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
              <div className="mono" style={{ fontSize: 9, color: diffCol, fontWeight: 700 }}>{diff > 0 ? '+' : ''}{(diff * 100).toFixed(0)}%</div>
              <div style={{ width: '100%', height: 90, position: 'relative', display: 'flex', alignItems: 'flex-end' }}>
                {/* Reference bar (back, violet) */}
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  height: `${r * 100}%`,
                  background: 'linear-gradient(to top, rgba(167,139,250,0.5), rgba(167,139,250,0.15))',
                  border: '1px solid rgba(167,139,250,0.4)',
                  borderRadius: '3px 3px 0 0',
                }} />
                {/* Yours bar (front, cyan, narrower) */}
                <div style={{
                  position: 'absolute', bottom: 0, left: '25%', right: '25%',
                  height: `${y * 100}%`,
                  background: 'linear-gradient(to top, var(--cyan), rgba(0,229,176,0.4))',
                  boxShadow: '0 0 6px rgba(0,229,176,0.4)',
                  borderRadius: '3px 3px 0 0',
                }} />
              </div>
              <div className="mono" style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-2)' }}>{b.n}</div>
              <div className="mono" style={{ fontSize: 8, color: 'var(--dim)' }}>{b.hz}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Fit score card ────────────────────────────────────────────────────────

function FitScoreCard({ track, reference }) {
  // Aggregate "match score" — how close yours is to reference
  const fitScore = 73; // mocked
  const col = fitScore >= 80 ? 'var(--cyan)' : fitScore >= 60 ? 'var(--yellow)' : 'var(--orange)';
  return (
    <div className="card card-body">
      <SectionTitle accent="var(--cyan)">Match score</SectionTitle>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <ScoreRing value={fitScore} max={100} size={100} color={col} stroke={7} label="match" />
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: col }}>Close — but not there yet</div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.5 }}>
            Your mix is in the same neighborhood. Loudness is the biggest gap (2.0 LU under). Frequency balance is 87% aligned.
          </div>
        </div>
      </div>
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <FitMicroRow label="Loudness"  pct={62} />
        <FitMicroRow label="Frequency" pct={87} />
        <FitMicroRow label="Stereo"    pct={91} />
        <FitMicroRow label="Dynamics"  pct={78} />
      </div>
    </div>
  );
}

function FitMicroRow({ label, pct }) {
  const col = pct >= 80 ? 'var(--cyan)' : pct >= 60 ? 'var(--yellow)' : 'var(--orange)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--text-2)', minWidth: 70 }}>{label}</span>
      <div style={{ flex: 1, height: 4, background: 'var(--dim)', borderRadius: 2 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: col, borderRadius: 2 }} />
      </div>
      <span className="mono" style={{ fontSize: 10, color: col, width: 26, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

// ── Suggestions card ──────────────────────────────────────────────────────

function SuggestionsCard({ track, reference }) {
  const sugs = [
    {
      sev: 'critical', persona: { color: 'var(--orange)', label: 'LOUDNESS' },
      title: 'Push +2.0 LUFS to match',
      detail: 'Reference sits at −9.2; you\'re at −11.2. Add 2 LU on the limiter input or master gain. Watch true-peak ceiling.',
    },
    {
      sev: 'warning', persona: { color: 'var(--cyan)', label: 'FREQUENCY' },
      title: 'Cut bass −10% to match shape',
      detail: 'Your bass is 14% above reference. Bell-cut 60–120 Hz on the bass channel by 1.5 dB.',
    },
    {
      sev: 'warning', persona: { color: 'var(--cyan)', label: 'FREQUENCY' },
      title: 'Lift air band +4% to match brightness',
      detail: 'Reference has more air; gentle 2 dB high-shelf at 12 kHz will close the gap.',
    },
  ];
  return (
    <div className="card">
      <div className="card-hd">
        <SectionTitle accent="var(--violet)" style={{ marginBottom: 0 }}>
          To match this reference
        </SectionTitle>
        <span className="pill violet">{sugs.length} steps</span>
      </div>
      <div style={{ padding: '4px 12px 14px' }}>
        {sugs.map((s, i) => (
          <div key={i} style={{
            padding: '10px 12px',
            borderRadius: 8,
            borderLeft: `3px solid ${s.persona.color}`,
            background: `${s.persona.color}06`,
            marginBottom: 6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <span className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: s.persona.color }}>
                {s.persona.label}
              </span>
              <span className="mono" style={{ fontSize: 9, color: 'var(--dim)' }}>#{i + 1}</span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{s.title}</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.5 }}>{s.detail}</div>
          </div>
        ))}
        <button className="btn primary sm" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>
          ◆ Apply all 3 suggested adjustments
        </button>
      </div>
    </div>
  );
}

window.ComparePage = ComparePage;
