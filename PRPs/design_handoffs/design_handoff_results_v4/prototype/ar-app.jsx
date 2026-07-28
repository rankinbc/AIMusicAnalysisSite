/* spectre — Analysis Results redesign. App shell: frame + tab routing + report states
   + tweaks. AI Coach is the primary tab (chat + the Actions move list under it). Checked
   fixes queue to the Listen page (storage handoff); the Game Plan is the DAW export. */
const { useState: useStateApp, useEffect: useEffectApp, useRef: useRefApp } = React;



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

// ── DAW Plan modal — the export you take back to your DAW ──────────
function GamePlanModal({ scenario, selectedIds, onClose }) {
  const [checked, setChecked] = useStateApp(() => new Set(selectedIds));
  const [format, setFormat] = useStateApp('md');            // md | txt | pdf
  const [detail, setDetail] = useStateApp('standard');       // brief | standard | detailed
  const [group, setGroup] = useStateApp('order');            // order | area
  const [opts, setOpts] = useStateApp(() => ({ facts: true, params: true, data: true, targets: true, genre: true, times: true, coach: false }));
  const toggle = (id) => setChecked(c => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setOpt = (k) => setOpts(o => ({ ...o, [k]: !o[k] }));
  const sel = scenario.moves.filter(m => checked.has(m.id));
  const ext = format === 'md' ? '.md' : format === 'txt' ? '.txt' : '.pdf';

  const OptRow = ({ k, label, sub }) => (
    <label className="gp-opt"><input type="checkbox" checked={opts[k]} onChange={() => setOpt(k)} /><span className="gp-opt-b"><span className="gp-opt-l">{label}</span><span className="gp-opt-s">{sub}</span></span></label>
  );

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal gp-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-hd">
          <div className="mt"><div className="mk">DAW Plan · build your export</div><div className="mn">{scenario.track.name} <span className="mono" style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{scenario.track.version}</span></div></div>
          <button className="modal-x" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body gp-body">
          <div className="gp-config">
            <div className="gp-sec">
              <div className="gp-sec-h">Format</div>
              <div className="gp-seg">
                {[['md', 'Markdown'], ['txt', 'Plain text'], ['pdf', 'PDF']].map(([v, l]) => <button key={v} className={format === v ? 'on' : ''} onClick={() => setFormat(v)}>{l}</button>)}
              </div>
            </div>
            <div className="gp-sec">
              <div className="gp-sec-h">Detail level</div>
              <div className="gp-seg">
                {[['brief', 'Brief'], ['standard', 'Standard'], ['detailed', 'Detailed']].map(([v, l]) => <button key={v} className={detail === v ? 'on' : ''} onClick={() => setDetail(v)}>{l}</button>)}
              </div>
            </div>
            <div className="gp-sec">
              <div className="gp-sec-h">Order fixes by</div>
              <div className="gp-seg">
                {[['order', 'Signal chain'], ['area', 'Problem area'], ['device', 'Per device']].map(([v, l]) => <button key={v} className={group === v ? 'on' : ''} onClick={() => setGroup(v)}>{l}</button>)}
              </div>
            </div>
            <div className="gp-sec">
              <div className="gp-sec-h">Include</div>
              <div className="gp-opts">
                <OptRow k="facts" label="Track facts" sub="tempo · key · LUFS · genre" />
                <OptRow k="params" label="Device parameters" sub="the suggested rack settings per fix" />
                <OptRow k="data" label="Measured evidence" sub="the numbers each fix is based on" />
                <OptRow k="targets" label="Streaming targets" sub="platform LUFS / true-peak goals" />
                <OptRow k="genre" label="Genre targets" sub="where trance medians sit — tone · width · loudness" />
                <OptRow k="times" label="Timestamped events" sub="clip clusters · loudest moment · section-scoped issues" />
                <OptRow k="coach" label="Coach commentary" sub="the why-it-matters context" />
              </div>
            </div>
            <div className="gp-sec">
              <div className="gp-sec-h">Fixes <span className="gp-sec-c">{sel.length}/{scenario.moves.length}</span></div>
              <div className="gp-fixlist">
                {scenario.moves.map(m => {
                  const on = checked.has(m.id);
                  return (
                    <button key={m.id} className={`gp-fix${on ? ' on' : ''}`} onClick={() => toggle(m.id)}>
                      <span className="gp-fix-ck">{on && <Icon name="check" size={10} />}</span>
                      <span className="gp-fix-t">{m.title}</span>
                      <span className="gp-fix-scope mono">{m.scope}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="gp-preview">
            <div className="gp-pv-bar"><span className="mono">DAW-Plan-{scenario.track.name}{ext}</span><span className="gp-pv-tag">{format.toUpperCase()} · live preview</span></div>
            <div className="gp-doc">
              <div className="gp-doc-h1"># Mixing plan — {scenario.track.name} <span className="dim">{scenario.track.version}</span></div>
              {opts.facts && <div className="gp-doc-block"><div className="gp-doc-h2">Track facts</div><div className="gp-doc-kv"><span>Tempo</span><b>{scenario.meta.bpm} BPM</b></div><div className="gp-doc-kv"><span>Key</span><b>{scenario.meta.key}</b></div><div className="gp-doc-kv"><span>Loudness</span><b>{scenario.loudness.lufs} LUFS</b></div><div className="gp-doc-kv"><span>Genre</span><b>{arGenre(scenario.meta.genre)}</b></div></div>}
              <div className="gp-doc-block">
                <div className="gp-doc-h2">{group === 'device' ? 'Actions per device' : 'Moves'} <span className="dim">· by {group === 'order' ? 'signal chain' : group === 'area' ? 'problem area' : 'target device — Master first'}</span></div>
                {sel.length === 0 ? <div className="gp-doc-empty">No fixes selected — pick some on the left.</div> : group === 'device' ? (() => {
                  const byTarget = {};
                  sel.forEach(m => (arRack(scenario.id, m.id) || []).forEach(rm => { (byTarget[m.scope] = byTarget[m.scope] || []).push({ m, rm }); }));
                  return Object.keys(byTarget).sort((a, b) => (b.startsWith('Master') ? 1 : 0) - (a.startsWith('Master') ? 1 : 0)).map(tg => (
                    <div className="gp-doc-move" key={tg}>
                      <div className="gp-doc-move-t">{tg}</div>
                      {byTarget[tg].map(({ m, rm }, j) => (
                        <div key={j} style={{ marginTop: 5 }}>
                          <div className="gp-doc-chip mono">{rm.mod}{rm.sub ? ` — ${rm.sub}` : ''}</div>
                          {opts.params && <div className="gp-doc-move-d">{Object.entries(rm.params || {}).map(([k, v]) => `${k}: ${v}`).join(' · ')}</div>}
                          {detail !== 'brief' && <div className="gp-doc-why">← {m.title}</div>}
                        </div>
                      ))}
                    </div>
                  ));
                })() : sel.map((m, i) => {
                  const rack = arRack(scenario.id, m.id);
                  return (
                    <div className="gp-doc-move" key={m.id}>
                      <div className="gp-doc-move-t">{i + 1}. {m.title} <span className="dim mono">{m.scope}</span></div>
                      {detail !== 'brief' && <div className="gp-doc-move-d">{m.directive.replace(/`/g, '')}</div>}
                      {opts.params && rack.length > 0 && <div className="gp-doc-params">{rack.map((rm, j) => <span className="gp-doc-chip mono" key={j}>{rm.mod}{Object.entries(rm.params).slice(0, detail === 'detailed' ? 9 : 2).map(([k, v]) => ` · ${k} ${v}`).join('')}</span>)}</div>}
                      {opts.data && m.evidence && detail === 'detailed' && <div className="gp-doc-data mono">↳ {m.evidence.label}</div>}
                      {opts.coach && m.why && detail !== 'brief' && <div className="gp-doc-why">{m.why}</div>}
                    </div>
                  );
                })}
              </div>
              {opts.targets && <div className="gp-doc-block"><div className="gp-doc-h2">Streaming targets</div>{scenario.streaming.slice(0, 3).map((r, i) => <div className="gp-doc-kv" key={i}><span>{r.platform}</span><b>{r.target} LUFS</b></div>)}</div>}
              {opts.genre && scenario.genreTargets && <div className="gp-doc-block"><div className="gp-doc-h2">Genre targets <span className="dim">· {arGenre(scenario.meta.genre)} median</span></div>{Object.entries(scenario.genreTargets).map(([k, v]) => <div className="gp-doc-kv" key={k}><span>{k}</span><b>{v}</b></div>)}</div>}
              {opts.times && scenario.timedEvents && <div className="gp-doc-block"><div className="gp-doc-h2">Timestamped events</div>{scenario.timedEvents.map((e, i) => <div className="gp-doc-kv" key={i}><span className="mono">{e.t}</span><b style={{ fontWeight: 500 }}>{e.label}</b></div>)}</div>}
            </div>
          </div>
        </div>
        <div className="spec-foot">
          <span className="sf-note"><span className="v">{sel.length}</span> {sel.length === 1 ? 'fix' : 'fixes'} · {Object.values(opts).filter(Boolean).length} sections · {format.toUpperCase()}</span>
          <button className="btn primary sm" disabled={sel.length === 0}><Icon name="download" size={13} />Download {ext}</button>
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

// ── RackChain — THE standardized device chain: in → [device] → … → out.
//    One component, reused everywhere a rack is shown (Coach Mix modal, preset
//    modal, preset rows). size="sm" for inline rows, default for full views. ──
function RackChain({ modules, size }) {
  return (
    <div className={`rack-chain${size === 'sm' ? ' sm' : ''}`}>
      <span className="rc-io">in</span>
      {modules.map((rm, i) => { const meta = AR_MOD_META[rm.mod] || {}; return <React.Fragment key={i}><span className="rc-arr">→</span><span className="rc-node" style={{ '--ac': meta.accent || 'var(--accent)' }}>{meta.icon && <Icon name={meta.icon} size={size === 'sm' ? 10 : 12} />}{rm.mod}</span></React.Fragment>; })}
      <span className="rc-arr">→</span><span className="rc-io">out</span>
    </div>
  );
}

// ── Preset modal — a saved/compiled rack's full detail: the chain + every
//    device's params. Same renderer family as everywhere else. ──
function PresetModal({ scenario, preset, onClose }) {
  if (!preset) return null;
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" style={{ width: 'min(820px,100%)' }} onClick={e => e.stopPropagation()}>
        <div className="modal-hd">
          <div className="mt"><div className="mk">Preset · rack</div><div className="mn">{preset.name} <span className="mono" style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{preset.modules.length} devices</span></div></div>
          <button className="modal-x" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body">
          <RackChain modules={preset.modules} />
          <div className="rack-grid" style={{ marginTop: 14 }}>{preset.modules.map((rm, i) => <RackModule key={i} m={rm} />)}</div>
        </div>
        <div className="spec-foot">
          <span className="sf-note"><span className="v">{preset.modules.length}</span> devices in order</span>
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
      <div className="modal" style={{ width: 'min(820px,100%)' }} onClick={e => e.stopPropagation()}>
        <div className="modal-hd">
          <div className="mt"><div className="mk">Coach Mix · calculated rack</div><div className="mn">{scenario.track.name} <span className="mono" style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{scenario.track.version}</span></div></div>
          <button className="modal-x" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="banner info" style={{ marginBottom: 16, borderStyle: 'solid', borderColor: 'rgba(0,229,176,.28)', background: 'rgba(0,229,176,.05)' }}>
            <span className="bic" style={{ color: 'var(--accent)', background: 'rgba(0,229,176,.1)', border: '1px solid rgba(0,229,176,.28)' }}><Icon name="cassette" size={16} /></span>
            <div className="bb"><div className="t">Your {moves.length} {moves.length === 1 ? 'fix' : 'fixes'}, solved into one rack</div><div className="s">SPECTR calculates the EQ curve, dynamics and loudness <b style={{ color: 'var(--text)' }}>together</b> — accounting for how the fixes interact — instead of stacking one device per fix. Load it on the Listen page, or toggle modules one at a time.</div></div>
          </div>
          <RackChain modules={modules} />
          <div className="rack-grid" style={{ marginTop: 14 }}>{modules.map((rm, i) => <RackModule key={i} m={rm} />)}</div>
        </div>
        <div className="spec-foot">
          <span className="sf-note"><span className="v">{modules.length}</span> modules · solved from <span className="v">{moves.length}</span> {moves.length === 1 ? 'fix' : 'fixes'}</span>
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

// ── CompiledRack — the shared device-module renderer. ONE object (an ordered
//    chain of modules) → one look. Used by the Compiled view AND every Preset row,
//    because a Compiled rack and a saved Preset are the same rack schema. ──
function CompiledRack({ modules, compact }) {
  return (
    <div className="crack">
      <RackChain modules={modules} size={compact ? 'sm' : undefined} />
      {!compact && <div className="rack-grid" style={{ marginTop: 12 }}>{modules.map((rm, i) => <RackModule key={i} m={rm} />)}</div>}
    </div>
  );
}

// ── Rack card — ONE rack primitive, two tabs.
//    Rack tab: By fix (the cart/checklist — the INPUT, not a rack) ⇄ Compiled
//    (the single chain the cart solves into). Presets tab: saved racks, rendered
//    with the SAME CompiledRack renderer. Footer: Listen + DAW Plan. ──
function FixActionBar({ scenario, selected, onToggle, onOpenGamePlan, coachMixState, onGenerateCoachMix, toast }) {
  const queued = scenario.moves.filter(m => selected.has(m.id));
  const fixCount = queued.length;
  const [presetModal, setPresetModal] = useStateApp(null);
  const coachReady = coachMixState === 'ready';
  const coachGen = coachMixState === 'generating';
  // Presets = full chains auditioned as one. Coach Mix only exists once the user generates it (under the findings list).
  const presets = coachReady ? [{ name: 'Coach Mix', auto: true, modules: compileCoachMix(scenario.id, fixCount ? queued : scenario.moves) }] : [];

  return (
    <div className="fixcard">
      <div className="fixcard-top">
        <span className="fixcard-title">Send to Listen
          <span className="tipwrap fc-tip"><Icon name="info" size={12} /><span className="tip up">Queue fixes in the findings list — each carries to <b>Listen</b> on its own so you can A/B one change at a time. <b>Presets</b> (like <b>Coach Mix</b>) are full chains you audition as one.</span></span>
        </span>
        <span className="fc-selnote top">{fixCount ? <><span className="v">{fixCount}</span> {fixCount === 1 ? 'fix' : 'fixes'} queued</> : 'nothing queued'}{presets.length > 0 && ' · 1 preset'}</span>
      </div>

      <div className="fq-presets">
        {presets.length === 0
          ? null
          : <div className="fq-cart">{presets.map((p, i) => (
            <div className="preset-row2" key={i}>
              <span className="pr2-glyph"><Icon name="cassette" size={13} /></span>
              <button className="pr2-b" onClick={() => setPresetModal(p)} title="View devices & parameters">
                <span className="pr2-name">{p.name}</span>{p.auto && <span className="pr2-badge">auto</span>}<span className="pr2-count mono">{p.modules.length} devices</span>
              </button>
              <a className="pr2-listen" href="Listen Page.html" title={`Open ${p.name} in Listen`}><Icon name="play" size={11} />Listen</a>
            </div>
          ))}</div>}
      </div>
      {presetModal && <PresetModal scenario={scenario} preset={presetModal} onClose={() => setPresetModal(null)} />}

      <div className="fixcard-foot">
        {presets.length === 0
          ? <span className="fq-emptynote"><Icon name="cassette" size={12} />No presets yet — hit <b>Coach Mix</b> in the coach box to solve your queued fixes into one chain.</span>
          : <span className="fc-selnote"></span>}
        {fixCount > 0
          ? <a className="fbx-listen" href="Listen Page.html"><Icon name="play" size={13} />Listen</a>
          : <span className="fbx-listen disabled"><Icon name="play" size={13} />Listen</span>}
      </div>
    </div>
  );
}

// ── Findings status strip — read-only counts for the diagnosis surface ─
function FindingsStatus({ findings, faultCount, runCount, suggestedSpecs, fixableCount, queuedCount, onOpenSpecialists, onGoActions, ignoredCount = 0, onRestoreIgnored }) {
  const wins = findings.filter(f => f.sev === 'win').length;
  return (
    <div className="fstat">
      <span className="fstat-chip"><span className="k">Findings</span><span className="v">{findings.length}</span><span className="s">{faultCount} faults · {wins} wins</span></span>
      <button className="fstat-chip link" onClick={onOpenSpecialists} title="Open the Specialist Team"><span className="k">Specialists</span><span className="v">{runCount}</span><span className="s">run · {suggestedSpecs} suggested</span></button>
      <button className="fstat-chip link" onClick={onGoActions} title="Open the Actions tab"><span className="k">Actions</span><span className="v">{fixableCount}</span><span className="s">fixes + notes</span></button>
      <span className="fstat-chip"><span className="k">Queued for Listen</span><span className="v ac">{queuedCount}</span></span>
      {ignoredCount > 0 && <button className="fstat-chip link" onClick={onRestoreIgnored} title="Restore all ignored findings"><span className="k">Ignored</span><span className="v">{ignoredCount}</span><span className="s">restore all</span></button>}
    </div>
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
  const scenario = AR_DEEP;
  const reportState = 'complete';

  const [tab, setTab] = useStateApp('coach');
  const [boardFocus, setBoardFocus] = useStateApp(null);
  const [selected, setSelected] = useStateApp(() => new Set());
  const [exportOpen, setExportOpen] = useStateApp(false);
  const [specOpen, setSpecOpen] = useStateApp(false);
  const [coachMixState, setCoachMixState] = useStateApp('idle');
  const [fixModalId, setFixModalId] = useStateApp(null);
  const [coachMixOpen, setCoachMixOpen] = useStateApp(false);
  const [specState, setSpecState] = useStateApp({});
  const [extraFindings, setExtraFindings] = useStateApp([]);
  const [coachMsgs, setCoachMsgs] = useStateApp(() => [coachGreeting(scenario)]);
  const [credits, setCredits] = useStateApp(23);
  const [toasts, setToasts] = useStateApp([]);
  const [pendingFlash, setPendingFlash] = useStateApp(null);
  const [ignored, setIgnored] = useStateApp(() => new Set());
  const [userPresets, setUserPresets] = useStateApp([]);
  const [planLog, setPlanLog] = useStateApp([]);
  const toastId = useRefApp(0);

  // reset per-scenario interaction state when the scenario changes
  useEffectApp(() => {
    const top2 = scenario.moves.slice().sort((a, b) => AR_SEV[a.sev].rank - AR_SEV[b.sev].rank).slice(0, 2).map(m => m.id);
    setSelected(new Set(top2));
    setExtraFindings([]); setSpecState({}); setCoachMsgs([coachGreeting(scenario)]); setTab('coach');
    setCoachMixState('idle'); setFixModalId(null); setCoachMixOpen(false);
  }, [scenario.id]);

  // merged specialist run-state (pre-run cached + runtime)
  const runState = {};
  AR_SPECIALISTS.forEach(s => { if (scenario.specRuns[s.slug]) runState[s.slug] = { status: 'cached', found: scenario.specRuns[s.slug].found }; });
  Object.entries(specState).forEach(([k, v]) => { runState[k] = v; });
  const runCount = Object.values(runState).filter(v => v.status === 'cached').length;

  // visible findings (apply report-state filters + specialist extras + ignores)
  let findings = [...scenario.findings, ...extraFindings];
  if (reportState === 'degraded') findings = findings.filter(f => f.source === 'measured');
  if (reportState === 'clean') findings = findings.filter(f => f.sev === 'win');
  findings = findings.filter(f => !ignored.has(f.id));
  const faultCount = findings.filter(f => f.sev !== 'win' && f.kind !== 'integrity').length;
  const worst = arWorstSev(findings);
  const alert = faultCount > 0 && ['critical', 'severe', 'moderate'].includes(worst);

  const scenarioForFindings = { ...scenario, findings };
  const goToFinding = (id) => { setTab('coach'); setBoardFocus(id); };
  const goToAction = (id) => { setTab('actions'); setBoardFocus(id); };
  const askCoach = (f) => {
    sendCoach(`Tell me more about “${f.headline}” — what’s causing it, and how would you fix it?`);
    toast('Asked the coach — answer incoming in the chat', 'message');
  };
  const onIgnoreFinding = (f) => {
    setIgnored(s => new Set([...s, f.id]));
    toast(`Ignored “${f.headline}” — hidden from Findings and Actions`, 'eyeoff');
  };

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
  const recordPlan = (text) => setPlanLog(l => [...l, { time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), text }]);
  const onCreatePreset = () => {
    const queued = scenario.moves.filter(m => selected.has(m.id));
    if (queued.length === 0) { toast('Nothing selected — check some fixes first', 'info'); return; }
    const name = 'Fix stack ' + (userPresets.length + 1);
    const devs = []; queued.forEach(m => (arRack(scenario.id, m.id) || []).forEach(rm => { if (!devs.includes(rm.mod)) devs.push(rm.mod); }));
    setUserPresets(p => [...p, { id: 'up' + p.length, name, moves: queued.map(m => m.id) }]);
    recordPlan(`Created preset “${name}” from ${queued.length} fixes — devices: ${devs.join(', ')}`);
    toast(`Preset “${name}” created — it's in your DAW Plan`, 'cassette');
  };
  const onTryFixes = () => recordPlan(`Auditioned ${selected.size} queued ${selected.size === 1 ? 'fix' : 'fixes'} on Listen — toggled individually while playing`);
  const onGenerateCoachMix = () => { setCoachMixState('generating'); setTimeout(() => { setCoachMixState('ready'); toast('Coach Mix compiled — find it in Presets', 'bolt'); const n = selected.size || scenario.moves.length; recordPlan(`Coach Mix compiled ${n} ${n === 1 ? 'fix' : 'fixes'} into one gain-staged chain (saved as the “Coach Mix” preset)`); setCoachMsgs(m => [...m, { role: 'coach', text: `Done — I solved your ${n} queued ${n === 1 ? 'fix' : 'fixes'} into one gain-staged chain instead of stacking a device per fix. It’s saved as the “Coach Mix” preset in the Rack panel; open it there to see every device and its parameters, or load it on the Listen page to A/B against your original.` }]); }, 1300); };

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

  if (reportState === 'running') return (<div className="app"><TopBar credits={credits} /><RunningView scenario={scenario} /></div>);
  if (reportState === 'failed') return (<div className="app"><TopBar credits={credits} /><FailedView scenario={scenario} /></div>);

  const actionable = findings.filter(f => f.sev !== 'win');
  const tabs = [
    { id: 'trackinfo', label: 'Track Analysis', icon: 'chart' },
    { id: 'project', label: 'Project', icon: 'folder', disabled: !scenario.project, tip: scenario.project ? null : 'No Ableton project uploaded — drop your .als to unlock device chains, MIDI health, and arrangement checks' },
    { id: 'stems', label: 'Stems', icon: 'layers', disabled: !scenario.inputs.stems.on, tip: scenario.inputs.stems.on ? null : 'No stems uploaded — add stems to unlock per-stem levels, width, and clash analysis' },
    scenario.reference ? { id: 'reference', label: 'Reference', icon: 'diamond' } : null,
    { id: 'notes', label: 'Notes / Feedback', icon: 'users', badge: scenario.feedback ? scenario.feedback.comments.length : null, tip: 'Your own notes on this version plus comments and emoji reactions from listeners you shared it with — stored with the song to reinforce future feedback' },
    { id: 'debug', label: 'Debug', icon: 'sliders' },
    { id: 'coach', label: 'Findings', icon: 'message', badge: faultCount, alert, right: true, hot: true, tip: 'All significant discoveries from the uploaded track' },
    { id: 'actions', label: 'Actions', icon: 'check', badge: actionable.length, right: true, hot: true, tip: 'Recommended fixes compiled from the findings — queue them here and send to Listen' },
    { id: 'dawplan', label: 'Improvement Plan', icon: 'target', right: true, hot: true, badge: planLog.length, tip: 'Listen in Studio — pick fixes and presets to audition on the Listen rack — plus the step-by-step DAW plan to take back to your project' },
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
            <div className="hero-row">
              <div className="hero-left">
                <ResultsHeader scenario={scenarioForFindings} onVitalClick={() => setTab('coach')} onAddInput={onAddInput} />
                <FixActionBar scenario={scenario} selected={selected} onToggle={toggleSel} onOpenGamePlan={() => setExportOpen(true)} coachMixState={coachMixState} onGenerateCoachMix={onGenerateCoachMix} toast={toast} />
              </div>
              <CoachTab scenario={scenario} messages={coachMsgs} onSend={sendCoach} runCount={runCount} onOpenSpecialists={() => setSpecOpen(true)} coachMixState={coachMixState} onGenerateCoachMix={onGenerateCoachMix} fixCount={selected.size} queued={scenario.moves.filter(m => selected.has(m.id))} />
            </div>
            <TabBar tab={curTab} setTab={setTab} tabs={tabs} />
            {curTab === 'coach' && (
              <div className="tabbody fade-up">
                <FindingsStatus findings={findings} faultCount={faultCount} runCount={runCount} suggestedSpecs={scenario.specSuggested}
                  fixableCount={actionable.length} queuedCount={selected.size} onOpenSpecialists={() => setSpecOpen(true)} onGoActions={() => setTab('actions')}
                  ignoredCount={ignored.size} onRestoreIgnored={() => { setIgnored(new Set()); toast('Restored all ignored findings', 'eye'); }} />
                <FixBoard mode="findings" onAskCoach={askCoach} onGoToActions={goToAction} onIgnore={onIgnoreFinding} scenario={scenario} findings={findings} selected={selected} onToggle={toggleSel} onSelectAllFixable={(on) => { setSelected(on ? new Set(findings.filter(f => f.fixId).map(f => f.fixId)) : new Set()); setCoachMixState('idle'); }} degraded={reportState === 'degraded'} onEvidence={(a) => flashTo('trackinfo', `[data-ti-anchor="${a}"]`)} focusId={boardFocus} onConsumeFocus={() => setBoardFocus(null)} coachMixState={coachMixState} onGenerateCoachMix={onGenerateCoachMix} />
              </div>
            )}
            {curTab === 'actions' && (
              <div className="tabbody fade-up">
                <ActionsBar queuedCount={selected.size} onCreatePreset={onCreatePreset} coachMixState={coachMixState} onGenerateCoachMix={onGenerateCoachMix} onTryFixes={onTryFixes} onGoPlan={() => setTab('dawplan')} planCount={planLog.length} />
                <FixBoard title="Actions" mode="actions" onGoToFinding={goToFinding} onAskCoach={askCoach} scenario={scenario} findings={actionable} selected={selected} onToggle={toggleSel} onSelectAllFixable={(on) => { setSelected(on ? new Set(actionable.filter(f => f.fixId).map(f => f.fixId)) : new Set()); }} onEvidence={setFixModalId} degraded={reportState === 'degraded'} focusId={boardFocus} onConsumeFocus={() => setBoardFocus(null)} coachMixState={coachMixState} onGenerateCoachMix={onGenerateCoachMix} />
              </div>
            )}
            {curTab === 'dawplan' && <ImprovementPlanTab scenario={scenario} findings={findings} selected={selected} userPresets={userPresets} coachMixState={coachMixState} planLog={planLog} onGoToActions={() => setTab('actions')} onOpenGamePlan={() => setExportOpen(true)} onGoToFinding={goToFinding} />}
            {curTab === 'project' && <ProjectTab scenario={scenario} />}
            {curTab === 'stems' && scenario.inputs.stems.on && <StemsTab scenario={scenarioForFindings} onGoToFinding={goToFinding} />}
            {curTab === 'notes' && <NotesTab scenario={scenario} />}
            {curTab === 'trackinfo' && <TrackInfoTab scenario={scenario} onGoToFinding={goToFinding} findingsCount={findings.length} onGoToFindings={() => setTab('coach')} />}
            {curTab === 'reference' && scenario.reference && (
              <div className="tabbody fade-up"><RefBlock r={scenario.reference} hasStems={scenario.inputs.stems.on} onGoToFinding={goToFinding} /></div>
            )}
            {curTab === 'debug' && <DebugTab scenario={scenario} />}
          </main>
        </div>
      </div>

      {exportOpen && <GamePlanModal scenario={scenario} selectedIds={selected} onClose={() => setExportOpen(false)} />}
      {specOpen && <SpecialistModal runState={runState} hasStems={scenario.inputs.stems.on} credits={credits} suggestedCount={scenario.specSuggested} findings={findings} onRun={runSpecialist} onClose={() => setSpecOpen(false)} />}
      {fixModalId && <FixModal scenario={scenario} move={scenario.moves.find(m => m.id === fixModalId)} selected={selected} onToggle={toggleSel} onClose={() => setFixModalId(null)} />}
      {coachMixOpen && <CoachMixModal scenario={scenario} selectedIds={selected} onClose={() => setCoachMixOpen(false)} />}
      <ToastHost toasts={toasts} />
    </div>
  );
}

// canned grounded coach reply
function coachGreeting(scenario) {
  const deep = scenario.id === 'deep';
  return deep
    ? { role: 'bot', text: "I’ve been through **Lumen v3** top to bottom. Headline: the master clips on true-peak, and the low-mids are heavy versus the trance median. Ask me anything — or start with the findings below.", gnd: ['true peak +0.4 dBTP', 'low-mid +3.5 dB'] }
    : { role: 'bot', text: "It’s a 9-second sketch, so data is limited — but headroom is clean and there’s no clipping. Ask me anything about what’s here so far.", gnd: ['peak −3.3 dBFS'] };
}
function cannedReply(text, scenario) {
  const t = text.toLowerCase();
  const deep = scenario.id === 'deep';
  if (/clip|peak|true.?peak/.test(t)) return { role: 'bot', text: deep ? "The master clips on **true-peak** at +0.4 dBTP — inter-sample peaks cross 0 dBFS, so lossy codecs distort it. Drop the limiter ceiling to −1.0 dBTP with 4× oversampling. There's a one-click fix below." : "You're well under the ceiling here (−7.8 dBTP) — no clipping at all. It's the opposite: there's headroom to push louder.", gnd: deep ? ['true peak +0.4 dBTP'] : ['true peak −7.8 dBTP'] };
  if (/low.?mid|mud|boxy|carve/.test(t)) return { role: 'bot', text: deep ? "Your low-mids sit **+3.5 dB** over the trance median around 280 Hz — that's the boxiness. A −2.5 dB bell at 280 Hz (Q 1.2) opens it up. See the move below." : "The low-mids are a touch heavy versus the top. Without stems I can't pin the exact frequency — best to carve by ear on Listen and A/B it.", gnd: deep ? ['low-mid +3.5 dB'] : ['low-mid 200–500 Hz'] };
  if (/work|good|right|win/.test(t)) return { role: 'bot', text: deep ? "Plenty: your **energy contrast** between breakdown and drop is 11.2 dB — right in the pro range. The stereo field and frequency balance both score high too. Don't touch those." : "It's an early sketch, but the loudness has clean headroom and there's no clipping — a solid foundation to build on.", gnd: deep ? ['contrast 11.2 dB'] : ['peak −3.3 dBFS'] };
  if (/club|loud|master|stream/.test(t)) return { role: 'bot', text: deep ? "For club/Beatport you're already at −8.2 LUFS which fits. For Spotify/YouTube bounce a separate master at **−14 LUFS** — drop input gain ~5.5 dB after fixing the true-peak." : "Push toward −14 LUFS for streaming — you've got headroom (peak −3.3 dBFS). Small gain beats a big push.", gnd: deep ? ['−8.2 LUFS'] : ['−16.9 LUFS'] };
  return { role: 'bot', text: deep ? "Good question. The headline for Lumen is the true-peak clipping — fix that first, then the low-mid carve. Want me to walk through either?" : "On a 9-second clip I'm working with limited data, but the low end and the near-mono image are the two things I'd watch as this grows.", gnd: [] };
}

// Tweaks removed — fixed to Track: Deep, State: Complete.


ReactDOM.createRoot(document.getElementById('root')).render(<App />);
