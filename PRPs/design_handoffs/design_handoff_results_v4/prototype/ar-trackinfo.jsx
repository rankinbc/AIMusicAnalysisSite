/* spectre — Track Analysis tab. Every visual maps to a real final_json field (noted
   next to each component). Genre-median band curve is NOT produced by the backend —
   flags come from phase6.gaps; the median line was removed. */
const { useState: useStateTI } = React;

// genre token → friendly
const arGenre = (g) => g === 'other' || !g ? 'Uncategorized' : g.charAt(0).toUpperCase() + g.slice(1);
const tiTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ── Structure strip — phase1.structure.segments[].{label,start,end} ──
function StructStrip({ segments, duration, compact }) {
  if (!segments || segments.length === 0) return null;
  return (
    <div className={`struct-strip${compact ? ' compact' : ''}`} title="phase1.structure.segments">
      {segments.map((sg, i) => <div className="ss-seg" key={i} style={{ width: `${(sg.end - sg.start) / duration * 100}%` }} title={`${sg.label} · ${tiTime(sg.start)}–${tiTime(sg.end)}`}><span>{sg.label}</span></div>)}
    </div>);
}

// ── Visuals (waveform + spectrogram) + structure overlay ─────────────
function VizCard({ kind, segments, duration }) {
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
        {segments && <span className="viz-path mono">phase1.structure</span>}
      </div>
      <div className={`viz-img ${isWave ? 'wave' : 'spectro'}`}>
        <img src={src} alt={isWave ? 'waveform' : 'spectrogram'} className="viz-real" />
        {!isWave && <div className="viz-axis"><span>20k</span><span>2k</span><span>200</span><span>20 Hz</span></div>}
      </div>
      <StructStrip segments={segments} duration={duration} compact={true} />
      <div className="viz-desc"><b>{lead}</b>{body}</div>
    </div>);
}

// ── Loudness & dynamics — phase1.{lufs,peak_dbfs,true_peak_db,clipping,dr} ──
function tpTone(tp) {return tp > -0.1 ? 'bad' : tp > -1.0 ? 'warn' : 'ok';}
function LoudnessCard({ loud }) {
  const MIN = -24,MAX = 0;
  const pct = (v) => `${Math.max(0, Math.min(100, (v - MIN) / (MAX - MIN) * 100))}%`;
  const hot = loud.lufs > loud.lufsTargetStream;
  const tpt = tpTone(loud.truePeakDb);
  return (
    <div className="card" data-ti-anchor="loudness">
      <div className="card-hd"><span className="t"><span className="led" />Loudness &amp; dynamics</span><span className="meta">phase1.lufs · true_peak_db</span></div>
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
            <div className="dtile" title="phase1.peak_dbfs"><div className="dl">Sample peak</div><div className="dv">{loud.peakDbfs}<small>dBFS</small></div></div>
            <div className="dtile" title="phase1.true_peak_db"><div className="dl"><Icon name={tpt === 'ok' ? 'check' : 'alert'} size={10} />True peak</div><div className={`dv ${tpt}`}>{loud.truePeakDb > 0 ? '+' : ''}{loud.truePeakDb}<small>dBTP</small></div>{tpt !== 'ok' && <div className="dnote">{tpt === 'bad' ? 'over 0 — will clip on lossy' : 'close to ceiling'}</div>}</div>
            <div className="dtile" title="phase1.dynamic_range"><div className="dl">Dynamic range</div><div className={`dv ${loud.dynamicRange < 6 ? 'warn' : ''}`}>{loud.dynamicRange}<small>LU</small></div></div>
            <div className="dtile" title="phase1.clipped_sample_count"><div className="dl">Clipping</div>{loud.clipping.detected ? <div className="dv bad">{loud.clipping.count}<small>samples</small></div> : <div className="dv ok">clean ✓</div>}</div>
          </div>
        </div>
      </div>
    </div>);
}

// ── Loudness over time — phase1.loudness_timeline.short_term.{t[],lufs[]} ──
function LoudnessTimeline({ timeline, segments, duration, stMax }) {
  if (!timeline) return null;
  const W = 720, H = 104, padL = 34, padR = 8, padT = 8, padB = 6;
  const yMin = -20, yMax = -4;
  const x = (t) => padL + (t / duration) * (W - padL - padR);
  const y = (v) => padT + (1 - (Math.max(yMin, Math.min(yMax, v)) - yMin) / (yMax - yMin)) * (H - padT - padB);
  const pts = timeline.t.map((t, i) => `${x(t)},${y(timeline.lufs[i])}`).join(' ');
  const area = `${x(timeline.t[0])},${H - padB} ${pts} ${x(timeline.t[timeline.t.length - 1])},${H - padB}`;
  return (
    <div className="card">
      <div className="card-hd"><span className="t"><span className="led" />Loudness over time</span><span className="meta">phase1.loudness_timeline.short_term</span></div>
      <div className="card-body">
        <svg className="lt-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {[-8, -14].map(g => <g key={g}><line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} stroke="rgba(255,255,255,.06)" strokeWidth="1" /><text x={2} y={y(g) + 3} fontSize="8" fill="var(--muted)" fontFamily="JetBrains Mono">{g}</text></g>)}
          {segments && segments.slice(1).map((sg, i) => <line key={i} x1={x(sg.start)} x2={x(sg.start)} y1={padT} y2={H - padB} stroke="rgba(122,162,247,.18)" strokeWidth="1" />)}
          {stMax != null && <g><line x1={padL} x2={W - padR} y1={y(stMax)} y2={y(stMax)} stroke="rgba(251,146,60,.4)" strokeWidth="1" strokeDasharray="3 4" /><text x={W - padR - 2} y={y(stMax) - 3} fontSize="8" fill="var(--orange)" fontFamily="JetBrains Mono" textAnchor="end">ST max {stMax}</text></g>}
          <polygon points={area} fill="rgba(0,229,176,.09)" />
          <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.6" />
        </svg>
        <StructStrip segments={segments} duration={duration} />
      </div>
    </div>);
}

// ── Punch / dynamics — phase1.crest_factor · loudness_range_lu · transients.* ──
function ScoreBar({ v, max = 100, tone }) {
  const pc = Math.max(0, Math.min(100, (v / max) * 100));
  return <div className="scorebar"><div className={`sb-fill ${tone || ''}`} style={{ width: `${pc}%` }} /></div>;
}
function PunchCard({ punch }) {
  if (!punch) return null;
  // crest factor on a 2–16 dB scale with zones: <6 over-compressed · 6–11 healthy · >11 very dynamic
  const MIN = 2, MAX = 16;
  const pos = (v) => `${Math.max(0, Math.min(100, ((v - MIN) / (MAX - MIN)) * 100))}%`;
  const verdict = punch.crest < 6 ? 'over-compressed' : punch.crest > 11 ? 'very dynamic' : 'healthy';
  return (
    <div className="card">
      <div className="card-hd"><span className="t"><span className="led" />Punch &amp; transients</span><span className="meta">phase1.crest_factor · transients</span></div>
      <div className="card-body">
        <div className="punch-vis" title="phase1.crest_factor — peak-above-average headroom">
          <div className="pv-hd"><span className="pv-l">Crest factor</span><span className={`pv-verdict ${punch.crest < 6 ? 'warn' : 'ok'}`}>{verdict}</span><span className="pv-v mono">{punch.crest} dB</span></div>
          <div className="pv-gauge">
            <div className="pvg-zone squash" style={{ left: 0, width: pos(6) }} />
            <div className="pvg-zone ok" style={{ left: pos(6), width: `${(11 - 6) / (MAX - MIN) * 100}%` }} />
            <div className="pvg-zone open" style={{ left: pos(11), right: 0 }} />
            <div className="pvg-pin" style={{ left: pos(punch.crest) }} />
          </div>
          <div className="pv-scale"><span>squashed</span><span>punchy</span><span>very dynamic</span></div>
        </div>
        <div className="loud-tiles" style={{ marginTop: 12 }}>
          <div className="dtile" title="phase1.loudness_range_lu"><div className="dl">Loudness range</div><div className="dv">{punch.lra}<small>LU</small></div></div>
          <div className="dtile" title="phase1.transients.transients_per_second"><div className="dl">Transients</div><div className="dv">{punch.transientsPerSec}<small>/s</small></div><div className="dnote">{punch.transientCount.toLocaleString()} total</div></div>
          <div className="dtile" title="phase1.transients.avg_transient_strength"><div className="dl">Avg strength</div><div className="dv">{punch.transientStrength}</div></div>
        </div>
      </div>
    </div>);
}

// ── Tonal balance — phase1.bands.* (user only; flags from phase6.gaps) ──
function TonalCard({ bands }) {
  const vals = bands.map((b) => b.db);
  const floor = Math.min(...vals) - 4,ceil = Math.max(...vals) + 2;
  const h = (v) => `${Math.max(4, Math.min(100, (v - floor) / (ceil - floor) * 100))}%`;
  return (
    <div className="card" data-ti-anchor="bands">
      <div className="card-hd"><span className="t"><span className="led" />Tonal balance</span><span className="meta">phase1.bands · flags phase6.gaps</span></div>
      <div className="card-body">
        <div className="bands">
          {bands.map((b, i) =>
          <div className="band" key={i}>
              <div className="bcol" style={{ height: '100%' }}>
                <div className={`bfill ${b.tone}`} style={{ height: h(b.db) }} />
              </div>
              <div className="bval">{b.db}</div>
              <div className="blbl">{b.label}<br />{b.hz}</div>
            </div>
          )}
        </div>
        <div className="bands-legend" title="A genre median curve isn’t measured yet — flags come from phase6 gap analysis.">
          <span className="lg"><span className="sw" style={{ background: 'var(--accent)' }} />your mix</span>
          <span className="lg"><span className="sw" style={{ background: 'var(--orange)' }} />flagged by gap analysis</span>
        </div>
      </div>
    </div>);
}

// ── Stereo — phase1.{stereo_width,stereo_correlation,mono_compatibility,channel_balance} + phase9.spatial ──
function StereoCard({ stereo, channelBalance, spatial }) {
  const corrPct = `${(stereo.correlation + 1) / 2 * 100}%`;
  const corrColor = stereo.correlation < 0 ? 'var(--red)' : stereo.correlation < 0.3 ? 'var(--orange)' : 'var(--accent)';
  const monoColor = stereo.monoCompat < 0.6 ? 'var(--orange)' : 'var(--accent)';
  const cb = channelBalance;
  const cbPct = cb ? `${Math.max(8, Math.min(92, 50 + cb.balance * 8))}%` : null;
  return (
    <div className="card" data-ti-anchor="stereo">
      <div className="card-hd"><span className="t"><span className="led" />Stereo field</span><span className="meta">phase1 scalars · stylized scope</span></div>
      <div className="card-body">
        <div className="stereo">
          <Goniometer width={stereo.width} correlation={stereo.correlation} size={96} />
          <div className="stereo-rows">
            <div className="srow" title="phase1.stereo_width">
              <div className="sr-top"><span className="sr-l">Width</span><span className="sr-v mono">{stereo.width.toFixed(2)}</span></div>
              <div className="sr-track"><div className="f" style={{ width: `${stereo.width * 100}%`, background: stereo.width < 0.2 ? 'var(--orange)' : 'var(--accent)' }} /></div>
            </div>
            <div className="srow" title="phase1.stereo_correlation">
              <div className="sr-top"><span className="sr-l">Correlation</span><span className="sr-v mono">{stereo.correlation > 0 ? '+' : ''}{stereo.correlation.toFixed(2)}</span></div>
              <div className="sr-track"><span className="mid" /><div className="dot2" style={{ left: corrPct, background: corrColor, boxShadow: `0 0 0 3px ${corrColor}22` }} /></div>
            </div>
            <div className="srow" title="phase1.mono_compatibility">
              <div className="sr-top"><span className="sr-l">Mono compatibility</span><span className="sr-v mono">{Math.round(stereo.monoCompat * 100)}%</span></div>
              <div className="sr-track"><div className="f" style={{ width: `${stereo.monoCompat * 100}%`, background: monoColor }} /></div>
            </div>
            {cb && <div className="srow" title="phase1.channel_balance">
              <div className="sr-top"><span className="sr-l">L/R balance</span><span className="sr-v mono">L {cb.l} · R {cb.r} dB</span></div>
              <div className="sr-track"><span className="mid" /><div className="dot2" style={{ left: cbPct, background: 'var(--accent)' }} /></div>
            </div>}
          </div>
        </div>
        {spatial && <div className="sp-bars" title="phase9.spatial">
          <div className="spb" title="phase9.spatial.height_score"><span className="spb-l">Height</span><ScoreBar v={spatial.height} tone="accent" /><span className="spb-v mono">{spatial.height}</span></div>
          <div className="spb" title="phase9.spatial.depth_score"><span className="spb-l">Depth</span><ScoreBar v={spatial.depth} tone="accent" /><span className="spb-v mono">{spatial.depth}</span></div>
          <div className="spb" title="phase9.spatial.width_consistency"><span className="spb-l">Width consistency</span><ScoreBar v={spatial.widthConsistency * 100} tone="accent" /><span className="spb-v mono">{spatial.widthConsistency}</span></div>
        </div>}
      </div>
    </div>);
}

// ── Facts row — phase2 genre · phase1 key_estimate/bpm · danceability_score ──
function MetaRow({ meta, duration, danceability }) {
  const ke = meta.keyEstimate;
  return (
    <div className="meta-row">
      <div className="mstat" title="phase2.genre · confidence"><div className="ml">Genre</div><div className="mv">{arGenre(meta.genre)}</div><div className="msub">{Math.round(meta.genreConf * 100)}%</div></div>
      <div className="mstat" title="phase1.duration_seconds"><div className="ml">Duration</div><div className="mv"><span className="mono">{duration}</span></div></div>
      <div className="mstat" title="phase1.bpm"><div className="ml">Tempo</div><div className="mv"><span className="mono">{meta.bpm}</span><span className="u">BPM</span></div></div>
      {ke
        ? <div className="mstat" title="phase1.key_estimate"><div className="ml">Key</div><div className="mv"><span className="mono">{ke.key} {ke.mode}</span></div><div className="msub">{Math.round(ke.confidence * 100)}% · alt {ke.secondKey} {ke.secondMode}</div></div>
        : <div className="mstat"><div className="ml">Key</div><div className="mv"><KeyBadge k={meta.key} confidence={meta.keyConf} /></div></div>}
      {danceability != null && <div className="mstat dance" title="danceability_score"><div className="ml">Danceability</div><div className="mv"><span className="mono">{danceability}</span><span className="u">of 100</span></div><ScoreBar v={danceability} tone="accent" /></div>}
    </div>);
}

// ── Streaming readiness (computed vs phase1 loudness) ────────────────
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

// ── Frequency clashes — phase4.clashes[] ─────────────────────────────
function ClashCard({ clashes }) {
  if (!clashes || clashes.length === 0) return null;
  return (
    <div className="card">
      <div className="card-hd"><span className="t"><span className="led" />Frequency clashes</span><span className="meta">phase4.clashes · {clashes.length} detected</span></div>
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

// ── Mix translation — phase9.playback.* + phase9.surround.* ──────────
const AR_TRANS_COLOR = { great: 'var(--green)', good: 'var(--accent)', fair: 'var(--orange)', poor: 'var(--red)' };
const AR_TRANS_ICON = { Headphones: 'headphones', Speakers: 'sound', Mono: 'target' };
function TranslationCard({ translation }) {
  return (
    <div className="card">
      <div className="card-hd"><span className="t"><span className="led" />Mix translation</span><span className="meta">phase9.playback · phase9.surround</span></div>
      <div className="card-body">
        {translation ?
          <>
            <div className="trans-line">
              <div className="trans-row">
                {translation.systems.map((sy) =>
                  <div className="trans-sys" key={sy.name} style={{ '--tc': AR_TRANS_COLOR[sy.rating] || 'var(--text-2)' }} title={sy.path}>
                    <span className="ts-ic"><Icon name={AR_TRANS_ICON[sy.name] || 'sound'} size={13} /></span>
                    <span className="ts-name">{sy.name}</span>
                    <span className="ts-rating">{sy.rating}</span>
                    {sy.score != null && <span className="ts-score">{sy.score}</span>}
                  </div>)}
              </div>
              <div className="trans-note">{translation.note}</div>
            </div>
            {translation.chips && <div className="trans-chips">
              {translation.chips.map((c) => <div className="dtile" key={c.k} title={c.path}><div className="dl">{c.k}</div><div className={`dv ${c.tone || ''}`}>{c.v}</div></div>)}
            </div>}
          </> :
          <div className="na"><Icon name="info" size={14} />Not assessed — the track is too short to predict translation across systems.</div>}
      </div>
    </div>);
}

// ── Track Analysis tab ───────────────────────────────────────────────
function TrackInfoTab({ scenario, onGoToFinding, findingsCount, onGoToFindings }) {
  const s = scenario;
  const dur = s.track.durationSec;
  const segs = s.structure && s.structure.segments;
  return (
    <div className="tabbody fade-up">
      <div className="ti-stack">
        <div className="ti-toprow">
          <MetaRow meta={s.meta} duration={s.track.duration} danceability={s.danceability} />
          {findingsCount > 0 && <button className="ti-findings-note" onClick={onGoToFindings}>{findingsCount} post-analysis findings <Icon name="arrow" size={11} /></button>}
        </div>
        <div className="ti-grid">
          <LoudnessCard loud={s.loudness} />
          <TonalCard bands={s.bands} />
          <StereoCard stereo={s.stereo} channelBalance={s.channelBalance} spatial={s.spatial} />
          <PunchCard punch={s.punch} />
          <ClashCard clashes={s.clashes} />
        </div>
        <LoudnessTimeline timeline={s.loudnessTimeline} segments={segs} duration={dur} stMax={s.shortTermMax} />
        <div className="ti-visuals">
          <VizCard kind="wave" segments={segs} duration={dur} />
          <VizCard kind="spectro" segments={segs} duration={dur} />
        </div>
        <TranslationCard translation={s.translation} />
        <StreamingReadiness rows={s.streaming} />
      </div>
    </div>);
}

Object.assign(window, { TrackInfoTab, arGenre });
