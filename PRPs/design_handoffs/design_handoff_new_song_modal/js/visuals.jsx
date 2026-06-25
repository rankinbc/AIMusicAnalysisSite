// visuals.jsx — song cover renderers + live library-card preview.
// Color model: each color is an oklch triple {l,c,h}, so the palette can carry
// vivid AND deep/dark tones. Renderers derive their gradient stops from the two
// chosen colors. Aurora stays faithful to the app's CoverArt recipe (dark base
// + two color glows); the rest are new, extensible templates.

// ── Palette ───────────────────────────────────────────────────────────────
// Curated swatches, vivid → deep → dark → near-neutral. Stored on the song as
// {l,c,h}. 14 per picker, 7 across.
const PALETTE = [
  { l: 0.72, c: 0.19, h: 352 }, // rose
  { l: 0.72, c: 0.18, h: 25 },  // coral
  { l: 0.76, c: 0.16, h: 70 },  // amber
  { l: 0.80, c: 0.18, h: 135 }, // green
  { l: 0.74, c: 0.15, h: 172 }, // emerald (brand)
  { l: 0.72, c: 0.13, h: 210 }, // sky
  { l: 0.66, c: 0.17, h: 285 }, // violet
  { l: 0.52, c: 0.18, h: 6 },   // deep red
  { l: 0.54, c: 0.15, h: 48 },  // rust
  { l: 0.50, c: 0.13, h: 165 }, // deep teal
  { l: 0.46, c: 0.16, h: 270 }, // indigo
  { l: 0.40, c: 0.14, h: 320 }, // plum
  { l: 0.34, c: 0.10, h: 250 }, // midnight
  { l: 0.30, c: 0.03, h: 250 }, // charcoal
];

const colorKey = (c) => `${c.l}|${c.c}|${c.h}`;
const oklch = (c, alpha) => `oklch(${c.l} ${c.c} ${c.h}${alpha != null ? ` / ${alpha}` : ''})`;
// shift lightness/chroma of a color, clamped
const shade = (c, dl = 0, dc = 0) => ({ l: Math.max(0.05, Math.min(0.95, c.l + dl)), c: Math.max(0, c.c + dc), h: c.h });
const swatchColor = (c) => oklch(c);

// linear blend two colors (for spectrum bars)
const mix = (a, b, t) => ({ l: a.l + (b.l - a.l) * t, c: a.c + (b.c - a.c) * t, h: a.h + (b.h - a.h) * t });

const TEMPLATES = [
  { id: 'aurora', label: 'Aurora' },
  { id: 'vinyl', label: 'Vinyl' },
  { id: 'spin', label: 'Spin' },
  { id: 'eq', label: 'EQ' },
  { id: 'skyline', label: 'City' },
  { id: 'robot', label: 'Robot' },
  { id: 'booth', label: 'Booth' },
  { id: 'cassette', label: 'Cassette' },
  { id: 'boombox', label: 'Boombox' },
];

const Scan = ({ opacity = 0.4 }) => <div className="cardp-scan" style={{ opacity }} />;

// ── Aurora — the canonical CoverArt look ────────────────────────────────────
function auroraBg(p, s) {
  return `
    radial-gradient(ellipse 80% 60% at 30% 30%, ${oklch(p, 0.72)} 0%, transparent 55%),
    radial-gradient(ellipse 70% 80% at 80% 70%, ${oklch(shade(s, -0.05, 0.02), 0.55)} 0%, transparent 60%),
    linear-gradient(135deg, ${oklch({ l: 0.21, c: Math.min(p.c, 0.05), h: p.h })} 0%, ${oklch({ l: 0.12, c: Math.min(s.c, 0.045), h: s.h })} 100%)
  `;
}
function AuroraVisual({ p, s }) {
  return <div className="cardp-vis" style={{ background: auroraBg(p, s) }}><Scan /></div>;
}

// ── Record disc (shared by Vinyl + Spin) ────────────────────────────────────
function RecordDisc({ p, s, style }) {
  const body = `
    repeating-radial-gradient(circle at 50% 50%, rgba(255,255,255,0.05) 0 1px, rgba(0,0,0,0) 1.4px 3px),
    conic-gradient(from 205deg at 50% 50%, transparent 0deg, ${oklch(shade(s, 0.04, 0.02), 0.55)} 42deg, transparent 86deg, transparent 214deg, ${oklch(shade(s, 0.04, 0.02), 0.4)} 256deg, transparent 300deg),
    radial-gradient(circle at 36% 30%, rgba(255,255,255,0.16) 0%, transparent 36%),
    radial-gradient(circle at 50% 50%, #17171d 0%, #0c0c11 58%, #050507 100%)
  `;
  const label = `radial-gradient(circle at 50% 42%, ${oklch(shade(p, 0.0, 0))} 0%, ${oklch(shade(p, -0.16))} 66%, ${oklch(shade(p, -0.26))} 100%)`;
  return (
    <div
      aria-hidden="true"
      style={{
        borderRadius: '50%', overflow: 'hidden', background: body,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `0 12px 34px -10px rgba(0,0,0,0.75), inset 0 0 18px -2px ${oklch(shade(s, 0.04, 0.02), 0.28)}, inset 0 0 0 1px rgba(255,255,255,0.05)`,
        ...style,
      }}
    >
      <div style={{ position: 'absolute', inset: '14%', borderRadius: '50%', boxShadow: `inset 0 0 0 1px ${oklch(shade(s, 0.04, 0.02), 0.18)}` }} />
      <div style={{
        width: '36%', height: '36%', borderRadius: '50%', background: label,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.07), 0 2px 8px rgba(0,0,0,0.4)',
      }}>
        <div style={{ width: '13%', height: '13%', borderRadius: '50%', background: '#070708', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)' }} />
      </div>
    </div>
  );
}

function VinylVisual({ p, s }) {
  const backdrop = `
    radial-gradient(ellipse 90% 130% at 16% 28%, ${oklch(shade(p, -0.38, -0.07))} 0%, transparent 58%),
    radial-gradient(ellipse 75% 95% at 94% 82%, ${oklch(shade(s, -0.42, -0.05), 0.7)} 0%, transparent 55%),
    linear-gradient(135deg, ${oklch({ l: 0.2, c: Math.min(p.c, 0.05), h: p.h })} 0%, ${oklch({ l: 0.11, c: Math.min(s.c, 0.04), h: s.h })} 100%)
  `;
  return (
    <div className="cardp-vis" style={{ background: backdrop }}>
      <RecordDisc p={p} s={s} style={{ position: 'absolute', top: '50%', left: '50%', height: '132%', aspectRatio: '1', transform: 'translate(-50%, -50%)' }} />
      <Scan opacity={0.22} />
    </div>
  );
}

// ── Spin — a record on the platter, viewed at an angle (turntable) ──────────
function SpinVisual({ p, s }) {
  const backdrop = `
    radial-gradient(ellipse 70% 90% at 78% 18%, ${oklch(shade(s, -0.34, -0.04), 0.8)} 0%, transparent 55%),
    radial-gradient(ellipse 90% 80% at 20% 95%, ${oklch(shade(p, -0.40, -0.06))} 0%, transparent 60%),
    linear-gradient(160deg, ${oklch({ l: 0.19, c: Math.min(p.c, 0.05), h: p.h })} 0%, ${oklch({ l: 0.09, c: 0.03, h: s.h })} 100%)
  `;
  return (
    <div className="cardp-vis" style={{ background: backdrop, perspective: '460px', perspectiveOrigin: '50% 30%' }}>
      <div style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d' }}>
        <RecordDisc
          p={p} s={s}
          style={{ position: 'absolute', top: '54%', left: '50%', height: '150%', aspectRatio: '1', transform: 'translate(-50%, -50%) rotateX(56deg) rotateZ(-14deg)' }}
        />
        {/* tonearm — thin bar + headshell, from upper-right toward the label */}
        <div style={{ position: 'absolute', top: '14%', right: '12%', width: '46%', height: '4px', borderRadius: '3px', transform: 'rotate(26deg)', transformOrigin: 'right center', background: 'linear-gradient(90deg, #2a2f3a, #c7ccd6 70%, #e6e9ef)', boxShadow: '0 3px 8px rgba(0,0,0,0.5)' }}>
          <div style={{ position: 'absolute', left: '-3px', top: '-3px', width: '12px', height: '10px', borderRadius: '2px', background: '#e6e9ef', boxShadow: '0 2px 5px rgba(0,0,0,0.5)' }} />
          <div style={{ position: 'absolute', right: '-6px', top: '-4px', width: '12px', height: '12px', borderRadius: '50%', background: '#3a4150', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.2)' }} />
        </div>
      </div>
      <Scan opacity={0.18} />
    </div>
  );
}

// ── EQ — spectrum-analyzer bars, hue-ramped primary → secondary ─────────────
function EqVisual({ p, s, mini }) {
  const n = mini ? 14 : 28;
  const base = `linear-gradient(180deg, ${oklch({ l: 0.17, c: Math.min(p.c, 0.05), h: p.h })} 0%, ${oklch({ l: 0.09, c: 0.025, h: s.h })} 100%)`;
  return (
    <div className="cardp-vis" style={{ background: base }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: mini ? '1.5px' : '2.5px', padding: mini ? '0 6px 0' : '0 12px' }}>
        {Array.from({ length: n }).map((_, i) => {
          const t = i / (n - 1);
          const env = 0.30 + (Math.sin(i * 0.55) * 0.5 + 0.5) * 0.62 * (0.55 + 0.45 * Math.sin(i * 1.7 + 0.6));
          const bc = mix(p, s, t);
          return (
            <div key={i} style={{
              flex: 1, minWidth: 0, height: `${Math.min(0.95, env) * 100}%`, borderRadius: '2px 2px 0 0',
              background: `linear-gradient(180deg, ${oklch(shade(bc, 0.1))} 0%, ${oklch(bc)} 55%, ${oklch(shade(bc, -0.08))} 100%)`,
              boxShadow: mini ? 'none' : `0 0 7px -1px ${oklch(bc, 0.55)}`,
            }} />
          );
        })}
      </div>
      {/* baseline glow */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '36%', background: `linear-gradient(180deg, transparent, ${oklch(shade(p, -0.3), 0.5)})`, pointerEvents: 'none' }} />
      <Scan opacity={0.25} />
    </div>
  );
}

// ── Skyline — a city at night ───────────────────────────────────────────────
const SKYLINE = [
  { w: 7, h: 42 }, { w: 10, h: 66 }, { w: 6, h: 34 }, { w: 12, h: 82 }, { w: 8, h: 54 },
  { w: 14, h: 96 }, { w: 7, h: 48 }, { w: 11, h: 72 }, { w: 9, h: 60 }, { w: 6, h: 38 }, { w: 13, h: 88 }, { w: 8, h: 50 },
];
function SkylineVisual({ p, s, mini }) {
  const sky = `
    radial-gradient(ellipse 60% 70% at 78% 14%, ${oklch(shade(s, 0.06, -0.02), 0.55)} 0%, transparent 55%),
    linear-gradient(180deg, ${oklch({ l: 0.26, c: Math.min(s.c, 0.09), h: s.h })} 0%, ${oklch({ l: 0.14, c: Math.min(p.c, 0.07), h: p.h })} 58%, ${oklch({ l: 0.07, c: 0.02, h: p.h })} 100%)
  `;
  const lit = oklch(shade(s, 0.16, -0.02), 0.92);
  return (
    <div className="cardp-vis" style={{ background: sky, overflow: 'hidden' }}>
      {/* moon */}
      <div style={{ position: 'absolute', top: '16%', right: '15%', width: mini ? '8px' : '16px', height: mini ? '8px' : '16px', borderRadius: '50%', background: oklch(shade(s, 0.2, -0.05)), boxShadow: `0 0 16px 2px ${oklch(shade(s, 0.16), 0.6)}` }} />
      {/* horizon glow */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '46%', background: `linear-gradient(180deg, transparent, ${oklch(shade(p, -0.18, 0.02), 0.55)})` }} />
      {/* buildings */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: mini ? '2px' : '3px' }}>
        {SKYLINE.map((b, i) => (
          <div key={i} style={{
            width: `${b.w}%`, height: `${b.h}%`, position: 'relative',
            background: oklch({ l: 0.085 + (i % 3) * 0.015, c: 0.02, h: p.h }),
            backgroundImage: `radial-gradient(${lit} 32%, transparent 36%)`,
            backgroundSize: mini ? '4px 5px' : '6px 8px',
            backgroundBlendMode: 'screen',
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.3)',
          }}>
            {/* darken the window grid toward the top edge */}
            <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, ${oklch({ l: 0.07, c: 0.02, h: p.h })} 0%, transparent 30%)` }} />
          </div>
        ))}
      </div>
      <Scan opacity={0.18} />
    </div>
  );
}

// The coach mascot (provided image). Kept crisp + on-brand; a radial edge-fade
// melts its square backdrop into the scene. Chosen colors theme the scene
// around it (backdrop glows, console, halo) rather than recoloring the mascot.
const COACH = 'assets/coach.png';
function Coach({ style }) {
  const m = 'radial-gradient(ellipse 68% 72% at 50% 47%, #000 55%, rgba(0,0,0,0.4) 76%, transparent 90%)';
  return (
    <div aria-hidden="true" style={{
      backgroundImage: `url(${COACH})`, backgroundSize: 'contain',
      backgroundRepeat: 'no-repeat', backgroundPosition: 'center',
      WebkitMaskImage: m, maskImage: m, ...style,
    }} />
  );
}

// ── Robot — the coach as a hero portrait ────────────────────────────────────
function RobotVisual({ p, s }) {
  const backdrop = `
    radial-gradient(ellipse 72% 80% at 50% 36%, ${oklch(p, 0.5)} 0%, transparent 58%),
    radial-gradient(ellipse 85% 70% at 50% 102%, ${oklch(shade(s, -0.18, 0), 0.6)} 0%, transparent 60%),
    linear-gradient(160deg, ${oklch({ l: 0.18, c: Math.min(p.c, 0.05), h: p.h })} 0%, ${oklch({ l: 0.08, c: 0.03, h: s.h })} 100%)
  `;
  return (
    <div className="cardp-vis" style={{ background: backdrop }}>
      <div style={{ position: 'absolute', top: '47%', left: '50%', width: '66%', aspectRatio: '1', transform: 'translate(-50%,-50%)', borderRadius: '50%', background: `radial-gradient(circle, ${oklch(p, 0.5)} 0%, transparent 62%)` }} />
      <Coach style={{ position: 'absolute', inset: '6% 0 9%', filter: 'drop-shadow(0 10px 18px rgba(0,0,0,0.5))' }} />
      <Scan opacity={0.3} />
    </div>
  );
}

// ── Booth — the coach playing a DJ set (decks + mixer rendered in CSS) ───────
function Deck({ p }) {
  return (
    <div style={{ flex: '0 0 auto', height: '82%', aspectRatio: '1', borderRadius: '50%', position: 'relative', alignSelf: 'flex-end', background: 'radial-gradient(circle at 42% 36%, #21242c 0%, #0b0c10 72%)', boxShadow: '0 5px 12px -3px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.07)' }}>
      <div style={{ position: 'absolute', inset: '16%', borderRadius: '50%', background: 'repeating-radial-gradient(circle, rgba(255,255,255,0.06) 0 1px, transparent 1px 2.6px), radial-gradient(circle, #16161b, #050506)' }}>
        <div style={{ position: 'absolute', inset: '37%', borderRadius: '50%', background: oklch(p), boxShadow: `0 0 6px ${oklch(p, 0.6)}` }} />
      </div>
      <div style={{ position: 'absolute', top: '12%', right: '8%', width: '46%', height: '2px', background: 'linear-gradient(90deg,#3a4150,#d3d7df)', transform: 'rotate(34deg)', transformOrigin: 'right center', borderRadius: '2px' }} />
    </div>
  );
}
function Mixer({ p, s, mini }) {
  return (
    <div style={{ flex: '0 0 auto', width: '17%', height: '60%', alignSelf: 'flex-end', borderRadius: '4px', background: 'linear-gradient(180deg,#22252d,#0e0f13)', boxShadow: '0 5px 10px -3px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.07)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: mini ? '2px' : '3px', padding: '0 0 14%' }}>
      {!mini && [0, 1, 2].map((i) => (
        <div key={i} style={{ width: '3px', height: '58%', background: 'rgba(255,255,255,0.14)', borderRadius: '2px', position: 'relative' }}>
          <div style={{ position: 'absolute', left: '50%', top: `${18 + i * 20}%`, transform: 'translateX(-50%)', width: '7px', height: '4px', borderRadius: '1px', background: i === 1 ? oklch(s) : oklch(p) }} />
        </div>
      ))}
      {mini && <div style={{ width: '60%', height: '50%', borderRadius: '2px', background: oklch(p, 0.7) }} />}
    </div>
  );
}
function BoothVisual({ p, s, mini }) {
  const backdrop = `
    radial-gradient(ellipse 50% 60% at 50% 4%, ${oklch(shade(s, 0.06, 0), 0.5)} 0%, transparent 55%),
    radial-gradient(ellipse 95% 55% at 50% 102%, ${oklch(shade(p, -0.2, 0), 0.55)} 0%, transparent 60%),
    linear-gradient(180deg, ${oklch({ l: 0.16, c: Math.min(s.c, 0.07), h: s.h })} 0%, ${oklch({ l: 0.07, c: 0.025, h: p.h })} 100%)
  `;
  const beam = (x, hue) => ({ position: 'absolute', top: '-8%', left: `${x}%`, width: '30%', height: '82%', transform: 'translateX(-50%)', background: `linear-gradient(180deg, ${oklch(shade(hue, 0.06, 0), 0.32)} 0%, transparent 74%)`, filter: 'blur(6px)', clipPath: 'polygon(42% 0, 58% 0, 100% 100%, 0% 100%)', pointerEvents: 'none' });
  return (
    <div className="cardp-vis" style={{ background: backdrop, overflow: 'hidden' }}>
      <div style={beam(33, s)} />
      <div style={beam(67, p)} />
      <Coach style={{ position: 'absolute', top: '1%', left: '50%', transform: 'translateX(-50%)', width: mini ? '56%' : '44%', height: '64%' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '40%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: mini ? '5px' : '9px', padding: mini ? '0 7px 7px' : '0 16px 11px' }}>
        <Deck p={p} />
        <Mixer p={p} s={s} mini={mini} />
        <Deck p={s} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: '39%', height: '1px', background: `linear-gradient(90deg, transparent, ${oklch(shade(s, 0.1, 0), 0.6)}, transparent)` }} />
      <Scan opacity={0.2} />
    </div>
  );
}

// ── Cassette ────────────────────────────────────────────────────────────────
function Reel({ c }) {
  return (
    <div style={{ height: '64%', aspectRatio: '1', borderRadius: '50%', background: `conic-gradient(${oklch(shade(c, 0.06, 0))} 0 25%, ${oklch(shade(c, -0.14, 0))} 0 50%, ${oklch(shade(c, 0.06, 0))} 0 75%, ${oklch(shade(c, -0.14, 0))} 0)`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 2px rgba(255,255,255,0.16), 0 2px 4px rgba(0,0,0,0.4)' }}>
      <div style={{ width: '34%', height: '34%', borderRadius: '50%', background: '#0a0a0c', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.22)' }} />
    </div>
  );
}
function CassetteVisual({ p, s }) {
  const bg = `linear-gradient(160deg, ${oklch({ l: 0.16, c: Math.min(p.c, 0.05), h: p.h })}, ${oklch({ l: 0.09, c: 0.03, h: s.h })})`;
  return (
    <div className="cardp-vis" style={{ background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: '82%', height: '70%', borderRadius: '9px', background: `linear-gradient(180deg, ${oklch(shade(p, -0.02, 0))} 0%, ${oklch(shade(p, -0.17, 0))} 100%)`, boxShadow: '0 12px 26px -8px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.10), inset 0 2px 0 rgba(255,255,255,0.13)', padding: '8% 8%', display: 'flex', flexDirection: 'column', gap: '7%' }}>
        <div style={{ height: '38%', borderRadius: '4px', background: `linear-gradient(180deg, ${oklch(shade(s, 0.13, 0))}, ${oklch(shade(s, 0.0, 0))})`, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.22)', padding: '0 8%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '9%' }}>
          <div style={{ height: '11%', minHeight: '2px', width: '72%', background: 'rgba(0,0,0,0.4)', borderRadius: '2px' }} />
          <div style={{ height: '11%', minHeight: '2px', width: '46%', background: 'rgba(0,0,0,0.26)', borderRadius: '2px' }} />
        </div>
        <div style={{ flex: 1, borderRadius: '5px', background: 'rgba(0,0,0,0.46)', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.4), inset 0 2px 6px rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '0 12%' }}>
          <Reel c={p} />
          <Reel c={s} />
        </div>
      </div>
    </div>
  );
}

// ── Boombox ───────────────────────────────────────────────────────────────
function Speaker({ c }) {
  return (
    <div style={{ flex: '0 0 auto', height: '84%', aspectRatio: '1', borderRadius: '50%', background: `radial-gradient(circle at 42% 38%, ${oklch(shade(c, 0.06, 0))} 0%, ${oklch(shade(c, -0.22, 0))} 60%, #0a0a0c 100%)`, boxShadow: `0 0 12px -2px ${oklch(c, 0.5)}, inset 0 0 0 2px rgba(255,255,255,0.13), inset 0 0 0 5px rgba(0,0,0,0.3)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '26%', height: '26%', borderRadius: '50%', background: '#0a0a0c', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.2)' }} />
    </div>
  );
}
function BoomboxVisual({ p, s, mini }) {
  const bg = `linear-gradient(160deg, ${oklch({ l: 0.15, c: 0.04, h: p.h })}, ${oklch({ l: 0.08, c: 0.025, h: s.h })})`;
  return (
    <div className="cardp-vis" style={{ background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '90%', height: '86%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end' }}>
        <div style={{ width: '38%', height: '15%', borderTopLeftRadius: '999px', borderTopRightRadius: '999px', borderTop: '2px solid', borderLeft: '2px solid', borderRight: '2px solid', borderColor: oklch(shade(p, 0.06, 0), 0.7), borderBottom: 'none', boxSizing: 'border-box' }} />
        <div style={{ width: '100%', height: '74%', borderRadius: '9px', background: `linear-gradient(180deg, ${oklch(shade(p, -0.03, 0))}, ${oklch(shade(p, -0.18, 0))})`, boxShadow: '0 12px 26px -8px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.10), inset 0 2px 0 rgba(255,255,255,0.13)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 5%', gap: '4%' }}>
        <Speaker c={s} />
        <div style={{ flex: '0 0 auto', width: '24%', height: '80%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '8%' }}>
          <div style={{ height: '30%', borderRadius: '3px', background: 'rgba(0,0,0,0.42)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '0 12%' }}>
            <div style={{ width: '24%', aspectRatio: '1', borderRadius: '50%', background: oklch(s) }} />
            <div style={{ width: '24%', aspectRatio: '1', borderRadius: '50%', background: oklch(s) }} />
          </div>
          {!mini && (
            <>
              <div style={{ height: '22%', display: 'flex', alignItems: 'flex-end', gap: '9%', justifyContent: 'center' }}>
                {[0.5, 0.9, 0.6, 1, 0.7].map((h, i) => <div key={i} style={{ width: '10%', height: `${h * 100}%`, background: oklch(mix(p, s, i / 4)), borderRadius: '1px' }} />)}
              </div>
              <div style={{ height: '14%', display: 'flex', gap: '11%', justifyContent: 'center' }}>
                {[0, 1, 2].map((i) => <div key={i} style={{ width: '16%', background: 'rgba(255,255,255,0.2)', borderRadius: '1px' }} />)}
              </div>
            </>
          )}
        </div>
        <Speaker c={p} />
        </div>
      </div>
    </div>
  );
}

function SongVisual({ template, p, s, mini }) {
  switch (template) {
    case 'vinyl': return <VinylVisual p={p} s={s} />;
    case 'spin': return <SpinVisual p={p} s={s} />;
    case 'eq': return <EqVisual p={p} s={s} mini={mini} />;
    case 'skyline': return <SkylineVisual p={p} s={s} mini={mini} />;
    case 'robot': return <RobotVisual p={p} s={s} />;
    case 'booth': return <BoothVisual p={p} s={s} mini={mini} />;
    case 'cassette': return <CassetteVisual p={p} s={s} />;
    case 'boombox': return <BoomboxVisual p={p} s={s} mini={mini} />;
    case 'aurora':
    default: return <AuroraVisual p={p} s={s} />;
  }
}

// ── Random visual (randomized on dialog open + shuffle) ─────────────────────
const randColor = () => PALETTE[Math.floor(Math.random() * PALETTE.length)];
function randomVisual() {
  const p = randColor();
  let s = randColor();
  let guard = 0;
  while (colorKey(s) === colorKey(p) && guard++ < 6) s = randColor();
  return { template: TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)].id, p, s };
}

// ── Live card preview (exactly as the song appears in the library) ──────────
function MiniWave() {
  return (
    <div className="cardp-wave" aria-hidden="true">
      {Array.from({ length: 24 }).map((_, i) => {
        const v = 0.25 + (Math.sin(i * 0.7) * 0.5 + 0.5) * 0.65;
        return <div key={i} style={{ height: `${v * 100}%` }} />;
      })}
    </div>
  );
}

function CardPreview({ name, template, p, s }) {
  const trimmed = (name || '').trim();
  return (
    <div className="cardp">
      <div className="cardp-cover">
        <SongVisual template={template} p={p} s={s} />
        <div className="cardp-overlay">
          <div className="cardp-top">
            <span />
            <span className="cardp-pill">new</span>
          </div>
          <div className="cardp-bottom">
            <MiniWave />
            <span className="cardp-play" aria-hidden="true">▶</span>
          </div>
        </div>
      </div>
      <div className="cardp-body">
        <span className="cardp-name" data-empty={trimmed ? 'false' : 'true'}>{trimmed || 'Untitled song'}</span>
        <span className="cardp-meta">— no analysis yet</span>
      </div>
      <div className="cardp-foot">
        <span>just now</span>
        <span>0 v</span>
      </div>
    </div>
  );
}

Object.assign(window, { PALETTE, TEMPLATES, colorKey, swatchColor, SongVisual, CardPreview, randomVisual });
