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
