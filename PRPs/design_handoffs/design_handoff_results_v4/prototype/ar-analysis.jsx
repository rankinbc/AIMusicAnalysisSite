/* spectre — Analysis Results redesign. Analysis tab (SPECTR transparency):
   how SPECTR analyzed THIS track. Per-phase explainer cards, collapsed by default. */
const { useState: useStateAn } = React;

const AR_PHASE_STATE = {
  ok: { label: 'ok', color: 'var(--accent)' },
  skipped: { label: 'not applicable', color: 'var(--muted)' },
  failed: { label: 'failed', color: 'var(--red)' },
};

function PhaseStateTag({ status }) {
  const st = AR_PHASE_STATE[status] || AR_PHASE_STATE.ok;
  if (status === 'ok') return <span className="badge" style={{ color: 'var(--accent)', background: 'rgba(0,229,176,.1)', border: '1px solid rgba(0,229,176,.26)' }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />ok</span>;
  if (status === 'failed') return <span className="badge" style={{ color: 'var(--red)', background: 'rgba(244,63,94,.1)', border: '1px solid rgba(244,63,94,.3)' }}>failed</span>;
  return <span className="badge" style={{ color: 'var(--muted)', background: 'var(--card-2)', border: '1px solid var(--border-2)' }}>not applicable</span>;
}

// which phases expose a Re-run vs full Re-analyze vs Retry
function phaseControl(phase, status) {
  if (status === 'failed') return { label: 'Retry', icon: 'refresh' };
  if (phase === 1) return { label: 'Re-analyze (full)', icon: 'refresh' };
  if ([4, 5, 8].includes(phase)) return { label: 'Re-run this phase', icon: 'refresh' };
  return null;
}

function PhaseCard({ p, onAddInput }) {
  const [open, setOpen] = useStateAn(false);
  const ctl = phaseControl(p.phase, p.status);
  const skipped = p.status === 'skipped';
  const addKey = p.phase === 5 ? 'ref' : p.phase === 8 ? 'als' : p.phase === 4 ? 'stems' : null;
  return (
    <div className={`phase-card ${p.status}`}>
      <button className="pc-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="pc-num">{p.phase}</span>
        <div className="pc-htext">
          <div className="pc-name">{p.friendly}</div>
          <div className="pc-measures">{p.measures}</div>
        </div>
        <span className="pc-state"><PhaseStateTag status={p.status} /></span>
        <span className="pc-chev"><Icon name="chevron" size={16} /></span>
      </button>
      {open && (
        <div className="pc-body fade-up">
          {p.values && p.values.length > 0 && (
            <div className="pc-value">
              {p.values.map((v, i) => <span className="pc-vchip" key={i}><span className="k">{v.k}</span><span className={`v${v.accent ? ' accent' : ''}`}>{v.v}</span></span>)}
            </div>
          )}
          <div className="pc-meaning"><span className="q">i</span><span>{p.meaning}</span></div>
          <div className="pc-controls">
            {skipped && addKey
              ? <button className="btn sm" onClick={() => onAddInput(addKey)}><Icon name="plus" size={13} />Add {addKey === 'ref' ? 'reference' : addKey === 'als' ? '.als' : 'stems'}</button>
              : ctl && <button className="btn sm"><Icon name={ctl.icon} size={13} />{ctl.label}</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function AnalysisTab({ scenario, onGoToDebug, onAddInput }) {
  const phases = scenario.phases;
  const okCount = phases.filter(p => p.status === 'ok').length;
  return (
    <div className="tabbody fade-up">
      <p className="tab-intro">
        <b>How SPECTR analyzed {scenario.track.name}.</b> Each stage runs independently and explains what it measured on <span className="accent">your</span> track — not a stats dump. The numbers live in Track Info; the raw inputs and outputs live in Debug.
      </p>

      <div className="an-pipe">
        <span className="pl-label">pipeline</span>
        {phases.map((p, i) => (
          <React.Fragment key={p.phase}>
            {i > 0 && <span className="an-pedge" />}
            <span className={`an-pnode ${p.status}`} title={`${p.friendly} · ${p.status}`} />
          </React.Fragment>
        ))}
        <button className="pl-link" onClick={onGoToDebug}>view pipeline <Icon name="arrow" size={11} /></button>
      </div>

      <div className="tab-intro" style={{ marginBottom: 14 }}>
        SPECTR ran <b style={{ fontFamily: "'JetBrains Mono',monospace", color: 'var(--accent)' }}>{okCount}</b> of {phases.length} analyses on this track. {phases.length - okCount > 0 && <span style={{ color: 'var(--muted)' }}>The rest are not applicable to your current inputs — expand them to see why.</span>}
      </div>

      {phases.map(p => <PhaseCard key={p.phase} p={p} onAddInput={onAddInput} />)}
    </div>
  );
}

Object.assign(window, { AnalysisTab, PhaseCard });
