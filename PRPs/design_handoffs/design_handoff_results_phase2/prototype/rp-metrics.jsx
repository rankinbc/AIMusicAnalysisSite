/* spectre — Analysis tab · the 🆕 Phase-1 metric groups (Dynamics / Loudness / Tone).
 * Each renders in one of three comparable viz variants set by the `metricViz` tweak:
 *   'meter' — horizontal zone meters (dense, familiar)
 *   'dial'  — radial gauges (punchy, novel)
 *   'plot'  — number-forward axis ticks (editorial, minimal)
 * Density ('compact' | 'full') trims secondary readouts. */

function MetricCard({ title, led = 'var(--accent)', usedin, children }) {
  return (
    <div className="card metric-card">
      <div className="card-hd">
        <span className="t"><span className="led" style={{ background: led }} />{title}</span>
        {usedin && <span className="usedin">{usedin}</span>}
      </div>
      <div className="card-body">{children}</div>
    </div>
  );
}

// Horizontal zone meter (meter variant primitive)
function ZoneMeter({ value, min, max, zone, unit = '', color = 'var(--accent)', zoneLabel }) {
  const pct = (v) => `${Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100))}%`;
  return (
    <div className="zmeter">
      <div className="zm-track">
        {zone && <div className="zm-zone" style={{ left: pct(zone[0]), right: `calc(100% - ${pct(zone[1])})` }} />}
        <div className="zm-fill" style={{ width: pct(value), background: color }} />
        <div className="zm-mark" style={{ left: pct(value), borderColor: color }} />
      </div>
      <div className="zm-scale mono">
        <span>{min}{unit}</span>
        {zoneLabel && <span className="zm-zlabel">{zoneLabel}</span>}
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

// Platform-target loudness scale (meter / plot variants)
function LoudnessTargets({ d }) {
  const pct = (v) => Math.max(0, Math.min(100, ((v - d.scaleMin) / (d.scaleMax - d.scaleMin)) * 100));
  const tone = (delta) => Math.abs(delta) < 1 ? 'near' : delta > 0 ? 'hot' : 'under';
  return (
    <div className="ltargets">
      <div className="lt-track">
        <div className="lt-band" style={{ left: `${pct(-16)}%`, right: `${100 - pct(-13)}%` }} />
        <div className="lt-fill" style={{ width: `${pct(d.integrated)}%` }} />
        <div className="lt-you" style={{ left: `${pct(d.integrated)}%` }}><span className="cap mono">you {d.integrated}</span></div>
      </div>
      <div className="lt-scale mono"><span>{d.scaleMin}</span><span className="lt-band-lbl">streaming</span><span>{d.scaleMax} LUFS</span></div>
      <div className="lt-chips">
        {d.targets.map((t, i) => {
          const delta = +(d.integrated - t.lufs).toFixed(1), tn = tone(delta);
          return (
            <div className={`lt-chip ${tn}`} key={i}>
              <span className="ltc-n">{t.name}</span>
              <span className="ltc-v mono">{t.lufs}</span>
              <span className="ltc-d mono">{delta > 0 ? `+${delta} hot` : delta < 0 ? `${delta} under` : 'on target'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Dynamics / Punch ─────────────────────────────────────────────────
function DynamicsCard({ variant, density }) {
  const d = RP_DYNAMICS, full = density === 'full';
  const crestC = 'var(--green)';
  const tiles = (
    <div className="metric-tiles" style={{ gridTemplateColumns: full ? 'repeat(3,1fr)' : 'repeat(2,1fr)' }}>
      <StatTile l="ATTACK" v={d.transientStrength} u="env" c="var(--text)" />
      <StatTile l="ONSETS / S" v={d.transientsPerSec} u="" c="var(--accent)" />
      {full && <StatTile l="ONSETS" v={d.transientCount} u="" c="var(--text)" />}
      {full && <StatTile l="LOUDNESS RANGE" v={d.loudnessRange} u="LU" c="var(--text)" />}
    </div>
  );
  return (
    <MetricCard title="Dynamics & punch" led={crestC} usedin="→ move 5">
      {variant === 'dial' ? (
        <div className="metric-dialrow">
          <GaugeDial value={d.crest} min={d.crestMin} max={d.crestMax} zone={d.crestZone} unit="dB crest" color={crestC} label="Crest factor" sub="healthy 8–14" />
          <div className="metric-tiles col">{tiles}</div>
        </div>
      ) : variant === 'plot' ? (
        <>
          <div className="metric-hero">
            <span className="mh-v mono" style={{ color: crestC }}>{d.crest}<i>dB</i></span>
            <span className="mh-l">crest factor · <b style={{ color: crestC }}>punchy</b></span>
          </div>
          <ScalePos pct={(d.crest / d.crestMax) * 100} lo="squashed" hi="very wide" color={crestC} />
          {tiles}
        </>
      ) : (
        <>
          <div className="metric-line"><span className="ml-v mono" style={{ color: crestC }}>{d.crest} dB</span><span className="ml-l">crest factor · peak − RMS</span></div>
          <ZoneMeter value={d.crest} min={d.crestMin} max={d.crestMax} zone={d.crestZone} unit="" color={crestC} zoneLabel="healthy 8–14" />
          {tiles}
        </>
      )}
    </MetricCard>
  );
}

// ── Loudness detail (streaming-readiness) ────────────────────────────
function LoudnessCard({ variant, density }) {
  const d = RP_LOUD, full = density === 'full';
  const hot = 'var(--orange)';
  const tiles = (
    <div className="metric-tiles" style={{ gridTemplateColumns: full ? 'repeat(4,1fr)' : 'repeat(2,1fr)' }}>
      <StatTile l="TRUE PEAK" v={d.truePeak} u="dBTP" c={d.truePeak > -1 ? hot : 'var(--accent)'} />
      <StatTile l="RANGE" v={d.range} u="LU" c="var(--text)" />
      {full && <StatTile l="SHORT-TERM" v={d.shortTerm} u="LUFS" c="var(--text)" />}
      {full && <StatTile l="MOMENTARY" v={d.momentary} u="LUFS" c="var(--text)" />}
    </div>
  );
  return (
    <MetricCard title="Loudness · streaming readiness" led={hot} usedin="→ move 1">
      {variant === 'dial' ? (
        <div className="metric-dialrow">
          <GaugeDial value={d.integrated} min={d.scaleMin} max={d.scaleMax} zone={[-16, -13]} unit="LUFS" color={hot} label="Integrated" sub="streaming −16…−13" />
          <div className="metric-tiles col">{tiles}</div>
          <div className="dial-targets">
            {d.targets.map((t, i) => {
              const delta = +(d.integrated - t.lufs).toFixed(1);
              return <div key={i} className={`lt-chip ${Math.abs(delta) < 1 ? 'near' : delta > 0 ? 'hot' : 'under'}`}><span className="ltc-n">{t.name}</span><span className="ltc-d mono">{delta > 0 ? `+${delta}` : delta}</span></div>;
            })}
          </div>
        </div>
      ) : variant === 'plot' ? (
        <>
          <div className="metric-hero">
            <span className="mh-v mono" style={{ color: hot }}>{d.integrated}<i>LUFS</i></span>
            <span className="mh-l">integrated · <b style={{ color: hot }}>4.5 LU over streaming</b></span>
          </div>
          <LoudnessTargets d={d} />
          {tiles}
        </>
      ) : (
        <>
          <div className="metric-line"><span className="ml-v mono" style={{ color: hot }}>{d.integrated} LUFS</span><span className="ml-l">integrated loudness</span></div>
          <LoudnessTargets d={d} />
          {tiles}
        </>
      )}
    </MetricCard>
  );
}

// ── Tone / Clarity ───────────────────────────────────────────────────
function ToneCard({ variant }) {
  const rows = RP_TONE;
  const col = 'var(--accent)';
  return (
    <MetricCard title="Tone & clarity" led={col} usedin="→ move 2">
      {variant === 'dial' ? (
        <div className="tone-dials">
          {rows.map((r, i) => (
            <GaugeDial key={i} value={r.pct} min={0} max={100} unit={r.k.toLowerCase()} color={col} size={96}
              display={`${r.val}${r.unit}`} sub={`${r.lo} → ${r.hi}`} />
          ))}
        </div>
      ) : variant === 'plot' ? (
        <div className="tone-plot">
          {rows.map((r, i) => (
            <div className="tp-col" key={i}>
              <span className="tp-v mono" style={{ color: col }}>{r.val}<i>{r.unit}</i></span>
              <span className="tp-k">{r.k}</span>
              <ScalePos pct={r.pct} lo={r.lo} hi={r.hi} color={col} />
            </div>
          ))}
        </div>
      ) : (
        <div className="tone-rows">
          {rows.map((r, i) => (
            <div className="tone-row" key={i}>
              <div className="tr-head"><span className="tr-k">{r.k}</span><span className="tr-v mono">{r.val}<i>{r.unit}</i></span></div>
              <ScalePos pct={r.pct} lo={r.lo} hi={r.hi} color={col} />
            </div>
          ))}
        </div>
      )}
    </MetricCard>
  );
}

Object.assign(window, { MetricCard, DynamicsCard, LoudnessCard, ToneCard });
