/* spectre — Fix Rack (Phase 2 "act on them" layer). Turns committed fixable Moves
 * into a mastering RackChain you can hear in Listen.
 *   States: idle → generating (POST→poll) → ready → empty.
 * Mirrors the live contract: POST /reports/{jobId}/fix-rack (202 queued) → poll
 * GET (204 until ready → 200 FixRackDto). The chain is byte-identical to the one
 * the Listen rack loads, so "Open in Listen rack" hands it straight over.
 *
 * The change_log / leftover_advice "coaching layer" is solver-computed but NOT
 * wired day one — the panel reserves room and shows its placeholder until then. */
const { useState: useStateFx, useEffect: useEffectFx, useRef: useRefFx } = React;

function FixModule({ m, onGoToMove }) {
  return (
    <div className="fxmod" style={{ '--ac': m.accent }}>
      <div className="fxmod-hd">
        <span className="fxmod-glyph" style={{ color: m.accent, borderColor: m.accent }}>{m.glyph}</span>
        <div className="fxmod-t">
          <span className="fxmod-l">{m.label}</span>
          <span className="fxmod-s">{m.sub}</span>
        </div>
        <span className="fxmod-on" title="enabled in the chain"><span className="dot" />on</span>
      </div>
      <div className="fxmod-settings">
        {m.settings.map((s, i) => (
          <div className="fxset" key={i}>
            <span className="fxset-ctl">{s.ctl}</span>
            <span className="fxset-val mono">{s.val}</span>
            {s.move
              ? <button className="fxset-move" onClick={() => onGoToMove(s.move)}>Move {s.move}</button>
              : <span className="fxset-auto mono">auto</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function CoachingPanel({ rack, mode, onGoToMove }) {
  if (mode === 'placeholder') {
    return (
      <div className="fx-coach placeholder">
        <span className="fxc-ic"><Icon name="sparkle" size={15} /></span>
        <div className="fxc-body">
          <div className="fxc-t">Why these settings &middot; what&rsquo;s left <span className="fxc-soon">soon</span></div>
          <div className="fxc-s">The solver already computes a note for every module and the problems a master rack can&rsquo;t fix. That coaching layer isn&rsquo;t wired to the page yet — this panel is holding its place.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="fx-coach">
      <div className="fxc-col">
        <div className="fxc-h"><Icon name="check" size={13} />What changed</div>
        {rack.changeLog.map((c, i) => <div className="fxc-line" key={i}><span className="fxc-dot" />{c}</div>)}
      </div>
      <div className="fxc-col">
        <div className="fxc-h alt"><Icon name="layers" size={13} />What a rack can&rsquo;t fix</div>
        {rack.leftovers.map((l, i) => (
          <div className="fxc-line" key={i}>
            <span className="fxc-dot alt" />
            <span><b>{l.headline}.</b> {l.why} {l.move && <button className="fxc-move" onClick={() => onGoToMove(l.move)}>see Move {l.move}</button>}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FixRack({ t, committedFixable, onGoToMove }) {
  const forced = t.fixRack;                 // 'flow' | 'generating' | 'ready' | 'empty'
  const coaching = t.fixCoaching || 'placeholder';
  const clean = t.state === 'clean';
  const [phase, setPhase] = useStateFx('idle');
  const timer = useRefFx(null);

  // forced tweak overrides the interactive flow (for review)
  const effective = forced === 'flow' ? phase : forced;
  const isEmpty = forced === 'empty' || clean || committedFixable === 0;

  useEffectFx(() => () => clearTimeout(timer.current), []);
  const generate = () => {
    setPhase('generating');                 // POST → 202 queued
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPhase('ready'), 1600);  // poll 204…204→200
  };

  const rack = RP_FIXRACK;
  const fromMoves = new Set();
  rack.modules.forEach(m => m.moves.forEach(n => fromMoves.add(n)));

  // ── empty ──
  if (isEmpty) {
    return (
      <div className="fixrack empty fade-up">
        <span className="fx-ic clean"><Icon name="check" size={18} /></span>
        <div className="fx-body">
          <div className="fx-t">Nothing to apply</div>
          <div className="fx-s">{RP_FIXRACK_EMPTY.reason} When a fix needs a rack, the button shows up here.</div>
        </div>
      </div>
    );
  }

  // ── idle ──
  if (effective === 'idle') {
    return (
      <div className="fixrack idle fade-up">
        <span className="fx-ic"><Icon name="sliders" size={18} /></span>
        <div className="fx-body">
          <div className="fx-t">Generate fix rack</div>
          <div className="fx-s">Bundle your committed fixes into a mastering chain you can hear in Listen — built from <b>{committedFixable}</b> {committedFixable === 1 ? 'move' : 'moves'} across EQ, glue &amp; limiter.</div>
        </div>
        <button className="fx-gen" onClick={generate}><Icon name="sparkle" size={14} />Generate</button>
      </div>
    );
  }

  // ── generating ──
  if (effective === 'generating') {
    return (
      <div className="fixrack generating fade-up">
        <span className="fx-ic busy"><span className="eqdots"><i /><i /><i /></span></span>
        <div className="fx-body">
          <div className="fx-t">Solving your chain…</div>
          <div className="fx-s">Ordering modules and dialing in settings from your committed moves. This runs on a worker — a few seconds.</div>
          <div className="fx-poll mono">POST /fix-rack · 202 queued · polling…</div>
        </div>
      </div>
    );
  }

  // ── ready ──
  return (
    <div className="fixrack ready fade-up">
      <div className="fx-head">
        <span className="fx-ic done"><Icon name="sliders" size={18} /></span>
        <div className="fx-body">
          <div className="fx-t">{rack.name}</div>
          <div className="fx-s">{rack.modules.length} modules · from {fromMoves.size} committed moves · <span className="mono">{rack.createdAt}</span></div>
        </div>
        <div className="fx-actions">
          <button className="fx-regen" onClick={() => setPhase('idle')}><Icon name="refresh" size={13} />Regenerate</button>
          <a className="fx-open" href="Listen Page.html"><Icon name="play" size={14} />Open in Listen rack</a>
        </div>
      </div>

      <div className="fx-chainbar">
        <span className="fxcb-l mono">signal</span>
        <span className="fxcb-in">in</span>
        {rack.order.map((id, i) => {
          const m = rack.modules.find(x => x.id === id);
          return <React.Fragment key={id}>
            <span className="fxcb-arrow">→</span>
            <span className="fxcb-node" style={{ '--ac': m.accent }}>{m.glyph} {m.label}</span>
          </React.Fragment>;
        })}
        <span className="fxcb-arrow">→</span>
        <span className="fxcb-out">out</span>
      </div>

      <div className="fx-modules">
        {rack.order.map(id => <FixModule key={id} m={rack.modules.find(x => x.id === id)} onGoToMove={onGoToMove} />)}
      </div>

      <CoachingPanel rack={rack} mode={coaching} onGoToMove={onGoToMove} />
    </div>
  );
}

Object.assign(window, { FixRack });
