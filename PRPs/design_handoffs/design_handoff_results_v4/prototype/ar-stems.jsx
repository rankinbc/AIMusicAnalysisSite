/* spectre — Analysis Results redesign. Stems tab: master-detail on phase4.stems (grouped mode).
   Metrics are per ROLE; the physical files (stems endpoint) nest inside each role.
   Left: role list (no controls). Right: role detail — files w/ confidence + evidence +
   solo play, LUFS/RMS/peak/DR, 7-band energy, width/pan/mono chips, clash matrix badges,
   balance-flag + reference-delta sentences, link to the related finding. */
const { useState: useStateSt, useEffect: useEffectSt } = React;

const ST_TIER = { info: 'var(--accent)', warning: 'var(--orange)', critical: 'var(--red)' };
const ST_BANDS = [['sub', '20–60'], ['bass', '60–200'], ['low_mid', '200–600'], ['mid', '600–2k'], ['high_mid', '2k–6k'], ['presence', '6k–12k'], ['air', '12k–20k']];

function StemLevelBar({ v, min = -26, max = 0, hot }) {
  const pc = Math.max(0, Math.min(100, (v - min) / (max - min) * 100));
  return <div className="stem-bar"><div className={`sb-f${hot ? ' hot' : ''}`} style={{ width: pc + '%' }} /></div>;
}

// ── 7-band energy sparkline — phase4.stems.per_stem[role].band_energy_db ─
function BandSpark({ bands }) {
  const vals = ST_BANDS.map(([k]) => bands[k]);
  const lo = -66, hi = -8;
  return (
    <div className="bspark">
      {ST_BANDS.map(([k, hz], i) => {
        const t = Math.max(0.04, Math.min(1, (vals[i] - lo) / (hi - lo)));
        return (
          <div key={k} className="bs-col" title={`${k} (${hz} Hz): ${vals[i].toFixed(1)} dB`}>
            <div className="bs-track"><div className="bs-f" style={{ height: t * 100 + '%' }} /></div>
            <span className="bs-k">{k.replace('_', '‑')}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── EQ overlap viz — two stem spectra on a log axis, shared energy shaded ─
function ClashOverlapViz({ clash, compact }) {
  const W = 660, H = compact ? 150 : 190, padL = 34, padR = 10, padT = 30, padB = 22;
  const fmin = 20, fmax = 2000, N = 140;
  const X = f => padL + Math.log(f / fmin) / Math.log(fmax / fmin) * (W - padL - padR);
  const Y = v => H - padB - v * (H - padB - padT);
  const bump = (f, c, s, a) => a * Math.exp(-Math.pow(Math.log2(f / c), 2) / (2 * s * s));
  const kick = f => Math.min(1, bump(f, 70, 0.5, 0.95) + bump(f, 1400, 1.1, 0.14));
  const bass = f => Math.min(1, bump(f, 74, 0.55, 0.88) + bump(f, 150, 0.5, 0.42) + bump(f, 300, 0.6, 0.2));
  const freqs = Array.from({ length: N }, (_, i) => fmin * Math.pow(fmax / fmin, i / (N - 1)));
  const path = fn => freqs.map((f, i) => `${i ? 'L' : 'M'}${X(f).toFixed(1)},${Y(fn(f)).toFixed(1)}`).join('');
  const area = fn => path(fn) + `L${X(fmax).toFixed(1)},${Y(0)}L${X(fmin).toFixed(1)},${Y(0)}Z`;
  const overlap = f => Math.min(kick(f), bass(f));
  const ticks = [20, 50, 100, 200, 500, 1000, 2000];
  return (
    <div className="cov-wrap">
      <div className="cov-legend">
        <span className="cl-chip" style={{ '--c': 'var(--accent)' }}>Kick</span>
        <span className="cl-chip" style={{ '--c': '#7aa2f7' }}>Bass</span>
        <span className="cl-chip" style={{ '--c': 'var(--orange)' }}>Shared energy</span>
        <span className="cl-note mono">overlap 0.82 · both peak ≈ 70 Hz</span>
      </div>
      <svg className="cov-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`EQ overlap between ${clash.pair}`}>
        <rect x={X(60)} y={padT - 14} width={X(90) - X(60)} height={H - padB - padT + 14} fill="rgba(251,146,60,.07)" stroke="rgba(251,146,60,.28)" strokeDasharray="3 3" />
        <text x={(X(60) + X(90)) / 2} y={padT - 4} textAnchor="middle" className="cov-band">60–90 Hz</text>
        {ticks.map(f => <g key={f}>
          <line x1={X(f)} y1={padT} x2={X(f)} y2={H - padB} stroke="rgba(148,163,184,.09)" />
          <text x={X(f)} y={H - 7} textAnchor="middle" className="cov-tick">{f >= 1000 ? f / 1000 + 'k' : f}</text>
        </g>)}
        <path d={area(kick)} fill="rgba(0,229,176,.13)" />
        <path d={area(bass)} fill="rgba(122,162,247,.13)" />
        <path d={area(overlap)} fill="rgba(251,146,60,.4)" />
        <path d={path(kick)} fill="none" stroke="var(--accent)" strokeWidth="1.6" />
        <path d={path(bass)} fill="none" stroke="#7aa2f7" strokeWidth="1.6" />
      </svg>
    </div>
  );
}

// ── Detail panel for the selected role ────────────────────────────────
function StemDetail({ s, scenario, onGoToFinding }) {
  const [playingFile, setPlayingFile] = useStateSt(null);
  useEffectSt(() => setPlayingFile(null), [s && s.role]);
  if (!s) return <div className="fb-detail empty"><Icon name="info" size={18} /><span>Select a stem role to see its detail.</span></div>;
  const worstClash = s.clashes && s.clashes[0];
  const tier = worstClash ? ST_TIER[worstClash.tier] : 'var(--accent)';
  const finding = s.findingId ? scenario.findings.find(f => f.id === s.findingId) : null;
  return (
    <div className="fb-detail" style={{ '--sev': tier }}>
      <div className="fbd-scroll">
        <div className="fbd-toplab">Stem role · grouped bus</div>
        <div className="fbd-meta">
          <span className="fbd-sev" style={{ color: tier }}>{worstClash ? `${worstClash.tier} clash` : 'Clean'}</span>
          <span className="fbd-group">{s.files.length} {s.files.length === 1 ? 'file' : 'files'}</span>
          <span className="fbd-group mono">centroid {s.centroid >= 1000 ? (s.centroid / 1000).toFixed(1) + ' kHz' : s.centroid + ' Hz'}</span>
        </div>
        <h3 className="fbd-head" style={{ textTransform: 'capitalize' }}>{s.role}</h3>

        <div className="stem-chips">
          <span className="schip mono">width {Math.round(s.width * 100)}%</span>
          <span className="schip mono">pan {s.pan === 0 ? 'C' : (s.pan > 0 ? 'R' : 'L') + Math.abs(Math.round(s.pan * 100))}</span>
          <span className={`schip mono${s.isMono ? ' on' : ''}`}>{s.isMono ? 'mono' : 'stereo'}</span>
          {s.domFreqs.length > 0 && <span className="schip mono">peaks {s.domFreqs.slice(0, 3).map(f => f >= 1000 ? (f / 1000).toFixed(1) + 'k' : Math.round(f)).join(' · ')} Hz</span>}
        </div>

        <div className="stem-files">
          {s.files.map(fl => (
            <div key={fl.name} className="sfile">
              <button className={`sp-btn sm${playingFile === fl.name ? ' on' : ''}`} onClick={() => setPlayingFile(p => p === fl.name ? null : fl.name)} title={playingFile === fl.name ? 'Pause' : 'Solo this file'}>
                <Icon name={playingFile === fl.name ? 'pause' : 'play'} size={11} />
              </button>
              <span className="sf-name mono" title={fl.evidence}>{fl.name}</span>
              {fl.detected && fl.detected !== s.role && <span className="sf-reclass" title={`Classifier guessed “${fl.detected}” — you confirmed “${s.role}”`}>reclassified</span>}
              <span className="sf-conf mono" title={fl.evidence}>conf {Math.round(fl.conf * 100)}%</span>
              <div className="sp-track"><div className={`sp-prog${playingFile === fl.name ? ' run' : ''}`} /></div>
            </div>
          ))}
        </div>

        <div className="stem-stats4">
          <div className="ss4"><span className="k">LUFS</span><span className="v mono">{s.lufs.toFixed(1)}</span></div>
          <div className="ss4"><span className="k">RMS</span><span className="v mono">{s.rms.toFixed(1)}</span></div>
          <div className="ss4"><span className="k">Peak</span><span className="v mono">{s.peak.toFixed(1)}</span></div>
          <div className="ss4"><span className="k">Dyn range</span><span className="v mono">{s.dr.toFixed(1)}<i>dB</i></span></div>
        </div>

        <div className="stem-sec"><span className="k">Band energy</span><BandSpark bands={s.bands} /></div>

        {s.balanceFlag && (
          <div className="stem-flag" style={{ '--t': ST_TIER[s.balanceFlag.tier] }}>
            <span className="d" /><span>{s.role[0].toUpperCase() + s.role.slice(1)} RMS is <b>{s.balanceFlag.observed.toFixed(1)} dB</b> — {s.balanceFlag.direction === 'too_high' ? 'hotter' : 'quieter'} than the {s.balanceFlag.range[0]}..{s.balanceFlag.range[1]} expected for this genre.</span>
          </div>
        )}
        {s.refDelta && (
          <div className="stem-flag ref" style={{ '--t': ST_TIER[s.refDelta.tier] }}>
            <span className="d" /><span>{s.refDelta.interpretation} <span className="mono dim">({s.refDelta.delta > 0 ? '+' : ''}{s.refDelta.delta.toFixed(1)} dB vs ref)</span></span>
          </div>
        )}

        {worstClash ? (
          <div className="stem-issue">
            <div className="si-hd"><span className="d" style={{ background: tier, boxShadow: `0 0 7px ${tier}` }} />Clash · vs {worstClash.vs} · {worstClash.band} band · overlap {worstClash.overlap}</div>
            {(s.role === 'kick' || s.role === 'bass') && <ClashOverlapViz clash={scenario.clashes[0]} compact />}
            {finding && (
              <button className="fbd-goact" style={{ marginTop: 10 }} onClick={() => onGoToFinding(finding.id)}>
                View the finding<Icon name="arrow" size={13} />
              </button>
            )}
          </div>
        ) : (
          <div className="fbd-nofix" style={{ marginTop: 14 }}><Icon name="check" size={14} />No clashes touch this role — level and width sit comfortably in the mix.</div>
        )}
      </div>
    </div>
  );
}

// ── Stems tab — master list (roles) + detail ──────────────────────────
function StemsTab({ scenario, onGoToFinding }) {
  const roles = scenario.stemsDetail || [];
  const fileCount = roles.reduce((n, r) => n + r.files.length, 0);
  const [selRole, setSelRole] = useStateSt(() => { const c = roles.find(r => r.clashes && r.clashes.length); return c ? c.role : (roles[0] && roles[0].role); });
  const sel = roles.find(r => r.role === selRole) || null;
  const clashCount = roles.filter(r => r.clashes && r.clashes.length).length;
  return (
    <div className="tabbody fade-up">
      <div className="fixboard">
        <div className="fb-list">
          <div className="fb-lh">
            <span className="t">Stems</span>
            <span className="stem-lh-meta mono">{fileCount} files → {roles.length} role buses · {clashCount} in a clash</span>
          </div>
          <div className="fb-scroll">
            {roles.map(r => {
              const wc = r.clashes && r.clashes[0];
              return (
                <button key={r.role} className={`fb-row${r.role === selRole ? ' on' : ''}`} style={{ '--sev': wc ? ST_TIER[wc.tier] : 'var(--accent)' }} onClick={() => setSelRole(r.role)}>
                  <span className="fr-dot" />
                  <span className="fr-b">
                    <span className="fr-head" style={{ textTransform: 'capitalize' }}>{r.role}</span>
                    <span className="fr-meta mono">{r.files.length === 1 ? r.files[0].name : r.files.length + ' files'} · {r.lufs.toFixed(1)} LUFS{r.isMono ? ' · mono' : ''}</span>
                  </span>
                  <span className="stem-rowlvl"><StemLevelBar v={r.rms} hot={!!wc} /></span>
                  {wc && <span className="stem-clashtag" style={{ color: ST_TIER[wc.tier], borderColor: 'color-mix(in srgb,' + ST_TIER[wc.tier] + ' 30%,transparent)', background: 'color-mix(in srgb,' + ST_TIER[wc.tier] + ' 12%,transparent)' }}>clash</span>}
                </button>
              );
            })}
          </div>
        </div>
        <StemDetail s={sel} scenario={scenario} onGoToFinding={onGoToFinding} />
      </div>
    </div>
  );
}

Object.assign(window, { StemsTab, StemDetail, ClashOverlapViz, BandSpark });
