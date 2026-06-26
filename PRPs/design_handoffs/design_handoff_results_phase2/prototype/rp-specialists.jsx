/* spectre — AI Analysis modal: which specialists were called (and why), plus the
 * roster still available to run. Opened from the AI Analysis button on Actions. */
const { useState: useStateSp } = React;

function SpecialistsModal({ onClose, credits, runs, ranIds, inputDepth, degraded, onRun }) {
  const [running, setRunning] = useStateSp(null);

  const depthOk = (s) => !s.needs || rpPresent(RP_DEPTH_RANK[s.needs], inputDepth);
  const ranViaDeepen = (s) => s.yields && ranIds.includes(s.yields);
  const effRan = (s) => {
    if (runs[s.slug] || ranViaDeepen(s)) return true;
    if (degraded) return s.slug === 'rule_engine';
    return s.ran && depthOk(s);
  };
  const called = RP_SPECIALISTS.filter(effRan);
  const available = RP_SPECIALISTS.filter(s => !effRan(s));

  const justRan = (s) => !!runs[s.slug] || ranViaDeepen(s);
  const resultOf = (s) => {
    if (runs[s.slug]?.outcome === 'move') return `added Move ${runs[s.slug].moveN}`;
    if (runs[s.slug]?.outcome === 'clean') return 'no new issues found';
    if (ranViaDeepen(s)) { const d = RP_DEEPEN.find(x => x.id === s.yields); return `added Move ${d.result.n}`; }
    return s.result || 'ran on demand';
  };

  const run = (s) => {
    if (running || credits < s.credits) return;
    setRunning(s.slug);
    setTimeout(() => { setRunning(null); onRun(s); }, 1400);
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="spec-modal" onClick={e => e.stopPropagation()}>
        <div className="spec-head">
          <div className="sh-ic"><Icon name="sparkle" size={17} /></div>
          <div className="sh-t">
            <div className="spec-kick">AI Analysis</div>
            <div className="spec-title">{called.length} specialist{called.length === 1 ? '' : 's'} ran · {available.length} available</div>
          </div>
          <span className="spec-credits mono"><b>{credits}</b> credits</span>
          <button className="gp-x" onClick={onClose}><Icon name="x" size={15} /></button>
        </div>

        <div className="spec-body">
          {degraded && (
            <div className="spec-degraded">
              <Icon name="layers" size={14} />
              Specialists are paused (budget) — only the rule engine ran. Resume to route the rest.
            </div>
          )}

          <div className="spec-sec-l">Called <span className="n">{called.length}</span> · why each ran</div>
          {called.map(s => (
            <div className="spec-row called" key={s.slug}>
              <span className="sr-dot done"><Icon name="check" size={11} /></span>
              <div className="sr-main">
                <div className="sr-head">
                  <span className="sr-label">{s.label}</span>
                  <span className="sr-group mono">{s.group}</span>
                  {s.free ? <span className="sr-tag free mono">free</span> : <span className="sr-tag mono">{s.credits} cr</span>}
                  {justRan(s) && <span className="sr-tag new mono">just ran</span>}
                </div>
                <div className="sr-why">{s.why || 'Ran on demand from this panel.'}</div>
                <div className="sr-result mono">→ {resultOf(s)}</div>
              </div>
            </div>
          ))}

          <div className="spec-sec-l">Available to run <span className="n">{available.length}</span></div>
          {available.map(s => {
            const ok = depthOk(s);
            const isRunning = running === s.slug;
            const afford = credits >= s.credits;
            return (
              <div className="spec-row avail" key={s.slug}>
                <span className="sr-dot" />
                <div className="sr-main">
                  <div className="sr-head">
                    <span className="sr-label">{s.label}</span>
                    <span className="sr-group mono">{s.group}</span>
                  </div>
                  <div className="sr-why">{s.blurb}</div>
                </div>
                {ok ? (
                  <button className={`sr-run${isRunning ? ' running' : ''}`} disabled={isRunning || !afford} onClick={() => run(s)} title={!afford ? 'Not enough credits' : ''}>
                    {isRunning
                      ? <><span className="eqdots"><i /><i /><i /></span>Running…</>
                      : <><Icon name="plus" size={12} />Run <span className="cr">{s.credits} cr</span></>}
                  </button>
                ) : (
                  <span className="sr-locked mono">needs {s.needs === 'als' ? '.als' : s.needs}</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="spec-foot">
          <span className="spec-note">26 specialists in the full catalog · no auto-spend</span>
          <span style={{ flex: 1 }} />
          <button className="btn sm primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SpecialistsModal });
