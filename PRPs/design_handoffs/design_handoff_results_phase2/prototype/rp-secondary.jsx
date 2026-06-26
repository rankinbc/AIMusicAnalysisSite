/* spectre — Analysis tab (measured evidence), Files tab, MD export modal.
 * The Analysis tab composes the 🆕 metric groups (rp-metrics.jsx) with the
 * frequency / stereo / clash / per-stem / .als / reference / arrangement cards.
 * Conditional cards (stems, .als, profile) gate on the inputDepth tweak. */

// ── small shared bits ────────────────────────────────────────────────
function Legend({ sw, label }) {
  return (
    <span className="legend">
      <span className="sw" style={{ background: sw }} />
      <span className="mono">{label}</span>
    </span>
  );
}
function Flag({ children }) {
  return (
    <div className="arr-flag">
      <span className="fi">▲</span><span>{children}</span>
    </div>
  );
}
function LockedCard({ title, cta }) {
  return (
    <div className="card locked">
      <div className="card-hd">
        <span className="t"><span className="led" style={{ background: 'var(--muted)' }} />{title}</span>
        <span className="meta">not uploaded</span>
      </div>
      <div className="card-body locked-body">
        <span className="lk-ic"><Icon name="layers" size={18} /></span>
        <div className="lk-t">{cta}</div>
        <button className="btn sm">Add files</button>
      </div>
    </div>
  );
}

// ── frequency balance (phase 1 bands) ────────────────────────────────
function FrequencyCard() {
  return (
    <div className="card">
      <div className="card-hd">
        <span className="t"><span className="led" />Frequency balance</span>
        <span className="usedin">→ moves 2, 3</span>
      </div>
      <div className="card-body">
        <div className="chart-bars" style={{ height: 120 }}>
          {RP_FREQ.map((b, i) => (
            <div className="chart-col" key={i}>
              <span className="mono" style={{ fontSize: 9, color: b.warn ? 'var(--orange)' : 'var(--muted)' }}>{Math.round(b.v * 100)}</span>
              <div className="bw">
                <div className="median" style={{ height: `${b.med * 100}%` }} />
                <div className={`barfill${b.warn ? ' warn' : ''}`} style={{ height: `${b.v * 100}%` }} />
              </div>
              <span className={`lbl${b.warn ? ' warn' : ''}`}>{b.n}</span>
            </div>
          ))}
        </div>
        <div className="freq-legend">
          <Legend sw="linear-gradient(180deg,var(--accent),rgba(94,234,212,.25))" label="your mix" />
          <Legend sw="rgba(255,255,255,.12)" label="genre median" />
          <Legend sw="linear-gradient(180deg,var(--orange),rgba(245,158,11,.25))" label="out of range" />
        </div>
      </div>
    </div>
  );
}

// ── stereo field (phase 1) ───────────────────────────────────────────
function StereoCard() {
  return (
    <div className="card">
      <div className="card-hd">
        <span className="t"><span className="led" />Stereo field</span>
        <span className="meta">phase 1</span>
      </div>
      <div className="card-body">
        {RP_STEREO.map((s, i) => (
          <div className="an-row" key={i} style={i === 0 ? { borderTop: 'none', paddingTop: 0 } : {}}>
            <span className="nm">{s.nm}</span>
            <div className="track"><div className="f" style={{ width: `${s.pct}%`, background: 'var(--accent)' }} /></div>
            <span className="val" style={{ color: 'var(--accent)' }}>{s.val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── frequency clashes (phase 4) ──────────────────────────────────────
function ClashCard() {
  return (
    <div className="card">
      <div className="card-hd">
        <span className="t"><span className="led" style={{ background: 'var(--orange)' }} />Frequency clashes</span>
        <span className="meta">{RP_CLASHES.length} detected</span>
      </div>
      <div className="card-body">
        {RP_CLASHES.map((c, i) => {
          const col = c.sev === 'warn' ? 'var(--orange)' : 'var(--accent)';
          return (
            <div className="clash" key={i} style={{ background: `${col}0d`, border: `1px solid ${col}33` }}>
              <div className="pair"><span className="chip">{c.a}</span><span className="x">×</span><span className="chip">{c.b}</span></div>
              <div className="body">
                <span className="rng" style={{ color: col }}>{c.rng} · {c.pct}% overlap</span>
                <div className="fix">{c.fix}</div>
              </div>
              {c.move && <span className="usedin">→ move {c.move}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── per-stem table (phase 4 · stems) ─────────────────────────────────
function PerStemCard({ density }) {
  const full = density === 'full';
  return (
    <div className="card">
      <div className="card-hd">
        <span className="t"><span className="led" />Per-stem</span>
        <span className="meta">4 stems · grouped</span>
      </div>
      <div className="card-body">
        <div className={`stemtable${full ? ' full' : ''}`}>
          <div className="st-head">
            <span>STEM</span><span>LUFS</span><span>DR</span><span>CENTROID</span><span>WIDTH</span>{full && <span>PAN</span>}
          </div>
          {RP_STEMS.map((s, i) => (
            <div className="st-row" key={i}>
              <span className="st-role">{s.role}
                {s.mono && <i className="st-tag mono-t">mono</i>}
                {s.flag && <i className="st-tag flag-t">{s.flag}</i>}
              </span>
              <span className="mono">{s.lufs}</span>
              <span className="mono">{s.dr}</span>
              <span className="mono">{s.centroid}<i> Hz</i></span>
              <span className="mono">{s.width}</span>
              {full && <span className="mono">{s.pan}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── .als project (phase 8) ───────────────────────────────────────────
function AlsCard() {
  const a = RP_ALS;
  return (
    <div className="card">
      <div className="card-hd">
        <span className="t"><span className="led" style={{ background: 'var(--violet)' }} />Ableton project</span>
        <span className="meta">demo.als</span>
      </div>
      <div className="card-body">
        <div className="als-top">
          <PercentRing value={a.health} size={66} hue={150} label="health" />
          <div className="als-meta">
            <div className="am-l">Live {a.version} · {a.tempo} BPM · {a.timeSig}</div>
            <div className="am-s mono">{a.totalDevices} devices · {a.disabledDevices} disabled · {a.clutterPct}% clutter</div>
            <div className="am-s mono">{a.midiNotes} notes · {a.audioClips} audio clips · {a.chords} chords</div>
          </div>
        </div>
        <div className="als-plugins">
          {a.plugins.map(p => <span className="pchip" key={p}>{p}</span>)}
        </div>
        {a.midiIssues.map((m, i) => (
          <div className="als-issue" key={i}>
            <span className="ai-sev">{m.sev}</span>
            <span className="ai-t"><b>{m.track} · {m.clip}</b> — {m.desc}. <span className="ai-fix">{m.fix}</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── reference comparison (phase 6) ───────────────────────────────────
function GapRow({ g }) {
  const lo = Math.min(g.range[0], g.user), hi = Math.max(g.range[1], g.user);
  const pad = ((hi - lo) || 2) * 0.3;
  const min = +(lo - pad).toFixed(1), max = +(hi + pad).toFixed(1);
  return (
    <div className="gaprow">
      <div className="gr-head">
        <span className="gr-k">{g.metric}</span>
        <span className="gr-v mono">{g.user}{g.unit}</span>
        <span className={`gr-chip ${g.inRange ? 'in' : 'out'}`}>{g.inRange ? 'in range' : 'out of range'}</span>
      </div>
      <RangeBar value={g.user} range={g.range} min={min} max={max} unit={g.unit} inRange={g.inRange} />
      <div className="gr-desc">{g.desc} · <span className="mono">profile mean {g.mean}{g.unit}</span></div>
    </div>
  );
}
function ReferenceCard({ hasProfile }) {
  const r = RP_REFERENCE;
  return (
    <div className="card">
      <div className="card-hd">
        <span className="t"><span className="led" style={{ background: hasProfile ? `oklch(0.78 0.13 ${r.profileHue})` : 'var(--blue)' }} />Reference comparison</span>
        <span className="usedin">phase 6</span>
      </div>
      <div className="card-body">
        <div className="rc-top">
          <PercentRing value={r.percentile} hue={hasProfile ? r.profileHue : null} label="pctile" />
          <div className="rc-prof">
            {hasProfile
              ? <span className="rc-chip" style={{ '--h': r.profileHue }}>{r.profileName}</span>
              : <span className="rc-chip genre">{r.genre} · genre profile</span>}
            <div className="rc-sub mono">{hasProfile ? `user profile · based on ${r.trackCount} tracks` : 'genre statistical profile · default'}</div>
            <div className="rc-note">{hasProfile ? 'Compared against your saved profile.' : 'Attach a reference profile in Files to compare against your own picks.'}</div>
          </div>
        </div>
        <div className="rc-gaps">
          {r.gaps.map((g, i) => <GapRow g={g} key={i} />)}
        </div>
      </div>
    </div>
  );
}

// ── arrangement (phase 7) ────────────────────────────────────────────
function ArrangementCard() {
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-hd">
        <span className="t"><span className="led" style={{ background: 'var(--violet)' }} />Arrangement</span>
        <span className="usedin">→ move 4</span>
      </div>
      <div className="card-body">
        <StructureStrip height={56} labels />
        <div className="arr-flags">
          {RP_STRUCT_FLAGS.map((f, i) => <Flag key={i}>{f}</Flag>)}
        </div>
      </div>
    </div>
  );
}

// ── Analysis tab ─────────────────────────────────────────────────────
function AnalysisTab({ t }) {
  const variant = t.metricViz, density = t.density, depth = t.inputDepth;
  const hasStems = rpPresent(1, depth), hasAls = rpPresent(2, depth), hasProfile = rpPresent(2, depth);
  return (
    <div className="fade-up">
      <p className="an-intro">
        The measured evidence behind your plan — the dense, pro-looking material is here for credibility. You don&rsquo;t need to act on any of it directly; every issue worth fixing is already a Move on the Plan.
      </p>

      <SecLabel glyph="📈" hint="phase 1 · new metrics">Loudness, dynamics &amp; tone</SecLabel>
      <div className="an-grid">
        <LoudnessCard variant={variant} density={density} />
        <DynamicsCard variant={variant} density={density} />
      </div>
      <div style={{ marginTop: 14 }}><ToneCard variant={variant} /></div>

      <SecLabel hint="phase 1 · phase 4">Frequency &amp; stereo</SecLabel>
      <div className="an-grid">
        <FrequencyCard />
        <StereoCard />
      </div>

      <SecLabel hint={hasStems ? 'phase 4 · stems uploaded' : 'stems not uploaded'}>Stems &amp; clashes</SecLabel>
      <div className="an-grid" style={{ alignItems: 'start' }}>
        {hasStems ? <PerStemCard density={density} /> : <LockedCard title="Per-stem" cta="Upload stems to unlock per-stem loudness, width &amp; clash analysis." />}
        <ClashCard />
      </div>

      <SecLabel hint="phase 6 · phase 8">Reference &amp; project</SecLabel>
      <div className="an-grid" style={{ alignItems: 'start' }}>
        <ReferenceCard hasProfile={hasProfile} />
        {hasAls ? <AlsCard /> : <LockedCard title="Ableton project" cta="Drop your .als for project health, device chains &amp; MIDI hygiene." />}
      </div>

      <SecLabel glyph="🎚" hint="phase 7">Arrangement</SecLabel>
      <ArrangementCard />
    </div>
  );
}

// ── Files tab ────────────────────────────────────────────────────────
function FilesTab({ inputDepth = 'als' }) {
  return (
    <div className="fade-up">
      <div className="an-grid" style={{ marginTop: 20, alignItems: 'start' }}>
        <div>
          <SecLabel hint="what we analyzed">Inputs</SecLabel>
          {RP_INPUTS.map(f => {
            const present = rpPresent(f.tier, inputDepth);
            const c = present ? 'var(--accent)' : 'var(--muted)';
            return (
              <div className={`file-row${present ? '' : ' file-drop'}`} key={f.id}>
                <div className="fic" style={{ color: c, background: present ? 'rgba(94,234,212,.08)' : 'rgba(255,255,255,.02)', border: `1px solid ${present ? 'rgba(94,234,212,.3)' : 'var(--border-2)'}` }}>{f.ic}</div>
                <div className="fb">
                  <div className="l">{f.l}</div>
                  <div className={`n${present ? '' : ' empty'}`}>{present ? f.n : (f.metaOff || 'Not uploaded')}</div>
                </div>
                {present
                  ? <span className="pill cyan">{f.id === 'mix' ? 'parsed' : f.id === 'ref' ? 'profile' : 'parsed'}</span>
                  : <button className="btn sm">Add</button>}
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 9, marginTop: 14 }}>
            <button className="btn primary"><Icon name="refresh" size={14} />Re-analyze</button>
            <button className="btn">Add files to deepen</button>
          </div>
        </div>

        <div>
          <SecLabel hint="this song">Versions</SecLabel>
          <div className="card"><div className="card-body" style={{ padding: '4px 16px' }}>
            {RP_VERSIONS.map(v => (
              <div className={`ver-row${v.current ? ' current' : ''}`} key={v.v}>
                <span className="vn">v{v.v}</span>
                <span className="vl">{v.l}{v.current && <span className="mono" style={{ color: 'var(--accent)', fontSize: 10, marginLeft: 8 }}>current</span>}</span>
                <span className="vd">{v.date}</span>
              </div>
            ))}
          </div></div>

          <SecLabel hint="game plans">Export history</SecLabel>
          <div className="card"><div className="card-body" style={{ padding: '4px 16px' }}>
            {RP_EXPORTS.map((e, i) => (
              <div className="ver-row" key={i}>
                <Icon name="download" size={14} />
                <span className="vl">{e.what}</span>
                <span className="vd">{e.detail}</span>
                <span className="vd" style={{ marginLeft: 'auto' }}>{e.when}</span>
              </div>
            ))}
          </div></div>
        </div>
      </div>
    </div>
  );
}

// ── Game Plan preview modal (visual checklist) ───────────────────────
function ExportModal({ committed, onClose }) {
  const quick = committed.filter(m => m.group === 'quick');
  const deep = committed.filter(m => m.group === 'deep');
  const summary = (m) => (m.steps || []).map(s => s.to).filter(x => x && x !== '\u2014').join(' · ');
  const Row = (m) => (
    <div className="gp-row" key={m.id}>
      <span className="gp-check" />
      <div className="gp-rb">
        <div className="gp-rt">{m.title}</div>
        <div className="gp-rd"><span className="scope">{m.scope}</span> · {summary(m)}</div>
      </div>
    </div>
  );
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="gp-modal" onClick={e => e.stopPropagation()}>
        <div className="gp-head">
          <CoverArt hue={RP_TRACK.coverHue} size={44} radius={9} waveform={false} />
          <div className="gp-htext">
            <div className="gp-kick">Game Plan · export preview</div>
            <div className="gp-title">{RP_TRACK.name} <span className="ver">{RP_TRACK.version}</span></div>
          </div>
          <button className="gp-x" onClick={onClose}><Icon name="x" size={15} /></button>
        </div>
        <div className="gp-body">
          {committed.length === 0 && (
            <div className="gp-empty">No moves committed yet. Hit <b>Add to plan</b> on the moves you want, and they&rsquo;ll collect here as a checklist.</div>
          )}
          {quick.length > 0 && (
            <div className="gp-group">
              <div className="gp-gl"><span className="g">⚡</span>Quick wins<span className="n">{quick.length}</span></div>
              {quick.map(Row)}
            </div>
          )}
          {deep.length > 0 && (
            <div className="gp-group">
              <div className="gp-gl"><span className="g">🛠</span>Deeper work<span className="n">{deep.length}</span></div>
              {deep.map(Row)}
            </div>
          )}
        </div>
        <div className="gp-foot">
          <span className="gp-note">Ticks off in your notes app · committed moves only</span>
          <span style={{ flex: 1 }} />
          <button className="btn sm" onClick={onClose}><Icon name="copy" size={13} />Copy .md</button>
          <button className="btn sm primary"><Icon name="download" size={13} />Download</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { AnalysisTab, FilesTab, ExportModal });
