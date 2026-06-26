/* spectre — Plan screen: depth/degraded banners, Move cards, deepen, coach, export. */
const { useState: useStateP, useRef: useRefP, useEffect: useEffectP } = React;

// ── Depth-unlock banner (mix-only inputs) ────────────────────────────
function DepthBanner() {
  return (
    <div className="depth fade-up">
      <div className="depth-ic"><Icon name="layers" size={17} /></div>
      <div className="depth-body">
        <div className="t">You gave us a mix — here&rsquo;s the plan from what we can hear.</div>
        <div className="s">Add your <span className="em">stems</span> or <span className="em">.als</span> to turn these into device-specific fixes with exact settings.</div>
      </div>
      <div className="depth-cta"><button className="btn sm">Add files</button></div>
    </div>
  );
}

// ── Degraded banner (LLM specialists paused — rule findings only) ─────
function DegradedBanner() {
  return (
    <div className="degraded fade-up">
      <span className="dg-ic"><Icon name="layers" size={16} /></span>
      <div className="dg-body">
        <div className="t">Rule-based findings only</div>
        <div className="s">AI specialists are paused (budget). The deterministic checks below — loudness, true-peak, dynamics, key — still ran on every metric.</div>
      </div>
      <button className="btn sm">Resume specialists</button>
    </div>
  );
}

// ── Triage controls (three variants) ─────────────────────────────────
function TriageButtons({ status, set }) {
  return (
    <div className="triage-buttons">
      <button className={`triage-add${status === 'committed' ? ' committed' : ''}`}
        onClick={() => set(status === 'committed' ? 'suggested' : 'committed')}>
        <Icon name={status === 'committed' ? 'check' : 'plus'} size={14} />
        {status === 'committed' ? 'In plan' : 'Add to plan'}
      </button>
    </div>
  );
}
function TriageSegmented({ status, set }) {
  const opts = [['suggested', 'Suggested'], ['trying', 'Trying'], ['committed', 'In plan']];
  return (
    <div className="triage-seg">
      {opts.map(([s, l]) => (
        <button key={s} data-s={s} className={status === s ? 'on' : ''} onClick={() => set(s)}>
          {s === 'committed' && status === s && <Icon name="check" size={11} />}{l}
        </button>
      ))}
    </div>
  );
}
function TriageMenu({ status, set }) {
  const [open, setOpen] = useStateP(false);
  const ref = useRefP(null);
  useEffectP(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const label = { suggested: 'Add to plan', trying: 'Trying', committed: 'In plan', dismissed: 'Dismissed' }[status];
  const committed = status === 'committed';
  return (
    <div className="triage-menu" ref={ref}>
      <button className={`triage-add${committed ? ' committed' : ''}`} onClick={() => setOpen(o => !o)}>
        <Icon name={committed ? 'check' : 'plus'} size={14} />{label}
        <span style={{ fontSize: 9, opacity: .6, marginLeft: 2 }}>▾</span>
      </button>
      {open && (
        <div className="triage-menu-pop">
          {[['committed', 'In my plan', 'var(--green)'], ['trying', 'Trying it', 'var(--orange)'], ['suggested', 'Just suggested', 'var(--muted)'], ['dismissed', 'Dismiss', 'var(--muted)']].map(([s, l, c]) => (
            <button key={s} onClick={() => { set(s); setOpen(false); }}>
              <span className="dot" style={{ background: c }} />{l}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Evidence renderer (the measurement behind a move) ────────────────
function Evidence({ ev }) {
  return (
    <div className="evidence">
      <div className="evidence-hd">
        <span className="lab">The data</span>
        <span className="metric">{ev.label}<i className="path">{ev.metric}</i></span>
      </div>
      {ev.type === 'spectrum' && <MiniSpectrum warnBands={ev.warnBands} />}
      {ev.type === 'meter' && <MiniMeter value={ev.value} min={ev.min} max={ev.max} target={ev.target} targetLabel={ev.targetLabel} />}
      {ev.type === 'structure' && <StructureStrip height={30} labels />}
      {ev.type === 'none' && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-2)', padding: '8px 0', letterSpacing: '.04em' }}>{ev.label}</div>
      )}
    </div>
  );
}

// ── The Move card (the atom) — leads with the problem, then the fix ──
function MoveCard({ move, t, status: statusProp, setStatus: setStatusProp }) {
  const [localStatus, setLocal] = useStateP('suggested');
  const status = statusProp !== undefined ? statusProp : localStatus;
  const setStatus = setStatusProp || setLocal;
  const isWin = move.kind === 'win';
  const [showWhy, setShowWhy] = useStateP(false);
  const [showData, setShowData] = useStateP(t.evidence === 'inline');
  const shallow = t.inputDepth === 'mix';
  const c = RP_SEV[move.sev];
  const expanded = showWhy || showData;
  const Triage = t.triage === 'segmented' ? TriageSegmented : t.triage === 'menu' ? TriageMenu : TriageButtons;

  return (
    <div className="move fade-up" data-status={isWin ? undefined : status} data-kind={move.kind} data-move-n={move.n}
      data-new={move._new ? 'true' : undefined} style={{ '--sev': c }}>
      <div className="move-main">
        {/* problem reference — the finding this move addresses */}
        <div className="move-prob">
          <span className="mp-dot" />
          <span className="mp-lab">{isWin ? 'Working' : 'Fixing'}</span>
          {!isWin && <span className="mp-head">{move.problem.headline}</span>}
          <span className="mp-spacer" />
          <span className="mp-metric mono">{move.problem.value}</span>
          <span className="mp-sev">{RP_SEV_LABEL[move.sev]}</span>
        </div>

        <div className="move-top">
          <div className="move-title">{move.title}</div>
          {move._new && <span className="move-new">just added</span>}
        </div>

        {/* Directive — the hero (or the observation body for wins) */}
        {isWin ? (
          <div className="win-body">{move.why}</div>
        ) : shallow ? (
          <Directive text={move.directional} className="directional" />
        ) : t.directive === 'steps' ? (
          <div className="steps">
            {move.steps.map((s, i) => (
              <div className="step" key={i}>
                <span className="where">{s.where}</span>
                <span className="xform">
                  <span className="from">{s.from}</span><span className="ar">→</span><span className="to">{s.to}</span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Directive text={move.directive} scope={move.scope} />
        )}

        {/* foot: confidence + source + quiet why/data links + actions */}
        <div className="move-foot">
          {isWin ? (
            <span className="move-noact mono"><Icon name="check" size={12} />no action needed</span>
          ) : (
            <span className="move-conf" title="Model confidence — higher = more certain this fix is right">
              <span className="cv">{Math.round(move.confidence * 100)}%</span>conf
            </span>
          )}
          {t.showSource && <span className="move-signal"><span className="src">{move.source}</span></span>}
          <span className="foot-spacer" />
          {t.evidence === 'ondemand' && !isWin && (
            <button className={`linkbtn${showWhy ? ' on' : ''}`} onClick={() => setShowWhy(v => !v)}>why<span className="chev">▾</span></button>
          )}
          {t.evidence === 'ondemand' && (
            <button className={`linkbtn${showData ? ' on' : ''}`} onClick={() => setShowData(v => !v)}>data<span className="chev">▾</span></button>
          )}
          {!isWin && <button className="mini-btn audition"><Icon name="play" size={12} />Audition</button>}
          {!isWin && <Triage status={status} set={setStatus} />}
        </div>
      </div>

      {(expanded || t.evidence === 'inline') && (
        <div className="move-expand">
          {(showWhy || (t.evidence === 'inline' && !isWin)) && (
            <div className="why-block">
              <span className="q">?</span>
              <span className="why-text">{move.why}</span>
            </div>
          )}
          {(showData || t.evidence === 'inline') && <Evidence ev={move.evidence} />}
        </div>
      )}
    </div>
  );
}

// ── Deepen-your-plan zone ────────────────────────────────────────────
function DeepenCard({ d, onRun }) {
  const [running, setRunning] = useStateP(false);
  const run = () => {
    if (running) return;
    setRunning(true);
    setTimeout(() => onRun(d), 1500);
  };
  return (
    <div className="deepen-card">
      <div className="di"><Icon name="sparkle" size={16} /></div>
      <div className="db">
        <div className="t">{d.title}</div>
        <div className="s">{d.sub}</div>
      </div>
      <button className={`deepen-buy${running ? ' running' : ''}`} onClick={run}>
        {running
          ? <><span className="eqdots"><i /><i /><i /></span>Running…</>
          : <><Icon name="plus" size={13} />Run <span className="cr">{d.credits} cr</span></>}
      </button>
    </div>
  );
}

function DeepenZone({ onRun, ranIds = [] }) {
  const remaining = RP_DEEPEN.filter(d => !ranIds.includes(d.id));
  if (remaining.length === 0) {
    return (
      <div className="deepen-done">
        <span className="ic"><Icon name="check" size={15} /></span>
        Recommended specialists all run — their fixes were added to your plan above.
      </div>
    );
  }
  return (
    <div>
      <div className="deepen">
        {remaining.map(d => <DeepenCard key={d.id} d={d} onRun={onRun} />)}
      </div>
      <div className="deepen-advanced">
        <button>Browse all 26 specialists →</button>
      </div>
    </div>
  );
}

// ── Song header (image, name, version, measured meta, inputs, actions) ─
function SongHeader({ inputDepth = 'als' }) {
  const [queued, setQueued] = useStateP(false);
  return (
    <div className="songhdr fade-up">
      <div className="sh-cover">
        <CoverArt hue={RP_TRACK.coverHue} size={94} radius={12} badge={'v' + RP_TRACK.version.replace(/\D/g, '')} />
      </div>
      <div className="sh-info">
        <div className="sh-titlerow">
          <span className="sh-name">{RP_TRACK.name}</span>
        </div>
        <div className="sh-meta">
          <span className="ver">{RP_TRACK.version}</span>
          <span className="sep">·</span><span>{RP_TRACK.genre}</span>
          <span className="sep">·</span><span className="mono">{RP_TRACK.bpm} BPM</span>
          <span className="sep">·</span><KeyBadge k={RP_TRACK.key} confidence={RP_TRACK.keyConfidence} />
          <span className="sep">·</span><span className="mono">{RP_TRACK.durationLabel}</span>
        </div>
        <div className="sh-inputs">
          <span className="il">Analyzed from</span>
          {RP_INPUTS.map(f => {
            const present = rpPresent(f.tier, inputDepth);
            return (
              <span key={f.id} className={`ichip${present ? ' on' : ''}`}>
                {present ? <Icon name="check" size={11} /> : <span className="pl">+</span>}{f.l}
              </span>
            );
          })}
        </div>
      </div>
      <div className="sh-actions">
        <a className="sh-btn primary" href="Listen Page.html">
          <Icon name="play" size={14} />
          <span className="lbl">Open in Listen</span>
          <span className="sub">try the fixes</span>
        </a>
        <button className={`sh-btn ghost${queued ? ' done' : ''}`} onClick={() => setQueued(true)}>
          {queued ? <><Icon name="check" size={14} /><span className="lbl">In public queue</span></>
            : <><Icon name="users" size={15} /><span className="lbl">Get human feedback</span></>}
        </button>
      </div>
    </div>
  );
}

// ── Coach banner (sits right under the header) ───────────────────────
function CoachBanner() {
  const [open, setOpen] = useStateP(true);
  const [msgs, setMsgs] = useStateP([]);
  const [draft, setDraft] = useStateP('');
  const [thinking, setThinking] = useStateP(false);
  const body = useRefP(null);
  useEffectP(() => { if (body.current) body.current.scrollTop = body.current.scrollHeight; }, [msgs, thinking]);

  const send = (text) => {
    const q = (text || draft).trim();
    if (!q) return;
    setDraft('');
    setOpen(true);
    setMsgs(m => [...m, { from: 'user', text: q }]);
    setThinking(true);
    setTimeout(() => {
      setThinking(false);
      setMsgs(m => [...m, { from: 'bot', text: RP_COACH_REPLY, gnd: 'cites: true-peak finding · move #1' }]);
    }, 650);
  };

  return (
    <div className="coachbanner fade-up">
      <div className="cb-head">
        <div className="cb-bot"><TranceBot size={62} thinking={thinking} /></div>
        <div className="cb-htext">
          <div className="cb-kicker">
            <span className="lab">Ask the coach</span>
            <span className="led pulse" />
            <span className="on">online · trained on your analysis</span>
          </div>
          <div className="cb-title">Ask anything about this mix</div>
          <div className="cb-sub">
            {RP_COACH_INTRO}
            <button className="cb-toggle" onClick={() => setOpen(o => !o)}>{open ? 'hide' : 'show'}</button>
          </div>
        </div>
        <span className="cb-pill">grounded · this analysis</span>
      </div>

      {open && (
        <div className="cb-body">
          {msgs.length > 0 && (
            <div className="cb-thread" ref={body}>
              {msgs.map((m, i) => (
                <div className={`cmsg ${m.from}`} key={i}>
                  <div className="bub">{m.text}{m.gnd && <span className="gnd">{m.gnd}</span>}</div>
                </div>
              ))}
              {thinking && (
                <div className="cmsg bot">
                  <div className="bub"><span className="eqdots"><i /><i /><i /></span></div>
                </div>
              )}
            </div>
          )}
          <div className="cb-chips">
            {RP_COACH_CHIPS.map(c => <button key={c} onClick={() => send(c)}>{c}</button>)}
          </div>
          <div className="cb-input">
            <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Ask anything about this mix…" />
            <button className="send" onClick={() => send()}><Icon name="send" size={16} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Export bar ───────────────────────────────────────────────────────
function ExportBar({ onExport, committedCount }) {
  return (
    <div className="exportbar">
      <div className="eb-ic"><Icon name="download" size={18} /></div>
      <div className="eb-body">
        <div className="t">Export Game Plan</div>
        <div className="s"><span className="v">{committedCount}</span> committed moves → a checklist .md for your notes app</div>
      </div>
      <button className="btn" onClick={onExport}>Preview</button>
      <button className="btn primary" onClick={onExport}><Icon name="download" size={14} />Export .md</button>
    </div>
  );
}

// ── Running state ────────────────────────────────────────────────────
function RunningState() {
  const done = RP_PHASES.filter(p => p.s === 'done').length;
  return (
    <div className="running-wrap fade-up">
      <div className="card">
        <div className="card-hd"><span className="t"><span className="led pulse" />Analyzing your mix…</span><span className="meta">{done} / {RP_PHASES.length} phases</span></div>
        <div className="card-body">
          {RP_PHASES.map((p, i) => (
            <div className="phase-row" key={i}>
              <span className={`phase-ic ${p.s}`}>
                {p.s === 'done' && <Icon name="check" size={12} />}
                {p.s === 'run' && <span className="eqdots"><i /><i /><i /></span>}
              </span>
              <span className="pn" style={{ color: p.s === 'wait' ? 'var(--muted)' : 'var(--text)' }}>{p.l}</span>
              <span className="pd">{p.d}</span>
            </div>
          ))}
        </div>
      </div>
      <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12.5, marginTop: 18 }}>
        Your plan will appear here as soon as the specialists weigh in.
      </p>
    </div>
  );
}

Object.assign(window, {
  SongHeader, DepthBanner, DegradedBanner, MoveCard, Evidence, DeepenZone, CoachBanner, ExportBar, RunningState,
});
