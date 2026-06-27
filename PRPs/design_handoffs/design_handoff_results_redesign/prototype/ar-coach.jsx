/* spectre — Analysis Results redesign. AI Coach tab + Specialist Team modal.
   Grounded chat (templated, not a live LLM) + on-demand specialist runs whose results
   drop a templated line into the chat and bump the Findings vital. */
const { useState: useStateCo, useEffect: useEffectCo, useRef: useRefCo } = React;

// ── Specialist Team modal ────────────────────────────────────────────
function SpecialistModal({ runState, hasStems, credits, onRun, onClose }) {
  const ran = AR_SPECIALISTS.filter(s => runState[s.slug]?.status === 'cached').length;
  const available = AR_SPECIALISTS.filter(s => runState[s.slug]?.status !== 'cached' && !(s.needsStems && !hasStems)).length;

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal spec-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-hd">
          <div className="mt"><div className="mk">AI Coach · on-demand</div><div className="mn">Specialist Team</div></div>
          <button className="modal-x" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body">
          <p className="tab-intro" style={{ margin: '0 0 16px' }}>
            {AR_SPECIALISTS.length} specialists across 7 groups. Already-run ones are cached; run another to surface new findings — results drop into the chat and the Findings tab.
          </p>
          <div className="spec-groups">
            {AR_GROUPS.map(group => {
              const members = AR_SPECIALISTS.filter(s => s.group === group);
              const color = AR_GROUP_COLOR[group];
              return (
                <div className="spec-group" key={group}>
                  <div className="sg-h"><span className="sg-dot" style={{ background: color }} /><span className="sg-n">{group}</span><span className="sg-c">{members.length}</span></div>
                  <div className="spec-grid">
                    {members.map(s => {
                      const rs = runState[s.slug];
                      const locked = s.needsStems && !hasStems;
                      const status = locked ? 'locked' : rs?.status || 'idle';
                      const found = rs?.found;
                      return (
                        <button key={s.slug} className="spec-tile" data-status={status}
                          onClick={() => status === 'idle' && onRun(s.slug)} disabled={status !== 'idle'}>
                          {found > 0 && <span className="spec-found">{found}</span>}
                          <SpecAvatar icon={s.icon} color={color} />
                          <span className="spec-tn">{s.label}</span>
                          {status === 'running' ? <span className="spec-st run"><span className="eqdots"><i /><i /><i /><i /></span></span>
                            : status === 'cached' ? <span className="spec-st">{found > 0 ? `${found} found` : 'cached'}</span>
                            : status === 'locked' ? <span className="spec-st">needs stems</span>
                            : <span className="spec-st" style={{ color: 'var(--accent)' }}>run · 1 cr</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="spec-foot">
          <span className="sf-note"><span className="v">{ran}</span> ran · <span className="v">{available}</span> available{!hasStems && <span> · stem specialists locked</span>}</span>
          <span className="sf-note"><span className="v">{credits}</span> credits</span>
        </div>
      </div>
    </div>
  );
}

// ── Coach tab ────────────────────────────────────────────────────────
function CoachMsg({ m }) {
  if (m.role === 'specialist') {
    return (
      <div className="cmsg specialist">
        <span className="spec-av"><Icon name="robot" size={16} /></span>
        <div className="cmsg-c">
          <div className="bub"><span className="spec-name">{m.spec} Specialist:</span> {m.text}</div>
        </div>
      </div>
    );
  }
  return (
    <div className={`cmsg ${m.role}`}>
      <div className="cmsg-c">
        <div className="bub" dangerouslySetInnerHTML={{ __html: m.html || m.text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>') }} />
        {m.gnd && m.gnd.length > 0 && <div className="gnd">{m.gnd.map((g, i) => <span className="gch" key={i}>{g}</span>)}</div>}
      </div>
    </div>
  );
}

function CoachTab({ scenario, messages, onSend, runCount, onOpenSpecialists, coachMixState, onGenerateCoachMix, fixCount }) {
  const [draft, setDraft] = useStateCo('');
  const threadRef = useRefCo(null);
  useEffectCo(() => { const el = threadRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages]);

  const hasUserMsg = messages.some(m => m.role === 'user');
  const suggested = scenario.specSuggested ?? 5;
  const coachMixReady = coachMixState === 'ready';
  const coachMixGenerating = coachMixState === 'generating';
  const send = (text) => { const t = (text ?? draft).trim(); if (!t) return; onSend(t); setDraft(''); };

  return (
    <div className="coach-wrap">
        <div className="coach-hd">
          <CoachBot size={50} />
          <div className="ch-b">
            <div className="ch-k"><span className="led" /><span className="lab">Ask the Coach</span></div>
            <div className="ch-name">Ask anything about this mix</div>
            <div className="ch-sub">I’ve seen every metric on {scenario.track.name}. Got any questions?</div>
          </div>
          <div className="coach-actions">
            <button className="spec-btn" onClick={onOpenSpecialists}>
              <Icon name="users" size={15} />Specialist Team
              <span className="sb-counts">
                <span className="cnt">{runCount} run</span>
                <span className="cnt sug">{suggested} suggested</span>
              </span>
            </button>
            <button className={`genmix-btn${coachMixReady ? ' ready' : ''}`} onClick={onGenerateCoachMix} disabled={fixCount === 0 || coachMixGenerating}>
              {coachMixGenerating ? <><span className="eqdots"><i /><i /><i /></span>Compiling…</>
                : coachMixReady ? <><Icon name="refresh" size={14} />Regenerate Coach Mix</>
                : <><Icon name="cassette" size={15} />Generate Coach Mix</>}
            </button>
          </div>
        </div>
        <div className="coach-body">
          {messages.length > 0 && (
            <div className={`coach-thread${hasUserMsg ? ' expanded' : ''}`} ref={threadRef}>
              {messages.map((m, i) => <CoachMsg key={i} m={m} />)}
            </div>
          )}
          <div className="coach-input">
            <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Ask the coach about this mix…" />
            <button className="send" onClick={() => send()}><Icon name="send" size={16} /></button>
          </div>
          <div className="coach-cap">grounded · <span className="v">18</span>/20 messages today</div>
        </div>
      </div>
  );
}

Object.assign(window, { SpecialistModal, CoachTab, CoachMsg });
