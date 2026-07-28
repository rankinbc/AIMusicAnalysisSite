/* spectre — Reference tab. TWO complementary comparisons shown together, laid out by
   per-metric data availability (NOT a mode toggle):
   · "Compared to your genre" (phase6 gap analysis) — percentile / acceptable-range /
     genre-mean. Valid ONLY for phase6.gaps.{bpm,stereo_width,stereo_correlation} +
     overall phase6.percentile. Renders when genre confidence is decent; no upload needed.
     Low confidence → honest "can't place you", never a fabricated percentile.
   · "Compared to your reference" (phase5) — plain deltas (you · ref · Δ), colored by
     severity: phase5.deltas.* + phase5.genre_context.checks.* + (when stems present)
     phase5.per_stem_reference_deltas[]. Renders only when a reference is attached.
   The 3 metrics present in BOTH overlay the reference value as a ◇ marker on the genre
   range bar (correct only for those three). No per-band genre curve exists — dropped. */

function refFmt(v, unit) {
  if (unit === 'BPM') return `${v}`;
  if (unit === '') return v.toFixed(2);
  return `${v > 0 ? '+' : ''}${v}`;
}

// ── Target identity bar ──────────────────────────────────────────────
function RefIdentity({ profile, refTrack }) {
  const col = `hsl(${profile.hue} 65% 58%)`;
  return (
    <div className="ref-identity">
      <span className="ref-dot" style={{ background: col, boxShadow: `0 0 12px -2px ${col}` }} />
      <div className="ref-id-b">
        <div className="ref-id-name">{profile.name}<span className="ref-id-kind">{profile.kind === 'user' ? 'Your profile' : 'Genre preset'}</span></div>
        <div className="ref-id-sub">based on {profile.trackCount} tracks{refTrack && <> · chasing <b>◇ {refTrack.title}</b> — {refTrack.artist}</>}</div>
      </div>
      <span className="ref-id-vs">comparison targets</span>
    </div>
  );
}

// ── Genre percentile verdict — phase6.percentile ─────────────────────
function RefVerdict({ r }) {
  const inRange = r.gaps.filter(g => g.inRange).length;
  const size = 54, rad = (size - 9) / 2, c = 2 * Math.PI * rad, off = c * (1 - r.percentile / 100);
  return (
    <div className="ref-verdict" title="phase6.percentile">
      <div className="rv-ring">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size / 2} cy={size / 2} r={rad} fill="none" stroke="var(--dim)" strokeWidth="6" />
          <circle cx={size / 2} cy={size / 2} r={rad} fill="none" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={off} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset .7s ease' }} />
        </svg>
        <div className="rv-num"><span className="n">{r.percentile}</span><span className="u">th</span></div>
      </div>
      <div className="rv-b">
        <div className="rv-h"><span className="n">{inRange}</span> of {r.gaps.length} placed metrics in range</div>
        <div className="rv-take">{r.takeaway}</div>
      </div>
    </div>
  );
}

// ── Genre gap row — phase6.gaps.<feature>. When m.ref is present (bpm, stereo width,
//    stereo correlation) the reference value is layered on as a ◇ marker + read. ──
function RefGapRow({ m, onGoToFinding }) {
  const pos = (v) => Math.max(0, Math.min(100, ((v - m.dom[0]) / (m.dom[1] - m.dom[0])) * 100));
  const rLo = pos(m.range[0]), rHi = pos(m.range[1]);
  const u = m.unit ? ` ${m.unit}` : '';
  const hasRef = m.ref != null;
  return (
    <div className={`ref-gap${m.inRange ? '' : ' out'}`} title={m.path}>
      <span className="rg-lab-w"><span className="rg-label">{m.label}</span><span className="rg-pct"><span className="v">{m.pct}</span>th</span></span>
      <div className="rg-bar">
        <span className="rg-range" style={{ left: `${rLo}%`, width: `${rHi - rLo}%` }} />
        <span className="rg-meanTick" style={{ left: `${pos(m.mean)}%` }} />
        {hasRef && <span className="rg-refmark" style={{ left: `${pos(m.ref)}%` }} title={`reference ${refFmt(m.ref, m.unit)}`}>◇</span>}
        <span className={`rg-youdot${m.inRange ? '' : ' out'}`} style={{ left: `${pos(m.user)}%` }} />
      </div>
      <span className="rg-reads">
        <span className={`rg-you${m.inRange ? '' : ' out'}`}>you <b>{refFmt(m.user, m.unit)}{u}</b></span>
        <span className="rg-mean">genre {refFmt(m.mean, m.unit)}</span>
        {hasRef && <span className="rg-refval">◇ {refFmt(m.ref, m.unit)}</span>}
        {!m.inRange && m.findingId && <button className="rg-find" onClick={() => onGoToFinding(m.findingId)} title="See in Findings">fix <Icon name="arrow" size={11} /></button>}
      </span>
    </div>
  );
}

// ── Diverging delta bar — same anatomy as the genre range bar: full-width track,
//    ◇ reference at center, 'you' dot offset by the signed normalized magnitude. ──
function DeltaBar({ mag, tone }) {
  const m = Math.max(-1, Math.min(1, mag || 0));
  const col = tone === 'warn' ? 'var(--orange)' : 'var(--accent)';
  const half = Math.abs(m) * 46;
  return (
    <span className="rg-bar db-bar" title={`${m > 0 ? 'above' : 'below'} reference`}>
      <span className="db-fill" style={{ left: m >= 0 ? '50%' : `${50 - half}%`, width: `${half}%`, background: col }} />
      <span className="db-refmark">◇</span>
      <span className="rg-youdot" style={{ left: `${50 + m * 46}%`, background: col, boxShadow: `0 0 8px -1px ${col}` }} />
    </span>
  );
}

// ── Plain delta rows — phase5.deltas.*, rendered with the SAME row anatomy as the
//    genre gap rows: label left · bar middle · reads right. ──
function RefDeltaRows({ deltas, onGoToFinding }) {
  return (
    <div className="ref-gaps">
      {deltas.map((d) => (
        <div className={`ref-gap${d.tone === 'warn' ? ' out' : ''}`} key={d.key} title={d.path}>
          <span className="rg-lab-w"><span className="rg-label">{d.label}</span><span className={`rg-pct delta${d.tone === 'warn' ? ' warn' : ''}`}>{d.delta}</span></span>
          <DeltaBar mag={d.mag} tone={d.tone} />
          <span className="rg-reads">
            <span className={`rg-you${d.tone === 'warn' ? ' out' : ''}`}>you <b>{d.user}</b></span>
            <span className="rg-refval">◇ {d.ref}</span>
            {d.findingId && <button className="rg-find" onClick={() => onGoToFinding(d.findingId)} title="See in Findings">fix <Icon name="arrow" size={11} /></button>}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Genre-context checks — phase5.genre_context.checks.* ────────────
function RefChecks({ checks }) {
  if (!checks || checks.length === 0) return null;
  return (
    <div className="ref-checks">
      {checks.map((c) => <div className="dtile" key={c.k} title={`phase5.genre_context.checks.${c.k}`}><div className="dl">{c.k.replace(/_/g, ' ')}</div><div className={`dv ${c.tone || ''}`}>{c.v}</div></div>)}
    </div>
  );
}

// ── Per-stem reference deltas — phase5.per_stem_reference_deltas[] ──
function RefStemDeltas({ perStem }) {
  if (!perStem || perStem.length === 0) return null;
  return (
    <>
      <div className="ref-subhd">Per stem<span className="hint">phase5.per_stem_reference_deltas · stems + reference required</span></div>
      <div className="ref-gaps">
        {perStem.map((s, i) => (
          <div className={`ref-gap${s.tier !== 'minor' ? ' out' : ''}`} key={i}>
            <span className="rg-lab-w"><span className="rg-label"><b className="mono">{s.role}</b> · {s.metric.replace(/_/g, ' ')}</span><span className={`rg-pct delta${s.tier !== 'minor' ? ' warn' : ''}`}>{s.delta}</span></span>
            <DeltaBar mag={s.mag} tone={s.tier !== 'minor' ? 'warn' : 'ok'} />
            <span className="rg-reads">
              <span className={`rg-you${s.tier !== 'minor' ? ' out' : ''}`}>you <b>{s.user}</b></span>
              <span className="rg-refval">◇ {s.ref}</span>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Section shells ───────────────────────────────────────────────────
function RefGenreSection({ r, onGoToFinding }) {
  if (!r.genreConfident) {
    return (
      <section className="ref-section">
        <div className="seclabel"><span className="t">Compared to your genre</span><span className="hint">phase6 gap analysis</span><span className="rule" /></div>
        <div className="ref-cant"><Icon name="info" size={14} /><div><b>Not enough to place you against the genre yet.</b><span>Genre confidence is too low to position this mix on the {r.profile.name} distribution — improve detection with a cleaner master or a longer section.</span></div></div>
      </section>
    );
  }
  return (
    <section className="ref-section" data-kind="genre">
      <div className="seclabel"><span className="t">Compared to your genre</span><span className="hint">phase6 gap analysis · how you stack up against pros in this style</span><span className="rule" /></div>
      <RefVerdict r={r} />
      <div className="ref-gaps" style={{ marginTop: 12 }}>
        {r.gaps.map(m => <RefGapRow key={m.key} m={m} onGoToFinding={onGoToFinding} />)}
      </div>
      <div className="ref-legend"><span className="lg"><span className="d you" />you</span><span className="lg"><span className="d mean" />genre mean</span><span className="lg"><span className="d range" />acceptable range</span><span className="lg"><span className="dia">◇</span>your reference</span></div>
    </section>
  );
}

function RefReferenceSection({ r, hasStems, onGoToFinding }) {
  return (
    <section className="ref-section" data-kind="ref">
      <div className="seclabel"><span className="t">Compared to your reference</span><span className="hint">phase5 · how close you are to ◇ {r.refTrack.title}</span><span className="rule" /></div>
      <RefDeltaRows deltas={r.deltas} onGoToFinding={onGoToFinding} />
      <div className="ref-legend"><span className="lg"><span className="d you" />you</span><span className="lg"><span className="dia">◇</span>reference (center)</span><span className="lg">bar length = how far off</span></div>
      <RefChecks checks={r.checks} />
      {hasStems && <RefStemDeltas perStem={r.perStem} />}
    </section>
  );
}

// ── Assembled block — shows whichever sections have data ─────────────
function RefBlock({ r, hasStems, onGoToFinding }) {
  const showRef = !!r.refTrack;
  return (
    <>
      <RefIdentity profile={r.profile} refTrack={r.refTrack} />
      <RefGenreSection r={r} onGoToFinding={onGoToFinding} />
      {showRef && <RefReferenceSection r={r} hasStems={hasStems} onGoToFinding={onGoToFinding} />}
    </>
  );
}

function ReferenceTab({ scenario, onGoToFinding }) {
  const r = scenario.reference;
  if (!r) return null;
  const hasStems = !!(scenario.inputs && scenario.inputs.stems);
  return <div className="tabbody fade-up"><RefBlock r={r} hasStems={hasStems !== false} onGoToFinding={onGoToFinding} /></div>;
}

Object.assign(window, { ReferenceTab, RefBlock, RefIdentity, RefVerdict, RefGapRow });
