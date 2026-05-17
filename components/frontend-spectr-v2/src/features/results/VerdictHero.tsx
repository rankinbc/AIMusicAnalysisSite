import { GradePill } from '../../ui/GradePill';
import { Pill } from '../../ui/Pill';
import { gradeColor, normalizeGrade } from './helpers/grade';
import { fmtBpm, fmtGenre, fmtNumber } from './helpers/format';
import type { Phase1Data, Phase2Data } from '../../api/types';
import s from './VerdictHero.module.css';

const VERDICT_TEXT: Record<string, string> = {
  A: 'Release-ready',
  B: 'Almost there',
  C: 'Work needed',
  D: 'Major issues',
  F: 'Start over',
};

interface VerdictHeroProps {
  trackName: string;
  grade: string | null | undefined;
  score: number | undefined;
  danceability: number | undefined;
  phase1: Phase1Data | undefined;
  phase2: Phase2Data | undefined;
}

export function VerdictHero({
  trackName,
  grade,
  score,
  danceability,
  phase1,
  phase2,
}: VerdictHeroProps) {
  const norm = normalizeGrade(grade);
  const verdictText = norm ? VERDICT_TEXT[norm] : 'Awaiting analysis';
  const gc = gradeColor(grade);

  // Percentile is a derived estimate from score until the BFF surfaces it.
  const percentile = score != null ? Math.max(5, Math.min(95, Math.round(score * 0.95))) : null;

  const lufs = phase1?.lufs;
  const truePeak = phase1?.true_peak_db ?? phase1?.peak_dbfs;
  const dynRange = lufs != null && phase1?.rms != null ? Math.abs(phase1.rms - lufs) : null;
  const genre = phase2?.genre ?? null;
  const bpm = phase1?.bpm ?? phase2?.bpm;
  const key = phase1?.detected_key ?? null;

  const lufsTone = lufs != null ? (lufs > -12 ? 'var(--orange)' : 'var(--cyan)') : 'var(--muted)';
  const lufsSub =
    lufs != null
      ? lufs > -14
        ? `${(lufs - -14).toFixed(1)} LU over Spotify`
        : `${(-14 - lufs).toFixed(1)} LU under Spotify`
      : 'no measurement';

  const tpTone =
    truePeak != null
      ? truePeak > -1
        ? 'var(--orange)'
        : 'var(--cyan)'
      : 'var(--muted)';
  const tpSub = truePeak != null ? (truePeak > -1 ? 'over ceiling' : 'safe (-1 ceiling)') : '—';

  const dynTone =
    dynRange != null
      ? dynRange > 8
        ? 'var(--cyan)'
        : dynRange > 6
          ? 'var(--yellow)'
          : 'var(--orange)'
      : 'var(--muted)';
  const dynSub =
    dynRange != null
      ? dynRange > 8
        ? 'open'
        : dynRange > 6
          ? 'tight'
          : 'compressed'
      : '—';

  return (
    <div className={`card ${s.hero}`}>
      <div className={s.grid}>
        <div
          className={s.left}
          style={{ background: `radial-gradient(ellipse 90% 80% at 10% 50%, ${gc}10, transparent 65%)` }}
        >
          <GradePill grade={grade} size="lg" />
          <div className={s.verdict}>
            <div className="label">Verdict</div>
            <div className={s.verdictText} style={{ color: gc }}>
              {verdictText}
            </div>
            <div className={`mono ${s.scoreLine}`}>
              {score != null ? (
                <>
                  <span style={{ color: gc }}>{Math.round(score)}</span>
                  <span style={{ color: 'var(--dim)' }}>/100</span>
                </>
              ) : (
                <span style={{ color: 'var(--muted)' }}>—/100</span>
              )}
              {percentile != null && genre && (
                <>
                  {' · '}
                  {percentile}th pct in {fmtGenre(genre)}
                </>
              )}
            </div>
          </div>
        </div>

        <div className={s.right}>
          <div className={s.trackRow}>
            <div className={s.trackName}>{trackName}</div>
            {genre && <Pill tone="cyan">{fmtGenre(genre)}</Pill>}
            {bpm != null && (
              <Pill>
                <span className="mono">{fmtBpm(bpm)}</span> BPM
              </Pill>
            )}
            {key && (
              <Pill>
                <span className="mono">{key}</span>
              </Pill>
            )}
            <MixHealthPills phase1={phase1} />
          </div>
          <div className={s.metrics}>
            <HeroMetric
              label="Loudness"
              value={fmtNumber(lufs, 1)}
              unit="LUFS"
              tone={lufsTone}
              sub={lufsSub}
            />
            <HeroMetric
              label="True peak"
              value={fmtNumber(truePeak, 1)}
              unit="dBTP"
              tone={tpTone}
              sub={tpSub}
            />
            <HeroMetric
              label="Dyn range"
              value={fmtNumber(dynRange, 1)}
              unit="LU"
              tone={dynTone}
              sub={dynSub}
            />
            <HeroMetric
              label="Dance"
              value={danceability != null ? String(Math.round(danceability)) : '—'}
              unit="/100"
              tone="var(--cyan)"
              sub={danceability != null && danceability >= 75 ? 'high energy' : 'mid energy'}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

interface HeroMetricProps {
  label: string;
  value: string;
  unit: string;
  tone: string;
  sub?: string;
}

function HeroMetric({ label, value, unit, tone, sub }: HeroMetricProps) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={s.metricValueRow}>
        <span className={`mono ${s.metricValue}`} style={{ color: tone }}>
          {value}
        </span>
        <span className={`mono ${s.metricUnit}`}>{unit}</span>
      </div>
      {sub && <div className={`mono ${s.metricSub}`}>{sub}</div>}
    </div>
  );
}

interface MixHealthPillsProps {
  phase1: Phase1Data | undefined;
}

/** Compact mix-health pills surfaced alongside genre/BPM/key. These are the
 *  cheap-to-render diagnostics from phase 1 that mix engineers actually want
 *  at a glance: mono compatibility, clipping, and a stereo-width number. */
function MixHealthPills({ phase1 }: MixHealthPillsProps) {
  if (!phase1) return null;

  const mono = phase1.mono_compatibility;
  const clipping = phase1.clipping_detected;
  const clipCount = phase1.clipped_sample_count;
  const width = phase1.stereo_width;
  const corr = phase1.stereo_correlation;

  // Mono pill: green ≥0.85, yellow 0.7–0.85, orange <0.7.
  const monoPill =
    mono != null ? (
      <Pill
        tone={mono >= 0.85 ? 'cyan' : mono >= 0.7 ? 'yellow' : 'orange'}
        title="Mono playback compatibility (1.0 = perfect)"
      >
        mono <span className="mono">{mono.toFixed(2)}</span>
      </Pill>
    ) : null;

  // Clipping pill: only render when actually detected; mute when clean to
  // avoid clutter.
  const clipPill =
    clipping === true ? (
      <Pill tone="red" title="True-peak clipping detected">
        ⚠ clipping
        {clipCount != null && clipCount > 0 && (
          <>
            {' '}
            <span className="mono">{clipCount}</span>
          </>
        )}
      </Pill>
    ) : null;

  // Stereo width / correlation: use width as primary, fall back to correlation.
  // Width is 0..1 ratio (0 = mono, 1 = wide); correlation is -1..+1.
  const widthPill =
    width != null ? (
      <Pill
        tone={width >= 0.3 ? 'cyan' : 'yellow'}
        title="Stereo width (0 = mono, 1 = wide)"
      >
        width <span className="mono">{width.toFixed(2)}</span>
      </Pill>
    ) : corr != null ? (
      <Pill
        tone={corr >= 0.3 ? 'cyan' : corr >= -0.1 ? 'yellow' : 'orange'}
        title="L/R correlation (-1 = anti-phase, +1 = mono)"
      >
        corr <span className="mono">{corr.toFixed(2)}</span>
      </Pill>
    ) : null;

  if (!monoPill && !clipPill && !widthPill) return null;

  return (
    <>
      {monoPill}
      {widthPill}
      {clipPill}
    </>
  );
}
