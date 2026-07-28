/* spectre — Analysis Results redesign. FixBoard: master-detail board that merges the
   diagnosis (findings) and the fixes into one compact surface. A dense, scrollable list
   of findings on the left; selecting one shows its full detail (problem + fix + data +
   suggested rack) in a sticky panel on the right. Handles 20+ fixes without endless
   scroll. Checking a fix queues it for the Listen page (storage handoff) — no DSP here. */
const { useState: useStateAc, useEffect: useEffectAc } = React;

function FbSource({ source }) {
  return source === 'ai'
    ? <span className="src ai gloss">AI<span className="gtip">Surfaced by an AI specialist reading the measurements — an interpretation, so treat it as a strong suggestion rather than a hard number.</span></span>
    : <span className="src measured gloss">Measured<span className="gtip">Computed directly from your audio by the analysis engine — a hard number, the same every time it runs.</span></span>;
}

// General per-group tips for note-only items (manual DAW moves, no device chain)
const AR_GROUP_TIP = {
  Spectrum: 'Sweep a narrow EQ boost across the suspect range to find the exact spot, then cut there gently (wide Q, 1–3 dB). Re-check against a reference after each pass.',
  Loudness: 'Work the gain staging before the limiter: trim channel levels so the master peaks around −6 dBFS, then let the limiter do only the last 2–3 dB.',
  Dynamics: 'Ease off the heaviest compressor (slower attack, 2–3 dB less reduction) and automate levels instead — movement you ride by hand always sounds more alive.',
  Stereo: 'Keep everything below ~120 Hz mono, push width in pads/FX with mid-side EQ, and A/B the mono sum so nothing collapses on club systems.',
  Sections: 'Compare the energy of each section against the drop: mute busses per section until the arrangement breathes — contrast is what makes the drop land.',
  Stems: 'Solo the two stems together and carve complementary pockets: cut in one where the other lives, or sidechain the sustained part to the transient one.',
  Misc: 'Bounce a snapshot, take 20 minutes away, and A/B against two reference tracks at matched loudness — fresh ears find these faster than tools.',
};

// ── Source tag — who produced this finding, with a plain-language tooltip ─
function SourceTag({ source, spec }) {
  const ai = source === 'ai';
  const label = spec || (ai ? 'AI specialist' : 'Measured');
  const tip = ai
    ? `Source: ${spec ? spec + ' specialist' : 'AI specialist'} — an AI read of the measurements, so treat it as a strong suggestion rather than a hard number.`
    : `Source: ${spec ? spec + ' · ' : ''}rule engine — measured directly from your audio by the analysis engine. A hard number, the same every time it runs.`;
  return (
    <span className={`src-tag gloss${ai ? ' ai' : ''}`}>
      <span className="sk">Source:</span><Icon name={ai ? 'robot' : 'chart'} size={12} />{label}
      <span className="gtip">{tip}</span>
    </span>
  );
}
const GLOSS_RE = new RegExp('(' + AR_GLOSSARY.map(([t]) => t.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|') + ')', 'gi');
function Glossify({ text }) {
  if (!text) return null;
  const parts = String(text).split(GLOSS_RE);
  return <React.Fragment>{parts.map((p, i) => {
    const def = AR_GLOSSARY.find(([t]) => t.toLowerCase() === p.toLowerCase());
    return def ? <span key={i} className="gloss term">{p}<span className="gtip">{def[1]}</span></span> : p;
  })}</React.Fragment>;
}

// ── Group chip — color-coded by finding group, tooltip explains the group ─
function GroupChip({ group }) {
  return (
    <span className="fbd-group gloss" style={{ '--gc': AR_GROUP_COLOR[group] || 'var(--muted)' }}>
      <span className="gc-dot" />{group}
      <span className="gtip">{AR_GROUP_DESC[group] || group}</span>
    </span>
  );
}

// ── Meta chips row — priority breakdown · confidence · data tier · location ─
const AR_TIER_LABEL = { audio_only: 'audio only', stems: 'stems', project_midi: 'project + MIDI' };
function MetaChips({ f }) {
  if (!f.pr && f.conf == null && !f.tier && !f.where && !f.suspected) return null;
  return (
    <div className="fbd-meta2">
      {f.pr && <span className="mchip gloss"><Icon name="target" size={11} />priority {f.pr.score}
        <span className="gtip">Priority {f.pr.score} on the raw 20–300 scale: severity base {f.pr.base} × category weight ×{f.pr.catW} × scope ×{f.pr.scopeM}. Higher = worth fixing sooner; the list is sorted by it.</span></span>}
      {f.conf != null && <span className="mchip gloss">conf {Math.round(f.conf * 100)}%
        <span className="gtip">How confident the analyzer is in this detection.</span></span>}
      {f.tier && <span className="mchip gloss"><Icon name="layers" size={11} />{AR_TIER_LABEL[f.tier] || f.tier}
        <span className="gtip">What data this detection used — {f.tier === 'audio_only' ? 'just the bounced audio; uploading stems or your project can sharpen it' : f.tier === 'stems' ? 'your uploaded stems, so it can point at specific instruments' : 'your project file, down to devices and MIDI'}.</span></span>}
      {f.where && <span className="mchip"><Icon name="clock" size={11} />{f.where}</span>}
      {f.suspected && <span className="mchip warn gloss">provisional
        <span className="gtip">Provisional threshold — this detection uses a heuristic cutoff. Treat it as a lead to verify by ear, not a hard fault.</span></span>}
    </div>
  );
}

// ── Evidence rows — measured vs expected per metric ─────────────────
function EvRows({ rows }) {
  if (!rows || !rows.length) return null;
  return (
    <div className="evrows">
      <div className="er hd"><span>Metric</span><span>Yours</span><span>Expected</span><span>Δ</span></div>
      {rows.map((r, i) => (
        <div className="er" key={i}>
          <span className="m mono">{r.metric}</span>
          <span className="y mono">{r.yours}</span>
          <span className="e mono">{r.expected}</span>
          <span className="d mono">{r.delta}</span>
        </div>
      ))}
    </div>
  );
}

// ── Detail panel — everything about the selected finding/fix ─────────
// mode 'findings': diagnosis-first — why-it-matters always open, ask-the-coach +
// link to Actions; no queueing here. mode 'actions': the fix, rack, add-to-rack.
function arDefaultWhy(f) {
  if (f.sev === 'win') return 'This is working in your favor — keep it intact through any revisions.';
  return `${f.group} issues shape how the track translates — streaming normalization, small speakers, and club systems all react to it. The earlier it’s addressed, the less it compounds through the rest of the mix.`;
}
function FixDetail({ f, move, bands, rack, added, onToggle, onEvidence, mode = 'actions', onAskCoach, onGoToActions, onGoToFinding, related = [], scenario }) {
  const [whyOpen, setWhyOpen] = useStateAc(false);
  const [dataOpen, setDataOpen] = useStateAc(true);
  const [fbOpen, setFbOpen] = useStateAc(false);
  const [fbDone, setFbDone] = useStateAc(false);
  const [applied, setApplied] = useStateAc(false);
  const [fixTab, setFixTab] = useStateAc('fix');
  const findingsMode = mode === 'findings';
  useEffectAc(() => { setWhyOpen(false); setDataOpen(true); setFbOpen(false); setFbDone(false); setApplied(false); setFixTab('fix'); }, [f && f.id]);
  if (!f) return <div className="fb-detail empty"><Icon name="info" size={18} /><span>Select a finding to see the detail and its fix.</span></div>;
  const sev = arSevColor(f.sev);
  const ev = move && move.evidence;
  return (
    <div className="fb-detail" style={{ '--sev': sev }} data-finding-id={f.id} data-move-id={move ? move.id : undefined}>
      <div className="fbd-scroll">
        <div className="fbd-toplab">{findingsMode ? 'Finding' : 'Fix'}</div>
        <div className="fbd-meta">
          <span className="fbd-sev">{AR_SEV[f.sev].label}</span>
          <GroupChip group={f.group} />
          {!findingsMode && related.length > 0 && <span className="addr">Addresses Finding: {related.map((rf, i) => <React.Fragment key={rf.id}>{i > 0 && ', '}<button className="addr-lnk" onClick={() => onGoToFinding && onGoToFinding(rf.id)} title="Open on the Findings tab">{rf.headline}</button></React.Fragment>)}</span>}
          <SourceTag source={f.source} spec={f.spec && f.spec !== f.group ? f.spec : null} />
        </div>
        <MetaChips f={f} />

        {findingsMode ? (
          <React.Fragment>
            <h3 className="fbd-head">{f.headline}{f.metric && <span className="fbd-metric"><Glossify text={f.metric} /></span>}</h3>
            <div className="fbd-cols">
              <p className="fbd-sum"><Glossify text={f.summary} /></p>
            </div>
          </React.Fragment>
        ) : null}
        {findingsMode && f.sev !== 'win' && (
          <div className="fbd-why2">
            <span className="wh"><Icon name="info" size={12} />Why it matters</span>
            <p><Glossify text={f.why || arDefaultWhy(f)} /></p>
          </div>
        )}

        {findingsMode ? (
          <React.Fragment>
            {ev && (
              <div className={`fbd-data${dataOpen ? ' open' : ''}`}>
                <button className="fbd-datahd" onClick={() => setDataOpen(o => !o)}><span className="lab"><span className="fbd-dchev">{dataOpen ? '▾' : '▸'}</span>The data</span><span className="metric">{ev.label}<span className="path">{ev.path}</span></span></button>
                {dataOpen && <div className="fbd-datachart fade-up">
                  {ev.type === 'spectrum' && <MiniSpectrum bands={bands} warnIndex={ev.warnIndex} />}
                  {ev.type === 'meter' && <MiniMeter value={ev.value} min={ev.min} max={ev.max} target={ev.target} targetLabel={ev.targetLabel} hot={ev.hot} />}
                </div>}
              </div>
            )}
            <EvRows rows={f.ev2} />
            {move
              ? <div className="fbd-avail"><Icon name="check" size={13} />Applicable Fix Available</div>
              : f.sev !== 'win' && <div className="fbd-nofix"><Icon name="info" size={14} />No one-click fix — this is an observation. Ask the coach to dig in, or address it by hand.</div>}
            <div className="fbd-cta divided">
              <button className="fbd-ask" onClick={() => onAskCoach && onAskCoach(f)}><img className="coach-ic" src="ar-assets/coach.svg" alt="" width="17" height="17" />Ask the coach about this</button>
              {move && <button className="fbd-ask green" onClick={() => onGoToActions && onGoToActions(f.id)} title={`${move.title} — open on the Actions tab`}>Show Suggested Fix<Icon name="arrow" size={13} /></button>}
            </div>
          </React.Fragment>
        ) : move ? (
          <div className="fbd-fix">
            <div className="fbd-fixhd"><span className="fx-lab">The fix</span><span className="fbd-spacer" /></div>
            <div className="fbd-fixsub"><span className="fx-lab2">Suggested fix</span></div>
            <div className="fbd-fixtitle">{move.title}<span className="fx-conf"><span className="cv">{Math.round(move.conf * 100)}%</span> conf</span><span className="fx-scope mono">{move.directional ? 'directional' : move.scope}</span></div>
            <Directive text={move.directive} scope={null} className={move.directional ? 'directional' : ''} />

            <div className="fbd-subtabs">
              <button className={fixTab === 'fix' ? 'on' : ''} onClick={() => setFixTab('fix')}>Applicable fix</button>
              <button className={fixTab === 'daw' ? 'on' : ''} onClick={() => setFixTab('daw')}>Quick DAW Instructions</button>
            </div>
            {fixTab === 'fix' ? <div className="fbd-grid">
              {rack && rack.length > 0 && (
                <div className="fbd-rack">
                  <div className="fbd-rackhd-row">
                    <span className="fbd-rackhd">Suggested fix</span>
                    {move.scope.startsWith('Master')
                      ? <span className="scopechip gloss">Master<span className="gtip">Applies to the whole master bus — the Listen rack reproduces it exactly.</span></span>
                      : <span className="scopechip dev gloss">Device: {move.scope}<span className="gtip">This fix targets a specific device/track ({move.scope}). Listen plays the bounced mix, so adding it auditions a master-bus <b>approximation</b> — the exact per-device move is in your DAW Plan.</span></span>}
                    <span className="fbd-footnote">{added ? <><span className="dot on" />Queued for Listen{!move.scope.startsWith('Master') && ' · approximation'}</> : move.scope.startsWith('Master') ? 'Add to apply live on the Listen page' : 'Add to preview an approximation on Listen'}</span>
                    <button className={`rack-toggle sm${added ? ' on' : ''}`} onClick={() => onToggle(move.id)}>
                      <Icon name={added ? 'check' : 'plus'} size={12} />{added ? 'Added' : 'Add to fix rack'}
                    </button>
                  </div>
                  <div className="preset-mods">{rack.map((rm, i) => <RackModule key={i} m={rm} />)}</div>
                </div>
              )}
            </div> : <div className="fbd-dawtab dark">
              {move.ab && (
                <div className="fbd-abhint">
                  <span className="oh"><Icon name="folder" size={12} />In your Project</span>
                  <p className="mono">{(() => {
                    const devs = (rack || []).map(rm => rm.mod).concat(['Utility', 'EQ Eight', 'Limiter', 'Compressor', 'Pro-L 2']);
                    const rx = new RegExp(`(${[...new Set(devs)].map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
                    return move.ab.split(rx).map((part, i) => devs.includes(part) ? <mark className="devhl" key={i}>{part}</mark> : part);
                  })()}</p>
                </div>
              )}
              <div className="fbd-outcome listen">
                <span className="oh"><Icon name="wave" size={12} />What to listen for</span>
                <p><Glossify text={move.listen || 'Toggle the change on and off while looping the affected section — keep it only if the fix reads as an improvement at matched volume.'} /></p>
              </div>
            </div>}
            {ev && (
              <div className={`fbd-data${dataOpen ? ' open' : ''}`}>
                <button className="fbd-datahd" onClick={() => setDataOpen(o => !o)}><span className="lab"><span className="fbd-dchev">{dataOpen ? '▾' : '▸'}</span>The data</span><span className="metric">{ev.label}<span className="path">{ev.path}</span></span></button>
                {dataOpen && <div className="fbd-datachart fade-up">
                  {ev.type === 'spectrum' && <MiniSpectrum bands={bands} warnIndex={ev.warnIndex} fixDelta={ev.fixDelta} />}
                  {ev.type === 'meter' && <MiniMeter value={ev.value} min={ev.min} max={ev.max} target={ev.target} targetLabel={ev.targetLabel} hot={ev.hot} after={ev.after} />}
                  <p className="fbd-dataexp">{ev.type === 'spectrum'
                    ? <span>Your mix’s energy per frequency band — the orange bar is where <b>{ev.label}</b> measures{ev.fixDelta != null && <span>; the outlined ghost bar is where this fix would put it</span>}. Read from <span className="mono">{ev.path}</span>.</span>
                    : <span>The measured value vs its recommended range — <b>{ev.label}</b>{ev.after != null && <span>; the green marker shows the predicted reading after this fix</span>}. Read from <span className="mono">{ev.path}</span>.</span>}</p>
                  <EvRows rows={f.ev2} />
                </div>}
              </div>
            )}
            {move.section && <div className="na" style={{ marginTop: 12 }}><Icon name="clock" size={13} />Time-anchored · <b style={{ color: 'var(--text-2)' }}>{move.section}</b></div>}
            {move.outcome && (
              <div className="fbd-outcome">
                <span className="oh"><Icon name="sparkle" size={12} />Expected outcome</span>
                <p><Glossify text={move.outcome} /></p>
              </div>
            )}

            <div className="fbd-fb">
              {applied
                ? <span className="fb-done"><Icon name="check" size={13} />Marked applied — re-analyze to verify the result</span>
                : <button className="fbd-ask" onClick={() => setApplied(true)} title="Record that you made this move in your DAW"><Icon name="check" size={13} />Mark applied</button>}
              {fbDone
                ? <span className="fb-done"><Icon name="check" size={13} />Rating submitted — thanks, it tunes future fixes</span>
                : <span className="fb-rate">
                    <button className="fbd-ask" onClick={() => setFbOpen(true)}>Rate this Suggestion</button>
                    <button className="fb-thumb" onClick={() => setFbOpen(true)} title="Helpful — rate this suggestion"><Icon name="thumbup" size={13} /></button>
                    <button className="fb-thumb dn" onClick={() => setFbOpen(true)} title="Not helpful — rate this suggestion"><Icon name="thumbdown" size={13} /></button>
                  </span>}
            </div>
            {fbOpen && <FeedbackModal f={f} move={move} onClose={() => setFbOpen(false)} onSubmit={() => { setFbOpen(false); setFbDone(true); }} />}
          </div>
        ) : f.sev === 'win' ? (
          <div className="fbd-nofix"><Icon name="check" size={14} />A win — nothing to change here.</div>
        ) : (
          <div className="fbd-fix">
            <div className="fbd-fixhd"><span className="fx-lab" style={{ color: 'var(--violet)' }}>The note</span><span className="fbd-spacer" /></div>
            <div className="fbd-fixsub"><span className="fx-lab2">Manual move — no one-click fix</span></div>
            <div className="fbd-fixtitle">{f.headline}</div>
            <p className="fbd-sum" style={{ marginTop: 6 }}><Glossify text={f.summary} /></p>
            <div className="fbd-tip">
              <span className="th"><Icon name="sparkle" size={12} />General tip</span>
              <p><Glossify text={f.tip || AR_GROUP_TIP[f.group] || arDefaultWhy(f)} /></p>
              <p className="sub mono">This is a DAW move — apply it in your project; nothing gets queued to Listen.</p>
            </div>
            <div className="fbd-cta">
              <button className="fbd-ask" onClick={() => onAskCoach && onAskCoach(f)}><img className="coach-ic" src="ar-assets/coach.svg" alt="" width="17" height="17" />Ask the coach about this</button>
              <button className="fbd-ask" onClick={() => onGoToFinding && onGoToFinding(f.id)}>View finding<Icon name="arrow" size={13} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Feedback modal — rate a fix 1–10 + notes; finding & fix ride along ─
function FeedbackModal({ f, move, onClose, onSubmit }) {
  const [rating, setRating] = useStateAc(null);
  const [notes, setNotes] = useStateAc('');
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal fbm" onClick={e => e.stopPropagation()}>
        <div className="modal-hd">
          <div className="mt"><div className="mk">Fix feedback</div><div className="mn">What do you think about this fix?</div></div>
          <button className="modal-x" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="fbm-ctx">
            <div className="row"><span className="k">Finding</span><span className="d" style={{ background: arSevColor(f.sev) }} /><span className="v">{f.headline}</span></div>
            <div className="row"><span className="k">Fix</span><span className="d" style={{ background: 'var(--accent)' }} /><span className="v">{move.title}</span></div>
            <p className="note mono">Both are attached to your feedback automatically.</p>
          </div>
          <div className="fbm-lab">Rating<span className="s">1 = not helpful · 10 = nailed it</span></div>
          <div className="fbm-rate">{Array.from({ length: 10 }, (_, i) => i + 1).map(n =>
            <button key={n} className={rating === n ? 'on' : ''} onClick={() => setRating(n)}>{n}</button>)}
          </div>
          <div className="fbm-lab">Notes</div>
          <textarea className="fbm-notes" rows="4" placeholder="What worked, what didn’t, what you’d change…" value={notes} onChange={e => setNotes(e.target.value)}></textarea>
          <div className="fbm-foot">
            <button className="fbd-ask" onClick={onClose}>Cancel</button>
            <button className="fbd-goact" disabled={!rating} style={!rating ? { opacity: .45, cursor: 'not-allowed' } : null} onClick={() => rating && onSubmit({ rating, notes })}>Submit feedback</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Filter dropdown menu — fixed-positioned so ancestor overflow:hidden can't clip it;
// caps its height to the viewport and scrolls internally
function FddMenu({ children }) {
  const ref = React.useRef(null);
  const [pos, setPos] = useStateAc(null);
  useEffectAc(() => {
    const fit = () => {
      const el = ref.current; if (!el || !el.parentElement) return;
      const r = el.parentElement.getBoundingClientRect(); // .fb-filterdd wrapper = button footprint
      setPos({ top: r.bottom + 5, right: Math.max(8, window.innerWidth - r.right), maxHeight: Math.max(140, window.innerHeight - r.bottom - 18) });
    };
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('scroll', fit, true);
    return () => { window.removeEventListener('resize', fit); window.removeEventListener('scroll', fit, true); };
  }, []);
  return ReactDOM.createPortal(
    <div className="fdd-menu wide" ref={ref} style={pos ? { position: 'fixed', top: pos.top, right: pos.right, maxHeight: pos.maxHeight } : { visibility: 'hidden' }}><div className="fdd-scrollarea">{children}</div></div>,
    document.body);
}

// ── The board — master list + detail. Merges Findings + Fixes. ───────
function FixBoard({ scenario, findings, selected, onToggle, onSelectAllFixable, onEvidence, degraded, focusId, onConsumeFocus, coachMixState, onGenerateCoachMix, title = 'Findings', mode = 'actions', onAskCoach, onGoToActions, onGoToFinding, onIgnore }) {
  const findingsMode = mode === 'findings';
  const moveFor = (f) => f.fixId ? scenario.moves.find(m => m.id === f.fixId) : null;
  const [sevFilter, setSevFilter] = useStateAc('all');
  const [fixableOnly, setFixableOnly] = useStateAc(false);
  const [grpFilter, setGrpFilter] = useStateAc(new Set());   // finding groups: Loudness, Spectrum, Stereo, Stems…
  const [devFilter, setDevFilter] = useStateAc(new Set());   // fix targets: Master, Pad bus, Bass stem…
  const [minPr, setMinPr] = useStateAc(0);                    // hide findings below this priority score
  const [filterOpen, setFilterOpen] = useStateAc(false);
  const toggleIn = (set, setter, v) => { const n = new Set(set); n.has(v) ? n.delete(v) : n.add(v); setter(n); };

  const sorted = findings.slice().sort((a, b) => AR_SEV[a.sev].rank - AR_SEV[b.sev].rank || (b.fixId ? 1 : 0) - (a.fixId ? 1 : 0));
  let list = sorted;
  if (sevFilter !== 'all') list = list.filter(f => f.sev === sevFilter);
  if (fixableOnly) list = list.filter(f => f.fixId);
  if (grpFilter.size > 0) list = list.filter(f => grpFilter.has(f.group));
  const devOf = (f) => { const m = moveFor(f); return m ? (m.scope.startsWith('Master') ? 'Master' : m.scope) : null; };
  if (devFilter.size > 0) list = list.filter(f => devFilter.has(devOf(f)));
  if (minPr > 0) list = list.filter(f => f.sev === 'win' || (f.pr ? f.pr.score : 0) >= minPr);
  const nFilters = (fixableOnly ? 1 : 0) + grpFilter.size + devFilter.size + (minPr > 0 ? 1 : 0);

  const [selId, setSelId] = useStateAc(null);
  // keep a valid selection as the list/scenario changes
  useEffectAc(() => {
    if (list.length === 0) { setSelId(null); return; }
    if (!list.some(f => f.id === selId)) setSelId(list[0].id);
  }, [scenario.id, sevFilter, fixableOnly, grpFilter, devFilter, minPr, findings.length]);
  // external focus (deep-link from another tab)
  useEffectAc(() => {
    if (!focusId) return;
    if (findings.some(f => f.id === focusId)) { setSevFilter('all'); setFixableOnly(false); setGrpFilter(new Set()); setDevFilter(new Set()); setMinPr(0); setSelId(focusId); }
    onConsumeFocus && onConsumeFocus();
  }, [focusId]);

  const sel = findings.find(f => f.id === selId) || null;
  const fixableCount = findings.filter(f => f.fixId).length;
  const sevsPresent = ['critical', 'severe', 'moderate', 'minor', 'win'].filter(s => findings.some(f => f.sev === s));
  const groupsPresent = [...new Set(findings.map(f => f.group))];
  const devsPresent = [...new Set(findings.map(devOf).filter(Boolean))].sort((a, b) => (a === 'Master' ? -1 : b === 'Master' ? 1 : a.localeCompare(b)));
  const maxPr = Math.max(0, ...findings.map(f => f.pr ? f.pr.score : 0));

  if (findings.length === 0) {
    return (
      <div className="fb-empty">
        <div className="es-ic"><Icon name="check" size={20} /></div>
        <div className="es-t">No issues found</div>
        <div className="es-s">Nothing surfaced on this track. Ask the Coach if you want a second opinion.</div>
      </div>
    );
  }

  return (
    <div className="fixboard">
      <div className="fb-list">
        <div className="fb-lh">
          <span className="t">{title}</span>
          <div className="fb-filters">
            {!findingsMode && (() => { const allSel = fixableCount > 0 && findings.every(f => !f.fixId || selected.has(f.fixId)); return <button className="fpill selall" onClick={() => onSelectAllFixable(!allSel)}>{allSel ? 'Clear all' : 'Select all'}</button>; })()}
            <div className="fb-filterdd">
              <button className={`fpill fdd-btn${nFilters > 0 ? ' on' : ''}`} onClick={() => setFilterOpen(o => !o)}><Icon name="filter" size={11} />Filter{nFilters > 0 && <span className="fn">{nFilters}</span>}<span className="fdd-chev">▾</span></button>
              {filterOpen && <>
                <div className="fdd-scrim" onClick={() => setFilterOpen(false)} />
                <FddMenu>
                  <label className="fdd-opt"><input type="checkbox" checked={!fixableOnly} onChange={() => setFixableOnly(false)} />All findings <span className="fdd-c">{findings.length}</span></label>
                  <label className="fdd-opt"><input type="checkbox" checked={fixableOnly} onChange={() => setFixableOnly(true)} />Fixable only <span className="fdd-c">{fixableCount}</span></label>
                  <div className="fdd-sec mono">Category</div>
                  {groupsPresent.map(g => (
                    <label className="fdd-opt" key={g}><input type="checkbox" checked={grpFilter.has(g)} onChange={() => toggleIn(grpFilter, setGrpFilter, g)} />{g} <span className="fdd-c">{findings.filter(f => f.group === g).length}</span></label>
                  ))}
                  {devsPresent.length > 0 && <React.Fragment>
                    <div className="fdd-sec mono">Fix target</div>
                    {devsPresent.map(d => (
                      <label className="fdd-opt" key={d}><input type="checkbox" checked={devFilter.has(d)} onChange={() => toggleIn(devFilter, setDevFilter, d)} />{d === 'Master' ? 'Master' : `Device: ${d}`} <span className="fdd-c">{findings.filter(f => devOf(f) === d).length}</span></label>
                    ))}
                  </React.Fragment>}
                  {maxPr > 0 && <div className="fdd-pr">
                    <div className="fdd-sec mono" style={{ borderTop: 'none', paddingLeft: 0, paddingRight: 0 }}>Min priority <span className="v">{minPr > 0 ? `≥ ${minPr}` : 'off'}</span></div>
                    <input type="range" min="0" max={Math.ceil(maxPr / 10) * 10} step="10" value={minPr} onChange={e => setMinPr(+e.target.value)} title="Hide findings scored below this priority (wins always show)" />
                  </div>}
                  {nFilters > 0 && <button className="fdd-clear" onClick={() => { setFixableOnly(false); setGrpFilter(new Set()); setDevFilter(new Set()); setMinPr(0); }}>Clear filters</button>}
                </FddMenu>
              </>}
            </div>
          </div>
        </div>
        <div className="fb-scroll">
          {list.length === 0
            ? <div className="na" style={{ margin: '8px 4px' }}><Icon name="info" size={13} />Nothing matches this filter.</div>
            : ['critical', 'severe', 'moderate', 'minor', 'win'].map(sev => {
              const grp = list.filter(f => f.sev === sev);
              if (grp.length === 0) return null;
              return (
                <React.Fragment key={sev}>
                  <div className="fb-sevhd" style={{ '--sev': arSevColor(sev) }}><span className="d" />{sev === 'win' ? 'wins' : sev}<span className="c">{grp.length}</span></div>
                  {grp.map(f => {
                    const m = moveFor(f);
                    const added = m && selected.has(m.id);
                    return (
                      <button key={f.id} className={`fb-row${f.id === selId ? ' on' : ''}${added ? ' added' : ''}`} style={{ '--sev': arSevColor(f.sev) }}
                        data-finding-row={f.id} onClick={() => setSelId(f.id)}>
                        <span className="fr-dot" />
                        <span className="fr-b">
                          <span className="fr-head">{findingsMode || !m ? f.headline : m.title}</span>
                          <span className="fr-meta mono"><span className="fr-grp" style={{ color: AR_GROUP_COLOR[f.group] || 'var(--muted)' }}>{f.group}</span>{m && !m.directional ? ` · ${m.scope}` : ''}{!m ? (findingsMode ? ' · observation' : ' · note · manual move') : ''}</span>
                        </span>
                        {findingsMode
                          ? <span className="fr-acts" onClick={(e) => e.stopPropagation()}>
                              {m ? <span className="fr-ckbox gloss"><Icon name="check" size={11} /><span className="gtip">A suggested fix is available</span></span> : <span className="fr-ckbox off gloss"><span className="gtip">No one-click fix — shows as a note in Actions</span></span>}
                              <span className="fr-ic gloss" role="button" onClick={() => onAskCoach && onAskCoach(f)}><img src="ar-assets/coach.svg" width="15" height="15" alt="" /><span className="gtip">Ask the Coach about this</span></span>
                              <span className="fr-ic gloss" role="button" onClick={() => onIgnore && onIgnore(f)}><Icon name="eyeoff" size={13} /><span className="gtip">Ignore this finding — hides its action too</span></span>
                            </span>
                          : m
                            ? <span className={`fr-add${added ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); onToggle(m.id); }} title={added ? 'Remove from Listen queue' : 'Queue this fix'}><Icon name={added ? 'check' : 'plus'} size={12} /></span>
                            : f.sev !== 'win'
                              ? <span className={`fr-add note${selected.has(f.id) ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); onToggle(f.id); }} title={selected.has(f.id) ? 'Unmark this note' : 'Mark this note to work on in your DAW'}><Icon name={selected.has(f.id) ? 'check' : 'plus'} size={12} /></span>
                              : <span className="fr-obs" title="A win — nothing to do" />}
                      </button>
                    );
                  })}
                </React.Fragment>
              );
            })}
        </div>
      </div>
      <FixDetail f={sel} move={sel ? moveFor(sel) : null} bands={scenario.bands} scenario={scenario}
        rack={sel && moveFor(sel) ? arRack(scenario.id, moveFor(sel).id) : []}
        added={sel && moveFor(sel) ? selected.has(moveFor(sel).id) : false}
        related={sel && moveFor(sel) ? findings.filter(x => x.fixId === moveFor(sel).id) : []}
        onToggle={onToggle} onEvidence={onEvidence} mode={mode} onAskCoach={onAskCoach} onGoToActions={onGoToActions} onGoToFinding={onGoToFinding} />
    </div>
  );
}

Object.assign(window, { FixBoard, FixDetail, Glossify, GroupChip, SourceTag, MetaChips, EvRows, AR_GROUP_TIP });
