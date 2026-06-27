/* spectre — Analysis Results redesign. App shell: frame + tab routing + report states
   + tweaks. AI Coach is the primary tab (chat + the Actions move list under it). Checked
   fixes queue to the Listen page (storage handoff); the Game Plan is the DAW export. */
const { useState: useStateApp, useEffect: useEffectApp, useRef: useRefApp } = React;

const AR_TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "scenario": "deep",
  "reportState": "complete"
}/*EDITMODE-END*/;

// specialist runs that yield a templated extra finding
const AR_SPEC_YIELDS = {
  clarity: { sev: 'minor', headline: 'A slight haze in the 2–4 kHz presence region', summary: 'Clarity flags a mild build-up in the presence band that softens the lead’s edge.' },
  harmonic: { sev: 'minor', headline: 'Harmonic content is a touch dense in the mids', summary: 'Overlapping harmonics in the mids reduce separation between the pad and the lead.' },
  density: { sev: 'minor', headline: 'Arrangement gets busy in the second drop', summary: 'Density rises past the comfortable range in drop 2 — consider muting one layer.' },
  spatial: { sev: 'minor', headline: 'Reverb tail widens the low end slightly', summary: 'A long reverb is pushing low-frequency energy into the sides — high-pass the send.' },
  chord_harmony: { sev: 'minor', headline: 'One chord voicing rubs against the bassline', summary: 'A third in the pad voicing clashes with the root of the bass under the breakdown.' },
  gain_staging: { sev: 'minor', headline: 'Headroom is tight going into the limiter', summary: 'The pre-master bus runs hot; pull it back a couple dB for the limiter to breathe.' },
};

// ── Report-level states ──────────────────────────────────────────────
function RunningView({ scenario }) {
  const done = 5;
  return (
    <div className="wrap">
      <a className="backlink"><Icon name="back" size={14} />all versions</a>
      <div className="rhead" style={{ marginBottom: 18 }}>
        <div className="rh-top">
          <CoverArt hue={scenario.track.hue} size={62} badge={scenario.track.version} />
          <div className="rh-titles"><div className="rh-titlerow"><span className="rh-name">{scenario.track.name}</span><span className="rh-ver">{scenario.track.version}</span></div>
            <div className="rh-chips"><span className="chip"><span className="eqdots" style={{ height: 9 }}><i /><i /><i /></span>analyzing…</span></div></div>
        </div>
      </div>
      <div style={{ maxWidth: 560 }}>
        <div className="seclabel"><span className="t">Analysis in progress</span><span className="hint">{done} of {scenario.phases.length} phases</span><span className="rule" /></div>
        <div style={{ height: 5, borderRadius: 3, background: 'var(--dim)', overflow: 'hidden', marginBottom: 18 }}>
          <div className="pulse" style={{ width: `${(done / scenario.phases.length) * 100}%`, height: '100%', background: 'var(--accent)' }} />
        </div>
        {scenario.phases.map((p, i) => {
          const state = i < done ? 'done' : i === done ? 'run' : 'wait';
          return (
            <div key={p.phase} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '11px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
                color: state === 'done' ? 'var(--accent)' : state === 'run' ? 'var(--violet)' : 'var(--muted)',
                background: state === 'done' ? 'rgba(0,229,176,.12)' : state === 'run' ? 'rgba(167,139,250,.12)' : 'transparent',
                border: state === 'wait' ? '1.5px dashed var(--border-3)' : `1px solid ${state === 'done' ? 'rgba(0,229,176,.4)' : 'rgba(167,139,250,.5)'}` }}>
                {state === 'done' ? <Icon name="check" size={12} /> : state === 'run' ? <span className="eqdots" style={{ height: 9 }}><i /><i /><i /></span> : ''}
              </span>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: state === 'wait' ? 'var(--muted)' : 'var(--text)' }}>{p.friendly}</span>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>{state === 'done' ? 'done' : state === 'run' ? 'running' : 'queued'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FailedView({ scenario }) {
  return (
    <div className="wrap">
      <a className="backlink"><Icon name="back" size={14} />all versions</a>
      <div style={{ maxWidth: 520, margin: '40px auto 0' }}>
        <div className="empty-state">
          <div className="es-ic" style={{ color: 'var(--red)', background: 'rgba(244,63,94,.08)', borderColor: 'rgba(244,63,94,.28)' }}><Icon name="alert" size={22} /></div>
          <div className="es-t">Analysis failed</div>
          <div className="es-s">The pipeline crashed before finishing this version: <span className="mono" style={{ color: 'var(--text-2)' }}>worker exited during phase 4 (stem separation)</span>. Your upload is safe — re-run to try again.</div>
          <div style={{ marginTop: 18 }}><button className="btn primary"><Icon name="refresh" size={14} />Re-analyze</button></div>
        </div>
      </div>
    </div>
  );
}

// ── Game Plan modal — the export you take back to your DAW ────────────
function GamePlanModal({ scenario, selectedIds, onClose }) {
  const moves = scenario.moves.filter(m => selectedIds.has(m.id));
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" style={{ width: 'min(580px,100%)' }} onClick={e => e.stopPropagation()}>
        <div className="modal-hd">
          <div className="mt"><div className="mk">Game Plan · for your DAW</div><div className="mn">{scenario.track.name} <span className="mono" style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{scenario.track.version}</span></div></div>
          <button className="modal-x" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="banner info" style={{ marginBottom: 16 }}>
            <span className="bic"><Icon name="download" size={16} /></span>
            <div className="bb"><div className="t">Take this back to your DAW</div><div className="s">Your selected fixes, compiled into a checklist to apply by hand in Ableton (or wherever you mix). The same fixes stay queued to audition live on the Listen page.</div></div>
          </div>
          {moves.length === 0
            ? <div className="na"><Icon name="info" size={14} />No fixes selected yet — check the moves you want to take into your DAW.</div>
            : moves.map(m => (
              <div key={m.id} style={{ display: 'flex', gap: 11, padding: '11px 0', borderTop: '1px solid var(--border)' }}>
                <span style={{ width: 16, height: 16, borderRadius: 4, border: '1.5px solid var(--border-3)', flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{m.title}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.5 }}>
                    <span className="mono" style={{ color: 'var(--accent)' }}>{m.scope}</span> · {m.directive.replace(/`/g, '')}
                  </div>
                </div>
              </div>
            ))}
        </div>
        <div className="spec-foot">
          <span className="sf-note"><span className="v">{moves.length}</span> {moves.length === 1 ? 'fix' : 'fixes'} in your plan</span>
          <button className="btn primary sm"><Icon name="download" size={13} />Download .md</button>
        </div>
      </div>
    </div>
  );
}

// ── Fix data modal (opened by clicking a queued fix) ─────────────────
function FixModal({ scenario, move, selected, onToggle, onClose }) {
  if (!move) return null;
  const rack = arRack(scenario.id, move.id);
  const sev = arSevColor(move.sev);
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" style={{ width: 'min(540px,100%)' }} onClick={e => e.stopPropagation()}>
        <div className="modal-hd">
          <div className="mt"><div className="mk">Fix · {move.scope}</div><div className="mn">{move.title}</div></div>
          <button className="modal-x" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="move-prob" style={{ marginBottom: 14 }}>
            <span className="mp-dot" style={{ background: sev, boxShadow: `0 0 7px -1px ${sev}` }} />
            <span className="mp-head" style={{ cursor: 'default', color: 'var(--text-2)' }}>{move.findingHead}</span>
            <span className="mp-spacer" />
            {move.chip && <span className="mp-metric">{move.chip}</span>}
            <span className="mp-sev" style={{ color: sev, borderColor: `color-mix(in srgb, ${sev} 40%, transparent)`, background: `color-mix(in srgb, ${sev} 9%, transparent)` }}>{AR_SEV[move.sev].label}</span>
          </div>
          <Directive text={move.directive} scope={move.directional ? null : move.scope} className={move.directional ? 'directional' : ''} />
          {rack.length > 0 && (
            <div className="preset-block" style={{ marginTop: 16 }}>
              <div className="pb-h">{move.directional ? 'Suggested approach · audition to dial in' : `Rack preset${rack.length > 1 ? 's' : ''}`}</div>
              <div className="preset-mods">{rack.map((rm, i) => <RackModule key={i} m={rm} />)}</div>
            </div>
          )}
          {move.section && <div className="na" style={{ marginTop: 12 }}><Icon name="clock" size={14} />Time-anchored · <b style={{ color: 'var(--text-2)' }}>{move.section}</b></div>}
        </div>
        <div className="spec-foot">
          <span className="sf-note">Queued to apply on the <span className="v">Listen</span> page</span>
          <button className="rack-toggle on" onClick={() => { onToggle(move.id); onClose(); }}><Icon name="x" size={12} />Remove</button>
        </div>
      </div>
    </div>
  );
}

// ── Coach Mix modal — selected fixes compiled into one whole rack ─────
function CoachMixModal({ scenario, selectedIds, onClose }) {
  const moves = scenario.moves.filter(m => selectedIds.has(m.id));
  const modules = compileCoachMix(scenario.id, moves);
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" style={{ width: 'min(620px,100%)' }} onClick={e => e.stopPropagation()}>
        <div className="modal-hd">
          <div className="mt"><div className="mk">Coach Mix · calculated rack</div><div className="mn">{scenario.track.name} <span className="mono" style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{scenario.track.version}</span></div></div>
          <button className="modal-x" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="banner info" style={{ marginBottom: 16, borderStyle: 'solid', borderColor: 'rgba(0,229,176,.28)', background: 'rgba(0,229,176,.05)' }}>
            <span className="bic" style={{ color: 'var(--accent)', background: 'rgba(0,229,176,.1)', border: '1px solid rgba(0,229,176,.28)' }}><Icon name="cassette" size={16} /></span>
            <div className="bb"><div className="t">Your {moves.length} {moves.length === 1 ? 'fix' : 'fixes'}, solved into one rack</div><div className="s">SPECTR calculates the EQ curve, dynamics and loudness <b style={{ color: 'var(--text)' }}>together</b> — accounting for how the fixes interact — instead of stacking one device per fix. Load it on the Listen page, or toggle modules one at a time.</div></div>
          </div>
          <div className="signal-flow">
            <span className="sf-io">in</span>
            {modules.map((rm, i) => { const meta = AR_MOD_META[rm.mod] || {}; return <React.Fragment key={i}><span className="sf-arrow">→</span><span className="sf-node" style={{ '--ac': meta.accent || 'var(--accent)' }}>{rm.mod}</span></React.Fragment>; })}
            <span className="sf-arrow">→</span><span className="sf-io">out</span>
          </div>
          <div className="rack-grid">{modules.map((rm, i) => <RackModule key={i} m={rm} />)}</div>
        </div>
        <div className="spec-foot">
          <span className="sf-note"><span className="v">{modules.length}</span> modules · solved from <span className="v">{moves.length}</span> {moves.length === 1 ? 'fix' : 'fixes'}</span>
          <a className="btn primary sm" href="Listen Page.html"><Icon name="play" size={13} />Open Coach Mix in Listen</a>
        </div>
      </div>
    </div>
  );
}

// ── Right sidebar — Fixes for Listen + Coach Mix + Game Plan ──────────
function RackSidebar({ scenario, selected, onToggle, onOpenFix, onOpenGamePlan, coachMixState, onGenerateCoachMix, onOpenCoachMix }) {
  const fixes = scenario.moves.filter(m => selected.has(m.id));
  const ready = coachMixState === 'ready';
  const generating = coachMixState === 'generating';
  return (
    <aside className="side">
      <div className="side-card">
        <div className="side-h"><span className="l">Fixes for Listen</span><span className="hint">{fixes.length}</span></div>
        <div className="side-body">
          {ready && fixes.length > 0 && (
            <button className="coachmix-item" onClick={onOpenCoachMix}>
              <span className="cm-glyph"><Icon name="cassette" size={16} /></span>
              <div className="cm-b"><div className="cm-t">Coach Mix</div><div className="cm-s">calculated rack · {fixes.length} {fixes.length === 1 ? 'fix' : 'fixes'} solved</div></div>
              <Icon name="arrow" size={14} />
            </button>
          )}
          {fixes.length === 0
            ? <div className="rack-empty">Check fixes in the plan below — they’ll be queued here to apply on the Listen page.</div>
            : fixes.map(m => (
              <div className="rack-item" key={m.id} onClick={() => onOpenFix(m.id)} role="button" tabIndex={0} title="See the fix details">
                <span className="ri-dot" style={{ background: arSevColor(m.sev) }} />
                <div className="ri-b"><div className="ri-t">{m.title}</div><div className="ri-s mono">{m.scope}{m.chip ? ` · ${m.chip}` : ''}</div></div>
                <button className="ri-x" onClick={(e) => { e.stopPropagation(); onToggle(m.id); }} title="Remove"><Icon name="x" size={11} /></button>
              </div>
            ))}
        </div>
        {fixes.length > 0
          ? <a className="rack-listen" href="Listen Page.html"><Icon name="play" size={14} /><span className="rl-lbl">Open in Listen</span><span className="rl-sub">try the fixes</span></a>
          : <span className="rack-listen disabled"><Icon name="play" size={14} /><span className="rl-lbl">Open in Listen</span></span>}
      </div>

      <button className="gameplan-card" onClick={onOpenGamePlan}>
        <span className="gpc-ic"><Icon name="download" size={16} /></span>
        <div className="gpc-b"><div className="gpc-t">Game Plan</div><div className="gpc-s">Your plan compiled to take back to your DAW</div></div>
        <Icon name="arrow" size={14} />
      </button>
      <p className="side-note">Checked fixes apply live on Listen. The Game Plan is a checklist for hand-mixing in your DAW.</p>
    </aside>
  );
}

// ── Toasts ───────────────────────────────────────────────────────────
function ToastHost({ toasts }) {
  return (
    <div style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 90, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', pointerEvents: 'none' }}>
      {toasts.map(t => (
        <div key={t.id} className="fade-up" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 15px', borderRadius: 9, background: 'var(--surface-2)', border: '1px solid var(--border-2)', boxShadow: '0 14px 36px -12px rgba(0,0,0,.7)', fontSize: 12.5, color: 'var(--text)' }}>
          <span style={{ color: 'var(--accent)', display: 'grid', placeItems: 'center' }}><Icon name={t.icon || 'check'} size={15} /></span>{t.text}
        </div>
      ))}
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────────
function App() {
  const [tw, setTweak] = useTweaks(AR_TWEAK_DEFAULTS);
  const scenario = AR_SCENARIOS[tw.scenario] || AR_DEEP;
  const reportState = tw.reportState;

  const [tab, setTab] = useStateApp('coach');
  const [selected, setSelected] = useStateApp(() => new Set());
  const [exportOpen, setExportOpen] = useStateApp(false);
  const [specOpen, setSpecOpen] = useStateApp(false);
  const [coachMixState, setCoachMixState] = useStateApp('idle');
  const [fixModalId, setFixModalId] = useStateApp(null);
  const [coachMixOpen, setCoachMixOpen] = useStateApp(false);
  const [specState, setSpecState] = useStateApp({});
  const [extraFindings, setExtraFindings] = useStateApp([]);
  const [coachMsgs, setCoachMsgs] = useStateApp([]);
  const [credits, setCredits] = useStateApp(23);
  const [toasts, setToasts] = useStateApp([]);
  const [pendingFlash, setPendingFlash] = useStateApp(null);
  const toastId = useRefApp(0);

  // reset per-scenario interaction state when the scenario changes
  useEffectApp(() => {
    const top2 = scenario.moves.slice().sort((a, b) => AR_SEV[a.sev].rank - AR_SEV[b.sev].rank).slice(0, 2).map(m => m.id);
    setSelected(new Set(top2));
    setExtraFindings([]); setSpecState({}); setCoachMsgs([]); setTab('coach');
    setCoachMixState('idle'); setFixModalId(null); setCoachMixOpen(false);
  }, [scenario.id]);

  // merged specialist run-state (pre-run cached + runtime)
  const runState = {};
  AR_SPECIALISTS.forEach(s => { if (scenario.specRuns[s.slug]) runState[s.slug] = { status: 'cached', found: scenario.specRuns[s.slug].found }; });
  Object.entries(specState).forEach(([k, v]) => { runState[k] = v; });
  const runCount = Object.values(runState).filter(v => v.status === 'cached').length;

  // visible findings (apply report-state filters + specialist extras)
  let findings = [...scenario.findings, ...extraFindings];
  if (reportState === 'degraded') findings = findings.filter(f => f.source === 'measured');
  if (reportState === 'clean') findings = findings.filter(f => f.sev === 'win');
  const faultCount = findings.filter(f => f.sev !== 'win' && f.kind !== 'integrity').length;
  const worst = arWorstSev(findings);
  const alert = faultCount > 0 && ['critical', 'severe', 'moderate'].includes(worst);

  const visibleMoves = scenario.moves.filter(m => findings.some(f => f.id === m.findingId && f.sev !== 'win'));
  const scenarioForActions = { ...scenario, moves: visibleMoves };
  const scenarioForFindings = { ...scenario, findings };

  // persist the Listen handoff whenever the selected set changes
  useEffectApp(() => {
    const sel = scenario.moves.filter(m => selected.has(m.id));
    const handoff = {
      versionId: `${scenario.id}_${scenario.track.version}`, jobId: `job_${scenario.id}`,
      selectedFixes: sel.map(m => ({ fixId: m.id, findingId: m.findingId, label: m.title,
        dspChain: m.rackable ? [{ type: 'chain', params: { scope: m.scope } }] : [], section: m.section || null })),
      savedAt: new Date().toISOString(),
    };
    try { sessionStorage.setItem(`coachMix:${handoff.versionId}`, JSON.stringify(handoff)); } catch {}
  }, [selected, scenario.id]);

  const toast = (text, icon) => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, text, icon }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2600);
  };

  // cross-tab flash
  const flashTo = (targetTab, selector) => { setTab(targetTab); setPendingFlash({ tab: targetTab, selector, n: Date.now() }); };
  useEffectApp(() => {
    if (!pendingFlash || pendingFlash.tab !== tab) return;
    const id = requestAnimationFrame(() => {
      const el = document.querySelector(pendingFlash.selector);
      if (el) {
        const top = el.getBoundingClientRect().top + window.scrollY - 120;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1300);
      }
      setPendingFlash(null);
    });
    return () => cancelAnimationFrame(id);
  }, [pendingFlash, tab]);

  // handlers
  const onAddInput = (key) => toast(`Drop your ${key === 'ref' ? 'reference' : key === 'als' ? '.als project' : key} to deepen the analysis →`, 'plus');
  const toggleSel = (id) => { setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); setCoachMixState('idle'); };
  const onGenerateCoachMix = () => { setCoachMixState('generating'); setTimeout(() => { setCoachMixState('ready'); toast('Coach Mix compiled — open it on the Listen page', 'bolt'); }, 1300); };

  const runSpecialist = (slug) => {
    setSpecState(s => ({ ...s, [slug]: { status: 'running' } }));
    setCredits(c => Math.max(0, c - 1));
    setTimeout(() => {
      const y = AR_SPEC_YIELDS[slug];
      const label = AR_SPECIALISTS.find(x => x.slug === slug)?.label || slug;
      const group = AR_SPECIALISTS.find(x => x.slug === slug)?.group || 'Misc';
      const found = y ? 1 : 0;
      setSpecState(s => ({ ...s, [slug]: { status: 'cached', found } }));
      if (y) setExtraFindings(f => f.some(x => x.id === `x_${slug}`) ? f : [...f, {
        id: `x_${slug}`, sev: y.sev, group, source: 'ai', spec: label, kind: 'observation',
        headline: y.headline, metric: null, summary: y.summary, why: null, evidence: [], fixId: null,
      }]);
      setCoachMsgs(m => [...m, { role: 'specialist', spec: label, text: found > 0
        ? `I found ${found} additional ${found === 1 ? 'finding' : 'findings'} for you to review — ${found === 1 ? 'it’s' : 'they’re'} in the Findings tab now.`
        : `I didn’t find anything new this time.` }]);
    }, 1500);
  };

  const sendCoach = (text) => {
    setCoachMsgs(m => [...m, { role: 'user', text }]);
    setTimeout(() => setCoachMsgs(m => [...m, cannedReply(text, scenario)]), 600);
  };

  if (reportState === 'running') return (<div className="app"><TopBar credits={credits} /><RunningView scenario={scenario} /><ARTweaks tw={tw} setTweak={setTweak} /></div>);
  if (reportState === 'failed') return (<div className="app"><TopBar credits={credits} /><FailedView scenario={scenario} /><ARTweaks tw={tw} setTweak={setTweak} /></div>);

  const tabs = [
    { id: 'coach', label: 'AI Coach', icon: 'message' },
    { id: 'findings', label: 'Findings', icon: 'flag', badge: faultCount, alert },
    scenario.project ? { id: 'project', label: 'Project', icon: 'folder' } : null,
    scenario.reference ? { id: 'reference', label: 'Reference', icon: 'target' } : null,
    { id: 'trackinfo', label: 'Track Info', icon: 'chart' },
    { id: 'debug', label: 'Debug', icon: 'sliders' },
  ].filter(Boolean);
  const curTab = tabs.some(t => t.id === tab) ? tab : 'coach';

  return (
    <div className="app">
      {/* SCAFFOLD — mock SPECTR navbar; hosts the prototype, do NOT port into the real app */}
      <TopBar credits={credits} />
      {/* DELIVERABLE — everything in .wrap maps to features/results/ */}
      <div className="wrap">
        <a className="backlink"><Icon name="back" size={14} />all versions</a>
        <div className="layout">
          <main className="main">
            <ResultsHeader scenario={scenarioForFindings} onVitalClick={() => setTab('findings')} onAddInput={onAddInput} />
            <TabBar tab={curTab} setTab={setTab} tabs={tabs} />
            {curTab === 'coach' && (
              <div className="tabbody fade-up">
                <CoachTab scenario={scenario} messages={coachMsgs} onSend={sendCoach} runCount={runCount} onOpenSpecialists={() => setSpecOpen(true)} coachMixState={coachMixState} onGenerateCoachMix={onGenerateCoachMix} fixCount={selected.size} />
                <ActionsModule scenario={scenarioForActions} findings={findings} selected={selected} onToggle={toggleSel} onGoToFinding={(id) => flashTo('findings', `[data-finding-id="${id}"]`)} />
              </div>
            )}
            {curTab === 'findings' && <FindingsTab findings={findings} degraded={reportState === 'degraded'} onEvidence={(a) => flashTo('trackinfo', `[data-ti-anchor="${a}"]`)} onGoToFix={(id) => flashTo('coach', `[data-move-id="${id}"]`)} />}
            {curTab === 'project' && <ProjectTab scenario={scenario} />}
            {curTab === 'reference' && <ReferenceTab scenario={scenario} onGoToFinding={(id) => flashTo('findings', `[data-finding-id="${id}"]`)} />}
            {curTab === 'trackinfo' && <TrackInfoTab scenario={scenario} />}
            {curTab === 'debug' && <DebugTab scenario={scenario} />}
          </main>
          <RackSidebar scenario={scenario} selected={selected} onToggle={toggleSel} onOpenFix={setFixModalId} onOpenGamePlan={() => setExportOpen(true)} coachMixState={coachMixState} onGenerateCoachMix={onGenerateCoachMix} onOpenCoachMix={() => setCoachMixOpen(true)} />
        </div>
      </div>

      {exportOpen && <GamePlanModal scenario={scenario} selectedIds={selected} onClose={() => setExportOpen(false)} />}
      {specOpen && <SpecialistModal runState={runState} hasStems={scenario.inputs.stems.on} credits={credits} onRun={runSpecialist} onClose={() => setSpecOpen(false)} />}
      {fixModalId && <FixModal scenario={scenario} move={scenario.moves.find(m => m.id === fixModalId)} selected={selected} onToggle={toggleSel} onClose={() => setFixModalId(null)} />}
      {coachMixOpen && <CoachMixModal scenario={scenario} selectedIds={selected} onClose={() => setCoachMixOpen(false)} />}
      <ToastHost toasts={toasts} />
      <ARTweaks tw={tw} setTweak={setTweak} />
    </div>
  );
}

// canned grounded coach reply
function cannedReply(text, scenario) {
  const t = text.toLowerCase();
  const deep = scenario.id === 'deep';
  if (/clip|peak|true.?peak/.test(t)) return { role: 'bot', text: deep ? "The master clips on **true-peak** at +0.4 dBTP — inter-sample peaks cross 0 dBFS, so lossy codecs distort it. Drop the limiter ceiling to −1.0 dBTP with 4× oversampling. There's a one-click fix below." : "You're well under the ceiling here (−7.8 dBTP) — no clipping at all. It's the opposite: there's headroom to push louder.", gnd: deep ? ['true peak +0.4 dBTP'] : ['true peak −7.8 dBTP'] };
  if (/low.?mid|mud|boxy|carve/.test(t)) return { role: 'bot', text: deep ? "Your low-mids sit **+3.5 dB** over the trance median around 280 Hz — that's the boxiness. A −2.5 dB bell at 280 Hz (Q 1.2) opens it up. See the move below." : "The low-mids are a touch heavy versus the top. Without stems I can't pin the exact frequency — best to carve by ear on Listen and A/B it.", gnd: deep ? ['low-mid +3.5 dB'] : ['low-mid 200–500 Hz'] };
  if (/work|good|right|win/.test(t)) return { role: 'bot', text: deep ? "Plenty: your **energy contrast** between breakdown and drop is 11.2 dB — right in the pro range. The stereo field and frequency balance both score high too. Don't touch those." : "It's an early sketch, but the loudness has clean headroom and there's no clipping — a solid foundation to build on.", gnd: deep ? ['contrast 11.2 dB'] : ['peak −3.3 dBFS'] };
  if (/club|loud|master|stream/.test(t)) return { role: 'bot', text: deep ? "For club/Beatport you're already at −8.2 LUFS which fits. For Spotify/YouTube bounce a separate master at **−14 LUFS** — drop input gain ~5.5 dB after fixing the true-peak." : "Push toward −14 LUFS for streaming — you've got headroom (peak −3.3 dBFS). Small gain beats a big push.", gnd: deep ? ['−8.2 LUFS'] : ['−16.9 LUFS'] };
  return { role: 'bot', text: deep ? "Good question. The headline for Lumen is the true-peak clipping — fix that first, then the low-mid carve. Want me to walk through either?" : "On a 9-second clip I'm working with limited data, but the low end and the near-mono image are the two things I'd watch as this grows.", gnd: [] };
}

// Tweaks panel
function ARTweaks({ tw, setTweak }) {
  return (
    <TweaksPanel>
      <TweakSection label="Scenario" />
      <TweakRadio label="Track" value={tw.scenario}
        options={[{ value: 'deep', label: 'Deep' }, { value: 'short', label: 'Short clip' }]}
        onChange={v => setTweak('scenario', v)} />
      <TweakSection label="Report state" />
      <TweakSelect label="State" value={tw.reportState}
        options={[{ value: 'complete', label: 'Complete' }, { value: 'clean', label: 'Clean mix (no faults)' }, { value: 'degraded', label: 'Degraded (LLM off)' }, { value: 'running', label: 'Running' }, { value: 'failed', label: 'Failed' }]}
        onChange={v => setTweak('reportState', v)} />
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
