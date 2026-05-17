import { Pill } from '../../ui/Pill';
import { fmtGenre } from './helpers/format';
import s from './ReferenceTab.module.css';

interface ReferenceTabProps {
  genre: string | undefined;
  score: number | undefined;
}

// Gap rows are stub data until the BFF surfaces genre profile metrics. Three
// representative axes per the mockup, so the visual ships with shape.
interface GapStub {
  name: string;
  unit: string;
  yours: number;
  mean: number;
  acceptable: [number, number];
  range: [number, number];
  inRange: boolean;
}

const STUB_GAPS: GapStub[] = [
  {
    name: 'Integrated LUFS',
    unit: 'LUFS',
    yours: -11.2,
    mean: -10.5,
    acceptable: [-12, -9],
    range: [-18, -6],
    inRange: true,
  },
  {
    name: 'Sub-bass energy',
    unit: '%',
    yours: 78,
    mean: 62,
    acceptable: [50, 72],
    range: [10, 100],
    inRange: false,
  },
  {
    name: 'Stereo width @ mid',
    unit: '%',
    yours: 64,
    mean: 71,
    acceptable: [60, 85],
    range: [0, 100],
    inRange: true,
  },
];

export function ReferenceTab({ genre, score }: ReferenceTabProps) {
  const outOfRange = STUB_GAPS.filter((g) => !g.inRange).length;
  const percentile = score != null ? Math.max(5, Math.min(95, Math.round(score * 0.95))) : 60;
  const topPct = 100 - percentile;

  const ringSize = 86;
  const stroke = 7;
  const r = (ringSize - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (percentile / 100) * c;

  return (
    <section className={`card ${s.card}`}>
      <div className={s.hd}>
        <span className={s.title}>Genre profile · {genre ? fmtGenre(genre) : '—'}</span>
        <Pill>profile.v1 · stub data</Pill>
      </div>

      <div className={s.summary}>
        <div className={s.ring}>
          <svg width={ringSize} height={ringSize} style={{ transform: 'rotate(-90deg)' }}>
            <circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={r}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={stroke}
              fill="none"
            />
            <circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={r}
              stroke="var(--cyan)"
              strokeWidth={stroke}
              fill="none"
              strokeDasharray={c}
              strokeDashoffset={off}
              strokeLinecap="round"
            />
          </svg>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <div
              className="mono"
              style={{ fontSize: 22, fontWeight: 700, color: 'var(--cyan)', lineHeight: 1 }}
            >
              {percentile}
            </div>
          </div>
        </div>
        <div className={s.percentile}>
          <div className={s.percentileTitle}>{percentile}th percentile</div>
          <div className={s.percentileSub}>
            top {topPct}% · {STUB_GAPS.length - outOfRange} of {STUB_GAPS.length} metrics in range
          </div>
        </div>
        <div className={s.legend}>
          <span className={s.legendItem}>
            <span
              className={s.legendSwatch}
              style={{ background: 'rgba(0,229,176,0.4)' }}
            />
            acceptable range
          </span>
          <span className={s.legendItem}>
            <span className={s.legendSwatch} style={{ background: 'rgba(255,255,255,0.4)' }} />
            genre mean
          </span>
          <span className={s.legendItem}>
            <span
              className={s.legendSwatch}
              style={{ background: 'var(--cyan)', borderRadius: 6, width: 8, height: 8 }}
            />
            your track
          </span>
        </div>
      </div>

      <div className={s.gapList}>
        {STUB_GAPS.map((g) => (
          <GapRow key={g.name} gap={g} />
        ))}
      </div>
    </section>
  );
}

function GapRow({ gap }: { gap: GapStub }) {
  const span = gap.range[1] - gap.range[0];
  const pctOf = (v: number) => ((v - gap.range[0]) / span) * 100;
  const acceptLeft = pctOf(gap.acceptable[0]);
  const acceptWidth = pctOf(gap.acceptable[1]) - acceptLeft;
  const meanLeft = pctOf(gap.mean);
  const yoursLeft = pctOf(gap.yours);
  const percentile = Math.round((gap.yours - gap.range[0]) / span * 100);

  return (
    <div className={s.gap}>
      <div className={s.gapName}>
        <span className={s.gapLabel}>{gap.name}</span>
        <span className={s.gapValue}>
          yours <strong style={{ color: gap.inRange ? 'var(--cyan)' : 'var(--orange)' }}>
            {gap.yours}
            {gap.unit}
          </strong>{' '}
          · mean {gap.mean}
          {gap.unit}
        </span>
      </div>
      <div className={s.gapBar}>
        <div
          className={s.gapAccept}
          style={{ left: `${acceptLeft}%`, width: `${acceptWidth}%` }}
        />
        <div className={s.gapMean} style={{ left: `${meanLeft}%` }} />
        <div className={s.gapDot} data-warn={!gap.inRange} style={{ left: `${yoursLeft}%` }} />
      </div>
      <span
        className={s.gapPct}
        style={{ color: gap.inRange ? 'var(--cyan)' : 'var(--orange)' }}
      >
        {percentile}th
      </span>
    </div>
  );
}
