/* spectre — Analysis Results redesign. AI Coach tab + Specialist Team modal.
   Grounded chat (templated, not a live LLM) + on-demand specialist runs whose results
   drop a templated line into the chat and bump the Findings vital. */
const { useState: useStateCo, useEffect: useEffectCo, useRef: useRefCo } = React;

// ── Specialist Team modal ────────────────────────────────────────────
function SpecialistModal({ runState, hasStems, credits, suggestedCount, findings, onRun, onClose }) {
  const ran = AR_SPECIALISTS.filter(s => runState[s.slug]?.status === 'cached');
  const available = AR_SPECIALISTS.filter(s => runState[s.slug]?.status !== 'cached' && !(s.needsStems && !hasStems));
  const suggested = available.filter(s => runState[s.slug]?.status !== 'running').slice(0, suggestedCount || 5);
  const [selSlug, setSelSlug] = useStateCo(suggested[0]?.slug || null);
  const [ranOpen, setRanOpen] = useStateCo(false);
  const selSpec = AR_SPECIALISTS.find(s => s.slug === selSlug) || null;
  const [triageOpen, setTriageOpen] = useStateCo(false);

  const GROUP_DESC = {
    Spectrum: 'Scans the frequency spectrum for imbalances, masking and resonances.',
    Loudness: 'Checks levels, headroom and loudness targets across platforms.',
    Dynamics: 'Looks at compression, punch and dynamic range over time.',
    Stereo: 'Analyzes stereo width, phase and mono compatibility.',
    Sections: 'Compares energy and contrast between song sections.',
    Stems: 'Digs into individual stems — requires a stems upload.',
    Misc: 'Specialized one-off checks that don’t fit the other groups.',
  };

  const Tile = ({ s }) => {
    const rs = runState[s.slug];
    const locked = s.needsStems && !hasStems;
    const status = locked ? 'locked' : rs?.status || 'idle';
    const found = rs?.found;
    const color = AR_GROUP_COLOR[s.group];
    return (
      <button className={`spec-tile${s.slug === selSlug ? ' sel' : ''}`} data-status={status}
        onClick={() => setSelSlug(s.slug)}>
        {found > 0 && <span className="spec-found">{found}</span>}
        <SpecAvatar icon="robot" color={color} />
        <span className="spec-tn">{s.label}</span>
        {status === 'running' ? <span className="spec-st run"><span className="eqdots"><i /><i /><i /><i /></span></span>
          : status === 'cached' ? <span className="spec-st">{found > 0 ? `${found} found` : 'cached'}</span>
          : status === 'locked' ? <span className="spec-st">needs stems</span>
          : <span className="spec-st" style={{ color: 'var(--accent)' }}>1 cr</span>}
      </button>
    );
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal spec-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-hd">
          <div className="mt"><div className="mk">AI Coach · on-demand</div><div className="mn">Specialist Team</div></div>
          <button className="modal-x" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body">
          <button className="triage" onClick={() => setTriageOpen(o => !o)}>
            <span className="tri-ic"><Icon name="sparkle" size={13} /></span>
            <span className="tri-l">AI triage</span>
            <span className="tri-sub">why these {suggested.length} specialists were suggested</span>
            <span className="tri-chev">{triageOpen ? '▾' : '▸'}</span>
          </button>
          {triageOpen && <div className="triage-body fade-up">
            <p>The coach ranked the full roster against this track’s measured profile and surfaced the {suggested.length} most likely to find something. Weighted by: the critical true-peak clipping and hot loudness (Loudness, Gain Staging), the low-mid / air imbalance vs the trance profile (Frequency Balance, Low End), the kick×bass overlap in the stems (Frequency Collisions), and the near-mono breakdown (Stereo Field). Genre-arrangement and dynamics checks scored lower and sit further down.</p>
            <p className="tri-note">Running a suggested specialist costs 1 credit and drops its result into the chat and the Findings tab.</p>
          </div>}
          <p className="tab-intro" style={{ margin: '14px 0 16px' }}>
            {AR_SPECIALISTS.length} specialists across 7 groups. Already-run ones are cached; run another to surface new findings — results drop into the chat and the Findings tab.
          </p>
          <div className="spec-groups">
            {suggested.length > 0 && (
              <div className="spec-group suggested">
                <div className="sg-h"><span className="sg-dot" style={{ background: 'var(--accent)' }} /><span className="sg-n">Suggested for this track</span><span className="sg-c">{suggested.length}</span></div>
                <p className="sg-why">Picked by the coach from this track’s measured profile — the true-peak clipping and hot loudness, the low-mid / air imbalance vs the trance reference, and the kick×bass overlap each scored these {suggested.length} highest for likely new findings.</p>
                <div className="spec-grid">{suggested.map(s => <Tile key={s.slug} s={s} />)}</div>
              </div>
            )}
            {AR_GROUPS.map(group => {
              const members = AR_SPECIALISTS.filter(s => s.group === group);
              const color = AR_GROUP_COLOR[group];
              return (
                <div className="spec-group" key={group}>
                  <div className="sg-h"><span className="sg-dot" style={{ background: color }} /><span className="sg-n">{group}</span><span className="sg-c">{members.length}</span></div>
                  <div className="spec-grid">{members.map(s => <Tile key={s.slug} s={s} />)}</div>
                </div>
              );
            })}
            {ran.length > 0 && (
              <div className="spec-group">
                <button className="sg-h sg-toggle" onClick={() => setRanOpen(o => !o)}><span className="sg-dot" style={{ background: 'var(--text-2)' }} /><span className="sg-n">Already run</span><span className="sg-c">{ran.length}</span><span className="sg-chev">{ranOpen ? '▾' : '▸'}</span></button>
                {ranOpen && <div className="spec-ranlist boxed">
                  {ran.map(s => {
                    const hits = (findings || []).filter(f => f.spec === s.label);
                    return (
                      <div className="spec-ranrow" key={s.slug}>
                        <SpecAvatar icon="robot" color={AR_GROUP_COLOR[s.group]} size={22} />
                        <span className="srr-n">{s.label}</span>
                        <span className="srr-res">{hits.length > 0 ? hits.map(h => h.headline).join(' · ') : ''}</span>
                        <span className="srr-found">{hits.length} finding{hits.length === 1 ? '' : 's'}</span>
                      </div>
                    );
                  })}
                </div>}
              </div>
            )}
          </div>
        </div>
        <div className="spec-selbar">
          {selSpec ? (() => {
            const rs = runState[selSpec.slug];
            const locked = selSpec.needsStems && !hasStems;
            const status = locked ? 'locked' : rs?.status || 'idle';
            return (
              <>
                <SpecAvatar icon="robot" color={AR_GROUP_COLOR[selSpec.group]} size={34} />
                <div className="ssb-b">
                  <div className="ssb-n">{selSpec.label} <span className="ssb-g">{selSpec.group}</span></div>
                  <div className="ssb-d">{GROUP_DESC[selSpec.group]}{status === 'cached' ? ` · already run${rs?.found > 0 ? ` — ${rs.found} finding${rs.found === 1 ? '' : 's'}` : ''}.` : locked ? ' · locked — upload stems to enable.' : ''}</div>
                </div>
                {status === 'running'
                  ? <span className="ssb-run running"><span className="eqdots"><i /><i /><i /></span>Running…</span>
                  : <button className="ssb-run" disabled={status !== 'idle'} onClick={() => onRun(selSpec.slug)}><Icon name="bolt" size={13} />{status === 'cached' ? 'Cached' : locked ? 'Needs stems' : 'Run · 1 cr'}</button>}
              </>
            );
          })() : <span className="ssb-d">Select a specialist to see its details.</span>}
        </div>
        <div className="spec-foot">
          <span className="sf-note"><span className="v">{ran.length}</span> ran · <span className="v">{available.length}</span> available{!hasStems && <span> · stem specialists locked</span>}</span>
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
      </div>
    </div>
  );
}

function CoachTab({ scenario, messages, onSend, runCount, onOpenSpecialists, coachMixState, onGenerateCoachMix, fixCount, queued }) {
  const [draft, setDraft] = useStateCo('');
  const [mode, setMode] = useStateCo('Normal');
  const [cmOpen, setCmOpen] = useStateCo(false);
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
          <CoachBot size={26} />
          <div className="ch-b">
            <div className="ch-k"><span className="led" /><span className="lab">Ask the Coach</span>
              <span className="ch-modes">{['Concise', 'Normal', 'Teach'].map(m => <button key={m} className={`ch-mode${mode === m ? ' on' : ''}`} onClick={() => setMode(m)}>{m}</button>)}</span>
            </div>
            <div className="ch-sub">I know everything about this song.</div>
          </div>
          <div className="coach-actions">
            {!coachMixReady && <button className="spec-btn cmix" disabled={coachMixGenerating || fixCount === 0} onClick={() => setCmOpen(true)}>
              {coachMixGenerating ? <span className="cmg-spin" /> : <Icon name="cassette" size={13} />}{coachMixGenerating ? 'Compiling…' : 'Coach Mix'}
            </button>}
            <button className="spec-btn" onClick={onOpenSpecialists}>
              <Icon name="robot" size={13} />Specialists
            </button>
          </div>
        </div>
        <div className="coach-body">
          <div className="coach-thread" ref={threadRef}>
            {messages.map((m, i) => <CoachMsg key={i} m={m} />)}
          </div>
          <div className="coach-input">
            <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Ask the coach about this mix…" />
            <button className="send" onClick={() => send()}><Icon name="send" size={16} /></button>
          </div>
          <div className="coach-cap">grounded · <span className="v">18</span>/20 messages today · {runCount} specialists ran · {Math.min(runCount, suggested)}/{suggested} suggested</div>
        </div>
        {cmOpen && <CoachMixConfirmModal scenario={scenario} queued={queued || []} onCreate={() => { setCmOpen(false); onGenerateCoachMix(); }} onClose={() => setCmOpen(false)} />}
      </div>
  );
}

// ── Coach Mix confirm — what it's about to do + create ──
function CoachMixConfirmModal({ scenario, queued, onCreate, onClose }) {
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" style={{ width: 'min(480px,100%)' }} onClick={e => e.stopPropagation()}>
        <div className="modal-hd">
          <div className="mt"><div className="mk">Coach Mix</div><div className="mn">Solve your fixes into one chain</div></div>
          <button className="modal-x" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body">
          <p className="tab-intro" style={{ margin: '0 0 12px' }}>The coach takes your {queued.length} queued {queued.length === 1 ? 'fix' : 'fixes'}, orders them into one gain-staged device chain, and saves it as a preset in <b>Send to Listen</b> — audition the whole mix at once instead of one fix at a time.</p>
          <div className="cmc-list">
            {queued.map((m, i) => <div className="cmc-row" key={m.id}><span className="n mono">{i + 1}</span><span className="t">{m.title}</span><span className="devs mono">{arRack(scenario.id, m.id).map(rm => rm.mod).join(' → ') || 'directional'}</span></div>)}
          </div>
          <p className="cmc-note">Changing your queued fixes later invalidates the mix — just regenerate it.</p>
        </div>
        <div className="spec-foot">
          <span className="sf-note"><span className="v">{queued.length}</span> {queued.length === 1 ? 'fix' : 'fixes'} → 1 preset</span>
          <button className="btn primary sm" onClick={onCreate}><Icon name="bolt" size={13} />Create preset · 1 cr</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SpecialistModal, CoachTab, CoachMsg, CoachMixConfirmModal });
