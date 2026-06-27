/* spectre — Analysis Results redesign. Reference tab (conditional · phase 5 + 6).
   Read-only: how the user's mix compares to a chosen reference target (profile-led,
   single ref track as ◇ overlay). Legend: ● you · ▒▒ acceptable range · │ mean · ◇ ref. */

function refFmt(v, unit) {
  if (unit === 'BPM') return `${v}`;
  if (unit === '') return v.toFixed(2);
  return `${v > 0 ? '+' : ''}${v}`;
}

// ── Target identity bar ──────────────────────────────────────────────
function RefIdentity({ profile, refTrack, refSummary }) {
  const col = `hsl(${profile.hue} 65% 58%)`;
  return (
    <div className="ref-identity">
      <span className="ref-dot" style={{ background: col, boxShadow: `0 0 12px -2px ${col}` }} />
      <div className="ref-id-b">
        <div className="ref-id-name">{profile.name}<span className="ref-id-kind">{profile.kind === 'user' ? 'Your profile' : 'Genre preset'}</span></div>
        <div className="ref-id-sub">based on {profile.trackCount} tracks{refTrack && <> · overlaying <b>◇ {refTrack.title}</b> — {refTrack.artist}</>}</div>
      </div>
      {refSummary
        ? <div className="h2h-id-stats"><span className="h2h-stat"><span className="k">closest to ref</span><span className="v">{refSummary.closest}</span></span><span className="h2h-stat"><span className="k">biggest gap</span><span className="v">{refSummary.biggest}</span></span></div>
        : <span className="ref-id-vs">comparison target</span>}
    </div>
  );
}

// ── Legend ───────────────────────────────────────────────────────────
function RefLegend({ hasRef }) {
  return (
    <div className="ref-legend">
      <span className="rl-i"><span className="rl-you" />you</span>
      <span className="rl-i"><span className="rl-range" />acceptable range</span>
      <span className="rl-i"><span className="rl-mean" />target mean</span>
      {hasRef && <span className="rl-i"><span className="rl-ref">◇</span>ref track</span>}
    </div>
  );
}

// ── Verdict summary (percentile ring + M of N + takeaway) ────────────
function RefVerdict({ r }) {
  const size = 96, rad = (size - 13) / 2, c = 2 * Math.PI * rad, off = c * (1 - r.percentile / 100);
  return (
    <div className="ref-verdict">
      <div className="rv-ring">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size / 2} cy={size / 2} r={rad} fill="none" stroke="var(--dim)" strokeWidth="9" />
          <circle cx={size / 2} cy={size / 2} r={rad} fill="none" stroke="var(--accent)" strokeWidth="9" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={off} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset .7s ease' }} />
        </svg>
        <div className="rv-num"><span className="n">{r.percentile}</span><span className="u">th</span></div>
      </div>
      <div className="rv-b">
        <div className="rv-h"><span className="n">{r.inRange}</span> of {r.total} metrics in range</div>
        <div className="rv-take">{r.takeaway}</div>
      </div>
    </div>
  );
}

// ── Tonal fingerprint (HERO) — 7-band curve vs profile mean ±2σ ──────
function RefBandCurve({ r, onGoToFinding }) {
  const labels = AR_BAND_LABELS;
  const { user, mean, std, ref, out, findingId } = r.bands;
  const W = 720, H = 226, padL = 10, padR = 10, padT = 16, padB = 30;
  const upper = mean.map((m, i) => m + 2 * std[i]);
  const lower = mean.map((m, i) => m - 2 * std[i]);
  const all = [...user, ...(ref || []), ...upper, ...lower];
  const yMin = Math.min(...all) - 2.5, yMax = Math.max(...all) + 2.5;
  const x = (i) => padL + (i / (labels.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);
  const areaPts = [...upper.map((v, i) => `${x(i)},${y(v)}`), ...lower.map((v, i) => `${x(i)},${y(v)}`).reverse()].join(' ');
  const meanLine = mean.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const userLine = user.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  return (
    <div className="ref-hero">
      <div className="ref-hero-h"><span className="t">Tonal fingerprint</span><span className="s">7-band shape vs {r.profile.name} · mean ±2σ{r.refTrack ? <> · <span style={{ color: 'rgba(255,255,255,.62)' }}>◇ {r.refTrack.title}</span></> : ''}</span></div>
      <div className="ref-curve">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none">
          {[0.25, 0.5, 0.75].map(g => <line key={g} x1={padL} x2={W - padR} y1={padT + g * (H - padT - padB)} y2={padT + g * (H - padT - padB)} stroke="rgba(255,255,255,.05)" strokeWidth="1" />)}
          <polygon points={areaPts} fill="rgba(0,229,176,.11)" />
          <polyline points={meanLine} fill="none" stroke="rgba(255,255,255,.32)" strokeWidth="1.4" strokeDasharray="4 4" />
          <polyline points={userLine} fill="none" stroke="var(--accent)" strokeWidth="2.4" />
          {ref && ref.map((v, i) => <text key={'r' + i} x={x(i)} y={y(v) + 4.5} fontSize="13.5" fill="rgba(255,255,255,.62)" textAnchor="middle">◇</text>)}
          {user.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={out[i] ? 5.2 : 3.6} fill={out[i] ? 'var(--sev-severe)' : 'var(--accent)'} stroke="#070a12" strokeWidth="1.6" />)}
        </svg>
      </div>
      <div className="ref-axis">
        {labels.map((b, i) => <span key={b.key} className={`ref-ax${out[i] ? ' out' : ''}`}><span className="l">{b.label}</span><span className="h">{b.hz}</span></span>)}
      </div>
      <div className="ref-dev">
        {labels.map((b, i) => out[i] && (
          <button key={b.key} className="ref-dev-chip" onClick={() => findingId[i] && onGoToFinding(findingId[i])}>
            <span className="d">{b.label} {(user[i] - mean[i] > 0 ? '+' : '')}{(user[i] - mean[i]).toFixed(1)} dB</span>
            <span className="sep">vs profile</span>
            {findingId[i] && <span className="go">see in Findings <Icon name="arrow" size={11} /></span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Scalar gap row (range bar with ◇ overlay) ────────────────────────
function RefGapRow({ m, hasRef, onGoToFinding }) {
  const pos = (v) => Math.max(0, Math.min(100, ((v - m.dom[0]) / (m.dom[1] - m.dom[0])) * 100));
  const rLo = pos(m.range[0]), rHi = pos(m.range[1]);
  const u = m.unit ? ` ${m.unit}` : '';
  const dec = m.unit === '' ? 2 : m.unit === 'BPM' ? 0 : 1;
  const d = hasRef ? m.user - m.ref : 0;
  const isMatch = hasRef && Math.abs(d) < (dec === 2 ? 0.005 : dec === 0 ? 0.5 : 0.05);
  const near = hasRef && Math.abs(d) < (m.dom[1] - m.dom[0]) * 0.06;
  const deltaStr = isMatch ? 'match' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(dec)}${m.unit && m.unit !== 'BPM' ? ' ' + m.unit : ''}`;
  return (
    <div className={`ref-gap${m.inRange ? '' : ' out'}`}>
      <div className="rg-top">
        <span className="rg-label">{m.label}</span>
        <span className="rg-vals">
          <span className={`rg-you${m.inRange ? '' : ' out'}`}>you <b>{refFmt(m.user, m.unit)}{u}</b></span>
          <span className="rg-mean">mean {refFmt(m.mean, m.unit)}</span>
          {hasRef && <span className="rg-refval">◇ ref <b>{refFmt(m.ref, m.unit)}</b></span>}
        </span>
      </div>
      <div className="rg-bar">
        <span className="rg-range" style={{ left: `${rLo}%`, width: `${rHi - rLo}%` }} />
        <span className="rg-meanTick" style={{ left: `${pos(m.mean)}%` }} />
        {hasRef && <span className="rg-ref" style={{ left: `${pos(m.ref)}%` }}>◇</span>}
        <span className={`rg-youdot${m.inRange ? '' : ' out'}`} style={{ left: `${pos(m.user)}%` }} />
      </div>
      <div className="rg-foot">
        <span className="rg-pct"><span className="v">{m.pct}</span>th percentile{hasRef && <span className="rg-vsref"> · vs ◇ ref <b className={near ? 'near' : ''}>{deltaStr}</b></span>}</span>
        {!m.inRange && m.findingId && <button className="rg-find" onClick={() => onGoToFinding(m.findingId)}>see in Findings <Icon name="arrow" size={12} /></button>}
      </div>
    </div>
  );
}

// ── Head-to-head vs the uploaded reference track (phase 5 A/B) ────────
function RefTrackHead({ r }) {
  const t = r.refTrack;
  const fmt = (v, unit) => unit === 'BPM' ? `${v}` : unit === '' ? v.toFixed(2) : `${v}${unit ? ' ' + unit : ''}`;
  const scored = r.metrics.map(m => { const d = m.user - m.ref; return { m, d, norm: Math.abs(d) / (m.dom[1] - m.dom[0]) }; });
  const closest = scored.slice().sort((a, b) => a.norm - b.norm)[0];
  const furthest = scored.slice().sort((a, b) => b.norm - a.norm)[0];
  const pos = (m, v) => Math.max(0, Math.min(100, ((v - m.dom[0]) / (m.dom[1] - m.dom[0])) * 100));
  return (
    <div className="ref-h2h">
      <div className="seclabel" style={{ marginTop: 24 }}><span className="t">Head-to-head</span><span className="hint">phase 5 · vs the track you uploaded</span><span className="rule" /></div>
      <div className="h2h-id">
        <span className="h2h-dia">◇</span>
        <div className="h2h-id-b">
          <div className="h2h-id-name">{t.title}<span className="h2h-id-artist">{t.artist}</span></div>
          <div className="h2h-id-sub">your uploaded reference · direct A/B, no profile spread</div>
        </div>
        <div className="h2h-id-stats">
          <span className="h2h-stat"><span className="k">closest</span><span className="v">{closest.m.label}</span></span>
          <span className="h2h-stat"><span className="k">biggest gap</span><span className="v">{furthest.m.label}</span></span>
        </div>
      </div>
      <div className="h2h-rows">
        {scored.map(({ m, d }) => {
          const youP = pos(m, m.user), refP = pos(m, m.ref);
          const lo = Math.min(youP, refP), w = Math.abs(youP - refP);
          const dec = m.unit === '' ? 2 : m.unit === 'BPM' ? 0 : 1;
          const isMatch = Math.abs(d) < (dec === 2 ? 0.005 : dec === 0 ? 0.5 : 0.05);
          const near = Math.abs(d) < (m.dom[1] - m.dom[0]) * 0.06;
          const deltaStr = isMatch ? 'match' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(dec)}${m.unit && m.unit !== 'BPM' ? ' ' + m.unit : ''}`;
          return (
            <div className="h2h-row" key={m.key}>
              <span className="h2h-label">{m.label}</span>
              <span className="h2h-bar">
                <span className="h2h-conn" style={{ left: `${lo}%`, width: `${w}%` }} />
                <span className="h2h-ref" style={{ left: `${refP}%` }}>◇</span>
                <span className="h2h-you" style={{ left: `${youP}%` }} />
              </span>
              <span className="h2h-read">
                <span className="yv">{fmt(m.user, m.unit)}</span>
                <span className="rv">◇ {fmt(m.ref, m.unit)}</span>
                <span className={`dv${near ? ' near' : ''}`}>{deltaStr}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Reference tab ────────────────────────────────────────────────────
function ReferenceTab({ scenario, onGoToFinding }) {
  const r = scenario.reference;
  if (!r) return null;
  const hasRef = !!r.refTrack;
  let refSummary = null;
  if (hasRef) {
    const scored = r.metrics.map(m => ({ label: m.label, norm: Math.abs(m.user - m.ref) / (m.dom[1] - m.dom[0]) }));
    refSummary = {
      closest: scored.slice().sort((a, b) => a.norm - b.norm)[0].label,
      biggest: scored.slice().sort((a, b) => b.norm - a.norm)[0].label,
    };
  }
  return (
    <div className="tabbody fade-up">
      <RefIdentity profile={r.profile} refTrack={r.refTrack} refSummary={refSummary} />
      <RefVerdict r={r} />
      <RefLegend hasRef={hasRef} />
      <RefBandCurve r={r} onGoToFinding={onGoToFinding} />
      <div className="seclabel" style={{ marginTop: 22 }}><span className="t">Metric comparison</span><span className="hint">{r.total} metrics · you vs profile{hasRef ? ' + ◇ ref track' : ''}</span><span className="rule" /></div>
      <div className="ref-gaps">
        {r.metrics.map(m => <RefGapRow key={m.key} m={m} hasRef={hasRef} onGoToFinding={onGoToFinding} />)}
      </div>
    </div>
  );
}

Object.assign(window, { ReferenceTab, RefIdentity, RefLegend, RefVerdict, RefBandCurve, RefGapRow });
