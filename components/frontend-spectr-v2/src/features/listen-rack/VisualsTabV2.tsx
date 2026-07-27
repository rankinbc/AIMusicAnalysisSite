/* Listen Rack v2 — Visuals tab: masonry light-show control panel (primary
 * actions, stage select, auto program, auto-react, laser rig, primary color,
 * background, FX moments). Ported from the design handoff (lr-visuals.jsx),
 * wired to the page's real VizState / stages / director. */
import { useMemo } from 'react';

import { Icon } from '../results/Icon';
import {
  BG_COLORS, DIRECTORS, LASER_EFFECTS, LASER_PATTERNS, STAGES, type VizState,
} from './data';
import { hslToHex } from './helpers';
import { Sw } from './lrControls';

const VZ_HUE = 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)';

function VzHue({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <input
      type="range"
      className="lr-hue"
      min={0}
      max={360}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(+e.target.value)}
      style={{ background: VZ_HUE }}
    />
  );
}

function VzSlider({ label, value, min, max, step, fmt, onChange, disabled }: {
  label: string; value: number; min: number; max: number; step: number;
  fmt: (v: number) => string; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div className={'lr-vzs' + (disabled ? ' dis' : '')}>
      <div className="l"><span className="k">{label}</span><span className="v">{fmt(value)}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(+e.target.value)} />
    </div>
  );
}

function VzToggle({ label, on, onChange, disabled }: {
  label: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return <label className={'lr-vzt' + (disabled ? ' dis' : '')}><Sw on={on} onChange={onChange} />{label}</label>;
}

function VzSwatches({ colors, value, onChange, disabled, size }: {
  colors: string[]; value: string; onChange: (c: string) => void; disabled?: boolean; size: number;
}) {
  return (
    <div className={'lr-swat' + (disabled ? ' dis' : '')}>
      {colors.map((c) => (
        <button type="button" key={c} className={value === c ? 'on' : ''} style={{ background: c, width: size, height: size }} onClick={() => onChange(c)} title={c} />
      ))}
    </div>
  );
}

function VzPanel({ led, title, right, dim, children, accent }: {
  led: string; title: React.ReactNode; right?: React.ReactNode; dim?: boolean;
  children: React.ReactNode; accent?: string;
}) {
  return (
    <section className={'lr-vp' + (dim ? ' dim' : '')} style={accent ? { ['--mac' as string]: accent } : undefined}>
      <header>
        <span className="led" style={{ background: led, boxShadow: `0 0 7px ${led}` }} />
        <span className="t">{title}</span>
        <span className="sp" />
        {right}
      </header>
      <div className="b">{children}</div>
    </section>
  );
}

export function VisualsTabV2({ viz, setViz, stages, toggleStage, director, setDirector }: {
  viz: VizState;
  setViz: React.Dispatch<React.SetStateAction<VizState>>;
  stages: string[];
  toggleStage: (id: string) => void;
  director: string;
  setDirector: (id: string) => void;
}) {
  const set = <K extends keyof VizState>(k: K, v: VizState[K]) => setViz((s) => ({ ...s, [k]: v }));
  const dir = useMemo(() => DIRECTORS.find((d) => d.id === director) ?? DIRECTORS[0], [director]);
  const auto = director !== 'off';

  return (
    <div className="lr-vz">
      <VzPanel led="var(--accent)" title="Primary actions">
        <button
          type="button"
          className="lr-syncall"
          onClick={() => setViz((s) => ({ ...s, autoReact: true, laserSync: true, autoColor: true, bgSync: true }))}
        >
          <Icon name="refresh" size={14} />Sync all to music
        </button>
        <div className="lr-vzlbl">Color sync · theme</div>
        <div className="lr-theme">
          {viz.theme.map((c) => <span key={c} style={{ background: c }} />)}
          <button
            type="button"
            className="btn sm primary"
            onClick={() => setViz((s) => ({ ...s, autoColor: true, bgAuto: true }))}
          >
            Sync
          </button>
        </div>
        <p className="lr-vzhint">3 colours map to spectrum · lasers · background.</p>
      </VzPanel>

      <VzPanel led="var(--accent)" title="Stage select" right={<span className="lr-vzhint" style={{ margin: 0 }}>combine ↻</span>}>
        <div className="lr-vzgrid">
          {STAGES.map((s) => (
            <button type="button" key={s.id} className={'lr-vtile' + (stages.includes(s.id) ? ' on' : '')} onClick={() => toggleStage(s.id)}>
              <span className="gl">{s.glyph}</span>{s.label}<span className="d" />
            </button>
          ))}
        </div>
      </VzPanel>

      <VzPanel led="var(--violet)" accent="var(--violet)" title="Auto program" right={<span className="lr-vzhint" style={{ margin: 0 }}>sets modules</span>}>
        <div className="lr-vzgrid four">
          {DIRECTORS.map((d) => (
            <button type="button" key={d.id} className={'lr-vtile' + (director === d.id ? ' on' : '')} onClick={() => setDirector(d.id)} title={d.blurb}>
              <span className="gl">{d.glyph}</span>{d.label}<span className="d" />
            </button>
          ))}
        </div>
        <p className="lr-vzhint">{dir?.blurb}</p>
      </VzPanel>

      <VzPanel
        led={viz.autoReact ? 'var(--accent)' : 'var(--dim)'}
        title="Auto-react to music"
        dim={auto}
        right={<Sw on={viz.autoReact} onChange={(v) => set('autoReact', v)} />}
      >
        <p className="lr-vztext">Loud, intense parts add layers &amp; push the lasers; quiet parts strip back to one calm visual.</p>
        <VzSlider
          label="Sensitivity"
          value={Math.round(viz.autoReactSens * 100)}
          min={0}
          max={100}
          step={1}
          fmt={(v) => v + ' %'}
          onChange={(v) => set('autoReactSens', v / 100)}
          disabled={!viz.autoReact || auto}
        />
        {auto && <p className="lr-vzwarn">Auto program is driving — set it to Manual to use Auto-react.</p>}
      </VzPanel>

      <VzPanel
        led={viz.laserOn ? 'var(--accent)' : 'var(--dim)'}
        title={<span>⚡ Laser rig <b className="lr-synctag">SYNC</b></span>}
        right={<><Sw on={viz.laserSync} onChange={(v) => set('laserSync', v)} /><Sw on={viz.laserOn} onChange={(v) => set('laserOn', v)} /></>}
      >
        <div className="lr-vzrow">
          <span className="k">Effect</span><span className="sp" />
          <select className="lr-sel acc" value={viz.laserEffect} onChange={(e) => set('laserEffect', e.target.value)}>
            {LASER_EFFECTS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div className="lr-vzrow">
          <span className="k">Pattern</span><span className="sp" />
          <select className="lr-sel acc" value={viz.laserPattern} onChange={(e) => set('laserPattern', e.target.value)}>
            {LASER_PATTERNS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
        <VzSlider label="Intensity" value={viz.laserIntensity} min={0} max={100} step={5} fmt={(v) => v + ' %'} onChange={(v) => set('laserIntensity', v)} disabled={!viz.laserOn} />
        <VzSlider label="Beams" value={viz.laserBeams} min={1} max={12} step={1} fmt={(v) => String(v)} onChange={(v) => set('laserBeams', v)} disabled={!viz.laserOn} />
        <VzSlider label="Sweep speed" value={viz.laserSpeed} min={0.25} max={4} step={0.25} fmt={(v) => v.toFixed(2) + '×'} onChange={(v) => set('laserSpeed', v)} disabled={!viz.laserOn} />
        <div className="lr-vztogs">
          <VzToggle label="Roam" on={viz.laserMove} onChange={(v) => set('laserMove', v)} disabled={!viz.laserOn} />
          <VzToggle label="Flashes" on={viz.laserFlash} onChange={(v) => set('laserFlash', v)} disabled={!viz.laserOn} />
          <VzToggle label="Mono" on={viz.laserMono} onChange={(v) => set('laserMono', v)} disabled={!viz.laserOn} />
        </div>
        <div className="lr-vzlbl">Laser color (mono)</div>
        <VzHue
          value={viz.laserHue}
          onChange={(v) => setViz((s) => ({ ...s, laserHue: v, laserColor: hslToHex(v) }))}
          disabled={!viz.laserOn || !viz.laserMono}
        />
      </VzPanel>

      <VzPanel
        led="var(--accent)"
        title="Primary color"
        right={<label className="lr-vzt sm"><b className="lr-synctag">SYNC</b><Sw on={viz.autoColor} onChange={(v) => set('autoColor', v)} /></label>}
      >
        <VzSwatches colors={BG_COLORS.slice(0, 10)} value={viz.barColor} onChange={(c) => set('barColor', c)} disabled={viz.autoColor} size={17} />
        <VzHue
          value={viz.specHue}
          onChange={(v) => setViz((s) => ({ ...s, specHue: v, barColor: hslToHex(v) }))}
          disabled={viz.autoColor}
        />
      </VzPanel>

      <VzPanel
        led="var(--violet)"
        accent="var(--violet)"
        title="Background"
        right={<>
          <label className="lr-vzt sm"><b className="lr-synctag">SYNC</b><Sw on={viz.bgSync} onChange={(v) => set('bgSync', v)} /></label>
          <label className="lr-vzt sm"><b className="lr-synctag vio">CYCLE</b><Sw on={viz.bgAuto} onChange={(v) => set('bgAuto', v)} /></label>
        </>}
      >
        <VzSwatches colors={BG_COLORS} value={viz.bg} onChange={(c) => set('bg', c)} disabled={viz.bgSync || viz.bgAuto} size={16} />
        <VzHue
          value={viz.bgHue}
          onChange={(v) => setViz((s) => ({ ...s, bgHue: v, bg: hslToHex(v) }))}
          disabled={viz.bgSync || viz.bgAuto}
        />
        <VzToggle label="Flash background" on={viz.bgFlash} onChange={(v) => set('bgFlash', v)} />
        <VzSlider label="Flash rate" value={viz.bgFlashHz} min={1} max={12} step={1} fmt={(v) => v + ' Hz'} onChange={(v) => set('bgFlashHz', v)} disabled={!viz.bgFlash} />
        <div className="lr-vzrow">
          <span className="k">Color</span>
          <VzSwatches
            colors={['#94a3b8', '#00b890', '#7c6cd9', '#c98232', '#b04658']}
            value={viz.bgFlashColor}
            onChange={(c) => set('bgFlashColor', c)}
            disabled={!viz.bgFlash}
            size={14}
          />
        </div>
      </VzPanel>

      <VzPanel led={viz.gridIntensity > 0 ? 'var(--cyan)' : 'var(--dim)'} title="Floor grid">
        <VzSlider label="Intensity" value={viz.gridIntensity} min={0} max={300} step={10} fmt={(v) => (v === 0 ? 'off' : v + ' %')} onChange={(v) => set('gridIntensity', v)} />
        <div className="lr-vzlbl">Grid color</div>
        <VzHue value={viz.gridHue} onChange={(v) => set('gridHue', v)} disabled={viz.gridIntensity === 0} />
      </VzPanel>

      <VzPanel led={viz.dropFx ? 'var(--accent)' : 'var(--dim)'} title="FX · Moments">
        <VzToggle label="Sync fireworks to drops" on={viz.dropFx} onChange={(v) => set('dropFx', v)} />
      </VzPanel>
    </div>
  );
}
