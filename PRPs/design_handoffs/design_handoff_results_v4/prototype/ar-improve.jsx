/* Improvement Plan tab — two sections: Listen in Studio (pick fixes/presets to
   audition on the Listen Rack page) and Create DAW Plan (the existing plan doc). */
const { useState: useStateIP } = React;

function ImprovementPlanTab({ scenario, findings, selected, userPresets, coachMixState, planLog, onOpenGamePlan, onGoToFinding, onGoToActions }) {
  const queued = scenario.moves.filter(m => selected.has(m.id));
  const [picks, setPicks] = useStateIP(() => new Set(queued.map(m => 'm:' + m.id)));
  const toggle = (k) => setPicks(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const presets = userPresets.slice();
  if (coachMixState === 'ready') presets.push({ id: 'coach', name: 'Coach Mix', moves: queued.map(m => m.id), coach: true });
  const nPicked = picks.size;
  const prOf = (m) => { const f = findings.find(x => x.fixId === m.id && x.pr); return f ? f.pr.score : null; };
  return (
    <div className="tabbody fade-up">
      <div className="ip-sec">
        <div className="ip-hd">
          <div>
            <div className="ip-k mono">Section 1 · hear it before you commit</div>
            <h3>Listen in Studio</h3>
            <p className="ip-sub">Pick the fixes and presets to take into the studio. They load onto the Listen rack with your picks pre-selected — toggle each one live against the mix.</p>
          </div>
          <a className={`ip-go${nPicked === 0 ? ' dim' : ''}`} href="Listen Rack.html" title={nPicked === 0 ? 'Pick at least one fix or preset' : `Open the Listen page with ${nPicked} ${nPicked === 1 ? 'pick' : 'picks'} pre-selected`}>
            <Icon name="play" size={13} />Listen in Studio{nPicked > 0 && <span className="n mono">{nPicked}</span>}
          </a>
        </div>
        <div className="ip-cols">
          <div>
            <div className="ip-collab mono">Active fixes <span className="c">{queued.length}</span></div>
            {queued.length === 0
              ? <div className="na"><Icon name="info" size={13} />No fixes queued — select them on the <button className="ip-lnk" onClick={onGoToActions}>Actions tab</button>.</div>
              : queued.map(m => (
                <label className="ip-row" key={m.id}>
                  <input type="checkbox" checked={picks.has('m:' + m.id)} onChange={() => toggle('m:' + m.id)} />
                  <span className="t">{m.title}</span>
                  {prOf(m) != null && <span className="pr mono">P{prOf(m)}</span>}
                  <span className="sc mono">{m.scope.startsWith('Master') ? 'Master' : m.scope}</span>
                </label>
              ))}
          </div>
          <div>
            <div className="ip-collab mono">Presets <span className="c">{presets.length}</span></div>
            {presets.length === 0
              ? <div className="na"><Icon name="info" size={13} />No presets yet — build one from queued fixes on the Actions tab.</div>
              : presets.map(p => (
                <label className="ip-row preset" key={p.id}>
                  <input type="checkbox" checked={picks.has('p:' + p.id)} onChange={() => toggle('p:' + p.id)} />
                  {p.coach
                    ? <img className="coach-ic" src="ar-assets/coach.svg" alt="" width="15" height="15" />
                    : <Icon name="sliders" size={13} />}
                  <span className="t">{p.name}</span>
                  <span className="sc mono">{p.moves.length} {p.moves.length === 1 ? 'fix' : 'fixes'}</span>
                </label>
              ))}
          </div>
        </div>
      </div>
      <div className="ip-div">
        <span className="mono">Section 2 · take it back to the DAW</span>
      </div>
      <DawPlanBody scenario={scenario} findings={findings} selected={selected} userPresets={userPresets} coachMixState={coachMixState} planLog={planLog} onOpenGamePlan={onOpenGamePlan} onGoToFinding={onGoToFinding} />
    </div>
  );
}

Object.assign(window, { ImprovementPlanTab });
