/* spectre — Listen Rack redesign. Visuals tab: light-show control panel. */
const { useState: vS, useMemo: vM } = React;

const VZ_HUE = 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)';
function VzHue({ value, onChange, disabled }) {
  return <input type="range" className="lr-hue" min="0" max="360" value={value} disabled={disabled}
    onChange={(e) => onChange(+e.target.value)} style={{ background: VZ_HUE }} />;
}
function VzSlider({ label, value, min, max, step, fmt, onChange, disabled }) {
  return (
    <div className={'lr-vzs' + (disabled ? ' dis' : '')}>
      <div className="l"><span className="k">{label}</span><span className="v">{fmt(value)}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(+e.target.value)} />
    </div>);
}
function VzToggle({ label, on, onChange, disabled }) {
  return <label className={'lr-vzt' + (disabled ? ' dis' : '')}><Sw on={on} onChange={onChange} />{label}</label>;
}
function VzSwatches({ colors, value, onChange, disabled, size }) {
  return (
    <div className={'lr-swat' + (disabled ? ' dis' : '')}>{colors.map((c) =>
      <button key={c} className={value === c ? 'on' : ''} style={{ background: c, width: size, height: size }} onClick={() => onChange(c)} title={c} />)}
    </div>);
}
function VzPanel({ led, title, right, dim, children, accent }) {
  return (
    <section className={'lr-vp' + (dim ? ' dim' : '')} style={accent ? { '--mac': accent } : null}>
      <header><span className="led" style={{ background: led, boxShadow: `0 0 7px ${led}` }} /><span className="t">{title}</span><span className="sp" />{right}</header>
      <div className="b">{children}</div>
    </section>);
}

function VisualsTab({ stages, toggleStage, director, setDirector }) {
  const [vz, setVz] = vS({
    autoReact: false, sensitivity: 55,
    laserSync: true, laserOn: true, effect: 'sweep', pattern: 'fan', intensity: 60, beams: 4, speed: 1, roam: false, flashes: false, mono: false, laserHue: 190,
    colorSync: true, primary: BG_COLORS[0], primaryHue: 160,
    bgSync: false, bgCycle: true, bg: BG_COLORS[3], bgHue: 220, bgFlash: false, flashHz: 2, flashColor: '#94a3b8',
    dropFx: false,
  });
  const set = (k, v) => setVz((s) => ({ ...s, [k]: v }));
  const dir = vM(() => DIRECTORS.find((d) => d.id === director), [director]);
  const auto = director !== 'off';
  return (
    <div className="lr-vz">
      <VzPanel led="var(--accent)" title="Primary actions">
        <button className="lr-syncall" onClick={() => setVz((s) => ({ ...s, autoReact: true, laserSync: true, colorSync: true, bgSync: true }))}>
          <Icon name="refresh" size={14} />Sync all to music
        </button>
        <div className="lr-vzlbl">Color sync · theme</div>
        <div className="lr-theme">
          <span style={{ background: '#00e5b0' }} /><span style={{ background: '#a78bfa' }} /><span style={{ background: '#fb923c' }} />
          <button className="btn sm primary">Sync</button>
        </div>
        <p className="lr-vzhint">3 colours map to spectrum · lasers · background.</p>
      </VzPanel>

      <VzPanel led="var(--accent)" title="Stage select" right={<span className="lr-vzhint" style={{ margin: 0 }}>combine ↻</span>}>
        <div className="lr-vzgrid">{STAGES.map((s) =>
          <button key={s.id} className={'lr-vtile' + (stages.includes(s.id) ? ' on' : '')} onClick={() => toggleStage(s.id)}>
            <span className="gl">{s.glyph}</span>{s.label}<span className="d" />
          </button>)}
        </div>
      </VzPanel>

      <VzPanel led="var(--violet)" accent="var(--violet)" title="Auto program" right={<span className="lr-vzhint" style={{ margin: 0 }}>sets modules</span>}>
        <div className="lr-vzgrid four">{DIRECTORS.map((d) =>
          <button key={d.id} className={'lr-vtile' + (director === d.id ? ' on' : '')} onClick={() => setDirector(d.id)} title={d.blurb}>
            <span className="gl">{d.glyph}</span>{d.label}<span className="d" />
          </button>)}
        </div>
        <p className="lr-vzhint">{dir.blurb}</p>
      </VzPanel>

      <VzPanel led={vz.autoReact ? 'var(--accent)' : 'var(--dim)'} title="Auto-react to music" dim={auto}
        right={<Sw on={vz.autoReact} onChange={(v) => set('autoReact', v)} />}>
        <p className="lr-vztext">Loud, intense parts add layers &amp; push the lasers; quiet parts strip back to one calm visual.</p>
        <VzSlider label="Sensitivity" value={vz.sensitivity} min={0} max={100} step={1} fmt={(v) => v + ' %'} onChange={(v) => set('sensitivity', v)} disabled={!vz.autoReact || auto} />
        {auto && <p className="lr-vzwarn">Auto program is driving — set it to Manual to use Auto-react.</p>}
      </VzPanel>

      <VzPanel led={vz.laserOn ? 'var(--accent)' : 'var(--dim)'} title={<span>⚡ Laser rig <b className="lr-synctag">SYNC</b></span>}
        right={<React.Fragment><Sw on={vz.laserSync} onChange={(v) => set('laserSync', v)} /><Sw on={vz.laserOn} onChange={(v) => set('laserOn', v)} /></React.Fragment>}>
        <div className="lr-vzrow"><span className="k">Effect</span><span className="sp" />
          <select className="lr-sel acc" value={vz.effect} onChange={(e) => set('effect', e.target.value)}>{LASER_EFFECTS.map((o) => <option key={o}>{o}</option>)}</select></div>
        <div className="lr-vzrow"><span className="k">Pattern</span><span className="sp" />
          <select className="lr-sel acc" value={vz.pattern} onChange={(e) => set('pattern', e.target.value)}>{LASER_PATTERNS.map((o) => <option key={o}>{o}</option>)}</select></div>
        <VzSlider label="Intensity" value={vz.intensity} min={0} max={100} step={5} fmt={(v) => v + ' %'} onChange={(v) => set('intensity', v)} disabled={!vz.laserOn} />
        <VzSlider label="Beams" value={vz.beams} min={1} max={12} step={1} fmt={(v) => v} onChange={(v) => set('beams', v)} disabled={!vz.laserOn} />
        <VzSlider label="Sweep speed" value={vz.speed} min={0.25} max={4} step={0.25} fmt={(v) => v.toFixed(2) + '×'} onChange={(v) => set('speed', v)} disabled={!vz.laserOn} />
        <div className="lr-vztogs">
          <VzToggle label="Roam" on={vz.roam} onChange={(v) => set('roam', v)} disabled={!vz.laserOn} />
          <VzToggle label="Flashes" on={vz.flashes} onChange={(v) => set('flashes', v)} disabled={!vz.laserOn} />
          <VzToggle label="Mono" on={vz.mono} onChange={(v) => set('mono', v)} disabled={!vz.laserOn} />
        </div>
        <div className="lr-vzlbl">Laser color (mono)</div>
        <VzHue value={vz.laserHue} onChange={(v) => set('laserHue', v)} disabled={!vz.laserOn || !vz.mono} />
      </VzPanel>

      <VzPanel led="var(--accent)" title="Primary color" right={<label className="lr-vzt sm"><b className="lr-synctag">SYNC</b><Sw on={vz.colorSync} onChange={(v) => set('colorSync', v)} /></label>}>
        <VzSwatches colors={BG_COLORS.slice(0, 10)} value={vz.primary} onChange={(c) => set('primary', c)} disabled={vz.colorSync} size={17} />
        <VzHue value={vz.primaryHue} onChange={(v) => set('primaryHue', v)} disabled={vz.colorSync} />
      </VzPanel>

      <VzPanel led="var(--violet)" accent="var(--violet)" title="Background"
        right={<React.Fragment><label className="lr-vzt sm"><b className="lr-synctag">SYNC</b><Sw on={vz.bgSync} onChange={(v) => set('bgSync', v)} /></label>
          <label className="lr-vzt sm"><b className="lr-synctag vio">CYCLE</b><Sw on={vz.bgCycle} onChange={(v) => set('bgCycle', v)} /></label></React.Fragment>}>
        <VzSwatches colors={BG_COLORS} value={vz.bg} onChange={(c) => set('bg', c)} disabled={vz.bgSync || vz.bgCycle} size={16} />
        <VzHue value={vz.bgHue} onChange={(v) => set('bgHue', v)} disabled={vz.bgSync || vz.bgCycle} />
        <VzToggle label="Flash background" on={vz.bgFlash} onChange={(v) => set('bgFlash', v)} />
        <VzSlider label="Flash rate" value={vz.flashHz} min={1} max={12} step={1} fmt={(v) => v + ' Hz'} onChange={(v) => set('flashHz', v)} disabled={!vz.bgFlash} />
        <div className="lr-vzrow"><span className="k">Color</span>
          <VzSwatches colors={['#94a3b8', '#00b890', '#7c6cd9', '#c98232', '#b04658']} value={vz.flashColor} onChange={(c) => set('flashColor', c)} disabled={!vz.bgFlash} size={14} />
        </div>
      </VzPanel>

      <VzPanel led={vz.dropFx ? 'var(--accent)' : 'var(--dim)'} title="FX · Moments">
        <VzToggle label="Sync fireworks to drops" on={vz.dropFx} onChange={(v) => set('dropFx', v)} />
      </VzPanel>
    </div>);
}
Object.assign(window, { VisualsTab, VzPanel, VzHue, VzSlider, VzToggle, VzSwatches });
