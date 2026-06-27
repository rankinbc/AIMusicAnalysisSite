/* spectre — Analysis Results redesign. Debug tab (power-user).
   Pipeline diagram (nodes=phases, edges=deps, colored by status) + per-phase I/O
   + the full raw finalJson and verdicts payload. The data-dump exception. */
const { useState: useStateDb } = React;

// node layout in a 560×300 space
const AR_DBG_POS = {
  4: { x: 70, y: 42 }, 9: { x: 196, y: 50 }, 3: { x: 330, y: 50 },
  1: { x: 70, y: 150 }, 2: { x: 196, y: 150 }, 5: { x: 330, y: 130 },
  6: { x: 330, y: 210 }, 7: { x: 460, y: 150 }, 8: { x: 70, y: 258 },
};

// inputs description per phase
const AR_PHASE_INPUTS = {
  1: ['audio · mix'],
  2: ['audio · mix', 'phase 1 data'],
  3: ['audio · mix', 'genre (phase 2)', 'phase 1 data'],
  4: ['audio · mix', 'stems (if present)'],
  5: ['audio · mix', 'reference', 'phase 1 data', 'genre'],
  6: ['genre', 'phase 1 data'],
  7: ['structure (phase 1)', 'genre'],
  8: ['.als project'],
  9: ['phase 1 data · mix'],
};

function topLevel(scenario) {
  if (scenario.id === 'deep') return {
    grade: 'B', overall_score: 78.4, danceability_score: 72, coach_name: 'Coach',
    coach_intro: "Solid master — fix the true-peak first, then the low-mids.",
    top_fixes: ['Tame true-peak overshoot on the master (−1.0 dBTP)', 'Carve low-mid congestion at 280 Hz', 'Bring loudness to −14 LUFS for streaming'],
  };
  return {
    grade: 'F', overall_score: 42.611, danceability_score: 20, coach_name: 'Coach',
    coach_intro: "Here's what I'd focus on to push this mix forward:",
    coached_fixes: ['Your integrated loudness (-16.9 LUFS) is sitting below the sweet spot for Spotify (-14.0 LUFS). You have headroom — nudge your master limiter ceiling up slightly and re-check.'],
    top_fixes: ['EQ clash between low-end buildup: reduce sub-bass / bass (20–200 Hz)', 'EQ clash between low-mid congestion: reduce low-mid (200–500 Hz)', 'Optimize mix levels for streaming targets'],
  };
}

function verdictsPayload(scenario) {
  return {
    verdicts: scenario.findings.map((f, i) => ({
      id: `vd_${scenario.id}_${i}`, specialist: f.spec, severity: f.sev, category: f.group,
      source: f.source === 'ai' ? 'llm_identifier' : 'rule_engine',
      confidence: scenario.moves.find(m => m.findingId === f.id)?.conf ?? 0.5,
      headline: f.headline, metricLine: f.metric || null, whyItMatters: f.why || null,
      fixable: !!f.fixId, fix: f.fixId ? { fix_id: f.fixId, target: { name: scenario.moves.find(m => m.id === f.fixId)?.scope } } : null,
    })),
    specialists: AR_SPECIALISTS.map(s => ({ slug: s.slug, status: scenario.specRuns[s.slug] ? 'cached' : 'idle' })),
    degradation: null,
  };
}

function PipelineDiagram({ raw, sel, onSel }) {
  const edges = [];
  Object.entries(AR_PIPE_DEPS).forEach(([n, deps]) => deps.forEach(d => {
    if (AR_DBG_POS[n] && AR_DBG_POS[d]) edges.push([AR_DBG_POS[d], AR_DBG_POS[+n], n]);
  }));
  const statusOf = (p) => raw.find(r => r.phase === p)?.status || 'skipped';
  return (
    <div className="dbg-diagram">
      <div className="dbg-graph" style={{ height: 300 }}>
        <svg viewBox="0 0 560 300" width="100%" height="300" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} preserveAspectRatio="xMidYMid meet">
          {edges.map(([a, b], i) => (
            <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(255,255,255,.12)" strokeWidth="1.4" />
          ))}
        </svg>
        {raw.map(r => {
          const pos = AR_DBG_POS[r.phase]; if (!pos) return null;
          return (
            <div key={r.phase} className={`dbg-node ${r.status}${sel === r.phase ? ' sel' : ''}`}
              style={{ left: `${(pos.x / 560) * 100}%`, top: pos.y }} onClick={() => onSel(r.phase)}>
              <div className="dn-box">
                <div className="dn-p">P{r.phase}</div>
                <div className="dn-n">{r.name.replace(/ (Analysis|Advice|Detection|Comparison|Scoring|Separation & Clash)$/, '')}</div>
                <div className="dn-s">{r.status}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DebugTab({ scenario }) {
  const raw = AR_RAW[scenario.id];
  const [sel, setSel] = useStateDb(1);
  const selPhase = raw.find(r => r.phase === sel) || raw[0];
  const finalJson = { ...topLevel(scenario), phases: raw };

  return (
    <div className="tabbody fade-up">
      <p className="dbg-intro">// raw pipeline I/O — finalJson.phases[] + verdicts. Click a node for its inputs &amp; outputs.</p>

      <PipelineDiagram raw={raw} sel={sel} onSel={setSel} />

      <div className="dbg-iohead">phase <span className="dn">P{selPhase.phase}</span> · {selPhase.name} · <span style={{ color: selPhase.status === 'ok' ? 'var(--accent)' : selPhase.status === 'failed' ? 'var(--red)' : 'var(--muted)' }}>{selPhase.status}</span></div>
      <div className="dbg-io">
        <div className="json-block">
          <div className="json-hd"><span className="jl">inputs</span></div>
          <div style={{ padding: '13px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(AR_PHASE_INPUTS[selPhase.phase] || []).map((inp, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--text-2)' }}>
                <Icon name="arrow" size={12} />{inp}
              </div>
            ))}
          </div>
        </div>
        <JsonView data={selPhase.data} label={`outputs · phase.data`} maxHeight={220} />
      </div>

      <div className="dbg-iohead">full payloads</div>
      <div className="dbg-io">
        <JsonView data={finalJson} label="GET /api/jobs/{id}/results → finalJson" maxHeight={360} />
        <JsonView data={verdictsPayload(scenario)} label="GET /api/reports/{id}/verdicts" maxHeight={360} />
      </div>
    </div>
  );
}

Object.assign(window, { DebugTab, PipelineDiagram });
