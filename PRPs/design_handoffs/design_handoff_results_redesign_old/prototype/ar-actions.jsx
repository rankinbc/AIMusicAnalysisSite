/* spectre — Analysis Results redesign. Actions module (lives under the AI Coach chat).
   v1-style move cards: lead with the directive, then why / data / preset toggles.
   Checking a fix queues it for the Listen page (storage handoff) — no DSP here. */
const { useState: useStateAc } = React;

function MoveCard({ m, finding, bands, rack, added, onToggle, onGoToFinding }) {
  const [open, setOpen] = useStateAc(null);
  const toggle = (k) => setOpen(o => o === k ? null : k);
  const ev = m.evidence;
  const why = finding && finding.why;
  const hasPreset = rack && rack.length > 0;
  return (
    <div className="move" data-move-id={m.id} data-added={added ? 'true' : 'false'} style={{ '--sev': arSevColor(m.sev) }}>
      <div className="move-main">
        <div className="move-prob">
          <span className="mp-dot" />
          <button className="mp-head" onClick={() => onGoToFinding(m.findingId)} title="Jump to the finding this resolves">{m.findingHead}</button>
          <span className="mp-spacer" />
          {m.chip && <span className="mp-metric">{m.chip}</span>}
          <span className="mp-sev">{AR_SEV[m.sev].label}</span>
        </div>

        <div className="move-top"><div className="move-title">{m.title}</div></div>

        <Directive text={m.directive} scope={m.directional ? null : m.scope} className={m.directional ? 'directional' : ''} />

        <div className="move-foot">
          <span className="move-conf"><span className="cv">{Math.round(m.conf * 100)}%</span> conf</span>
          <span className={`move-src${m.source !== 'rule engine' ? ' ai' : ''}`}>{m.source}</span>
          {m.section && <span className="move-src">{m.section}</span>}
          <span className="spacer" />
          {why && <button className={`linkbtn${open === 'why' ? ' on' : ''}`} onClick={() => toggle('why')}>why <span className="chev">▾</span></button>}
          {ev && <button className={`linkbtn${open === 'data' ? ' on' : ''}`} onClick={() => toggle('data')}>data <span className="chev">▾</span></button>}
          {hasPreset && <button className={`linkbtn${open === 'preset' ? ' on' : ''}`} onClick={() => toggle('preset')}>suggested fix <span className="chev">▾</span></button>}
          <button className={`rack-toggle${added ? ' on' : ''}`} onClick={() => onToggle(m.id)} title="Queue this fix for the Listen page">
            <Icon name={added ? 'check' : 'plus'} size={13} />{added ? 'Added' : 'Add'}
          </button>
        </div>
      </div>

      {open && (
        <div className="move-expand fade-up">
          {open === 'why' && why && <div className="why-block"><span className="why-text">{finding.why}</span></div>}
          {open === 'data' && ev && (
            <div className="evidence">
              <div className="evidence-hd"><span className="lab">The data</span><span className="metric">{ev.label}<span className="path">{ev.path}</span></span></div>
              {ev.type === 'spectrum' && <MiniSpectrum bands={bands} warnIndex={ev.warnIndex} />}
              {ev.type === 'meter' && <MiniMeter value={ev.value} min={ev.min} max={ev.max} target={ev.target} targetLabel={ev.targetLabel} hot={ev.hot} />}
            </div>
          )}
          {open === 'preset' && hasPreset && (
            <div className="preset-block">
              <div className="pb-h">{m.directional ? 'Suggested approach · audition to dial in' : `Suggested fix${rack.length > 1 ? ' · rack' : ''}`}</div>
              <div className="preset-mods">{rack.map((rm, i) => <RackModule key={i} m={rm} />)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// The Actions module — rendered directly under the Coach chat.
function ActionsModule({ scenario, findings, selected, onToggle, onGoToFinding }) {
  const moves = scenario.moves.slice().sort((a, b) => AR_SEV[a.sev].rank - AR_SEV[b.sev].rank || b.conf - a.conf);
  if (moves.length === 0) {
    return (
      <div style={{ marginTop: 26 }}>
        <SecLabel hint="fixes">Recommended fixes</SecLabel>
        <div className="empty-state" style={{ padding: '28px 26px' }}>
          <div className="es-ic" style={{ color: 'var(--violet)', background: 'rgba(167,139,250,.08)', borderColor: 'rgba(167,139,250,.28)' }}><Icon name="wrench" size={20} /></div>
          <div className="es-t">No one-click fixes for this track</div>
          <div className="es-s">See Findings for the full picture, or ask the Coach to dig into a specific area.</div>
        </div>
      </div>
    );
  }
  const selCount = moves.filter(m => selected.has(m.id)).length;
  return (
    <div style={{ marginTop: 26 }}>
      <SecLabel hint={`${moves.length} fixes · ${selCount} queued for Listen`}>Recommended fixes</SecLabel>
      {moves.map(m => (
        <MoveCard key={m.id} m={m} finding={findings.find(f => f.id === m.findingId)} bands={scenario.bands}
          rack={arRack(scenario.id, m.id)} added={selected.has(m.id)} onToggle={onToggle} onGoToFinding={onGoToFinding} />
      ))}
    </div>
  );
}

Object.assign(window, { ActionsModule, MoveCard });
