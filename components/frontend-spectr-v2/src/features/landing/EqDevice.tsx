/* A compact "EQ device" for the hero's fix face: the combined frequency
 * response of the suggested bands (computed in eq-response.ts), numbered band
 * nodes on the curve, and a parameter readout per band — styled after a DAW
 * EQ (the fix names Ableton's EQ Eight). Decorative SVG is aria-hidden; the
 * readout carries the same parameters as real text. */
import { type EqBand, responseDb } from './eq-response';
import s from './EqDevice.module.css';

const W = 300;
const H = 104;
// Zoomed to the low end, where this fix lives (a full 20 Hz–20 kHz span
// squeezes a 30 Hz high-pass into the first few pixels).
const F_MIN = 15;
const F_MAX = 1000;
const DB_TOP = 4;
const DB_BOTTOM = -18;
const GRID_HZ = [20, 30, 40, 50, 60, 80, 100, 200, 300, 400, 500];
const LABEL_HZ: Record<number, string> = { 20: '20', 50: '50', 100: '100', 200: '200', 500: '500' };

const x = (f: number) => (Math.log10(f / F_MIN) / Math.log10(F_MAX / F_MIN)) * W;
const y = (db: number) => ((DB_TOP - Math.max(DB_BOTTOM, Math.min(DB_TOP, db))) / (DB_TOP - DB_BOTTOM)) * H;

function curvePath(bands: readonly EqBand[]): string {
  const pts: string[] = [];
  const N = 160;
  for (let i = 0; i <= N; i++) {
    const f = F_MIN * (F_MAX / F_MIN) ** (i / N);
    pts.push(`${x(f).toFixed(1)},${y(responseDb(bands, f)).toFixed(1)}`);
  }
  return `M${pts.join(' L')}`;
}

function bandLabel(b: EqBand): { kind: string; params: string[] } {
  const hz = b.freqHz >= 1000 ? `${b.freqHz / 1000} kHz` : `${b.freqHz} Hz`;
  return b.type === 'high_pass'
    ? { kind: 'High-pass', params: [hz, `${b.slopeDb} dB/oct`] }
    : { kind: 'Bell', params: [hz, `${b.gainDb > 0 ? '+' : b.gainDb < 0 ? '−' : ''}${Math.abs(b.gainDb).toFixed(1)} dB`, `Q ${b.q.toFixed(2)}`] };
}

export function EqDevice({ device, target, bands }: { device: string; target: string; bands: readonly EqBand[] }) {
  const path = curvePath(bands);
  const zeroY = y(0);
  return (
    <div className={s.device}>
      <div className={s.head}>
        <span className={s.name}>{device}</span>
        <span className={s.target}>{target}</span>
      </div>

      <svg className={s.graph} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {GRID_HZ.map((f) => (
          <line key={f} className={s.grid} x1={x(f)} x2={x(f)} y1={0} y2={H} />
        ))}
        <line className={s.zero} x1={0} x2={W} y1={zeroY} y2={zeroY} />
        <path className={s.fill} d={`${path} L${W},${zeroY} L0,${zeroY} Z`} />
        <path className={s.curve} d={path} pathLength={1} />
        {bands.map((b) => {
          const cx = x(b.freqHz);
          const cy = y(b.type === 'bell' ? responseDb(bands, b.freqHz) : -3);
          return (
            <g key={b.n} className={s.node} data-band={b.n}>
              <circle cx={cx} cy={cy} r={7} />
              <text x={cx} y={cy + 3.4} textAnchor="middle">
                {b.n}
              </text>
            </g>
          );
        })}
      </svg>
      <div className={`mono ${s.axis}`} aria-hidden="true">
        {Object.entries(LABEL_HZ).map(([f, label]) => (
          <span key={f} style={{ left: `${(x(Number(f)) / W) * 100}%` }}>
            {label}
          </span>
        ))}
      </div>

      <ul className={s.bands}>
        {bands.map((b) => {
          const { kind, params } = bandLabel(b);
          return (
            <li key={b.n} className={s.band}>
              <span className={s.bandNo} aria-hidden="true">
                {b.n}
              </span>
              <span className={s.kind}>{kind}</span>
              {params.map((p) => (
                <span key={p} className={`mono ${s.param}`}>
                  {p}
                </span>
              ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
