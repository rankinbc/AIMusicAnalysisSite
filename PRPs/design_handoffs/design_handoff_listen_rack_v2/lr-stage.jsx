/* spectre — Listen Rack redesign. Stage (canvas spectrum) + transport lane. */
const { useState: sS, useEffect: sE, useRef: sR, useMemo: sM } = React;

// ── Light show background: lasers + floor grid + haze, behind the whole page ─
function LightShow({ playing, intensity = 1, show }) {
  const cv = sR(null);
  const pr = sR({}); pr.current = { playing, intensity };
  sE(() => {
    if (!show) return;
    const c = cv.current, ctx = c.getContext('2d');
    let raf; const t0 = performance.now();
    const beams = [
      { h: 168, x: .06, base: .55, sw: .5, sp: .21, ph: 0 }, { h: 275, x: .3, base: .2, sw: .65, sp: .15, ph: 2.1 },
      { h: 330, x: .68, base: -.2, sw: .6, sp: .18, ph: 4.2 }, { h: 200, x: .94, base: -.55, sw: .5, sp: .24, ph: 1.3 },
    ];
    const dust = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.5 + .4, s: Math.random() * .01 + .003, ph: Math.random() * 7 }));
    const draw = () => {
      const { playing, intensity: I } = pr.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2), W = window.innerWidth, H = window.innerHeight;
      if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      const t = (performance.now() - t0) / 1000, live = playing ? 1 : .35;
      const beat = playing ? Math.pow(Math.max(0, Math.sin(t * Math.PI * (128 / 60))), 3) : 0;
      // haze wash
      const hz = ctx.createRadialGradient(W * .5, H * 1.05, 0, W * .5, H * 1.05, H * 1.1);
      hz.addColorStop(0, `hsla(${190 + Math.sin(t * .13) * 40},80%,45%,${.075 * I * live})`); hz.addColorStop(1, 'transparent');
      ctx.fillStyle = hz; ctx.fillRect(0, 0, W, H);
      // floor grid
      const hy = H * .66;
      ctx.strokeStyle = `hsla(168,90%,55%,${.05 * I * live})`; ctx.lineWidth = 1;
      for (let i = 0; i < 9; i++) {
        const p = ((t * .06 + i / 9) % 1), y = hy + Math.pow(p, 2.6) * (H - hy);
        ctx.globalAlpha = p * .9; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (let i = -7; i <= 7; i++) {
        ctx.beginPath(); ctx.moveTo(W * .5 + i * 26, hy); ctx.lineTo(W * .5 + i * W * .12, H); ctx.stroke();
      }
      // lasers
      ctx.globalCompositeOperation = 'lighter';
      beams.forEach((b) => {
        const a = b.base + Math.sin(t * b.sp * (playing ? 1 : .4) + b.ph) * b.sw;
        const x0 = b.x * W, L = H * 1.5, al = (.10 + beat * .12) * I * live;
        ctx.save(); ctx.translate(x0, -12); ctx.rotate(a);
        const g = ctx.createLinearGradient(0, 0, 0, L);
        g.addColorStop(0, `hsla(${b.h},100%,62%,${al})`); g.addColorStop(1, 'transparent');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-1.5, 0); ctx.lineTo(1.5, 0); ctx.lineTo(26, L); ctx.lineTo(-26, L); ctx.closePath(); ctx.fill();
        const core = ctx.createLinearGradient(0, 0, 0, L);
        core.addColorStop(0, `hsla(${b.h},100%,72%,${al * 2.4})`); core.addColorStop(1, 'transparent');
        ctx.strokeStyle = core; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, L); ctx.stroke();
        ctx.restore();
        const sg = ctx.createRadialGradient(x0, 0, 0, x0, 0, 46);
        sg.addColorStop(0, `hsla(${b.h},100%,65%,${al * 2})`); sg.addColorStop(1, 'transparent');
        ctx.fillStyle = sg; ctx.fillRect(x0 - 46, -46, 92, 92);
      });
      // dust
      ctx.fillStyle = `hsla(190,60%,80%,${.16 * I * live})`;
      dust.forEach((d) => {
        d.y -= d.s / 10; if (d.y < 0) d.y = 1;
        const x = (d.x + Math.sin(t * .3 + d.ph) * .012) * W;
        ctx.globalAlpha = (.3 + .7 * Math.abs(Math.sin(t * .8 + d.ph))) * .5;
        ctx.beginPath(); ctx.arc(x, d.y * H, d.r, 0, 7); ctx.fill();
      });
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [show]);
  return show ? <canvas className="lr-bgfx" ref={cv} /> : null;
}

// live-ish meter values so the page reads as an audio surface
function useMeters(playing, mod, bypass) {
  const [v, setV] = sS({ lufs: -11.2, tp: -0.6, corr: 0.71, gr: 0 });
  sE(() => {
    if (!playing) return;
    const iv = setInterval(() => setV((p) => {
      const lim = mod.limiter.enabled && !bypass, comp = mod.comp.enabled && !bypass;
      return {
        lufs: lrClamp(p.lufs + (Math.random() - 0.5) * 0.5, -13.5, -9.5),
        tp: lim ? mod.limiter.ceilingDb - Math.random() * 0.25 : lrClamp(p.tp + (Math.random() - 0.5) * 0.3, -1.4, 0.4),
        corr: lrClamp(p.corr + (Math.random() - 0.5) * 0.05, 0.35, 0.95),
        gr: comp || lim ? Math.abs(Math.sin(Date.now() / 420)) * (comp ? 3.4 : 1.6) : 0,
      };
    }), 220);
    return () => clearInterval(iv);
  }, [playing, mod.limiter.enabled, mod.limiter.ceilingDb, mod.comp.enabled, bypass]);
  return v;
}

// ── Canvas stage: spectrum bars shaped by the live EQ curve ─────────────
function Stage({ playing, height, bands, eqOn, energy, tint }) {
  const cv = sR(null);
  const pr = sR({});
  pr.current = { playing, bands, eqOn, energy, tint };
  sE(() => {
    const c = cv.current; if (!c) return;
    const ctx = c.getContext('2d'); let raf, t0 = performance.now();
    const N = 72;
    const draw = () => {
      const { playing, bands, eqOn, energy, tint } = pr.current;
      const dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
      if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      const t = (performance.now() - t0) / 1000;
      const beat = playing ? Math.pow(Math.max(0, Math.sin(t * Math.PI * (128 / 60) / 2)), 2.4) : 0;
      // — backdrop: lifted teal wash + drifting aurora blobs —
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#070b16'); bg.addColorStop(.65, '#071018'); bg.addColorStop(1, '#081521');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'screen';
      [[.2, 168, .09], [.62, 265, .07], [.9, 195, .08]].forEach(([fx, hue, al], bi) => {
        const bx = (fx + Math.sin(t * .1 + bi * 2.4) * .09) * W, by = H * (.72 + Math.sin(t * .14 + bi) * .1);
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, H * .85);
        g.addColorStop(0, `hsla(${hue + Math.sin(t * .07) * 24},70%,42%,${(al + beat * .05) * (playing ? 1 : .55)})`); g.addColorStop(1, 'transparent');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      });
      ctx.globalCompositeOperation = 'source-over';
      // — calibration grid: dB rows + log-spaced Hz columns (labels drawn after bars) —
      const GX = 26, gy = (k) => 34 + k * (H - 64) / 3;
      ctx.lineWidth = 1;
      [0, 1, 2, 3].forEach((k) => {
        ctx.strokeStyle = 'rgba(148,163,184,.13)';
        ctx.beginPath(); ctx.moveTo(GX, gy(k)); ctx.lineTo(W - 8, gy(k)); ctx.stroke();
      });
      const hzX = (f) => GX + Math.log(f / 30) / Math.log(16000 / 30) * (W - GX - 8);
      [[60, '60'], [120, '120'], [250, '250'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k']].forEach(([f]) => {
        ctx.strokeStyle = 'rgba(148,163,184,.07)';
        ctx.beginPath(); ctx.moveTo(hzX(f), 26); ctx.lineTo(hzX(f), H - 20); ctx.stroke();
      });
      const gw = (W - GX - 8) / N;
      for (let i = 0; i < N; i++) {
        const f = i / N;
        let a = 0.42 + 0.38 * Math.sin(f * 7 + t * 1.4) * Math.sin(f * 2.3 + t * 0.6);
        a *= 1 - Math.pow(f, 1.5) * 0.62;
        a += beat * (0.34 * Math.exp(-f * 9) + 0.08);
        if (eqOn) { const bi = Math.min(7, Math.floor(f * 9)); a *= 1 + (bands[bi].enabled ? bands[bi].gainDb / 24 : 0); }
        a *= playing ? 0.75 + energy / 200 : 0.22;
        const h = lrClamp(a, 0.02, 1) * (H - 60);
        ctx.fillStyle = tint; ctx.globalAlpha = 0.28 + 0.6 * lrClamp(a, 0, 1);
        ctx.fillRect(GX + i * gw + 1, H - h - 20, gw - 2.2, h);
        ctx.globalAlpha = 0.1; ctx.fillRect(GX + i * gw + 1, H - 20, gw - 2.2, Math.min(h * 0.3, 26));
      }
      ctx.globalAlpha = 1;
      // labels on top of the bars
      ctx.font = '8.5px "JetBrains Mono",monospace'; ctx.textBaseline = 'middle';
      ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(178,192,210,.65)';
      [0, -12, -24, -36].forEach((db, k) => ctx.fillText(String(db), 6, gy(k)));
      ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(178,192,210,.55)';
      [[60, '60'], [120, '120'], [250, '250'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k']].forEach(([f, l]) => ctx.fillText(l, hzX(f), H - 11));
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <div className="lr-stage" style={{ height }}><canvas ref={cv} /></div>;
}

// ── Transport: play, waveform scrub with note pins, mono readout ────────
const LR_WAVE = Array.from({ length: 128 }, (_, i) =>
  0.2 + Math.abs(Math.sin(i * 0.31) * 0.42 + Math.sin(i * 0.09) * 0.34 + Math.sin(i * 1.7) * 0.12));

function Transport({ playing, onPlay, position, onSeek, notes, activeNote, onNote, showNotes }) {
  const ref = sR(null);
  const pct = position / TRACK.durationSec;
  return (
    <div className="lr-tp">
      <button className="pl-btn" onClick={onPlay} title={playing ? 'Pause' : 'Play'}><Icon name={playing ? 'pause' : 'play'} /></button>
      <span className="pl-time"><b>{lrTime(position)}</b><span className="sep">/</span><span className="tot">{lrTime(TRACK.durationSec)}</span></span>
      <div className="lr-wave" ref={ref} onPointerDown={(e) => { e.preventDefault(); lrDrag(ref.current, e, (v) => onSeek(v * TRACK.durationSec)); }}>
        {LR_WAVE.map((v, i) => <i key={i} className={i / LR_WAVE.length <= pct ? 'on' : ''} style={{ height: (v * 100) + '%' }} />)}
        {showNotes && notes.map((n) =>
          <button key={n.id} className={'lr-note' + (n.pinned ? ' pin' : '')} title={n.text}
            style={{ left: (n.t / TRACK.durationSec * 100) + '%', outline: activeNote === n.id ? '1.5px solid #fff' : 'none' }}
            onPointerDown={(e) => e.stopPropagation()} onClick={() => onNote(n)} />)}
      </div>
      <span className="pl-time"><span className="tot">{TRACK.bpm} BPM</span><span className="sep">·</span>{TRACK.key}</span>
    </div>);
}

// ── Stage card: overlay chips + stage + transport ──────────────────────
function StageCard({ playing, onPlay, position, onSeek, rack, meters, tw, notes, activeNote, onNote, section }) {
  const eqOn = rack.mod.eq.enabled && !rack.bypass;
  const active = rack.order.filter((id) => rack.mod[id].enabled).length;
  return (
    <div className="card lr-stagecard">
      <Stage playing={playing} height={tw.stageHeight} bands={rack.mod.eq.bands} eqOn={eqOn} energy={tw.stageHeight} tint={rack.bypass ? '#64748b' : '#00e5b0'} />
      <div className="lr-ovl">
        <span className="lr-mchip sec">Section <b>{section}</b></span>
        {tw.stageMeters && <React.Fragment>
          <span className={'lr-mchip ' + (meters.lufs > -10.5 ? 'warn' : 'ok')}>LUFS-S <b>{meters.lufs.toFixed(1)}</b></span>
          <span className={'lr-mchip ' + (meters.tp > -0.3 ? 'warn' : 'ok')}>True peak <b>{meters.tp.toFixed(1)}</b></span>
          <span className="lr-mchip">Corr <b>{meters.corr.toFixed(2)}</b></span>
          <span className={'lr-mchip ' + (meters.gr > 2.5 ? 'warn' : '')}>GR <b>−{meters.gr.toFixed(1)}</b></span>
        </React.Fragment>}
        <span className="sp" />
        <span className="lr-mchip">Chain <b>{rack.bypass ? 'bypassed' : active + ' on'}</b></span>
      </div>
      <Transport playing={playing} onPlay={onPlay} position={position} onSeek={onSeek} notes={notes} activeNote={activeNote} onNote={onNote} showNotes={tw.notePins} />
    </div>);
}
Object.assign(window, { useMeters, Stage, Transport, StageCard, LightShow, LR_WAVE });
