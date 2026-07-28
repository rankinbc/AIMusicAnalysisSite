/* spectre — Analysis Results redesign. Actions bar (Try Fixes · Create Preset · Coach Mix)
   + the Create DAW Plan tab: the takeaway document built from presets / fixes / notes. */
const { useState: useStateDP } = React;

// ── Actions bar — three ways to act on the queue; everything logs to the DAW Plan ─
function ActionsBar({ queuedCount, onCreatePreset, coachMixState, onGenerateCoachMix, onTryFixes, onGoPlan, planCount }) {
  const gen = coachMixState === 'generating';
  return (
    <div className="axbar">
      <a className="axbtn gloss" href="Listen Page.html" onClick={onTryFixes}>
        <Icon name="play" size={13} />Try Fixes
        <span className="gtip">Opens <b>Listen</b> with your {queuedCount} queued {queuedCount === 1 ? 'fix' : 'fixes'} — toggle each one on and off while the track plays to hear exactly what it changes.</span>
      </a>
      <button className="axbtn gloss" onClick={onCreatePreset}>
        <Icon name="cassette" size={13} />Create Preset
        <span className="gtip">Combines the selected fixes into one rack preset — audition the whole stack as a single chain instead of one fix at a time.</span>
      </button>
      <button className="axbtn vio gloss" onClick={onGenerateCoachMix} disabled={gen}>
        <img src="ar-assets/coach.svg" alt="" width="16" height="16" />{gen ? 'Mixing…' : 'Coach Mix'}
        <span className="gtip">The coach decides which moves from your fix list belong together and solves them into one gain-staged preset for you to try.</span>
      </button>
      <button className="axnote gloss" onClick={onGoPlan}>
        <Icon name="download" size={12} />Everything you do here is recorded into your <b>DAW Plan</b>{planCount > 0 ? ` (${planCount})` : ''} →
        <span className="gtip">Each preset you create and each audition is logged — the Create DAW Plan tab turns it into a step-by-step document with the exact devices modified, plus the manual notes you kept selected.</span>
      </button>
    </div>
  );
}

// ── Create DAW Plan tab ────────────────────────────────────────────────
function DawPlanTab(props) { return <div className="tabbody fade-up"><DawPlanBody {...props} /></div>; }

function DawPlanBody({ scenario, findings, selected, userPresets, coachMixState, planLog, onOpenGamePlan, onGoToFinding }) {
  const [src, setSrc] = useStateDP('fixes');
  const [view, setView] = useStateDP('moves');
  const queued = scenario.moves.filter(m => selected.has(m.id));
  const notes = findings.filter(f => !f.fixId && f.sev !== 'win' && selected.has(f.id));
  const preset = userPresets.find(p => p.id === src);
  const coach = src === 'coach';
  const moves = preset ? scenario.moves.filter(m => preset.moves.includes(m.id)) : queued;
  const prOf = (m) => { const f = findings.find(x => x.fixId === m.id && x.pr); return f ? f.pr.score : null; };
  const worst = findings.filter(f => ['critical', 'severe'].includes(f.sev)).slice(0, 3);
  const devices = [];
  moves.forEach(m => (arRack(scenario.id, m.id) || []).forEach(rm => { if (!devices.includes(rm.mod)) devices.push(rm.mod); }));
  const srcLabel = preset ? `preset “${preset.name}”` : coach ? 'the Coach Mix preset' : `${moves.length} selected ${moves.length === 1 ? 'fix' : 'fixes'}`;
  return (
      <div className="dp-grid">
        <div className="dp-doc">
          <div className="dp-hd">
            <div>
              <div className="dp-k mono">DAW plan · {scenario.track.name} {scenario.track.version}</div>
              <h3>Take {srcLabel} back to your DAW</h3>
            </div>
            <button className="fbd-goact" onClick={onOpenGamePlan}><Icon name="download" size={13} />Export</button>
          </div>

          <SecLabel hint={`${worst.length} that matter most`}>Key takeaways</SecLabel>
          <div className="dp-takes">
            {worst.map(f => (
              <button key={f.id} className="dp-take" style={{ '--sev': arSevColor(f.sev) }} onClick={() => onGoToFinding(f.id)}>
                <span className="d" /><span className="b"><span className="h">{f.headline}</span><span className="s">{f.why || f.summary}</span></span>
              </button>
            ))}
          </div>

          <div className="dp-viewrow">
            <SecLabel hint={devices.length ? `devices touched: ${devices.join(' · ')}` : 'nothing selected yet'}>{view === 'moves' ? 'The moves' : 'What to do, device by device'}</SecLabel>
            <div className="dp-vt">
              <button className={view === 'moves' ? 'on' : ''} onClick={() => setView('moves')} title="One entry per fix, in priority order">By move</button>
              <button className={view === 'devices' ? 'on' : ''} onClick={() => setView('devices')} title="Grouped by target — Master first — with every change per device">Per device</button>
            </div>
          </div>
          {moves.length === 0
            ? <div className="na"><Icon name="info" size={14} />Nothing queued — check fixes on the Actions tab and they show up here.</div>
            : view === 'moves' ? moves.slice().sort((a, b) => (prOf(b) || 0) - (prOf(a) || 0)).map((m, i) => (
              <div className="dp-move" key={m.id}>
                <span className="n mono">{String(i + 1).padStart(2, '0')}</span>
                <div className="b">
                  <div className="t">{m.title}{prOf(m) != null && <span className="pr mono gloss">P{prOf(m)}<span className="gtip">Priority {prOf(m)} on the raw 20–300 scale — the plan is ordered by it, highest first.</span></span>}<span className="sc mono">{m.scope}</span></div>
                  <Directive text={m.directive} scope={null} className={m.directional ? 'directional' : ''} />
                  <div className="dp-devs">{(arRack(scenario.id, m.id) || []).map((rm, k) => <span key={k} className="dp-dev mono">{rm.mod}{rm.sub ? ` · ${rm.sub}` : ''}</span>)}</div>
                  {m.ab && scenario.inputs.als.on && <div className="dp-ab mono"><Icon name="folder" size={11} />{m.ab}</div>}
                </div>
              </div>
            )) : (() => {
              // group by target scope — Master sections first, then stems/buses
              const byTarget = {};
              moves.forEach(m => (arRack(scenario.id, m.id) || []).forEach(rm => {
                (byTarget[m.scope] = byTarget[m.scope] || []).push({ m, rm });
              }));
              const targets = Object.keys(byTarget).sort((a, b) => (b.startsWith('Master') ? 1 : 0) - (a.startsWith('Master') ? 1 : 0));
              return targets.map(tg => (
                <div className="dp-target" key={tg}>
                  <div className="dp-tg-h"><span className="nm">{tg}</span><span className="c mono">{byTarget[tg].length} {byTarget[tg].length === 1 ? 'change' : 'changes'}</span></div>
                  {byTarget[tg].map(({ m, rm }, k) => (
                    <div className="dp-devrow" key={k}>
                      <span className="dev mono">{rm.mod}</span>
                      <div className="b">
                        <span className="ps mono">{Object.entries(rm.params || {}).map(([pk, pv]) => `${pk}: ${pv}`).join(' · ')}</span>
                        {m.ab && scenario.inputs.als.on && <span className="ab"><Icon name="folder" size={10} />{m.ab}</span>}
                        <span className="why">← {m.title}{prOf(m) != null && <span className="pr mono"> · P{prOf(m)}</span>}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ));
            })()}

          {scenario.timedEvents && scenario.timedEvents.length > 0 && <React.Fragment>
            <SecLabel hint="where in the track to listen">Timestamped</SecLabel>
            <div className="dp-times">
              {scenario.timedEvents.map((e, i) => (
                <button className="dp-time" key={i} onClick={() => e.ref && onGoToFinding(e.ref)} title={e.ref ? 'Open the related finding' : undefined}>
                  <span className="t mono">{e.t}</span><span className="x">{e.label}</span>{e.ref && <Icon name="arrow" size={10} />}
                </button>
              ))}
            </div>
          </React.Fragment>}

          {notes.length > 0 && <React.Fragment>
            <SecLabel hint="manual moves — no device chain">Notes you kept</SecLabel>
            {notes.map(f => (
              <div className="dp-move note" key={f.id}>
                <span className="n mono">✎</span>
                <div className="b">
                  <div className="t">{f.headline}</div>
                  <p className="dp-tip">{f.tip || AR_GROUP_TIP[f.group] || f.summary}</p>
                </div>
              </div>
            ))}
          </React.Fragment>}
        </div>

        <aside className="dp-side">
          <div className="dp-sc">
            <div className="dp-sc-h">Build the plan from</div>
            <button className={`dp-src${src === 'fixes' ? ' on' : ''}`} onClick={() => setSrc('fixes')}>
              <span className="d" /><span className="nm">Selected fixes</span><span className="c mono">{queued.length}</span>
            </button>
            {userPresets.map(p => (
              <button key={p.id} className={`dp-src${src === p.id ? ' on' : ''}`} onClick={() => setSrc(p.id)}>
                <span className="d" /><span className="nm">{p.name}</span><span className="c mono">{p.moves.length} fixes</span>
              </button>
            ))}
            {coachMixState === 'ready' && (
              <button className={`dp-src vio${coach ? ' on' : ''}`} onClick={() => setSrc('coach')}>
                <span className="d" /><span className="nm">Coach Mix</span><span className="c mono">auto</span>
              </button>
            )}
            {userPresets.length === 0 && coachMixState !== 'ready' && <p className="dp-empty mono">No presets yet — Create Preset or Coach Mix on the Actions tab adds them here.</p>}
          </div>
          <div className="dp-sc">
            <div className="dp-sc-h">Activity log</div>
            {planLog.length === 0
              ? <p className="dp-empty mono">Nothing recorded yet.</p>
              : planLog.slice().reverse().map((e, i) => <div key={i} className="dp-log"><span className="t mono">{e.time}</span><span className="x">{e.text}</span></div>)}
          </div>
        </aside>
      </div>
  );
}

Object.assign(window, { ActionsBar, DawPlanTab, DawPlanBody });
