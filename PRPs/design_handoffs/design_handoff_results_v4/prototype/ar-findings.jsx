/* spectre — Analysis Results redesign. Findings tab (the diagnosis list).
   Severity-sorted, filterable by severity + group, evidence chips jump to Track Info,
   fixable findings bridge to Actions. */
const { useState: useStateFi } = React;

function SourceBadge({ source }) {
  if (source === 'ai') return <span className="src ai">AI</span>;
  return <span className="src measured">Measured</span>;
}

function FindingCard({ f, onEvidence, onGoToFix }) {
  const [why, setWhy] = useStateFi(false);
  const hasWhy = !!f.why;
  return (
    <div className="finding" data-finding-id={f.id} style={{ '--sev': arSevColor(f.sev) }}>
      <div className="finding-main">
        <div className="finding-top">
          <span className="sev-badge">{AR_SEV[f.sev].label}</span>
          <span className="finding-group">{f.group}</span>
          <span className="finding-spec"><SourceBadge source={f.source} /><span>{f.spec}</span></span>
        </div>
        <div className="finding-head">{f.headline}</div>
        <div className="finding-sum">{f.summary}</div>
        <div className="finding-foot">
          {f.evidence && f.evidence.map((e, i) => (
            e.anchor
              ? <button className="ev-chip" key={i} onClick={() => onEvidence(e.anchor)}><Icon name="anchor" size={11} /><span className="em">{e.label}</span></button>
              : <span className="ev-chip" key={i}><span className="em">{e.label}</span></span>
          ))}
          <span className="spacer" />
          {hasWhy && <button className={`why-toggle${why ? ' on' : ''}`} onClick={() => setWhy(w => !w)}>why it matters <span className="chev">▾</span></button>}
          {f.fixId && <button className="fixlink" onClick={() => onGoToFix(f.fixId)}>See fix in Actions <Icon name="arrow" size={13} /></button>}
        </div>
      </div>
      {why && hasWhy && (
        <div className="finding-why fade-up">
          <span className="q">?</span>
          <div className="wt">{f.why}{f.metric && <span className="metric">{f.metric}</span>}</div>
        </div>
      )}
    </div>
  );
}

function FindingsTab({ findings, degraded, onEvidence, onGoToFix }) {
  const [sevFilter, setSevFilter] = useStateFi('all');
  const [groupFilter, setGroupFilter] = useStateFi('all');

  // present severities + groups for filter chips
  const sevsPresent = ['critical', 'severe', 'moderate', 'minor', 'win'].filter(s => findings.some(f => f.sev === s));
  const groupsPresent = AR_GROUPS.filter(g => findings.some(f => f.group === g));

  let list = findings.slice().sort((a, b) => AR_SEV[a.sev].rank - AR_SEV[b.sev].rank);
  if (sevFilter !== 'all') list = list.filter(f => f.sev === sevFilter);
  if (groupFilter !== 'all') list = list.filter(f => f.group === groupFilter);

  const faultCount = findings.filter(f => f.sev !== 'win' && f.kind !== 'integrity').length;

  return (
    <div className="tabbody fade-up">
      {degraded && (
        <div className="banner degraded" style={{ marginBottom: 16 }}>
          <span className="bic"><Icon name="alert" size={16} /></span>
          <div className="bb"><div className="t">Rule-based findings only</div><div className="s">The AI specialists are paused (budget/outage) — you're seeing measured, deterministic findings. They still cover clipping, true-peak, loudness, mono and stereo.</div></div>
        </div>
      )}

      {faultCount === 0 && !degraded ? (
        <div className="empty-state">
          <div className="es-ic"><Icon name="check" size={22} /></div>
          <div className="es-t">No issues found</div>
          <div className="es-s">Nothing critical surfaced on this track. What&rsquo;s left is finishing, not fixing — check the wins below or ask the Coach.</div>
        </div>
      ) : (
        <>
          <div className="find-filters">
            <button className={`fpill${sevFilter === 'all' ? ' on' : ''}`} onClick={() => setSevFilter('all')}>All <span className="fn">{findings.length}</span></button>
            {sevsPresent.map(s => (
              <button key={s} className={`fpill${sevFilter === s ? ' on' : ''}`} onClick={() => setSevFilter(s)}>
                <span className="swatch" style={{ background: arSevColor(s) }} />{AR_SEV[s].label} <span className="fn">{findings.filter(f => f.sev === s).length}</span>
              </button>
            ))}
            <span className="find-sep">·</span>
            <button className={`fpill${groupFilter === 'all' ? ' on' : ''}`} onClick={() => setGroupFilter('all')}>All groups</button>
            {groupsPresent.map(g => (
              <button key={g} className={`fpill${groupFilter === g ? ' on' : ''}`} onClick={() => setGroupFilter(groupFilter === g ? 'all' : g)}>
                <span className="swatch" style={{ background: AR_GROUP_COLOR[g], borderRadius: '50%' }} />{g}
              </button>
            ))}
          </div>

          {list.length === 0
            ? <div className="na"><Icon name="info" size={14} />No findings match this filter.</div>
            : list.map(f => <FindingCard key={f.id} f={f} onEvidence={onEvidence} onGoToFix={onGoToFix} />)}
        </>
      )}
    </div>
  );
}

Object.assign(window, { FindingsTab, FindingCard });
