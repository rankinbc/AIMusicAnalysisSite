import { Pill } from '../../ui/Pill';
import type {
  Phase1Bands,
  Phase1Data,
  Phase3Data,
  Phase4Clash,
  Phase4Data,
} from '../../api/types';
import { GenreScorePanel } from './GenreScorePanel';
import { StereoCard } from './StereoCard';
import { StreamingReadiness } from './StreamingReadiness';
import s from './SpectrumTab.module.css';

interface BandSpec {
  key: keyof Phase1Bands;
  name: string;
  hz: string;
  /** Genre-median placeholder (0..1). Per-band reference until the BFF
   *  surfaces real genre profiles. */
  median: number;
}

const BANDS: BandSpec[] = [
  { key: 'sub_bass', name: 'Sub', hz: '20–60', median: 0.55 },
  { key: 'bass', name: 'Bass', hz: '60–200', median: 0.62 },
  { key: 'low_mid', name: 'L.Mid', hz: '200–500', median: 0.5 },
  { key: 'mid', name: 'Mid', hz: '500–2k', median: 0.46 },
  { key: 'upper_mid', name: 'H.Mid', hz: '2k–4k', median: 0.42 },
  { key: 'presence', name: 'Pres', hz: '4k–8k', median: 0.34 },
  { key: 'air', name: 'Bril', hz: '8k–12k', median: 0.28 },
  { key: 'air', name: 'Air', hz: '12k–20k', median: 0.22 },
];

interface SpectrumTabProps {
  bands: Phase1Bands | undefined;
  phase1: Phase1Data | undefined;
  phase3: Phase3Data | undefined;
  phase4: Phase4Data | undefined;
}

export function SpectrumTab({ bands, phase1, phase3, phase4 }: SpectrumTabProps) {
  // Normalize each band's value to a 0..1 ratio. Phase 1 emits dB values
  // typically in the -60..0 range; clamp + scale so the chart reads.
  const values = BANDS.map((b) => {
    const raw = bands?.[b.key];
    if (raw == null) return { ...b, value: 0, warn: false };
    const norm = Math.max(0, Math.min(1, (raw + 60) / 60));
    const warn = norm > b.median + 0.15;
    return { ...b, value: norm, warn };
  });

  const warnCount = values.filter((v) => v.warn).length;
  const clarityScore = Math.max(
    0,
    100 - warnCount * 12 - values.reduce((acc, v) => (v.value < 0.18 ? acc + 6 : acc), 0),
  );

  return (
    <div className={s.layout}>
      <section className={`card ${s.spectrumCard}`}>
        <div className={s.hd}>
          <span className={s.title}>
            Frequency balance · clarity{' '}
            <span className="mono" style={{ color: 'var(--cyan)' }}>
              {Math.round(clarityScore)}/100
            </span>
          </span>
          <Pill tone={warnCount === 0 ? 'cyan' : 'orange'}>
            {warnCount === 0 ? 'balanced' : `${warnCount} hot band${warnCount === 1 ? '' : 's'}`}
          </Pill>
        </div>

        <div className={s.bars}>
          {values.map((v) => (
            <div key={`${v.name}-${v.hz}`} className={s.band}>
              <span
                className={s.bandValue}
                style={{ color: v.warn ? 'var(--orange)' : 'var(--cyan)' }}
              >
                {v.warn && <span className={s.warnTri}>▲ </span>}
                {Math.round(v.value * 100)}%
              </span>
              <div className={s.bar} aria-label={`${v.name} ${Math.round(v.value * 100)}%`}>
                <div
                  className={s.median}
                  style={{ bottom: `${v.median * 100}%` }}
                  title={`Genre median: ${Math.round(v.median * 100)}%`}
                />
                <div
                  className={`${s.fill} fill-h`}
                  data-warn={v.warn}
                  style={{ height: `${v.value * 100}%` }}
                />
              </div>
              <span className={s.bandName}>{v.name}</span>
              <span className={s.bandHz}>{v.hz}</span>
            </div>
          ))}
        </div>
      </section>

      <ClashCard phase4={phase4} />

      <GenreScorePanel phase3={phase3} />

      <div className={s.diagnosticGrid}>
        <StereoCard
          width={phase1?.stereo_width}
          correlation={phase1?.stereo_correlation}
          monoCompat={phase1?.mono_compatibility}
        />
        <StreamingReadiness
          lufs={phase1?.lufs}
          truePeakDb={phase1?.true_peak_db ?? phase1?.peak_dbfs}
          clippingDetected={phase1?.clipping_detected}
        />
      </div>
    </div>
  );
}

interface ClashCardProps {
  phase4: Phase4Data | undefined;
}

function ClashCard({ phase4 }: ClashCardProps) {
  const clashes = phase4?.clashes ?? [];
  // Phase 4 emits clashes from spectral analysis even without user stems —
  // the labels just describe regions (e.g. "sub-bass / bass") rather than
  // per-stem pairs. Treat any clash list as the primary view.
  if (clashes.length === 0) {
    return (
      <section className={`card ${s.clashes}`}>
        <div className={s.clashHd}>
          <span className={s.title}>Frequency clashes</span>
          <Pill tone="cyan">no clashes detected</Pill>
        </div>
        <p className={s.empty}>
          Spectral analysis didn't find significant mid- or low-end
          collisions. Upload stems to refine the diagnosis with per-element
          (kick × bass, etc.) clash detection.
        </p>
      </section>
    );
  }

  const high = clashes.filter((c) => c.severity === 'high').length;
  return (
    <section className={`card ${s.clashes}`}>
      <div className={s.clashHd}>
        <span className={s.title}>
          Frequency clashes · {clashes.length}
        </span>
        <Pill tone={high > 0 ? 'red' : 'orange'}>
          {high > 0
            ? `${high} high · ${clashes.length - high} moderate`
            : `${clashes.length} moderate`}
        </Pill>
      </div>
      <table className={s.clashTable}>
        <thead>
          <tr>
            <th>Region</th>
            <th>Elements</th>
            <th style={{ textAlign: 'right' }}>Severity</th>
          </tr>
        </thead>
        <tbody>
          {clashes.map((c, i) => (
            <ClashRow key={i} clash={c} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ClashRow({ clash }: { clash: Phase4Clash }) {
  const tone =
    clash.severity === 'high'
      ? 'var(--red)'
      : clash.severity === 'moderate'
        ? 'var(--orange)'
        : 'var(--muted)';
  return (
    <tr className={s.clashRow}>
      <td className={s.clashRegion}>{clash.frequency_range ?? '—'}</td>
      <td className={s.clashStems}>{clash.stems ?? '—'}</td>
      <td className={s.clashSeverity}>
        <span className="mono" style={{ color: tone, textTransform: 'uppercase', fontWeight: 700 }}>
          {clash.severity ?? '—'}
        </span>
      </td>
    </tr>
  );
}
