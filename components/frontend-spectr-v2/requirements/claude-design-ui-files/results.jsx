/* SPECTR — Redesigned Results page
 *
 * Information hierarchy fix:
 *  - Sticky VerdictHero with grade + score ring + 3 critical stats + streaming strip
 *  - Tabs: Overview / Spectrum / Reference / Arrangement / AI / Streaming
 *  - Overview = 2-col: LEFT action (Fix Queue + AI summary), RIGHT diagnostics rail
 *  - Specialists collapsed to a category summary instead of 27 raw tiles
 */

const { useState } = React;

function ResultsPage({ track, tweak, onBackToSong, songContext }) {
  const [tab, setTab] = useState('coach');
  return (
    <div style={{ maxWidth: 1360, margin: '0 auto', padding: '14px 24px 80px' }}>
      <ResultsHeader track={track} onBackToSong={onBackToSong} songContext={songContext} />
      <ResultsTabs current={tab} onChange={setTab} track={track} />
      {tab === 'coach'       && <AICoachTab track={track} />}
      {tab === 'analysis'    && <AnalysisTab track={track} />}
      {tab === 'spectrum'    && <SpectrumTab track={track} />}
      {tab === 'reference'   && <ReferenceTab track={track} />}
      {tab === 'arrangement' && <ArrangementTab track={track} />}
    </div>
  );
}

function ResultsHeader({ track, onBackToSong, songContext }) {
  const gc = gradeColor(track.grade);
  return (
    <div style={{ padding: '6px 2px 14px' }}>
      {onBackToSong && songContext && (
        <button onClick={onBackToSong} className="btn ghost sm" style={{
          marginBottom: 10, color: 'var(--muted)', fontSize: 11, padding: '4px 10px',
        }}>
          ← {songContext.name} · all versions
        </button>
      )}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        flexWrap: 'wrap',
      }}>
        <GradePill grade={track.grade} size="sm" />
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>{track.name}</span>
          <span className="mono" style={{ fontSize: 11, color: gc, marginLeft: 4 }}>
            {track.score}<span style={{ color: 'var(--dim)' }}>/100</span>
          </span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>· {Math.round(track.percentile)}th pct</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span className="pill cyan">{track.genre.name}</span>
          <span className="pill"><span className="mono">{track.bpm}</span> BPM</span>
          <span className="pill"><span className="mono">{track.key}</span></span>
          <span className="pill"><span className="mono">{track.loudness.integrated.toFixed(1)}</span> LUFS</span>
        </div>
      </div>
    </div>
  );
}

// ── Verdict hero ──────────────────────────────────────────────────────────

function VerdictHero({ track }) {
  const verdictText = { A: 'Release-ready', B: 'Almost there', C: 'Work needed', D: 'Major issues', F: 'Start over' }[track.grade[0]] ?? track.grade;
  const gc = gradeColor(track.grade);

  return (
    <div className="card" style={{ overflow: 'hidden', marginBottom: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', alignItems: 'stretch' }}>
        {/* LEFT — grade + verdict */}
        <div style={{
          padding: '22px 26px',
          borderRight: '1px solid var(--border)',
          background: `radial-gradient(ellipse 90% 80% at 10% 50%, ${gc}10, transparent 65%)`,
          display: 'flex', alignItems: 'center', gap: 18,
        }}>
          <GradePill grade={track.grade} size="lg" />
          <div>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--muted)', textTransform: 'uppercase' }}>VERDICT</div>
            <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4, color: gc }}>{verdictText}</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              <span style={{ color: gc }}>{track.score}</span><span style={{ color: 'var(--dim)' }}>/100</span> · {Math.round(track.percentile)}th pct in {track.genre.name}
            </div>
          </div>
        </div>

        {/* RIGHT — track meta + key metrics */}
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>{track.name}</div>
            <span className="pill cyan">{track.genre.name}</span>
            <span className="pill"><span className="mono">{track.bpm}</span> BPM</span>
            <span className="pill"><span className="mono">{track.key}</span></span>
            <span className="pill"><span className="mono">{track.format.split(' · ')[0]}</span></span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            <HeroMetric label="Loudness"  value={`${track.loudness.integrated.toFixed(1)}`} unit="LUFS" tone={track.loudness.integrated > -12 ? 'var(--orange)' : 'var(--cyan)'} sub="2.8 LU over Spotify" />
            <HeroMetric label="True peak" value={`${track.loudness.truePeak.toFixed(1)}`} unit="dBTP" tone="var(--cyan)" sub="safe (-1 ceiling)" />
            <HeroMetric label="Dyn range" value={`${track.loudness.dynamicRange.toFixed(1)}`} unit="LU" tone="var(--yellow)" sub="compressed" />
            <HeroMetric label="Dance"     value={track.danceScore} unit="/100" tone="var(--cyan)" sub="high energy" />
          </div>
        </div>
      </div>
    </div>
  );
}

function DimensionRow({ d }) {
  const sevColors = { critical: 'var(--red)', warning: 'var(--orange)', info: 'var(--cyan)' };
  const dot = sevColors[d.sev] || 'var(--muted)';
  const trend = d.change > 0 ? `↑${d.change}` : d.change < 0 ? `↓${Math.abs(d.change)}` : '·';
  const trendCol = d.change > 0 ? 'var(--green)' : d.change < 0 ? 'var(--red)' : 'var(--muted)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: dot, boxShadow: `0 0 6px ${dot}88`, flexShrink: 0 }} />
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', minWidth: 78 }}>{d.label}</span>
      <div style={{ flex: 1, height: 4, background: 'var(--dim)', borderRadius: 2, overflow: 'hidden' }}>
        <div className="fill-w" style={{
          height: '100%', width: `${d.score}%`,
          background: d.score >= 80 ? 'var(--cyan)' : d.score >= 65 ? 'var(--yellow)' : 'var(--orange)',
          borderRadius: 2,
          boxShadow: d.score >= 80 ? '0 0 4px rgba(0,229,176,0.4)' : 'none',
        }} />
      </div>
      <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', width: 22, textAlign: 'right' }}>{d.score}</span>
      <span className="mono" style={{ fontSize: 9, color: trendCol, width: 20, textAlign: 'right' }}>{trend}</span>
      {d.findings > 0 && (
        <span className="mono" style={{ fontSize: 9, color: dot, minWidth: 12, textAlign: 'right' }}>{d.findings}●</span>
      )}
    </div>
  );
}

function AnalysisStatusRow({ group }) {
  const items = group.items;
  const cached   = items.filter(i => i.status === 'cached').length;
  const running  = items.filter(i => i.status === 'running').length;
  const disabled = items.filter(i => i.status === 'disabled').length;
  const total    = items.length;
  const enabled  = total - disabled;
  const idle     = enabled - cached - running;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '5px 0',
    }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', minWidth: 88 }}>{group.label}</span>
      <div style={{ display: 'flex', gap: 2, flex: 1 }}>
        {items.map((it, i) => {
          const m = {
            cached:   { color: 'var(--cyan)',   glow: true,  pulse: false },
            running:  { color: 'var(--violet)', glow: true,  pulse: true  },
            idle:     { color: 'rgba(255,255,255,0.10)', glow: false, pulse: false },
            disabled: { color: 'var(--dim)',    glow: false, pulse: false },
            error:    { color: 'var(--red)',    glow: true,  pulse: false },
          }[it.status] || { color: 'rgba(255,255,255,0.10)' };
          return (
            <div key={i} title={`${it.label} · ${it.status}`} style={{
              flex: 1, height: 6, borderRadius: 2,
              background: m.color,
              boxShadow: m.glow ? `0 0 4px ${m.color}` : 'none',
              animation: m.pulse ? 'pulse 1.1s ease-in-out infinite' : 'none',
            }} />
          );
        })}
      </div>
      <span className="mono" style={{
        fontSize: 10, color: cached === enabled && enabled > 0 ? 'var(--cyan)' : 'var(--text-2)',
        width: 30, textAlign: 'right',
      }}>
        {cached}<span style={{ color: 'var(--dim)' }}>/{enabled}</span>
      </span>
      <span style={{ width: 18, fontSize: 10, textAlign: 'right' }}>
        {running > 0 ? <EQDots count={3} color="var(--violet)" height={9} />
        : disabled > 0 ? <span className="mono" style={{ color: 'var(--muted)' }}>⨯</span>
        : cached === enabled ? <span style={{ color: 'var(--cyan)' }}>✓</span>
        : <span className="mono" style={{ color: 'var(--orange)' }}>{idle}</span>}
      </span>
    </div>
  );
}

function PipelineRow({ row }) {
  const isDone    = row.status === 'done';
  const isPartial = row.status === 'partial';
  const isMissing = row.status === 'missing';
  const isRunning = row.status === 'running';

  const icon = (() => {
    if (isDone) return (
      <span style={{
        width: 16, height: 16, borderRadius: '50%',
        background: 'rgba(0,229,176,0.14)',
        border: '1px solid rgba(0,229,176,0.4)',
        color: 'var(--cyan)',
        display: 'grid', placeItems: 'center',
        fontSize: 9, fontWeight: 800,
      }}>✓</span>
    );
    if (isPartial) return (
      <span style={{
        width: 16, height: 16, borderRadius: '50%',
        background: 'rgba(251,146,60,0.10)',
        border: '1.5px solid rgba(251,146,60,0.5)',
        position: 'relative',
        display: 'grid', placeItems: 'center',
      }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--orange)', boxShadow: '0 0 4px var(--orange)' }} />
      </span>
    );
    if (isRunning) return (
      <span style={{
        width: 16, height: 16, borderRadius: '50%',
        background: 'rgba(167,139,250,0.10)',
        border: '1.5px solid rgba(167,139,250,0.5)',
        display: 'grid', placeItems: 'center',
        animation: 'pulseGlow 1.4s ease-in-out infinite',
      }}>
        <EQDots count={3} color="var(--violet)" height={7} />
      </span>
    );
    // missing
    return (
      <span style={{
        width: 16, height: 16, borderRadius: '50%',
        border: '1.5px dashed rgba(255,255,255,0.18)',
      }} />
    );
  })();

  const labelColor =
    isDone    ? 'var(--text)'    :
    isPartial ? 'var(--text)'    :
    isMissing ? 'var(--muted)'   : 'var(--text-2)';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 9,
      padding: '5px 0',
    }}>
      {icon}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: labelColor, whiteSpace: 'nowrap' }}>{row.label}</span>
          {row.unlocks != null && (
            <span className="mono" style={{ fontSize: 8.5, color: 'var(--violet)', whiteSpace: 'nowrap' }}>
              +{row.unlocks} specialist{row.unlocks === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 1 }}>
          <span className="mono" style={{
            fontSize: 9.5,
            color: isDone ? 'var(--muted)' : isPartial ? 'var(--orange)' : 'var(--dim)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1,
          }}>{row.detail}</span>
          {row.cta && (
            <button style={{
              fontSize: 9.5, fontWeight: 700,
              color: isPartial ? 'var(--cyan)' : 'var(--violet)',
              padding: '1px 7px', borderRadius: 4,
              background: isPartial ? 'rgba(0,229,176,0.08)' : 'rgba(167,139,250,0.10)',
              border: `1px solid ${isPartial ? 'rgba(0,229,176,0.32)' : 'rgba(167,139,250,0.32)'}`,
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              fontFamily: 'JetBrains Mono, monospace',
            }}>{row.cta}</button>
          )}
        </div>
        {isPartial && row.progress != null && (
          <div style={{ height: 2, background: 'var(--dim)', borderRadius: 1, marginTop: 3 }}>
            <div style={{ height: '100%', width: `${row.progress * 100}%`, background: 'var(--orange)', borderRadius: 1 }} />
          </div>
        )}
      </div>
    </div>
  );
}

function HeroMetric({ label, value, unit, tone, sub }) {  return (
    <div>
      <div className="mono" style={{ fontSize: 9, letterSpacing: '0.16em', color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 4 }}>
        <span className="mono" style={{ fontSize: 22, fontWeight: 700, color: tone }}>{value}</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{unit}</span>
      </div>
      {sub && <div className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────

function ResultsTabs({ current, onChange, track }) {
  const pipelineDone  = track.analysisPipeline.filter(p => p.status === 'done').length;
  const pipelineTotal = track.analysisPipeline.length;
  const tabs = [
    { id: 'coach',       label: 'AI Coach',     badge: track.coachSummary.total, badgeTone: 'cyan', featured: true },
    { id: 'analysis',    label: 'Analysis',     badge: `${pipelineDone}/${pipelineTotal}`, badgeTone: 'violet' },
    { id: 'spectrum',    label: 'Spectrum',     badge: null },
    { id: 'reference',   label: 'Reference',    badge: track.gap.filter(g => !g.inRange).length, badgeTone: 'orange' },
    { id: 'arrangement', label: 'Arrangement',  badge: '!', badgeTone: 'orange' },
  ];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      marginBottom: 20,
      borderBottom: '1px solid var(--border)',
      padding: '0 2px',
    }}>
      {tabs.map(t => {
        const active = current === t.id;
        const badgeColor =
          t.badgeTone === 'cyan'   ? 'var(--cyan)' :
          t.badgeTone === 'orange' ? 'var(--orange)' :
          t.badgeTone === 'red'    ? 'var(--red)' :
          'var(--muted)';
        return (
          <button key={t.id} onClick={() => onChange(t.id)}
            style={{
              padding: '12px 16px',
              fontSize: 13, fontWeight: 600, letterSpacing: '0.02em',
              color: active ? 'var(--text)' : 'var(--muted)',
              borderBottom: active ? '2px solid var(--cyan)' : '2px solid transparent',
              marginBottom: -1,
              display: 'flex', alignItems: 'center', gap: 8,
              transition: 'color .15s',
            }}>
            {t.featured && <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--cyan)',
              boxShadow: '0 0 8px var(--cyan)',
              animation: 'pulseGlow 1.8s ease-in-out infinite',
            }} />}
            <span>{t.label}</span>
            {t.badge != null && (
              <span className="mono" style={{
                fontSize: 9, padding: '1px 6px', borderRadius: 999,
                background: active ? `${badgeColor}1a` : 'rgba(255,255,255,0.04)',
                color: active ? badgeColor : 'var(--muted)',
                border: `1px solid ${active ? `${badgeColor}40` : 'var(--border)'}`,
                fontWeight: 700,
              }}>{t.badge}</span>
            )}
          </button>
        );
      })}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        <button className="btn sm">⇣ Export PDF</button>
        <button className="btn sm primary">↺ Re-analyze</button>
      </div>
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────

function OverviewTab({ track, tweak }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: tweak.density === 'compact' ? 'minmax(0,1fr) 340px' : 'minmax(0,1fr) 380px',
      gap: 20,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <FixQueueCard track={track} />
        <AISummaryCard track={track} />
      </div>
      <DiagnosticRail track={track} />
    </div>
  );
}

function FixQueueCard({ track }) {
  return (
    <div className="card">
      <div className="card-hd">
        <SectionTitle accent="var(--orange)" style={{ marginBottom: 0 }}>
          Fix queue · <span style={{ color: 'var(--text-2)' }}>top {track.fixes.length}</span>
        </SectionTitle>
        <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>ranked by impact</span>
      </div>
      <div style={{ padding: '8px 8px' }}>
        {track.fixes.map((f, i) => <FixItem fix={f} i={i} key={i} />)}
      </div>
    </div>
  );
}

function FixItem({ fix, i }) {
  const [open, setOpen] = useState(i === 0);
  const c = sevColor(fix.sev);
  return (
    <div style={{
      borderRadius: 8,
      background: open ? 'rgba(255,255,255,0.02)' : 'transparent',
      border: open ? `1px solid ${c}26` : '1px solid transparent',
      borderLeft: `3px solid ${c}`,
      marginBottom: 6,
      overflow: 'hidden',
      transition: 'background .15s',
    }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', textAlign: 'left',
        padding: '12px 14px',
        display: 'flex', alignItems: 'flex-start', gap: 14,
      }}>
        <span className="mono" style={{ fontSize: 22, fontWeight: 700, color: c, lineHeight: 1, opacity: 0.7 }}>
          {String(i + 1).padStart(2, '0')}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{fix.title}</div>
          <div className="mono" style={{ fontSize: 10, color: c, marginTop: 4, letterSpacing: '0.04em' }}>{fix.metricLine}</div>
        </div>
        {fix.badge && (
          <span className="pill" style={{ color: c, borderColor: `${c}44`, background: `${c}10` }}>{fix.badge}</span>
        )}
        <span style={{ color: 'var(--muted)', fontSize: 10, marginLeft: 6 }}>{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div style={{
          padding: '0 14px 14px 52px',
          fontSize: 13, color: 'var(--text-2)', lineHeight: 1.55,
        }}>
          <div>{fix.body}</div>
          {fix.coachFix && (
            <div style={{
              marginTop: 10, padding: '10px 12px',
              background: 'rgba(0,229,176,0.04)',
              border: '1px solid rgba(0,229,176,0.18)',
              borderRadius: 7,
              display: 'flex', gap: 10, alignItems: 'flex-start',
            }}>
              <span style={{ color: 'var(--cyan)', fontSize: 11, marginTop: 1 }}>◆</span>
              <div style={{ flex: 1, fontStyle: 'italic', fontSize: 12, color: 'var(--text-2)' }}>
                "{fix.coachFix}"
              </div>
              <button className="btn sm" style={{ fontSize: 10, padding: '4px 10px' }}>Apply preset</button>
            </div>
          )}
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <button className="btn sm">Mark fixed</button>
            <button className="btn ghost sm">Snooze</button>
            <button className="btn ghost sm" style={{ marginLeft: 'auto', color: 'var(--muted)' }}>Why this?</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AI summary card — replaces the 27-tile grid as the "Overview" surface ─

function AISummaryCard({ track }) {
  const cached = SPECIALIST_GROUPS_STATS;
  return (
    <div className="card">
      <div className="card-hd">
        <SectionTitle accent="var(--cyan)" style={{ marginBottom: 0 }}>
          AI specialists · <span style={{ color: 'var(--text-2)' }}>{cached.cached}/{cached.total} run</span>
        </SectionTitle>
        <button className="btn sm primary">Run all remaining</button>
      </div>
      <div style={{ padding: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {SPECIALIST_GROUPS.map(g => <SpecialistGroupCard group={g} key={g.id} />)}
      </div>

      {/* Top verdicts inline */}
      <div style={{ padding: '4px 14px 16px' }}>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--muted)', textTransform: 'uppercase', margin: '8px 0' }}>
          TOP FINDINGS
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {track.verdicts.map(v => <VerdictRow v={v} key={v.id} />)}
        </div>
      </div>
    </div>
  );
}

// Track-level stats for the AI Summary header
const SPECIALIST_GROUPS_STATS = (() => {
  let total = 0, cached = 0, running = 0, disabled = 0;
  for (const g of SPECIALIST_GROUPS) {
    for (const it of g.items) {
      total++;
      if (it.status === 'cached')   cached++;
      if (it.status === 'running')  running++;
      if (it.status === 'disabled') disabled++;
    }
  }
  return { total, cached, running, disabled };
})();

function SpecialistGroupCard({ group }) {
  const cached = group.items.filter(i => i.status === 'cached').length;
  const running = group.items.filter(i => i.status === 'running').length;
  const disabled = group.items.filter(i => i.status === 'disabled').length;
  const total = group.items.length;
  const findings = group.items.reduce((a, b) => a + (b.findings || 0), 0);
  const enabledTotal = total - disabled;
  const pct = enabledTotal ? cached / enabledTotal : 0;

  return (
    <div style={{
      padding: 12,
      background: 'rgba(255,255,255,0.018)',
      border: '1px solid var(--border)',
      borderRadius: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>{group.label}</span>
        <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>{cached}/{enabledTotal}</span>
      </div>
      {/* progress dots */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 8 }}>
        {group.items.map((it, i) => {
          const color =
            it.status === 'cached'   ? 'var(--cyan)' :
            it.status === 'running'  ? 'var(--violet)' :
            it.status === 'disabled' ? 'var(--dim)'  : 'rgba(255,255,255,0.10)';
          return (
            <div key={i} style={{
              flex: 1, height: 5, borderRadius: 1,
              background: color,
              animation: it.status === 'running' ? 'pulse 1s ease-in-out infinite' : 'none',
            }} />
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {findings > 0 ? (
          <span className="mono" style={{ fontSize: 10, color: 'var(--orange)' }}>{findings} finding{findings === 1 ? '' : 's'}</span>
        ) : running > 0 ? (
          <span className="mono" style={{ fontSize: 10, color: 'var(--violet)' }}>running…</span>
        ) : cached === enabledTotal && enabledTotal > 0 ? (
          <span className="mono" style={{ fontSize: 10, color: 'var(--cyan)' }}>no issues</span>
        ) : (
          <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{enabledTotal - cached} to run</span>
        )}
        <button className="mono" style={{
          marginLeft: 'auto', fontSize: 10, color: 'var(--muted)', padding: '2px 0',
        }}>open ›</button>
      </div>
    </div>
  );
}

function VerdictRow({ v }) {
  const c = sevColor(v.sev);
  return (
    <div style={{
      padding: '10px 12px',
      background: `${c}08`,
      borderRadius: 7,
      borderLeft: `2px solid ${c}`,
      display: 'flex', alignItems: 'flex-start', gap: 10,
    }}>
      <span className="mono" style={{ fontSize: 9, color: c, letterSpacing: '0.16em', textTransform: 'uppercase', marginTop: 2, minWidth: 70 }}>
        {v.specialist.replace(/_/g, ' ')}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{v.title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.4 }}>{v.summary}</div>
      </div>
    </div>
  );
}

// ── Diagnostic rail (right column on Overview) ────────────────────────────

function DiagnosticRail({ track }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PercentileCard track={track} />
      <LoudnessMiniCard track={track} />
      <FrequencyMiniCard track={track} />
      <StereoMiniCard track={track} />
      <ArrangementMiniCard track={track} />
    </div>
  );
}

function PercentileCard({ track }) {
  const p = Math.round(track.percentile);
  const col = p >= 70 ? 'var(--cyan)' : p >= 40 ? 'var(--yellow)' : 'var(--orange)';
  return (
    <div className="card card-body" style={{ padding: 16 }}>
      <SectionTitle accent={col}>Genre ranking</SectionTitle>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <ScoreRing value={p} max={100} size={72} color={col} stroke={5} label="" />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{p}th percentile</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>
            among {track.genre.name} releases
          </div>
        </div>
      </div>
    </div>
  );
}

function LoudnessMiniCard({ track }) {
  const lufs = track.loudness.integrated;
  const tp = track.loudness.truePeak;
  return (
    <div className="card card-body" style={{ padding: 16 }}>
      <SectionTitle accent="var(--orange)">Loudness</SectionTitle>
      <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: 'var(--orange)' }}>
        {lufs.toFixed(1)} <span style={{ fontSize: 11, color: 'var(--muted)' }}>LUFS</span>
      </div>
      <div style={{ marginTop: 10 }}>
        <MeterBar value={lufs} min={-24} max={0} color="var(--orange)" targets={[
          { v: -14, color: 'rgba(0,229,176,0.6)', label: 'Spotify' },
          { v: -16, color: 'rgba(167,139,250,0.6)', label: 'Apple' },
          { v: -10.8, color: 'rgba(255,255,255,0.32)', label: 'Genre median' },
        ]} marker />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
        <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>PEAK</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>{tp.toFixed(1)} dBTP</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>DYN RANGE</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--yellow)' }}>{track.loudness.dynamicRange.toFixed(1)} LU</span>
      </div>
      <Sparkline data={track.loudness.shortTermSeries} color="var(--orange)" width={300} height={36} />
    </div>
  );
}

function FrequencyMiniCard({ track }) {
  return (
    <div className="card card-body" style={{ padding: 16 }}>
      <SectionTitle accent="var(--cyan)" right={<span className="pill violet">{track.frequency.label}</span>}>
        Spectrum
      </SectionTitle>
      <div style={{ display: 'flex', gap: 4, height: 60, alignItems: 'flex-end' }}>
        {track.frequency.bands.map((b, i) => (
          <div key={i} style={{ flex: 1, position: 'relative', height: '100%', display: 'flex', alignItems: 'flex-end' }}>
            {track.frequency.genreMedianBands?.[i] != null && (
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                height: `${track.frequency.genreMedianBands[i] * 100}%`,
                background: 'rgba(255,255,255,0.10)',
                borderRadius: '2px 2px 0 0',
              }} />
            )}
            <div className="fill-h" style={{
              width: '100%', height: `${b.v * 100}%`,
              borderRadius: '2px 2px 0 0',
              background: b.warn
                ? 'linear-gradient(to top, var(--orange), rgba(251,146,60,0.3))'
                : 'linear-gradient(to top, var(--cyan), rgba(0,229,176,0.3))',
              animationDelay: `${i * 0.05}s`,
            }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        {track.frequency.bands.map((b, i) => (
          <div key={i} className="mono" style={{ flex: 1, fontSize: 7, color: b.warn ? 'var(--orange)' : 'var(--muted)', textAlign: 'center' }}>
            {b.n}
          </div>
        ))}
      </div>
    </div>
  );
}

function StereoMiniCard({ track }) {
  const w = track.stereo.width;
  const c = track.stereo.correlation;
  const m = Math.round(track.stereo.monoCompat * 100);
  return (
    <div className="card card-body" style={{ padding: 16 }}>
      <SectionTitle accent="var(--cyan)">Stereo</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <MiniStat label="Width"       value={`${w}%`}     color="var(--cyan)"  pct={w} />
        <MiniStat label="Correlation" value={c.toFixed(2)} color="var(--cyan)"  pct={(c + 1) * 50} />
        <MiniStat label="Mono compat" value={`${m}%`}     color="var(--cyan)"  pct={m} />
      </div>
    </div>
  );
}

function MiniStat({ label, value, color, pct }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.04em' }}>{label}</span>
        <span className="mono" style={{ fontSize: 11, color, fontWeight: 600 }}>{value}</span>
      </div>
      <div style={{ height: 3, background: 'var(--dim)', borderRadius: 2 }}>
        <div className="fill-w" style={{
          height: '100%', width: `${pct}%`, borderRadius: 2,
          background: color, boxShadow: `0 0 4px ${color}66`,
        }} />
      </div>
    </div>
  );
}

function ArrangementMiniCard({ track }) {
  const total = track.arrangement.sections.reduce((s, x) => s + x.bars, 0);
  const sectionColors = {
    intro: 'rgba(255,255,255,0.08)',
    buildup: 'rgba(0,229,176,0.40)',
    drop: 'rgba(251,146,60,0.65)',
    breakdown: 'rgba(167,139,250,0.55)',
    outro: 'rgba(255,255,255,0.08)',
  };
  return (
    <div className="card card-body" style={{ padding: 16 }}>
      <SectionTitle accent="var(--violet)" right={
        <span className="mono" style={{ fontSize: 10, color: 'var(--orange)' }}>
          score {track.arrangement.score}
        </span>
      }>Arrangement</SectionTitle>
      <div style={{ display: 'flex', gap: 1, height: 28, borderRadius: 4, overflow: 'hidden' }}>
        {track.arrangement.sections.map((sec, i) => (
          <div key={i} title={sec.l} style={{
            width: `${(sec.bars / total) * 100}%`,
            background: sectionColors[sec.t] || 'rgba(255,255,255,0.06)',
            position: 'relative',
          }}>
            {sec.flag && <div style={{ position: 'absolute', top: 3, right: 3, width: 4, height: 4, borderRadius: '50%', background: 'var(--orange)' }} />}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {track.arrangement.issues.slice(0, 2).map((iss, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--text-2)' }}>
            <span style={{ color: 'var(--orange)' }}>▲</span>
            <span>{iss}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Analysis tab — pipeline status + upload to unlock more specialists ────

function AnalysisTab({ track }) {
  const phases = track.analysisPipeline;
  const done    = phases.filter(p => p.status === 'done').length;
  const partial = phases.filter(p => p.status === 'partial').length;
  const missing = phases.filter(p => p.status === 'missing').length;
  const totalUnlocks = phases.filter(p => p.status === 'missing').reduce((a, b) => a + (b.unlocks || 0), 0);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <AnalysisSummary done={done} partial={partial} missing={missing} unlocks={totalUnlocks} total={phases.length} />
        <AnalysisPhaseList phases={phases} />
        <UnlockBlock phases={phases} />
      </div>
      <AnalysisSideRail track={track} />
    </div>
  );
}

function AnalysisSummary({ done, partial, missing, unlocks, total }) {
  return (
    <div className="card" style={{
      overflow: 'hidden',
      background: 'linear-gradient(135deg, var(--card) 0%, var(--card) 60%, rgba(167,139,250,0.06) 100%)',
    }}>
      <div style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 22 }}>
        <PipelineDial done={done} total={total} />
        <div style={{ flex: 1 }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--muted)', textTransform: 'uppercase' }}>ANALYSIS PIPELINE</div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', marginTop: 4 }}>
            {done} of {total} phases complete
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
            {missing > 0 ? (
              <>Upload <span style={{ color: 'var(--violet)', fontWeight: 700 }}>{missing} more file{missing === 1 ? '' : 's'}</span> to unlock <span style={{ color: 'var(--cyan)', fontWeight: 700 }}>+{unlocks} specialist{unlocks === 1 ? '' : 's'}</span> and deepen the report.</>
            ) : 'Everything analyzed.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <SummaryStat label="Done"      value={done}    color="var(--cyan)" />
          <SummaryStat label="Running"   value={partial} color="var(--orange)" />
          <SummaryStat label="Missing"   value={missing} color="var(--muted)" />
        </div>
      </div>
    </div>
  );
}

function PipelineDial({ done, total }) {
  const pct = done / total;
  const size = 76, stroke = 6, r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} fill="none" />
        <circle cx={size/2} cy={size/2} r={r} stroke="var(--cyan)" strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={c - pct * c} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset .6s' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--cyan)' }}>{Math.round(pct * 100)}%</div>
      </div>
    </div>
  );
}

function SummaryStat({ label, value, color }) {
  return (
    <div style={{
      padding: '8px 14px',
      background: `${color}08`,
      border: `1px solid ${color}24`,
      borderRadius: 8,
      minWidth: 60, textAlign: 'center',
    }}>
      <div className="mono" style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div className="mono" style={{ fontSize: 9, color, letterSpacing: '0.14em', textTransform: 'uppercase', marginTop: 4, opacity: 0.9 }}>{label}</div>
    </div>
  );
}

// ── Phase list (the timeline of what's run) ───────────────────────────────

function AnalysisPhaseList({ phases }) {
  return (
    <div className="card">
      <div className="card-hd">
        <SectionTitle accent="var(--cyan)" style={{ marginBottom: 0 }}>
          Phase-by-phase status
        </SectionTitle>
        <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>uploaded today · 14:03</span>
      </div>
      <div style={{ padding: '8px 6px 14px' }}>
        {phases.map(p => <PhaseRow key={p.id} phase={p} />)}
      </div>
    </div>
  );
}

function PhaseRow({ phase }) {
  const isDone    = phase.status === 'done';
  const isPartial = phase.status === 'partial';
  const isMissing = phase.status === 'missing';

  const accent = isDone ? 'var(--cyan)' : isPartial ? 'var(--orange)' : 'var(--muted)';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '12px 16px',
      borderLeft: `2px solid ${isMissing ? 'transparent' : accent}`,
      marginLeft: 12,
      position: 'relative',
    }}>
      {/* Status icon overlapping the left border */}
      <div style={{ position: 'absolute', left: -10, top: 14 }}>
        <PhaseIcon status={phase.status} />
      </div>

      <div style={{ flex: 1, minWidth: 0, paddingLeft: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: isMissing ? 'var(--muted)' : 'var(--text)' }}>{phase.label}</span>
          {isDone && phase.durationMs && (
            <span className="mono" style={{ fontSize: 9, color: 'var(--dim)' }}>
              {(phase.durationMs / 1000).toFixed(2)}s
            </span>
          )}
          {phase.unlocks != null && (
            <span className="pill violet" style={{ fontSize: 9, fontWeight: 700 }}>
              +{phase.unlocks} specialist{phase.unlocks === 1 ? '' : 's'} pending
            </span>
          )}
          {isPartial && (
            <span className="pill orange" style={{ fontSize: 9, fontWeight: 700 }}>RUNNING {phase.running ? '· 1 active' : ''}</span>
          )}
        </div>
        <div className="mono" style={{
          fontSize: 11,
          color: isDone ? 'var(--muted)' : isPartial ? 'var(--text-2)' : 'var(--dim)',
          marginTop: 3,
        }}>
          {phase.detail}
        </div>
        {isPartial && phase.progress != null && (
          <div style={{ height: 3, background: 'var(--dim)', borderRadius: 2, marginTop: 8, maxWidth: 340 }}>
            <div style={{ height: '100%', width: `${phase.progress * 100}%`, background: 'var(--orange)', borderRadius: 2, boxShadow: '0 0 4px rgba(251,146,60,0.5)' }} />
          </div>
        )}
      </div>

      {phase.cta && (
        <button className={isPartial ? 'btn sm primary' : 'btn sm'} style={isMissing ? {
          color: 'var(--violet)', borderColor: 'rgba(167,139,250,0.32)', background: 'rgba(167,139,250,0.06)',
        } : {}}>
          {phase.cta}
        </button>
      )}
    </div>
  );
}

function PhaseIcon({ status }) {
  if (status === 'done') return (
    <div style={{
      width: 22, height: 22, borderRadius: '50%',
      background: 'rgba(0,229,176,0.14)',
      border: '1px solid rgba(0,229,176,0.5)',
      color: 'var(--cyan)',
      display: 'grid', placeItems: 'center',
      fontSize: 11, fontWeight: 800,
      boxShadow: '0 0 12px -4px rgba(0,229,176,0.6)',
    }}>✓</div>
  );
  if (status === 'partial') return (
    <div style={{
      width: 22, height: 22, borderRadius: '50%',
      background: 'rgba(251,146,60,0.10)',
      border: '1.5px solid rgba(251,146,60,0.5)',
      display: 'grid', placeItems: 'center',
      animation: 'pulseGlow 1.6s ease-in-out infinite',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--orange)' }} />
    </div>
  );
  if (status === 'running') return (
    <div style={{
      width: 22, height: 22, borderRadius: '50%',
      background: 'rgba(167,139,250,0.10)',
      border: '1.5px solid rgba(167,139,250,0.5)',
      display: 'grid', placeItems: 'center',
    }}>
      <EQDots count={3} color="var(--violet)" height={9} />
    </div>
  );
  return (
    <div style={{
      width: 22, height: 22, borderRadius: '50%',
      background: 'var(--bg)',
      border: '1.5px dashed rgba(255,255,255,0.18)',
    }} />
  );
}

// ── Unlock block — featured upload zones ──────────────────────────────────

function UnlockBlock({ phases }) {
  const missing = phases.filter(p => p.status === 'missing');
  if (missing.length === 0) return null;
  return (
    <div className="card">
      <div className="card-hd">
        <SectionTitle accent="var(--violet)" style={{ marginBottom: 0 }}>
          Unlock deeper analysis
        </SectionTitle>
        <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>add more material later · we'll re-analyze</span>
      </div>
      <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: 12 }}>
        {missing.map(p => <UnlockZone key={p.id} phase={p} />)}
      </div>
    </div>
  );
}

const UNLOCK_INFO = {
  stems: {
    title: 'Drop stems here',
    sub: 'WAV/AIFF · kick / bass / drums / vocals / fx / etc.',
    benefits: ['Per-stem balance', 'Stem stereo width', 'Stem reference deltas', 'Stem clash matrix'],
    accent: 'var(--cyan)',
    icon: 'S',
  },
  reference: {
    title: 'Drop a reference track',
    sub: 'A commercial release you want to match',
    benefits: ['A/B EQ tilt', 'Loudness gap', 'Spectral fingerprint match'],
    accent: 'var(--violet)',
    icon: 'R',
  },
  als: {
    title: 'Drop the Ableton project',
    sub: '.als file from Live 11+',
    benefits: ['Device chain audit', 'Per-track plugin inventory', 'Routing diagnostics'],
    accent: 'var(--orange)',
    icon: 'A',
  },
};

function UnlockZone({ phase }) {
  const info = UNLOCK_INFO[phase.id] || { title: phase.label, sub: phase.detail, benefits: [], accent: 'var(--cyan)', icon: '?' };
  return (
    <label style={{
      padding: 14,
      border: `1.5px dashed ${info.accent}55`,
      borderRadius: 10,
      background: `${info.accent}08`,
      cursor: 'pointer',
      display: 'flex', flexDirection: 'column', gap: 10,
      transition: 'background .15s, border-color .15s',
    }}
    onMouseOver={e => e.currentTarget.style.background = `${info.accent}12`}
    onMouseOut={e => e.currentTarget.style.background = `${info.accent}08`}>
      <input type="file" style={{ display: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: info.accent, color: '#06151a',
          display: 'grid', placeItems: 'center',
          fontWeight: 800, fontSize: 14,
        }}>{info.icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{info.title}</div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{info.sub}</div>
        </div>
        <span className="pill" style={{ color: info.accent, borderColor: `${info.accent}55`, background: `${info.accent}14`, fontWeight: 700 }}>
          +{phase.unlocks}
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {info.benefits.map(b => (
          <span key={b} className="mono" style={{
            fontSize: 9, color: 'var(--text-2)',
            padding: '2px 6px', borderRadius: 4,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--border)',
          }}>+ {b}</span>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
        <span className="mono" style={{ fontSize: 10, color: info.accent }}>↑ Click or drag file</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--dim)', marginLeft: 'auto' }}>up to 200 MB</span>
      </div>
    </label>
  );
}

// ── Side rail — current uploads + history ─────────────────────────────────

function AnalysisSideRail({ track }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card card-body">
        <SectionTitle accent="var(--cyan)">Current uploads</SectionTitle>
        <UploadItem
          icon="♪" label="Primary audio"
          name={track.name} sub={track.format}
          uploaded="today · 14:01"
          status="parsed" />
        <UploadItem
          icon="—" label="Stems"
          name={null} sub="not uploaded" status="missing" />
        <UploadItem
          icon="—" label="Reference track"
          name={null} sub="not uploaded" status="missing" />
        <UploadItem
          icon="—" label="Ableton .als"
          name={null} sub="not uploaded" status="missing" />
      </div>

      <div className="card card-body">
        <SectionTitle accent="var(--violet)">Re-analyze on changes</SectionTitle>
        <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
          New uploads automatically trigger affected phases. Existing AI specialist runs are <span style={{ color: 'var(--cyan)' }}>cached</span> and not re-billed unless the underlying data changes.
        </p>
        <button className="btn sm" style={{ marginTop: 10 }}>↺ Re-run everything</button>
      </div>

      <div className="card card-body">
        <SectionTitle accent="var(--cyan)">Analysis history</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <HistoryRow when="14:03"  what="AI specialists" detail="+3 verdicts" />
          <HistoryRow when="14:01"  what="Pipeline started" detail="6 phases · 8.1s" />
          <HistoryRow when="14:00"  what="Audio uploaded" detail={track.name + ' · 38 MB'} />
        </div>
      </div>
    </div>
  );
}

function UploadItem({ icon, label, name, sub, uploaded, status }) {
  const isParsed = status === 'parsed';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 0',
      borderBottom: '1px solid var(--border)',
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 7,
        background: isParsed ? 'rgba(0,229,176,0.08)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${isParsed ? 'rgba(0,229,176,0.32)' : 'var(--border)'}`,
        color: isParsed ? 'var(--cyan)' : 'var(--muted)',
        display: 'grid', placeItems: 'center', fontSize: 13,
        flexShrink: 0,
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>{label}</div>
        <div style={{ fontSize: 12, color: isParsed ? 'var(--text)' : 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name || sub}
        </div>
        {isParsed && uploaded && <div className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 2 }}>{uploaded}</div>}
      </div>
      {isParsed && <span className="pill cyan" style={{ fontSize: 9 }}>parsed</span>}
    </div>
  );
}

function HistoryRow({ when, what, detail }) {
  return (
    <div style={{ display: 'flex', gap: 10, fontSize: 12 }}>
      <span className="mono" style={{ color: 'var(--dim)', minWidth: 38 }}>{when}</span>
      <div>
        <div style={{ color: 'var(--text)', fontWeight: 600 }}>{what}</div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>{detail}</div>
      </div>
    </div>
  );
}

// ── Spectrum tab ──────────────────────────────────────────────────────────

function SpectrumTab({ track }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="card card-body">
        <SectionTitle accent="var(--cyan)" right={<span className="pill violet">{track.frequency.label}</span>}>
          Frequency balance · <span style={{ color: 'var(--text-2)' }}>clarity {track.frequency.clarity}/100</span>
        </SectionTitle>
        <BigSpectrumBars track={track} />
      </div>
      <div className="card card-body">
        <SectionTitle accent="var(--cyan)">Stem clashes</SectionTitle>
        {track.clashes.map((c, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '12px 14px', marginBottom: 8,
            background: c.sev === 'severe' ? 'rgba(244,63,94,0.06)' : 'rgba(251,146,60,0.06)',
            border: `1px solid ${c.sev === 'severe' ? 'rgba(244,63,94,0.22)' : 'rgba(251,146,60,0.22)'}`,
            borderRadius: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ padding: '4px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.05)', fontSize: 12, fontWeight: 700 }}>{c.a}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>×</span>
              <span style={{ padding: '4px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.05)', fontSize: 12, fontWeight: 700 }}>{c.b}</span>
            </div>
            <div style={{ flex: 1 }}>
              <div className="mono" style={{ fontSize: 10, color: c.sev === 'severe' ? 'var(--red)' : 'var(--orange)' }}>{c.range} · {c.pct}% overlap</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}><span style={{ color: 'var(--cyan)' }}>Fix: </span>{c.fix}</div>
            </div>
            <span className="pill" style={{
              color: c.sev === 'severe' ? 'var(--red)' : 'var(--orange)',
              borderColor: c.sev === 'severe' ? 'rgba(244,63,94,0.4)' : 'rgba(251,146,60,0.4)',
              background: c.sev === 'severe' ? 'rgba(244,63,94,0.08)' : 'rgba(251,146,60,0.08)',
            }}>{c.sev.toUpperCase()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BigSpectrumBars({ track }) {
  return (
    <div style={{ display: 'flex', gap: 5, alignItems: 'flex-end', height: 160 }}>
      {track.frequency.bands.map((b, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
          <span className="mono" style={{ fontSize: 10, color: b.warn ? 'var(--orange)' : 'var(--muted)' }}>{Math.round(b.v * 100)}</span>
          <div style={{ width: '100%', height: 110, display: 'flex', alignItems: 'flex-end', position: 'relative' }}>
            {track.frequency.genreMedianBands?.[i] != null && (
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                height: `${track.frequency.genreMedianBands[i] * 100}%`,
                background: 'rgba(255,255,255,0.10)',
                borderRadius: '3px 3px 0 0',
              }} />
            )}
            <div className="fill-h" style={{
              width: '100%', height: `${b.v * 100}%`,
              borderRadius: '3px 3px 0 0',
              background: b.warn
                ? 'linear-gradient(to top, var(--orange), rgba(251,146,60,0.3))'
                : 'linear-gradient(to top, var(--cyan), rgba(0,229,176,0.3))',
              boxShadow: b.warn ? '0 0 8px rgba(251,146,60,0.4)' : '0 0 6px rgba(0,229,176,0.3)',
              animationDelay: `${i * 0.06}s`,
            }} />
            {b.warn && <div style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', fontSize: 9, color: 'var(--orange)' }}>▲</div>}
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="mono" style={{ fontSize: 10, color: b.warn ? 'var(--orange)' : 'var(--text-2)', fontWeight: 600 }}>{b.n}</div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--dim)' }}>{b.hz}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Reference tab ─────────────────────────────────────────────────────────

function ReferenceTab({ track }) {
  return (
    <div className="card card-body">
      <SectionTitle accent="var(--violet)" right={<span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{track.profileSource}</span>}>
        Genre profile · {track.genre.name}
      </SectionTitle>
      <div style={{ display: 'flex', gap: 24, alignItems: 'center', marginBottom: 18, padding: 14, borderRadius: 10, background: 'rgba(0,229,176,0.04)', border: '1px solid rgba(0,229,176,0.18)' }}>
        <ScoreRing value={track.percentile} max={100} size={80} color="var(--cyan)" stroke={6} label="" />
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--cyan)' }}>{track.percentile}th percentile</div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            top 32% · {track.gap.filter(g => !g.inRange).length} of {track.gap.length} metrics out of range
          </div>
        </div>
      </div>

      <Legend />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
        {track.gap.map((g, i) => <GapRow g={g} key={i} />)}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div style={{ display: 'flex', gap: 14, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 20, height: 5, background: 'rgba(0,229,176,0.2)', border: '1px solid rgba(0,229,176,0.35)', borderRadius: 2 }} />
        <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>acceptable range (P10–P90)</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 2, height: 10, background: 'rgba(255,255,255,0.25)' }} />
        <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>genre mean</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--cyan)' }} />
        <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>your track</span>
      </div>
    </div>
  );
}

function GapRow({ g }) {
  const c = g.inRange ? 'var(--cyan)' : g.sev === 'critical' ? 'var(--red)' : 'var(--orange)';
  const span = (g.acceptableRange[1] - g.acceptableRange[0]) * 1.8;
  const barMin = g.acceptableRange[0] - span * 0.4;
  const barMax = g.acceptableRange[1] + span * 0.4;
  const range = barMax - barMin || 1;
  const toPct = v => `${Math.max(0, Math.min(100, ((v - barMin) / range) * 100))}%`;
  const fmt = (v) => Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, minWidth: 150 }}>{g.n}</span>
        <span className="pill" style={{ color: c, borderColor: `${c}44`, background: `${c}10` }}>
          {g.inRange ? 'IN RANGE' : g.sev.toUpperCase()}
        </span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>{g.pct}th pct</span>
      </div>
      <div style={{ position: 'relative', height: 18, marginBottom: 6 }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)', height: 4, background: 'var(--dim)', borderRadius: 2 }} />
        <div style={{
          position: 'absolute', top: '50%', transform: 'translateY(-50%)',
          left: toPct(g.acceptableRange[0]),
          width: `calc(${toPct(g.acceptableRange[1])} - ${toPct(g.acceptableRange[0])})`,
          height: 4, background: 'rgba(0,229,176,0.2)', border: '1px solid rgba(0,229,176,0.35)', borderRadius: 2,
        }} />
        <div style={{ position: 'absolute', left: toPct(g.mean), top: 3, bottom: 3, width: 2, background: 'rgba(255,255,255,0.32)', transform: 'translateX(-50%)' }} />
        <div style={{
          position: 'absolute', left: toPct(g.userVal), top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 12, height: 12, borderRadius: '50%',
          background: c, boxShadow: `0 0 8px ${c}88`,
          border: '2px solid var(--bg)',
        }} />
      </div>
      <div style={{ display: 'flex', gap: 20, fontSize: 11, flexWrap: 'wrap' }}>
        <span className="mono"><span style={{ color: 'var(--muted)' }}>yours </span><span style={{ color: c, fontWeight: 600 }}>{fmt(g.userVal)}{g.unit}</span></span>
        <span className="mono"><span style={{ color: 'var(--muted)' }}>mean </span><span style={{ color: 'var(--text-2)' }}>{fmt(g.mean)}{g.unit}</span></span>
        <span className="mono"><span style={{ color: 'var(--muted)' }}>range </span><span style={{ color: 'var(--text-2)' }}>{fmt(g.acceptableRange[0])} – {fmt(g.acceptableRange[1])}{g.unit}</span></span>
        {g.description && <span style={{ fontSize: 11, color: 'var(--dim)', marginLeft: 'auto', fontStyle: 'italic' }}>{g.description}</span>}
      </div>
    </div>
  );
}

// ── Arrangement tab ───────────────────────────────────────────────────────

function ArrangementTab({ track }) {
  const total = track.arrangement.sections.reduce((s, x) => s + x.bars, 0);
  const sectionColors = {
    intro: 'rgba(255,255,255,0.10)',
    buildup: 'rgba(0,229,176,0.32)',
    drop: 'rgba(251,146,60,0.55)',
    breakdown: 'rgba(167,139,250,0.45)',
    outro: 'rgba(255,255,255,0.10)',
  };
  return (
    <div className="card card-body">
      <SectionTitle accent="var(--violet)" right={
        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
          Score <span style={{ color: track.arrangement.score >= 70 ? 'var(--cyan)' : 'var(--orange)' }}>{track.arrangement.score}</span>/100
        </span>
      }>Arrangement</SectionTitle>
      <div style={{ display: 'flex', gap: 3, height: 70, marginBottom: 16, borderRadius: 6, overflow: 'hidden' }}>
        {track.arrangement.sections.map((sec, i) => (
          <div key={i} style={{
            width: `${(sec.bars / total) * 100}%`,
            background: sectionColors[sec.t] || 'rgba(255,255,255,0.06)',
            display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            padding: 10, position: 'relative',
            border: sec.flag ? '1px solid rgba(251,146,60,0.5)' : '1px solid transparent',
            overflow: 'hidden',
          }}>
            <div className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.92)' }}>{sec.l}</div>
            <div className="mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.55)' }}>{sec.bars} bars</div>
            {sec.flag && <div style={{ position: 'absolute', top: 6, right: 6, width: 5, height: 5, borderRadius: '50%', background: 'var(--orange)' }} />}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {track.arrangement.issues.map((iss, i) => (
          <div key={i} style={{
            display: 'flex', gap: 10, fontSize: 13,
            padding: '10px 12px',
            background: 'rgba(251,146,60,0.06)',
            border: '1px solid rgba(251,146,60,0.22)',
            borderRadius: 7,
          }}>
            <span style={{ color: 'var(--orange)' }}>▲</span>
            <span style={{ color: 'var(--text-2)' }}>{iss}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── AI tab — the full specialist grid lives here, not on Overview ─────────

function AITab({ track }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="card card-body">
        <SectionTitle accent="var(--cyan)" right={
          <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
            {SPECIALIST_GROUPS_STATS.cached}/{SPECIALIST_GROUPS_STATS.total} run · {SPECIALIST_GROUPS_STATS.running} running
          </span>
        }>AI specialists</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {SPECIALIST_GROUPS.map(g => (
            <div key={g.id}>
              <div className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                {g.label}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: 8 }}>
                {g.items.map(item => <SpecialistTileFull key={item.slug} item={item} />)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SpecialistTileFull({ item }) {
  const status = item.status;
  const c = status === 'cached' ? 'var(--cyan)' : status === 'running' ? 'var(--violet)' : status === 'error' ? 'var(--red)' : 'var(--muted)';
  const persona = (window.SPECTR_PERSONAS && window.SPECTR_PERSONAS[item.slug]) || null;
  const botColor = status === 'disabled' ? 'rgba(100,116,139,0.5)' : (persona?.color || c);
  return (
    <div style={{
      padding: '10px 12px',
      background: status === 'disabled' ? 'transparent' : 'rgba(255,255,255,0.018)',
      border: `1px solid ${status === 'cached' ? 'rgba(0,229,176,0.18)' : 'var(--border)'}`,
      borderRadius: 8,
      opacity: status === 'disabled' ? 0.5 : 1,
      minHeight: 72,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: `${botColor}1a`,
          border: `1px solid ${botColor}66`,
          display: 'grid', placeItems: 'center',
          flexShrink: 0,
        }}>
          <MiniBot size={20} color={botColor} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
        {item.findings != null && item.findings > 0 && (
          <span className="pill cyan">{item.findings}</span>
        )}
      </div>
      {status === 'idle' && <button className="btn sm" style={{ alignSelf: 'flex-start', fontSize: 10 }}>Run</button>}
      {status === 'running' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <EQDots count={4} color="var(--violet)" />
          <span className="mono" style={{ fontSize: 10, color: 'var(--violet)' }}>analyzing…</span>
        </div>
      )}
      {status === 'cached' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="mono" style={{ fontSize: 10, color: item.findings ? 'var(--orange)' : 'var(--cyan)' }}>
            {item.findings ? `${item.findings} finding${item.findings === 1 ? '' : 's'}` : 'no issues'}
          </span>
          <button className="btn ghost sm" style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 8px' }}>↺</button>
        </div>
      )}
      {status === 'disabled' && (
        <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic', lineHeight: 1.4 }}>{item.disabledReason}</div>
      )}
    </div>
  );
}

// ── Streaming tab ─────────────────────────────────────────────────────────

function StreamingTab({ track }) {
  return (
    <div className="card card-body">
      <SectionTitle accent="var(--cyan)" right={
        <span className="mono" style={{ fontSize: 10, color: track.streamingPassCount >= 3 ? 'var(--green)' : 'var(--orange)' }}>
          {track.streamingPassCount}/{track.streaming.length} platforms
        </span>
      }>Streaming readiness</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {track.streaming.map(row => {
          const bad = row.yours > row.target + 1;
          const col = bad ? 'var(--red)' : 'var(--green)';
          const overBy = row.yours - row.target;
          return (
            <div key={row.p} style={{
              padding: 14,
              background: `${col}08`,
              border: `1px solid ${col}28`,
              borderRadius: 8,
              display: 'flex', alignItems: 'center', gap: 14,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                display: 'grid', placeItems: 'center',
                background: 'rgba(255,255,255,0.04)',
                color: col, fontSize: 16, fontWeight: 800,
              }}>
                {bad ? '✗' : '✓'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{row.p}</div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  target {row.target} LUFS · yours {row.yours} ({overBy > 0 ? '+' : ''}{overBy.toFixed(1)})
                </div>
              </div>
              <span className="pill" style={{ color: col, borderColor: `${col}44`, background: `${col}10` }}>
                {bad ? 'WILL BE TURNED DOWN' : 'PASS'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

window.ResultsPage = ResultsPage;
