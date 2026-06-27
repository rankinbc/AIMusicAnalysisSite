import type { Phase6Data, Phase6Gap } from '../../api/types';
import { fmtGenre } from './helpers/format';

interface ReferenceTabProps {
  genre: string | undefined;
  score: number | undefined;
  phase6: Phase6Data | undefined;
}

// Pretty labels for the gap keys the worker emits.
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

// Profile-led comparison vs the genre statistical profile (phase 6). The
// uploaded-reference-track ◇ overlay + tonal-fingerprint curve are deferred
// until the backend produces that data — this is the profile-only state.
export function ReferenceTab({ genre: phase2Genre, score, phase6 }: ReferenceTabProps) {
  const realGaps = phase6?.gaps ?? null;
  const realPercentile = phase6?.percentile;
  const displayGenre = phase6?.genre ?? phase2Genre;
  const genreLabel = displayGenre ? fmtGenre(displayGenre) : '—';

  const percentile =
    realPercentile != null
      ? Math.round(realPercentile)
      : score != null
        ? Math.max(5, Math.min(95, Math.round(score * 0.95)))
        : 60;
  const topPct = 100 - percentile;

  const gapEntries: { key: string; gap: Phase6Gap }[] = realGaps
    ? Object.entries(realGaps).map(([key, gap]) => ({ key, gap }))
    : [];
  const inRange = gapEntries.filter((e) => e.gap.in_range).length;

  const ringSize = 86;
  const stroke = 7;
  const r = (ringSize - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (percentile / 100) * c;

  return (
    <div>
      <div className="ref-identity">
        <span className="ref-dot" style={{ background: 'var(--cyan)' }} />
        <div className="ref-id-b">
          <div className="ref-id-name">
            Genre profile · {genreLabel}
            <span className="ref-id-kind">Genre profile</span>
          </div>
          <div className="ref-id-sub">
            {phase6?.profile_source ? (
              <>
                based on <b>{phase6.profile_source}</b>
              </>
            ) : (
              <>compared against the {genreLabel} reference profile</>
            )}
          </div>
        </div>
      </div>

      <div className="ref-verdict">
        <div
          className="rv-ring"
          role="img"
          aria-label={`${percentile}th percentile versus the genre profile — top ${topPct}%.`}
        >
          <svg width={ringSize} height={ringSize} style={{ transform: 'rotate(-90deg)' }} aria-hidden>
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
          <span className="rv-num">{percentile}</span>
        </div>
        <div>
          <div className="rv-h">
            <span className="n">{percentile}</span>th percentile
          </div>
          <div className="rv-take">
            top {topPct}%
            {gapEntries.length > 0 && (
              <>
                {' · '}
                {inRange} of {gapEntries.length} metrics in range
              </>
            )}
          </div>
        </div>
      </div>

      {gapEntries.length === 0 ? (
        <div className="na">
          Phase 6 (gap analysis vs. genre profile) didn&rsquo;t run for this track — either the
          genre profile is missing or the phase was skipped.
        </div>
      ) : (
        <div className="ref-gaps">
          {gapEntries.map(({ key, gap }) => (
            <GapRow key={key} gapKey={key} gap={gap} />
          ))}
        </div>
      )}
    </div>
  );
}

function GapRow({ gapKey, gap }: { gapKey: string; gap: Phase6Gap }) {
  const meta = GAP_LABELS[gapKey] ?? { name: titleize(gapKey), unit: '' };
  const minBound = Math.min(gap.acceptable_range[0], gap.user_val, gap.genre_mean - 2 * gap.genre_std);
  const maxBound = Math.max(gap.acceptable_range[1], gap.user_val, gap.genre_mean + 2 * gap.genre_std);
  const span = Math.max(0.0001, maxBound - minBound);
  const pctOf = (v: number) => ((v - minBound) / span) * 100;
  const acceptLeft = pctOf(gap.acceptable_range[0]);
  const acceptWidth = pctOf(gap.acceptable_range[1]) - acceptLeft;
  const meanLeft = pctOf(gap.genre_mean);
  const yoursLeft = pctOf(gap.user_val);
  const out = !gap.in_range;

  const format = (v: number) =>
    Math.abs(v) >= 10 || Number.isInteger(v) ? v.toFixed(1) : v.toFixed(3);

  return (
    <div className={`ref-gap${out ? ' out' : ''}`}>
      <div className="rg-top">
        <span className="rg-label">{meta.name}</span>
        <span>
          <span className={`rg-you${out ? ' out' : ''}`}>
            yours {format(gap.user_val)}
            {meta.unit}
          </span>
          <span className="rg-mean">
            mean {format(gap.genre_mean)}
            {meta.unit}
          </span>
        </span>
      </div>
      <div className="rg-bar" aria-hidden>
        <div className="rg-range" style={{ left: `${acceptLeft}%`, width: `${acceptWidth}%` }} />
        <div className="rg-meanTick" style={{ left: `${meanLeft}%` }} />
        <div className={`rg-youdot${out ? ' out' : ''}`} style={{ left: `${yoursLeft}%` }} />
      </div>
      <div className="rg-foot">
        <span className="rg-pct" title={gap.description}>
          <span className="v">{Math.round(gap.percentile)}</span>th percentile
        </span>
      </div>
    </div>
  );
}
