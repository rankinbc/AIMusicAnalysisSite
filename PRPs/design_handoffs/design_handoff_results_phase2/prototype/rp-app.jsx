/* spectre — Results app shell: nav, job tabs, Plan/Analysis/Files, Tweaks. */
const { useState: useStateA } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "state": "loaded",
  "inputDepth": "als",
  "density": "full",
  "metricViz": "meter",
  "triage": "buttons",
  "directive": "prose",
  "evidence": "ondemand",
  "showSource": true,
  "fixRack": "flow",
  "fixCoaching": "placeholder"
}/*EDITMODE-END*/;

function TopNav({ credits }) {
  return (
    <div className="topnav">
      <a className="brand" href="#"><BrandMark /><span className="brand-name">spectre</span></a>
      <div className="breadcrumb">
        <span className="sep">/</span><span>{RP_TRACK.name}</span>
        <span className="sep">/</span><span className="crumb-current">{RP_TRACK.version}</span>
      </div>
      <span className="nav-spacer" />
      <div className="nav-tools">
        <span className="nav-chip"><span className="v">{credits}</span> credits</span>
        <span className="nav-avatar">M</span>
      </div>
    </div>
  );
}

function JobTabs({ tab, setTab, onExport, problemCount }) {
  const tabs = [
    { id: 'plan', label: 'Actions', icon: 'target', lead: true },
    { id: 'problems', label: 'Problems', icon: 'alert', badge: problemCount },
    { id: 'analysis', label: 'Analysis', icon: 'chart' },
    { id: 'files', label: 'Files', icon: 'folder' },
  ];
  return (
    <div className="jobtabs">
      {tabs.map(tb => (
        <button key={tb.id} className={`jobtab${tab === tb.id ? ' active' : ''}`} onClick={() => setTab(tb.id)}>
          {tb.lead && tab === tb.id && <span className="lead-dot" />}
          <span className="ic"><Icon name={tb.icon} size={15} /></span>
          {tb.label}
          {tb.badge != null && tb.badge > 0 && <span className="jobtab-badge">{tb.badge}</span>}
        </button>
      ))}
      <span className="jobtabs-spacer" />
      <button className="btn sm ghost" style={{ marginRight: 6 }} onClick={onExport}><Icon name="download" size={13} />Game Plan</button>
    </div>
  );
}

function CleanBanner() {
  return (
    <div className="clean-banner fade-up">
      <div className="cl-ic"><Icon name="check" size={18} /></div>
      <div className="cl-body">
        <div className="cl-t">Clean mix — here&rsquo;s the polish.</div>
        <div className="cl-s">No critical issues surfaced. What&rsquo;s left is finishing, not fixing — so we won&rsquo;t invent problems.</div>
      </div>
    </div>
  );
}

function PlanScreen({ t, statuses, setStatus, extraMoves = [], onRunDeepen, ranIds, onExport, onOpenSpecialists, onGoToMove }) {
  const clean = t.state === 'clean';
  const degraded = t.state === 'degraded';
  const shallow = t.inputDepth === 'mix';
  const ranCount = degraded ? 1 : RP_SPECIALISTS.filter(s => s.ran && (!s.needs || rpPresent(RP_DEPTH_RANK[s.needs], t.inputDepth))).length;
  let base = RP_MOVES;
  if (clean) base = RP_MOVES.filter(m => ['info', 'low', 'win'].includes(m.sev));
  else if (degraded) base = RP_MOVES.filter(m => /rule engine/.test(m.source));
  const moves = [...base, ...extraMoves];
  const quick = moves.filter(m => m.group === 'quick');
  const deep = moves.filter(m => m.group === 'deep');
  const wins = moves.filter(m => m.group === 'win');
  const committedCount = moves.filter(m => statuses[m.id] === 'committed').length;
  const committedFixable = moves.filter(m => statuses[m.id] === 'committed' && m.kind !== 'win').length;
  const mkey = (m) => m.id + t.triage + t.directive + t.evidence + t.inputDepth;

  return (
    <div>
      <div className="plan-top">
        <span className="pt-sum"><span className="mono">{ranCount}</span> {ranCount === 1 ? 'specialist' : 'specialists'} analyzed this mix</span>
        <button className="ai-btn" onClick={onOpenSpecialists}><Icon name="sparkle" size={14} />AI Analysis</button>
      </div>
      <CoachBanner />

      {degraded && <DegradedBanner />}
      {shallow && !degraded && <DepthBanner />}
      {clean && <CleanBanner />}

      {quick.length > 0 && (
        <>
          <SecLabel glyph="⚡" hint={`${quick.length} ${quick.length === 1 ? 'move' : 'moves'} · do these first`}>Quick wins</SecLabel>
          {quick.map(m => <MoveCard key={mkey(m)} move={m} t={t} status={statuses[m.id] || 'suggested'} setStatus={s => setStatus(m.id, s)} />)}
        </>
      )}

      {deep.length > 0 && (
        <>
          <SecLabel glyph="🛠" hint={`${deep.length} ${deep.length === 1 ? 'move' : 'moves'} · more effort`}>Deeper work</SecLabel>
          {deep.map(m => <MoveCard key={mkey(m)} move={m} t={t} status={statuses[m.id] || 'suggested'} setStatus={s => setStatus(m.id, s)} />)}
        </>
      )}

      {wins.length > 0 && (
        <>
          <SecLabel glyph="✓" hint="holding up well — leave these alone">What&rsquo;s working</SecLabel>
          {wins.map(m => <MoveCard key={mkey(m)} move={m} t={t} status={statuses[m.id] || 'suggested'} setStatus={s => setStatus(m.id, s)} />)}
        </>
      )}

      {!degraded && (
        <>
          <SecLabel glyph="✦" hint="priced · no auto-spend">Deepen your plan</SecLabel>
          <DeepenZone onRun={onRunDeepen} ranIds={ranIds} />
        </>
      )}

      <SecLabel glyph="🎚" hint="apply · one click into Listen">Fix rack</SecLabel>
      <FixRack t={t} committedFixable={committedFixable} onGoToMove={onGoToMove} />

      <ExportBar onExport={onExport} committedCount={committedCount} />
    </div>
  );
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [tab, setTab] = useStateA('plan');
  const [exportOpen, setExportOpen] = useStateA(false);
  const [statuses, setStatuses] = useStateA({ m1: 'committed', m2: 'committed' });
  const setStatus = (id, s) => setStatuses(prev => ({ ...prev, [id]: s }));
  const [credits, setCredits] = useStateA(23);
  const [extraMoves, setExtraMoves] = useStateA([]);
  const [ranIds, setRanIds] = useStateA([]);
  const [specialistsOpen, setSpecialistsOpen] = useStateA(false);
  const [specialistRuns, setSpecialistRuns] = useStateA({});
  const runDeepen = (d) => {
    setCredits(c => Math.max(0, c - d.credits));
    setExtraMoves(m => [...m, { ...d.result, _new: true }]);
    setRanIds(ids => [...ids, d.id]);
  };
  const runSpecialist = (spec) => {
    setCredits(c => Math.max(0, c - spec.credits));
    if (spec.yields) {
      const d = RP_DEEPEN.find(x => x.id === spec.yields);
      if (d) {
        setExtraMoves(m => m.some(x => x.id === d.result.id) ? m : [...m, { ...d.result, _new: true }]);
        setRanIds(ids => ids.includes(d.id) ? ids : [...ids, d.id]);
        setSpecialistRuns(r => ({ ...r, [spec.slug]: { outcome: 'move', moveN: d.result.n } }));
        return;
      }
    }
    setSpecialistRuns(r => ({ ...r, [spec.slug]: { outcome: 'clean' } }));
  };
  const goToMove = (n) => {
    if (n == null) return;
    const el = document.querySelector(`.move[data-move-n="${n}"]`);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 90;
    window.scrollTo({ top, behavior: 'smooth' });
    el.classList.add('move-flash');
    setTimeout(() => el.classList.remove('move-flash'), 1200);
  };
  const loading = t.state === 'loading';
  const committed = RP_MOVES.concat(extraMoves).filter(m => statuses[m.id] === 'committed');
  const openProblemCount = (() => {
    let list = RP_PROBLEMS.filter(p => rpTierVisible(p.dataTier, t.inputDepth) && !p.refines);
    if (t.state === 'degraded') list = list.filter(p => p.source === 'rule_engine');
    if (t.state === 'clean') list = list.filter(p => p.sev === 'win');
    return list.filter(p => p.kind === 'fault').length;
  })();

  return (
    <div className="shell">
      <TopNav credits={credits} />
      <div className="page">
        {!loading && <SongHeader inputDepth={t.inputDepth} />}
        {!loading && <JobTabs tab={tab} setTab={setTab} onExport={() => setExportOpen(true)} problemCount={openProblemCount} />}
        {loading ? <RunningState /> : (
          <>
            {tab === 'plan' && <PlanScreen t={t} statuses={statuses} setStatus={setStatus} extraMoves={extraMoves} onRunDeepen={runDeepen} ranIds={ranIds} onExport={() => setExportOpen(true)} onOpenSpecialists={() => setSpecialistsOpen(true)} onGoToMove={goToMove} />}
            {tab === 'problems' && <ProblemsTab t={t} onGoToMove={() => setTab('plan')} />}
            {tab === 'analysis' && <AnalysisTab t={t} />}
            {tab === 'files' && <FilesTab inputDepth={t.inputDepth} />}
          </>
        )}
      </div>

      {exportOpen && <ExportModal committed={committed} onClose={() => setExportOpen(false)} />}
      {specialistsOpen && <SpecialistsModal onClose={() => setSpecialistsOpen(false)} credits={credits} runs={specialistRuns} ranIds={ranIds} inputDepth={t.inputDepth} degraded={t.state === 'degraded'} onRun={runSpecialist} />}

      <TweaksPanel>
        <TweakSection label="Report state" />
        <TweakRadio label="State" value={t.state}
          options={[{ value: 'loaded', label: 'Loaded' }, { value: 'loading', label: 'Loading' }, { value: 'clean', label: 'Clean' }, { value: 'degraded', label: 'Degraded' }]}
          onChange={v => setTweak('state', v)} />

        <TweakSection label="Inputs analyzed" />
        <TweakRadio label="Depth" value={t.inputDepth}
          options={[{ value: 'mix', label: 'Mix' }, { value: 'stems', label: '+ Stems' }, { value: 'als', label: '+ .als' }]}
          onChange={v => setTweak('inputDepth', v)} />

        <TweakSection label="Analysis · new metrics" />
        <TweakRadio label="Metric viz" value={t.metricViz}
          options={[{ value: 'meter', label: 'Meter' }, { value: 'dial', label: 'Dial' }, { value: 'plot', label: 'Plot' }]}
          onChange={v => setTweak('metricViz', v)} />
        <TweakRadio label="Density" value={t.density}
          options={[{ value: 'compact', label: 'Compact' }, { value: 'full', label: 'Full' }]}
          onChange={v => setTweak('density', v)} />

        <TweakSection label="Move card" />
        <TweakRadio label="Triage" value={t.triage}
          options={[{ value: 'buttons', label: 'Buttons' }, { value: 'segmented', label: 'Segmented' }, { value: 'menu', label: 'Menu' }]}
          onChange={v => setTweak('triage', v)} />
        <TweakRadio label="Directive" value={t.directive}
          options={[{ value: 'prose', label: 'Prose' }, { value: 'steps', label: 'Step list' }]}
          onChange={v => setTweak('directive', v)} />
        <TweakRadio label="Evidence" value={t.evidence}
          options={[{ value: 'ondemand', label: 'On demand' }, { value: 'inline', label: 'Always shown' }]}
          onChange={v => setTweak('evidence', v)} />
        <TweakToggle label="Show source" value={t.showSource} onChange={v => setTweak('showSource', v)} />

        <TweakSection label="Fix rack" />
        <TweakRadio label="State" value={t.fixRack}
          options={[{ value: 'flow', label: 'Flow' }, { value: 'generating', label: 'Gen' }, { value: 'ready', label: 'Ready' }, { value: 'empty', label: 'Empty' }]}
          onChange={v => setTweak('fixRack', v)} />
        <TweakRadio label="Coaching" value={t.fixCoaching}
          options={[{ value: 'placeholder', label: 'Day one' }, { value: 'preview', label: 'Preview' }]}
          onChange={v => setTweak('fixCoaching', v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
