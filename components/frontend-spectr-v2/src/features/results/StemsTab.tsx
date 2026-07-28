import { useMemo, useState } from 'react';

import { getAccessToken } from '../../api/fetcher';
import { useStemProposals } from '../../api/hooks';
import type { Phase5PerStemDelta, VerdictDto } from '../../api/types';
import { Icon } from './Icon';
import { severityColor } from './helpers/severity';
import {
  bandIntensity,
  bandRange,
  clashesForStem,
  deltasByRole,
  parseStemsAnalysis,
  STEM_BAND_KEYS,
  STEM_BAND_LABEL,
  type StemClash,
  type StemEntry,
  type StemsAnalysis,
} from './stems-model';

// Stems tab (v4): findings-style sidebar (one row per role/stem) → detail with
// level/width/spectral stats, the uploaded files (classifier confidence, play),
// a band-level EQ-overlap grid built from REAL band_energy_db + clash_matrix
// (the prototype's Gaussian curves were synthetic — deliberately not ported),
// balance flags, reference deltas, and links into the Findings board.

interface StemsTabProps {
  stemsRaw: unknown;
  perStemDeltas: Phase5PerStemDelta[] | undefined;
  versionId: string | null;
  verdicts: VerdictDto[];
  onShowFinding: (verdictId: string) => void;
}

const TIER_TONE: Record<string, string> = {
  critical: 'var(--sev-critical)',
  warning: 'var(--orange)',
  info: 'var(--muted)',
};

function fmt(v: number | null, digits = 1, suffix = ''): string {
  if (v == null) return '—';
  return `${v.toFixed(digits)}${suffix}`;
}

export function StemsTab({ stemsRaw, perStemDeltas, versionId, verdicts, onShowFinding }: StemsTabProps) {
  const analysis = useMemo(() => parseStemsAnalysis(stemsRaw), [stemsRaw]);
  const [selKey, setSelKey] = useState<string | null>(null);

  if (!analysis || analysis.entries.length === 0) {
    return (
      <div className="fb-empty">
        <div className="es-ic">
          <Icon name="layers" size={20} />
        </div>
        <div className="es-t">No stem analysis</div>
        <div className="es-s">Upload stems with your next analysis to unlock this tab.</div>
      </div>
    );
  }

  const sel =
    analysis.entries.find((e) => e.key === selKey) ?? analysis.entries[0]!;

  return (
    <div className="stems-stack">
      <div className="fixboard">
        <StemList analysis={analysis} selKey={sel.key} onSelect={setSelKey} />
        <StemDetail
          entry={sel}
          analysis={analysis}
          perStemDeltas={perStemDeltas}
          versionId={versionId}
          verdicts={verdicts}
          onShowFinding={onShowFinding}
        />
      </div>
      <OverlapGrid analysis={analysis} selKey={sel.key} />
    </div>
  );
}

function StemList({
  analysis,
  selKey,
  onSelect,
}: {
  analysis: StemsAnalysis;
  selKey: string;
  onSelect: (key: string) => void;
}) {
  // Level bar normalized across stems (rms_db).
  const rmsVals = analysis.entries
    .map((e) => e.metrics.rms_db)
    .filter((v): v is number => v != null);
  const rmsMin = Math.min(...rmsVals, -40);
  const rmsMax = Math.max(...rmsVals, -6);
  return (
    <div className="fb-list">
      <div className="fb-lh">
        <span className="t">Stems</span>
        <span className="fr-meta mono">{analysis.mode === 'per_stem' ? 'per stem' : 'grouped by role'}</span>
      </div>
      <div className="fb-scroll">
        {analysis.entries.map((e) => {
          const clashes = clashesForStem(analysis.clashes, e.key);
          const rms = e.metrics.rms_db;
          const pct =
            rms == null || rmsMax === rmsMin
              ? 0
              : Math.max(6, Math.min(100, ((rms - rmsMin) / (rmsMax - rmsMin)) * 100));
          return (
            <button
              key={e.key}
              type="button"
              className={`fb-row${e.key === selKey ? ' on' : ''}`}
              onClick={() => onSelect(e.key)}
            >
              <span className="fr-b">
                <span className="fr-head">
                  {e.key}
                  {analysis.mode === 'per_stem' && (
                    <span className="fr-meta mono"> · {e.role}</span>
                  )}
                </span>
                <span className="st-level" title={`RMS ${fmt(rms, 1, ' dB')}`}>
                  <span className="st-level-fill" style={{ width: `${pct}%` }} />
                </span>
              </span>
              {clashes.length > 0 && (
                <span
                  className="st-clashcount mono"
                  title={`${clashes.length} frequency clash${clashes.length > 1 ? 'es' : ''}`}
                >
                  <Icon name="collision" size={11} />
                  {clashes.length}
                </span>
              )}
            </button>
          );
        })}
        {analysis.truncated && (
          <div className="na" style={{ margin: '8px 4px' }}>
            <Icon name="info" size={13} />
            Clash analysis capped — only the loudest stems were compared pairwise.
          </div>
        )}
      </div>
    </div>
  );
}

function StemDetail({
  entry,
  analysis,
  perStemDeltas,
  versionId,
  verdicts,
  onShowFinding,
}: {
  entry: StemEntry;
  analysis: StemsAnalysis;
  perStemDeltas: Phase5PerStemDelta[] | undefined;
  versionId: string | null;
  verdicts: VerdictDto[];
  onShowFinding: (verdictId: string) => void;
}) {
  const m = entry.metrics;
  const clashes = clashesForStem(analysis.clashes, entry.key);
  const flags = analysis.balanceFlags.filter((f) => f.role === entry.role);
  const deltas = deltasByRole(perStemDeltas).get(entry.role) ?? [];
  const related = verdicts.filter(
    (v) =>
      v.headline !== 'Specialist failed' &&
      (v.dataTier === 'stems' || `${v.headline} ${v.summary ?? ''}`.toLowerCase().includes(entry.role)),
  );

  const stats: { k: string; v: string }[] = [
    { k: 'LUFS', v: fmt(m.lufs_integrated) },
    { k: 'RMS', v: fmt(m.rms_db, 1, ' dB') },
    { k: 'Peak', v: fmt(m.peak_db, 1, ' dB') },
    { k: 'Dyn range', v: fmt(m.dynamic_range_db, 1, ' dB') },
    { k: 'Centroid', v: m.spectral_centroid_hz != null ? `${Math.round(m.spectral_centroid_hz)} Hz` : '—' },
    { k: 'Width', v: fmt(m.stereo_width, 2) },
    { k: 'Pan', v: fmt(m.pan_estimate, 2) },
  ];

  return (
    <div className="fb-detail">
      <div className="fbd-scroll">
        <div className="fbd-toplab">Stem</div>
        <h3 className="fbd-head">
          {entry.key}
          {m.is_mono != null && (
            <span className={`st-mono-badge mono${m.is_mono ? '' : ' stereo'}`}>
              {m.is_mono ? 'MONO' : 'STEREO'}
            </span>
          )}
        </h3>

        <div className="st-stats">
          {stats.map((s) => (
            <div className="st-stat" key={s.k}>
              <span className="k">{s.k}</span>
              <span className="v mono">{s.v}</span>
            </div>
          ))}
        </div>

        {m.dominant_frequencies_hz.length > 0 && (
          <p className="fbd-dataexp" style={{ marginTop: 8 }}>
            Dominant frequencies:{' '}
            <span className="mono">
              {m.dominant_frequencies_hz.slice(0, 3).map((f) => `${Math.round(f)} Hz`).join(' · ')}
            </span>
          </p>
        )}

        <StemFiles entry={entry} analysis={analysis} versionId={versionId} />

        {clashes.length > 0 && (
          <div className="st-section">
            <span className="fbd-rackhd">Frequency clashes</span>
            {clashes.map((c, i) => (
              <ClashRow key={i} clash={c} self={entry.key} />
            ))}
          </div>
        )}

        {flags.length > 0 && (
          <div className="st-section">
            <span className="fbd-rackhd">Balance flags</span>
            <div className="st-flags">
              {flags.map((f, i) => (
                <span
                  key={i}
                  className="pill"
                  style={{ color: TIER_TONE[f.severity_tier] ?? 'var(--muted)' }}
                  title={
                    f.expected_range
                      ? `${f.metric}: ${f.observed} (expected ${f.expected_range[0]} … ${f.expected_range[1]})`
                      : `${f.metric}: ${f.observed}`
                  }
                >
                  {f.metric} {f.direction === 'too_high' ? 'too high' : 'too low'}
                </span>
              ))}
            </div>
          </div>
        )}

        {deltas.length > 0 && (
          <div className="st-section">
            <span className="fbd-rackhd">vs reference</span>
            <div className="evrows">
              <div className="er hd">
                <span>Metric</span>
                <span>Yours</span>
                <span>Reference</span>
                <span>Δ</span>
              </div>
              {deltas.map((d, i) => (
                <div className="er" key={i} title={d.interpretation ?? ''}>
                  <span className="m mono">{d.metric ?? ''}</span>
                  <span className="y mono">{d.user_value != null ? d.user_value.toFixed(1) : '—'}</span>
                  <span className="e mono">
                    {d.reference_value != null ? d.reference_value.toFixed(1) : '—'}
                  </span>
                  <span
                    className="d mono"
                    style={{ color: TIER_TONE[d.severity_tier ?? ''] ?? 'var(--orange)' }}
                  >
                    {d.delta != null ? `${d.delta > 0 ? '+' : ''}${d.delta.toFixed(1)}` : '—'}
                  </span>
                </div>
              ))}
            </div>
            {deltas[0]?.interpretation && (
              <p className="fbd-dataexp" style={{ marginTop: 6 }}>
                {deltas[0].interpretation}
              </p>
            )}
          </div>
        )}

        {related.length > 0 && (
          <div className="st-section">
            <span className="fbd-rackhd">Findings mentioning this stem</span>
            {related.map((v) => (
              <button
                key={v.id}
                type="button"
                className="st-finding"
                style={{ ['--sev' as string]: severityColor(v.severity) }}
                onClick={() => onShowFinding(v.id)}
              >
                <span className="d" />
                <span className="t">{v.headline}</span>
                <Icon name="arrow" size={12} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Uploaded files behind this entry — classifier confidence + inline playback.
 *  Grouped mode: every file whose confirmed/detected role matches the row's
 *  role. Per-stem mode: match by filename label. */
function StemFiles({
  entry,
  analysis,
  versionId,
}: {
  entry: StemEntry;
  analysis: StemsAnalysis;
  versionId: string | null;
}) {
  const { data } = useStemProposals(versionId ?? '', Boolean(versionId));
  const [playingId, setPlayingId] = useState<string | null>(null);
  const files = useMemo(() => {
    const all = data?.stems ?? [];
    if (analysis.mode === 'per_stem') {
      return all.filter((s) => s.originalFilename.replace(/\.[^.]+$/, '') === entry.key);
    }
    return all.filter((s) => (s.confirmedRole ?? s.detectedRole) === entry.role);
  }, [data, analysis.mode, entry]);

  if (!versionId || files.length === 0) return null;
  const token = getAccessToken();

  return (
    <div className="st-section">
      <span className="fbd-rackhd">Files ({files.length})</span>
      {files.map((f) => {
        const src = token
          ? `/api/versions/${versionId}/stems/${f.id}/audio?t=${encodeURIComponent(token)}`
          : null;
        const playing = playingId === f.id;
        return (
          <div className="st-file" key={f.id}>
            {src && (
              <button
                type="button"
                className={`st-play${playing ? ' on' : ''}`}
                title={playing ? 'Stop' : 'Play this stem'}
                onClick={() => setPlayingId(playing ? null : f.id)}
              >
                <Icon name={playing ? 'pause' : 'play'} size={11} />
              </button>
            )}
            <span className="st-file-name" title={f.originalFilename}>
              {f.originalFilename}
            </span>
            <span className="st-file-meta mono">
              {(f.confirmedRole ?? f.detectedRole) ?? '—'} · {Math.round(f.confidence * 100)}%
            </span>
            {playing && src && <audio src={src} autoPlay onEnded={() => setPlayingId(null)} />}
          </div>
        );
      })}
    </div>
  );
}

function ClashRow({ clash, self }: { clash: StemClash; self: string }) {
  const other = clash.stem_a === self ? clash.stem_b : clash.stem_a;
  const tone = TIER_TONE[clash.severity_tier] ?? 'var(--orange)';
  return (
    <div className="st-clash" style={{ ['--tone' as string]: tone }}>
      <Icon name="collision" size={12} />
      <span className="t">
        vs <b>{other}</b> in the <b>{clash.band.replace(/_/g, '-')}</b> band
      </span>
      <span className="mono sev" title={`overlap severity ${clash.overlap_severity.toFixed(2)}`}>
        {clash.severity_tier} · {Math.round(clash.overlap_severity * 100)}%
      </span>
    </div>
  );
}

/** Band-level EQ-overlap grid: one row per stem, 7 band columns; cell tint =
 *  that stem's band energy; clash cells get a severity outline. Real data only. */
function OverlapGrid({ analysis, selKey }: { analysis: StemsAnalysis; selKey: string }) {
  const [min, max] = bandRange(analysis.entries);
  const clashAt = (key: string, band: string): StemClash | undefined =>
    analysis.clashes.find((c) => (c.stem_a === key || c.stem_b === key) && c.band === band);
  return (
    <div className="card st-grid-card">
      <div className="card-hd">
        <span className="t">
          <span className="led" />
          Band overlap map
        </span>
        <span className="meta">phase4.stems.per_stem.band_energy_db · clash_matrix</span>
      </div>
      <div className="st-grid" style={{ ['--cols' as string]: String(STEM_BAND_KEYS.length) }}>
        <div className="st-grid-row hd">
          <span className="st-grid-name" />
          {STEM_BAND_KEYS.map((b) => (
            <span key={b} className="st-grid-cell hd mono">
              {STEM_BAND_LABEL[b]}
            </span>
          ))}
        </div>
        {analysis.entries.map((e) => (
          <div className={`st-grid-row${e.key === selKey ? ' on' : ''}`} key={e.key}>
            <span className="st-grid-name mono">{e.key}</span>
            {STEM_BAND_KEYS.map((b) => {
              const clash = clashAt(e.key, b);
              const intensity = bandIntensity(e.metrics.band_energy_db[b], min, max);
              return (
                <span
                  key={b}
                  className={`st-grid-cell${clash ? ' clash' : ''}`}
                  style={{
                    ['--i' as string]: String(intensity),
                    ...(clash
                      ? { ['--tone' as string]: TIER_TONE[clash.severity_tier] ?? 'var(--orange)' }
                      : {}),
                  }}
                  title={
                    clash
                      ? `${clash.stem_a} × ${clash.stem_b} clash in ${b} — ${clash.severity_tier} (${Math.round(clash.overlap_severity * 100)}%)`
                      : e.metrics.band_energy_db[b] != null
                        ? `${e.key} · ${b}: ${e.metrics.band_energy_db[b]!.toFixed(1)} dB`
                        : ''
                  }
                />
              );
            })}
          </div>
        ))}
      </div>
      <p className="fbd-dataexp" style={{ padding: '0 14px 12px' }}>
        Brighter cells carry more energy in that band; outlined pairs are where two stems fight for
        the same frequencies.
      </p>
    </div>
  );
}
