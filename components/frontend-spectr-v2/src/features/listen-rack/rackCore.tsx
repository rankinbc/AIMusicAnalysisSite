/* SPECTR · Listen rack redesign — shared module renderers.
 * Renders controls straight from the manifest. The live state + hooks live in
 * rackState.ts (non-component module); these renderers bind to that shape.
 */
import { type CSSProperties } from 'react';

import { MANIFEST_BY_ID, type EqBand } from './data';
import { useGainReduction, type RackState } from './rackState';
import { GRMeter, ParamControl } from './ui';

// ── rack chrome: active count + signal flow + A/B + reset + bindings ───────
export function RackChrome({ rs, dense }: { rs: RackState; playing?: boolean; dense?: boolean }) {
  const flow = rs.order.filter((id) => rs.mod[id].enabled).map((id) => MANIFEST_BY_ID[id].label.split(' ')[0]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span className="dot" style={{ background: rs.masterBypass ? 'var(--muted)' : 'var(--cyan)', boxShadow: rs.masterBypass ? 'none' : '0 0 8px var(--cyan)' }} />
        <span className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', fontWeight: 700, color: rs.masterBypass ? 'var(--muted)' : 'var(--cyan)', textTransform: 'uppercase' }}>INSERT RACK</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{rs.activeCount} on · bypass {rs.masterBypass ? 'on' : 'off'}</span>
      </div>
      {!dense && (
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
          <span style={{ color: 'var(--text-2)' }}>Signal</span>
          {flow.length ? flow.map((l, i) => <span key={i}>{i ? ' → ' : ''}<span style={{ color: 'var(--text-2)' }}>{l}</span></span>) : <span>flat (transparent)</span>}
          <span> → Σ</span>
        </div>
      )}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" onClick={() => rs.setShowBind(!rs.showBind)} className="mono" title="Show useAudioGraph bindings"
          style={{ fontSize: 9.5, padding: '5px 9px', borderRadius: 6, color: rs.showBind ? 'var(--cyan)' : 'var(--muted)', border: `1px solid ${rs.showBind ? 'rgba(0,229,176,0.4)' : 'var(--border)'}`, background: rs.showBind ? 'rgba(0,229,176,0.08)' : 'transparent' }}>⌁ Bindings</button>
        <button type="button" onClick={() => rs.setMasterBypass(!rs.masterBypass)} className="btn sm" style={{ color: rs.masterBypass ? 'var(--cyan)' : 'var(--text-2)', borderColor: rs.masterBypass ? 'rgba(0,229,176,0.4)' : 'var(--border)' }}>A / B Bypass</button>
        <button type="button" onClick={rs.reset} className="btn ghost sm" style={{ color: 'var(--muted)' }}>↺ Reset</button>
      </div>
    </div>
  );
}

// 8-band EQ editor (expanded EQ)
export function EqBandEditor({ bands, setBands, accent, dim }: {
  bands: EqBand[]; setBands: (b: EqBand[]) => void; accent: string; dim?: boolean;
}) {
  const setGain = (i: number, g: number) => setBands(bands.map((b, j) => j === i ? { ...b, gainDb: Math.max(-24, Math.min(24, g)) } : b));
  return (
    <div style={{ background: 'rgba(7,10,18,0.4)', borderRadius: 8, padding: '14px 12px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        {bands.map((b, i) => {
          const on = Math.abs(b.gainDb) > 0.05;
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
              <span className="mono" style={{ fontSize: 9, fontWeight: 600, color: on && !dim ? accent : 'var(--muted)' }}>{b.gainDb > 0 ? '+' : ''}{b.gainDb.toFixed(1)}</span>
              <input type="range" min="-24" max="24" step="0.5" value={b.gainDb} onChange={(e) => setGain(i, parseFloat(e.target.value))} className="lr-eq-slider"
                style={{ writingMode: 'vertical-lr', direction: 'rtl', width: 6, height: 84, ['--eq-accent']: dim ? 'var(--muted)' : accent } as CSSProperties} />
              <span className="mono" style={{ fontSize: 8, color: 'var(--muted)' }}>{b.freq >= 1000 ? (b.freq / 1000) + 'k' : b.freq}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, paddingTop: 9, borderTop: '1px solid var(--border)' }}>
        <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>Drag a band — curve redraws on the stage.</span>
        <button type="button" onClick={() => setBands(bands.map((b) => ({ ...b, gainDb: 0 })))} className="btn ghost sm" style={{ fontSize: 9.5, color: 'var(--muted)', padding: '3px 8px' }}>Flatten</button>
      </div>
    </div>
  );
}

// ── Rich inline controls (no drill-down): show a module's whole param set ───
export function RichControls({ id, rs, playing, knobSize = 34 }: {
  id: string; rs: RackState; playing: boolean; knobSize?: number;
}) {
  const m = MANIFEST_BY_ID[id], st = rs.mod[id], on = st.enabled && !rs.masterBypass;
  const gr = useGainReduction(rs.graph, id, m.hasMeter ? st.enabled : false, playing, id === 'limiter' ? 4 : id === 'gate' ? 10 : 6);
  if (id === 'eq') return <EqBandEditor bands={st.bands as EqBand[]} setBands={rs.setEqBands} accent={m.accent} dim={!on} />;
  const skip = id === 'delay' ? ['bpm', 'enabled'] : ['enabled'];
  const params = m.params.filter((p) => !skip.includes(p.key));
  const knobs = params.filter((p) => p.control !== 'slider');
  const sliders = params.filter((p) => p.control === 'slider');
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '13px 12px', alignItems: 'flex-start', flex: 1 }}>
        {knobs.map((p) => <ParamControl key={p.key} p={p} value={st[p.key]} accent={m.accent} dim={!on} knobSize={knobSize} onChange={(k, v) => rs.setParam(id, k, v)} />)}
        {sliders.map((p) => <div key={p.key} style={{ width: '100%' }}><ParamControl p={p} value={st[p.key]} accent={m.accent} dim={!on} onChange={(k, v) => rs.setParam(id, k, v)} /></div>)}
      </div>
      {m.hasMeter && <GRMeter reductionDb={gr} open={id === 'gate' ? gr > -0.2 : undefined} height={knobSize * 2 + 24} />}
    </div>
  );
}
