import type { Phase6Data, Phase6Gap } from '../../api/types';
import { Pill } from '../../ui/Pill';
import { fmtGenre } from './helpers/format';
import s from './ReferenceTab.module.css';

interface ReferenceTabProps {
  genre: string | undefined;
  score: number | undefined;
  phase6: Phase6Data | undefined;
}

// Pretty labels for the gap keys the worker emits. Anything not in this map
// is rendered with the key as-is (titlecased) so unknown axes still appear.
const GAP_LABELS: Record<string, { name: string; unit: string }> = {
  bpm: { name: 'Tempo', unit: ' BPM' },
  stereo_correlation: { name: 'Stereo correlation', unit: '' },
  stereo_width: { name: 'Stereo width', unit: '' },
  lufs: { name: 'Integrated LUFS', unit: ' LUFS' },
  true_peak: { name: 'True peak', unit: ' dBTP' },
  dynamic_range: { name: 'Dynamic range', unit: ' LU' },
  sub_bass: { name: 'Sub-bass energy', unit: '' },
  bass: { name: 'Bass energy', unit: '' },
  low_mid: { name: 'Low mid energy', unit: '' },
  mid: { name: 'Mid energy', unit: '' },
  upper_mid: { name: 'Upper mid energy', unit: '' },
  presence: { name: 'Presence', unit: '' },
  air: { name: 'Air', unit: '' },
};

function titleize(key: string): string {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function ReferenceTab({ genre: phase2Genre, score, phase6 }: ReferenceTabProps) {
  const realGaps = phase6?.gaps ?? null;
  const realPercentile = phase6?.percentile;
  const hasRealData = realGaps != null && Object.keys(realGaps).length > 0;
  const displayGenre = phase6?.genre ?? phase2Genre;

  // Fallback percentile: derive from overall_score when phase 6 missing.
  // This keeps the visual usable for skipped/failed phase 6 jobs.
  const percentile = realPercentile != null
    ? Math.round(realPercentile)
    : score != null
      ? Math.max(5, Math.min(95, Math.round(score * 0.95)))
      : 60;
  const topPct = 100 - percentile;

  const gapEntries: { key: string; gap: Phase6Gap }[] = realGaps
    ? Object.entries(realGaps).map(([key, gap]) => ({ key, gap }))
    : [];
  const outOfRange = gapEntries.filter((e) => !e.gap.in_range).length;

  const ringSize = 86;
  const stroke = 7;
  const r = (ringSize - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (percentile / 100) * c;

  return (
    <section className={`card ${s.card}`}>
      <div className={s.hd}>
        <span className={s.title}>
          Genre profile · {displayGenre ? fmtGenre(displayGenre) : '—'}
        </span>
        {hasRealData ? (
          phase6?.profile_source && <Pill>{phase6.profile_source}</Pill>
        ) : (
          <Pill>no profile data</Pill>
        )}
      </div>

      <div className={s.summary}>
        <div className={s.ring} role="img" aria-label={`${percentile}th percentile versus the genre profile — top ${topPct}%.`}>
          <svg width={ringSize} height={ringSize} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
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
            top {topPct}%
            {hasRealData && (
              <>
                {' · '}
                {gapEntries.length - outOfRange} of {gapEntries.length} metrics in range
              </>
            )}
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

      {gapEntries.length === 0 ? (
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: 'var(--muted)',
            fontStyle: 'italic',
          }}
        >
          Phase 6 (gap analysis vs. genre profile) didn't run for this
          track — either the genre profile is missing or the phase was
          skipped.
        </p>
      ) : (
        <div className={s.gapList}>
          {gapEntries.map(({ key, gap }) => (
            <GapRow key={key} gapKey={key} gap={gap} />
          ))}
        </div>
      )}
    </section>
  );
}

interface GapRowProps {
  gapKey: string;
  gap: Phase6Gap;
}

function GapRow({ gapKey, gap }: GapRowProps) {
  const meta = GAP_LABELS[gapKey] ?? { name: titleize(gapKey), unit: '' };
  // Phase 6 doesn't emit absolute min/max bounds, only mean/std + acceptable
  // range. Derive a display range that comfortably contains all reference
  // points (±2 sigma is the convention used in the profile generator).
  const minBound = Math.min(
    gap.acceptable_range[0],
    gap.user_val,
    gap.genre_mean - 2 * gap.genre_std,
  );
  const maxBound = Math.max(
    gap.acceptable_range[1],
    gap.user_val,
    gap.genre_mean + 2 * gap.genre_std,
  );
  const span = Math.max(0.0001, maxBound - minBound);
  const pctOf = (v: number) => ((v - minBound) / span) * 100;
  const acceptLeft = pctOf(gap.acceptable_range[0]);
  const acceptWidth = pctOf(gap.acceptable_range[1]) - acceptLeft;
  const meanLeft = pctOf(gap.genre_mean);
  const yoursLeft = pctOf(gap.user_val);

  const format = (v: number) =>
    Math.abs(v) >= 10 || Number.isInteger(v) ? v.toFixed(1) : v.toFixed(3);

  return (
    <div className={s.gap}>
      <div className={s.gapName}>
        <span className={s.gapLabel}>{meta.name}</span>
        <span className={s.gapValue}>
          yours{' '}
          <strong
            style={{ color: gap.in_range ? 'var(--cyan)' : 'var(--orange)' }}
          >
            {format(gap.user_val)}
            {meta.unit}
          </strong>
          <span className="sr-only"> ({gap.in_range ? 'in range' : 'out of range'})</span>{' '}
          · mean {format(gap.genre_mean)}
          {meta.unit}
        </span>
      </div>
      <div className={s.gapBar} aria-hidden="true">
        <div
          className={s.gapAccept}
          style={{ left: `${acceptLeft}%`, width: `${acceptWidth}%` }}
        />
        <div className={s.gapMean} style={{ left: `${meanLeft}%` }} />
        <div
          className={s.gapDot}
          data-warn={!gap.in_range}
          style={{ left: `${yoursLeft}%` }}
        />
      </div>
      <span
        className={s.gapPct}
        style={{ color: gap.in_range ? 'var(--cyan)' : 'var(--orange)' }}
        title={gap.description}
      >
        {Math.round(gap.percentile)}th
      </span>
    </div>
  );
}
