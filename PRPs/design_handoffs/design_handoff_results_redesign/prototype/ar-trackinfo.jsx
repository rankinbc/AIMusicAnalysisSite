/* spectre — Analysis Results redesign. Track Info tab.
   Numbers + visuals, each meaningful; streaming readiness demoted to the bottom. */
const { useState: useStateTI } = React;

// genre token → friendly
const arGenre = (g) => g === 'other' || !g ? 'Uncategorized' : g.charAt(0).toUpperCase() + g.slice(1);

// ── Visuals (waveform + spectrogram) ─────────────────────────────────
function VizCard({ kind }) {
  const isWave = kind === 'wave';
  const src = isWave ? 'ar-assets/waveform.webp' : 'ar-assets/spectrogram.webp';
  const lead = isWave ? 'Amplitude over time' : 'Frequency over time';
  const body = isWave
    ? ' — the overall shape of the track. Read arrangement dynamics and where it peaks or drops out.'
    : ' — lows at the bottom, highs at the top; brighter means louder. Spot harshness or muddy low-end build-ups.';
  return (
    <div className="viz" title={lead + body}>
      <div className="viz-hd">
        <span className="l">{isWave ? 'waveform' : 'spectrogram'}</span>
      </div>
      <div className={`viz-img ${isWave ? 'wave' : 'spectro'}`}>
        <img src={src} alt={isWave ? 'waveform' : 'spectrogram'} className="viz-real" />
        {!isWave && <div className="viz-axis"><span>20k</span><span>2k</span><span>200</span><span>20 Hz</span></div>}
      </div>
      <div className="viz-desc"><b>{lead}</b>{body}</div>
    </div>);

}

// ── Loudness & dynamics ──────────────────────────────────────────────
function tpTone(tp) {return tp > -0.1 ? 'bad' : tp > -1.0 ? 'warn' : 'ok';}
function LoudnessCard({ loud }) {
  const MIN = -24,MAX = 0;
  const pct = (v) => `${Math.max(0, Math.min(100, (v - MIN) / (MAX - MIN) * 100))}%`;
  const hot = loud.lufs > loud.lufsTargetStream;
  const tpt = tpTone(loud.truePeakDb);
  return (
    <div className="card" data-ti-anchor="loudness">
      <div className="card-hd"><span className="t"><span className="led" />Loudness &amp; dynamics</span><span className="meta">integrated · true-peak</span></div>
      <div className="card-body">
        <div className="loud">
          <div className="loud-meter">
            <div className="lm-scale">
              <div className={`lm-fill${hot ? ' hot' : ''}`} style={{ width: pct(loud.lufs) }} />
              <div className={`lm-val${hot ? ' hot' : ''}`} style={{ left: pct(loud.lufs) }}>{loud.lufs} LUFS</div>
              <div className="lm-tgt" style={{ left: pct(loud.lufsTargetStream) }}><span className="cap">stream {loud.lufsTargetStream}</span></div>
            </div>
            <div className="lm-ends"><span>−24</span><span>integrated loudness</span><span>0 LUFS</span></div>
          </div>
          <div className="loud-tiles">
            <div className="dtile"><div className="dl">Sample peak</div><div className="dv">{loud.peakDbfs}<small>dBFS</small></div></div>
            <div className="dtile"><div className="dl"><Icon name={tpt === 'ok' ? 'check' : 'alert'} size={10} />True peak</div><div className={`dv ${tpt}`}>{loud.truePeakDb > 0 ? '+' : ''}{loud.truePeakDb}<small>dBTP</small></div>{tpt !== 'ok' && <div className="dnote">{tpt === 'bad' ? 'over 0 — will clip on lossy' : 'close to ceiling'}</div>}</div>
            <div className="dtile"><div className="dl">Dynamic range</div><div className={`dv ${loud.dynamicRange < 6 ? 'warn' : ''}`}>{loud.dynamicRange}<small>LU</small></div></div>
            <div className="dtile"><div className="dl">Clipping</div>{loud.clipping.detected ? <div className="dv bad">{loud.clipping.count}<small>samples</small></div> : <div className="dv ok">clean ✓</div>}</div>
          </div>
        </div>
      </div>
    </div>);

}

// ── Tonal balance (7-band, vs genre median) ──────────────────────────
function TonalCard({ bands }) {
  const vals = bands.flatMap((b) => [b.db, b.med]);
  const floor = Math.min(...vals) - 4,ceil = Math.max(...vals) + 2;
  const h = (v) => `${Math.max(4, Math.min(100, (v - floor) / (ceil - floor) * 100))}%`;
  return (
    <div className="card" data-ti-anchor="bands">
      <div className="card-hd"><span className="t"><span className="led" />Tonal balance</span><span className="meta">7-band · relative dB</span></div>
      <div className="card-body">
        <div className="bands">
          {bands.map((b, i) =>
          <div className="band" key={i}>
              <div className="bcol" style={{ height: '100%' }}>
                <div className="bmed" style={{ bottom: h(b.med) }} title={`genre median ${b.med} dB`} />
                <div className={`bfill ${b.tone}`} style={{ height: h(b.db) }} />
              </div>
              <div className="bval">{b.db}</div>
              <div className="blbl">{b.label}<br />{b.hz}</div>
            </div>
          )}
        </div>
        <div className="bands-legend">
          <span className="lg"><span className="sw" style={{ background: 'var(--accent)' }} />your mix</span>
          <span className="lg"><span className="sw" style={{ background: 'rgba(255,255,255,.32)' }} />genre median</span>
          <span className="lg"><span className="sw" style={{ background: 'var(--orange)' }} />over</span>
          <span className="lg"><span className="sw" style={{ background: 'var(--blue)' }} />under</span>
        </div>
      </div>
    </div>);

}

// ── Stereo ───────────────────────────────────────────────────────────
function StereoCard({ stereo }) {
  const corrPct = `${(stereo.correlation + 1) / 2 * 100}%`;
  const corrColor = stereo.correlation < 0 ? 'var(--red)' : stereo.correlation < 0.3 ? 'var(--orange)' : 'var(--accent)';
  const monoColor = stereo.monoCompat < 0.6 ? 'var(--orange)' : 'var(--accent)';
  return (
    <div className="card" data-ti-anchor="stereo">
      <div className="card-hd"><span className="t"><span className="led" />Stereo field</span><span className="meta">width · phase · mono</span></div>
      <div className="card-body">
        <div className="stereo">
          <Goniometer width={stereo.width} correlation={stereo.correlation} size={120} />
          <div className="stereo-rows">
            <div className="srow">
              <div className="sr-top"><span className="sr-l">Width</span><span className="sr-v mono">{stereo.width.toFixed(2)}</span></div>
              <div className="sr-track"><div className="f" style={{ width: `${stereo.width * 100}%`, background: stereo.width < 0.2 ? 'var(--orange)' : 'var(--accent)' }} /></div>
            </div>
            <div className="srow">
              <div className="sr-top"><span className="sr-l">Correlation</span><span className="sr-v mono">{stereo.correlation > 0 ? '+' : ''}{stereo.correlation.toFixed(2)}</span></div>
              <div className="sr-track"><span className="mid" /><div className="dot2" style={{ left: corrPct, background: corrColor, boxShadow: `0 0 0 3px ${corrColor}22` }} /></div>
            </div>
            <div className="srow">
              <div className="sr-top"><span className="sr-l">Mono compatibility</span><span className="sr-v mono">{Math.round(stereo.monoCompat * 100)}%</span></div>
              <div className="sr-track"><div className="f" style={{ width: `${stereo.monoCompat * 100}%`, background: monoColor }} /></div>
            </div>
          </div>
        </div>
      </div>
    </div>);

}

// ── Tempo · Key · Duration · Genre ───────────────────────────────────
function MetaRow({ meta, duration }) {
  return (
    <div className="meta-row">
      <div className="mstat"><div className="ml">Genre</div><div className="mv" style={{ fontSize: 16 }}>{arGenre(meta.genre)}</div><div className="msub">{Math.round(meta.genreConf * 100)}% confidence</div></div>
      <div className="mstat"><div className="ml">Duration</div><div className="mv"><span className="mono">{duration}</span></div></div>
      <div className="mstat"><div className="ml">Tempo</div><div className="mv"><span className="mono">{meta.bpm}</span><span className="u">BPM</span></div></div>
      <div className="mstat"><div className="ml">Key</div><div className="mv"><KeyBadge k={meta.key} confidence={meta.keyConf} /></div></div>
    </div>);

}

// ── Streaming readiness (demoted, collapsible) ───────────────────────
function CellMark({ ok }) {
  return <span className="cell"><span className={`ck ${ok ? 'ok' : 'no'}`}><Icon name={ok ? 'check' : 'x'} size={9} /></span></span>;
}
function StreamingReadiness({ rows }) {
  const [open, setOpen] = useStateTI(false);
  const ready = rows.filter((r) => r.lufsOk && r.tpOk && r.clipOk).length;
  return (
    <div className="stream-card">
      <button className="stream-hd" onClick={() => setOpen((o) => !o)}>
        <span className="l"><Icon name="sound" size={15} />Streaming readiness</span>
        <span className="sum"><span className={ready === rows.length ? 'ok' : 'no'}>{ready}/{rows.length}</span> platforms ready · <Icon name="chevron" size={12} /></span>
      </button>
      {open &&
      <div className="stream-table fade-up">
          <div className="stream-row head"><span>Platform</span><span>LUFS target</span><span>True peak</span><span>No clipping</span></div>
          {rows.map((r, i) =>
        <div className="stream-row" key={i}>
              <span className="plat">{r.platform}</span>
              <span className="cell"><span className={`ck ${r.lufsOk ? 'ok' : 'no'}`}><Icon name={r.lufsOk ? 'check' : 'x'} size={9} /></span>{r.target} LUFS</span>
              <CellMark ok={r.tpOk} />
              <CellMark ok={r.clipOk} />
            </div>
        )}
        </div>
      }
    </div>);

}

// ── Frequency clashes (phase 4) ──────────────────────────────
function ClashCard({ clashes }) {
  if (!clashes || clashes.length === 0) return null;
  return (
    <div className="card">
      <div className="card-hd"><span className="t"><span className="led" />Frequency clashes</span><span className="meta">{clashes.length} detected</span></div>
      <div className="card-body">
        <div className="clash-list">
          {clashes.map((c, i) => {
            const cc = c.severity === 'high' ? 'var(--orange)' : c.severity === 'moderate' ? 'var(--yellow)' : 'var(--muted)';
            return (
              <div className="clash-row" key={i} style={{ '--cc': cc }}>
                <div className="clash-top"><span className="clash-dot" /><span className="clash-pair">{c.pair}</span><span className="clash-range mono">{c.range}</span><span className="clash-sev mono">{c.severity}</span></div>
                <div className="clash-note">{c.note}</div>
              </div>);
          })}
        </div>
      </div>
    </div>);
}

// ── Mix translation (phase 9) ────────────────────────────────
const AR_TRANS_COLOR = { great: 'var(--green)', good: 'var(--accent)', fair: 'var(--orange)', poor: 'var(--red)' };
const AR_TRANS_ICON = { Phone: 'phone', Laptop: 'laptop', Club: 'sound' };
function TranslationCard({ translation }) {
  return (
    <div className="card">
      <div className="card-hd"><span className="t"><span className="led" />Mix translation</span><span className="meta">how it holds up</span></div>
      <div className="card-body">
        {translation ?
          <>
            <div className="trans-row">
              {translation.systems.map((sy) =>
                <div className="trans-sys" key={sy.name} style={{ '--tc': AR_TRANS_COLOR[sy.rating] || 'var(--text-2)' }}>
                  <span className="ts-ic"><Icon name={AR_TRANS_ICON[sy.name] || 'sound'} size={18} /></span>
                  <span className="ts-name">{sy.name}</span>
                  <span className="ts-rating">{sy.rating}</span>
                </div>)}
            </div>
            <div className="trans-note">{translation.note}</div>
          </> :
          <div className="na"><Icon name="info" size={14} />Not assessed — the track is too short to predict translation across systems.</div>}
      </div>
    </div>);
}

// ── Track Info tab ───────────────────────────────────────────────────
function TrackInfoTab({ scenario }) {
  const s = scenario;
  return (
    <div className="tabbody fade-up">
      <div className="ti-stack">
        <MetaRow meta={s.meta} duration={s.track.duration} />
        <LoudnessCard loud={s.loudness} />
        <TonalCard bands={s.bands} />
        <ClashCard clashes={s.clashes} />
        <StereoCard stereo={s.stereo} />
        <TranslationCard translation={s.translation} />
        <StreamingReadiness rows={s.streaming} />
        <div className="ti-visuals">
          <VizCard kind="wave" />
          <VizCard kind="spectro" />
        </div>
      </div>
    </div>);

}

Object.assign(window, { TrackInfoTab, arGenre });