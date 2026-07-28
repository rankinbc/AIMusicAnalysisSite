import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { getAccessToken } from '../../api/fetcher';
import type {
  Phase1Bands,
  Phase1ChannelBalance,
  Phase1Data,
  Phase1KeyEstimate,
  Phase1Structure,
  Phase2Data,
  Phase3Data,
  Phase4Clash,
  Phase4Data,
  Phase9Data,
  Phase9Spatial,
} from '../../api/types';
import { tiTime } from './track-info-helpers';
import { LoudnessTimelineCard } from './panels/LoudnessTimelineCard';
import { PunchCard } from './panels/PunchCard';
import { StructureStrip } from './panels/StructureStrip';

interface TrackInfoTabProps {
  phase1: Phase1Data | undefined;
  phase2: Phase2Data | undefined;
  phase3: Phase3Data | undefined;
  phase4: Phase4Data | undefined;
  phase9: Phase9Data | undefined;
  /** Top-level danceability_score (0–100) — not a phase field. */
  danceability?: number | undefined;
  spectrogramUrl?: string | null | undefined;
  waveformUrl?: string | null | undefined;
  /** v4 ev2 deep-link: a frequency range whose overlapping tonal-balance bands
   *  glow when landing here from a finding's evidence row. */
  highlightBand?: [number, number] | null | undefined;
}

const BANDS: { key: keyof Phase1Bands; label: string; hz: string; lo: number; hi: number }[] = [
  { key: 'sub_bass', label: 'Sub', hz: '20–60', lo: 20, hi: 60 },
  { key: 'bass', label: 'Bass', hz: '60–250', lo: 60, hi: 250 },
  { key: 'low_mid', label: 'Lo-mid', hz: '250–500', lo: 250, hi: 500 },
  { key: 'mid', label: 'Mid', hz: '0.5–2k', lo: 500, hi: 2000 },
  { key: 'upper_mid', label: 'Hi-mid', hz: '2–4k', lo: 2000, hi: 4000 },
  { key: 'presence', label: 'Pres', hz: '4–8k', lo: 4000, hi: 8000 },
  { key: 'air', label: 'Air', hz: '8–20k', lo: 8000, hi: 20000 },
];

const PLATFORMS: { name: string; target: number }[] = [
  { name: 'Spotify', target: -14 },
  { name: 'Apple Music', target: -16 },
  { name: 'YouTube', target: -14 },
  { name: 'Tidal', target: -14 },
  { name: 'Amazon Music', target: -14 },
  { name: 'SoundCloud', target: -10 },
  { name: 'Beatport', target: -8 },
];

const clampPct = (v: number) => Math.max(0, Math.min(100, v));
const arGenre = (g: string | undefined) =>
  g === 'other' || !g ? 'Uncategorized' : g.charAt(0).toUpperCase() + g.slice(1);
const cssVar = (name: string, value: string): CSSProperties => ({ [name]: value }) as CSSProperties;

export function TrackInfoTab({
  phase1,
  phase2,
  phase3,
  phase4,
  phase9,
  danceability,
  spectrogramUrl,
  waveformUrl,
  highlightBand,
}: TrackInfoTabProps) {
  void phase3;
  const structure = phase1?.structure;
  const dur = phase1?.duration_seconds;
  return (
    <div className="ti-stack">
      <div className="ti-toprow">
        <MetaRow phase1={phase1} phase2={phase2} danceability={danceability} />
      </div>
      <div className="ti-grid">
        <LoudnessCard phase1={phase1} />
        <TonalCard bands={phase1?.bands} highlightBand={highlightBand} />
        <StereoCard phase1={phase1} spatial={phase9?.spatial} />
        <PunchCard phase1={phase1} />
        <ClashCard clashes={phase4?.clashes} />
      </div>
      <LoudnessTimelineCard phase1={phase1} />
      {(waveformUrl || spectrogramUrl) && (
        <div className="ti-visuals">
          <VizCard kind="wave" src={waveformUrl} structure={structure} durationSec={dur} />
          <VizCard kind="spectro" src={spectrogramUrl} structure={structure} durationSec={dur} />
        </div>
      )}
      <TranslationCard phase9={phase9} />
      <StreamingReadiness phase1={phase1} />
    </div>
  );
}

// ── Icons (stroke 1.7, rounded) — subset used by the Track Analysis tab ──────
const ICON_PATHS: Record<string, ReactNode> = {
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  check: <path d="M5 13l4 4L19 7" />,
  x: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.3 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </>
  ),
  chevron: <path d="M6 9l6 6 6-6" />,
  sound: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9z" />
      <path d="M17 8a5 5 0 0 1 0 8" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.4" />
    </>
  ),
  headphones: (
    <>
      <path d="M4 14v-1a8 8 0 0 1 16 0v1" />
      <rect x="3" y="14" width="4.5" height="6" rx="1.8" />
      <rect x="16.5" y="14" width="4.5" height="6" rx="1.8" />
    </>
  ),
};

function Icon({ name, size = 15 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICON_PATHS[name] ?? null}
    </svg>
  );
}

function ScoreBar({ v, max = 100, tone }: { v: number; max?: number; tone?: string }) {
  const pc = clampPct((v / max) * 100);
  return (
    <div className="scorebar">
      <div className={`sb-fill ${tone ?? ''}`} style={{ width: `${pc}%` }} />
    </div>
  );
}

// ── Facts row — phase2 genre · phase1 key_estimate/bpm · danceability ────────
function KeyBadge({ k, confidence }: { k: string; confidence?: number | undefined }) {
  const conf = confidence == null ? 1 : confidence;
  const uncertain = conf < 0.5;
  return (
    <span
      className="mono"
      title={`key confidence ${Math.round(conf * 100)}%`}
      style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, color: uncertain ? 'var(--muted)' : 'inherit' }}
    >
      {k}
      {uncertain && <span style={{ fontSize: 9, color: 'var(--orange)' }}>· uncertain</span>}
    </span>
  );
}

function MetaRow({
  phase1,
  phase2,
  danceability,
}: {
  phase1: Phase1Data | undefined;
  phase2: Phase2Data | undefined;
  danceability?: number | undefined;
}) {
  const genreConf = phase2?.confidence;
  const dur = phase1?.duration_seconds;
  const bpm = phase1?.bpm ?? phase2?.bpm;
  const ke: Phase1KeyEstimate | undefined = phase1?.key_estimate;
  return (
    <div className="meta-row">
      <div className="mstat" title="phase2.genre · confidence">
        <div className="ml">Genre</div>
        <div className="mv">{arGenre(phase2?.genre)}</div>
        {genreConf != null && <div className="msub">{Math.round(genreConf * 100)}%</div>}
      </div>
      <div className="mstat" title="phase1.duration_seconds">
        <div className="ml">Duration</div>
        <div className="mv">
          <span className="mono">{dur != null ? tiTime(dur) : '—'}</span>
        </div>
      </div>
      <div className="mstat" title="phase1.bpm">
        <div className="ml">Tempo</div>
        <div className="mv">
          <span className="mono">{bpm != null ? Math.round(bpm) : '—'}</span>
          {bpm != null && <span className="u">BPM</span>}
        </div>
      </div>
      {ke?.key ? (
        <div className="mstat" title="phase1.key_estimate">
          <div className="ml">Key</div>
          <div className="mv">
            <span className="mono">
              {ke.key}
              {ke.mode ? ` ${ke.mode}` : ''}
            </span>
          </div>
          {ke.confidence != null && (
            <div className="msub">
              {Math.round(ke.confidence * 100)}%
              {ke.second_key ? ` · alt ${ke.second_key}${ke.second_mode ? ` ${ke.second_mode}` : ''}` : ''}
            </div>
          )}
        </div>
      ) : (
        <div className="mstat" title="phase1.detected_key">
          <div className="ml">Key</div>
          <div className="mv">
            <KeyBadge k={phase1?.detected_key ?? '—'} confidence={phase1?.key_detection_confidence} />
          </div>
        </div>
      )}
      {danceability != null && (
        <div className="mstat dance" title="danceability_score">
          <div className="ml">Danceability</div>
          <div className="mv">
            <span className="mono">{Math.round(danceability)}</span>
            <span className="u">of 100</span>
          </div>
          <ScoreBar v={danceability} tone="accent" />
        </div>
      )}
    </div>
  );
}

// ── Loudness & dynamics — phase1.{lufs,peak_dbfs,true_peak_db,clipping,dr} ────
const tpTone = (tp: number) => (tp > -0.1 ? 'bad' : tp > -1.0 ? 'warn' : 'ok');
const fmtSigned = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`;

function LoudnessCard({ phase1 }: { phase1: Phase1Data | undefined }) {
  const lufs = phase1?.lufs;
  const peak = phase1?.peak_dbfs;
  const tp = phase1?.true_peak_db;
  const dr = phase1?.loudness_range_lu;
  const clipDetected = phase1?.clipping_detected === true;
  const clipCount = phase1?.clipped_sample_count ?? 0;
  const target = -14;
  const MIN = -24;
  const MAX = 0;
  const pct = (v: number) => `${clampPct(((v - MIN) / (MAX - MIN)) * 100)}%`;
  const hot = lufs != null && lufs > target;
  const tpt = tp != null ? tpTone(tp) : null;
  return (
    <div className="card" data-ti-anchor="loudness">
      <div className="card-hd">
        <span className="t">
          <span className="led" />
          Loudness &amp; dynamics
        </span>
        <span className="meta">phase1.lufs · true_peak_db</span>
      </div>
      <div className="card-body">
        <div className="loud">
          <div className="loud-meter">
            <div className="lm-scale">
              {lufs != null && (
                <>
                  <div className={`lm-fill${hot ? ' hot' : ''}`} style={{ width: pct(lufs) }} />
                  <div className={`lm-val${hot ? ' hot' : ''}`} style={{ left: pct(lufs) }}>
                    {lufs.toFixed(1)} LUFS
                  </div>
                </>
              )}
              <div className="lm-tgt" style={{ left: pct(target) }}>
                <span className="cap">stream {target}</span>
              </div>
            </div>
            <div className="lm-ends">
              <span>−24</span>
              <span>integrated loudness</span>
              <span>0 LUFS</span>
            </div>
          </div>
          <div className="loud-tiles">
            <div className="dtile" title="phase1.peak_dbfs">
              <div className="dl">Sample peak</div>
              <div className="dv">
                {peak != null ? peak.toFixed(1) : '—'}
                <small>dBFS</small>
              </div>
            </div>
            <div className="dtile" title="phase1.true_peak_db">
              <div className="dl">
                {tpt && <Icon name={tpt === 'ok' ? 'check' : 'alert'} size={10} />}
                True peak
              </div>
              <div className={`dv ${tpt ?? ''}`}>
                {tp != null ? fmtSigned(tp) : '—'}
                <small>dBTP</small>
              </div>
              {tpt && tpt !== 'ok' && (
                <div className="dnote">{tpt === 'bad' ? 'over 0 — will clip on lossy' : 'close to ceiling'}</div>
              )}
            </div>
            <div className="dtile" title="phase1.dynamic_range">
              <div className="dl">Dynamic range</div>
              <div className={`dv ${dr != null && dr < 6 ? 'warn' : ''}`}>
                {dr != null ? dr.toFixed(1) : '—'}
                <small>LU</small>
              </div>
            </div>
            <div className="dtile" title="phase1.clipped_sample_count">
              <div className="dl">Clipping</div>
              {clipDetected ? (
                <div className="dv bad">
                  {clipCount.toLocaleString()}
                  <small>samples</small>
                </div>
              ) : (
                <div className="dv ok">clean ✓</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tonal balance — phase1.bands.* (flags from phase6.gaps, not wired here) ───
function TonalCard({
  bands,
  highlightBand,
}: {
  bands: Phase1Bands | undefined;
  highlightBand?: [number, number] | null | undefined;
}) {
  // ev2 deep-link: scroll the card into view when a band range lands.
  useEffect(() => {
    if (!highlightBand) return;
    document
      .querySelector('[data-ti-anchor="bands"]')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightBand]);
  const vals = BANDS.map((b) => ({ ...b, db: bands?.[b.key] }));
  const present = vals.map((v) => v.db).filter((d): d is number => d != null);
  if (present.length === 0) return null;
  const floor = Math.min(...present) - 4;
  const ceil = Math.max(...present) + 2;
  const h = (v: number) => `${Math.max(4, clampPct(((v - floor) / (ceil - floor)) * 100))}%`;
  const isHl = (b: { lo: number; hi: number }) =>
    highlightBand != null && b.lo < highlightBand[1] && b.hi > highlightBand[0];
  return (
    <div className="card" data-ti-anchor="bands">
      <div className="card-hd">
        <span className="t">
          <span className="led" />
          Tonal balance
        </span>
        <span className="meta">phase1.bands · flags phase6.gaps</span>
      </div>
      <div className="card-body">
        <div className="bands">
          {vals.map((b, i) => (
            <div className={`band${isHl(b) ? ' hl' : ''}`} key={i}>
              <div className="bcol" style={{ height: '100%' }}>
                <div className="bfill" style={{ height: b.db != null ? h(b.db) : 0 }} />
              </div>
              <div className="bval">{b.db != null ? b.db.toFixed(1) : '—'}</div>
              <div className="blbl">
                {b.label}
                <br />
                {b.hz}
              </div>
            </div>
          ))}
        </div>
        <div
          className="bands-legend"
          title="A genre median curve isn’t measured yet — flags come from phase6 gap analysis."
        >
          <span className="lg">
            <span className="sw" style={{ background: 'var(--accent)' }} />
            your mix
          </span>
          <span className="lg">
            <span className="sw" style={{ background: 'var(--orange)' }} />
            flagged by gap analysis
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Stereo — phase1 scalars + phase9.spatial ─────────────────────────────────
function Goniometer({ width, correlation, size = 96 }: { width: number; correlation: number; size?: number }) {
  const N = 96;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 8;
  const spread = 0.25 + Math.max(0, Math.min(1, width)) * 0.75;
  const tilt = Math.max(0, Math.min(1, correlation));
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 0.45 + 0.5 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.9));
    let x = Math.cos(a) * r * spread;
    const y = Math.sin(a) * r;
    x *= 1 - tilt * 0.82;
    pts.push([cx + x * R, cy + y * R]);
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="scope">
      <circle cx={cx} cy={cy} r={R} fill="rgba(0,229,176,.02)" stroke="var(--border-2)" strokeWidth="1" />
      <line x1={cx} y1={cy - R} x2={cx} y2={cy + R} stroke="rgba(255,255,255,.07)" strokeWidth="1" />
      <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke="rgba(255,255,255,.07)" strokeWidth="1" />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.5" fill="var(--accent)" opacity={0.5 + (i % 5) * 0.1} />
      ))}
    </svg>
  );
}

function StereoCard({ phase1, spatial }: { phase1: Phase1Data | undefined; spatial: Phase9Spatial | undefined }) {
  const width = phase1?.stereo_width;
  const corr = phase1?.stereo_correlation;
  const mono = phase1?.mono_compatibility;
  const cb: Phase1ChannelBalance | undefined = phase1?.channel_balance;
  if (width == null && corr == null && mono == null) return null;
  const w = width ?? 0;
  const c = corr ?? 0;
  const m = mono ?? 0;
  const corrPct = `${((c + 1) / 2) * 100}%`;
  const corrColor = c < 0 ? 'var(--red)' : c < 0.3 ? 'var(--orange)' : 'var(--accent)';
  const monoColor = m < 0.6 ? 'var(--orange)' : 'var(--accent)';
  const cbBal = cb?.balance_db;
  const cbPct = cbBal != null ? `${Math.max(8, Math.min(92, 50 + cbBal * 8))}%` : null;
  const spCells: { label: string; path: string; v: number; bar: number }[] = [];
  if (spatial?.height_score != null)
    spCells.push({ label: 'Height', path: 'phase9.spatial.height_score', v: spatial.height_score, bar: spatial.height_score });
  if (spatial?.depth_score != null)
    spCells.push({ label: 'Depth', path: 'phase9.spatial.depth_score', v: spatial.depth_score, bar: spatial.depth_score });
  if (spatial?.width_consistency != null) {
    const wc = spatial.width_consistency;
    spCells.push({ label: 'Width consistency', path: 'phase9.spatial.width_consistency', v: wc, bar: wc <= 1 ? wc * 100 : wc });
  }
  return (
    <div className="card" data-ti-anchor="stereo">
      <div className="card-hd">
        <span className="t">
          <span className="led" />
          Stereo field
        </span>
        <span className="meta">phase1 scalars · stylized scope</span>
      </div>
      <div className="card-body">
        <div className="stereo">
          <Goniometer width={w} correlation={c} size={96} />
          <div className="stereo-rows">
            <div className="srow" title="phase1.stereo_width">
              <div className="sr-top">
                <span className="sr-l">Width</span>
                <span className="sr-v mono">{w.toFixed(2)}</span>
              </div>
              <div className="sr-track">
                <div
                  className="f"
                  style={{ width: `${clampPct(w * 100)}%`, background: w < 0.2 ? 'var(--orange)' : 'var(--accent)' }}
                />
              </div>
            </div>
            <div className="srow" title="phase1.stereo_correlation">
              <div className="sr-top">
                <span className="sr-l">Correlation</span>
                <span className="sr-v mono">
                  {c > 0 ? '+' : ''}
                  {c.toFixed(2)}
                </span>
              </div>
              <div className="sr-track">
                <span className="mid" />
                <div
                  className="dot2"
                  style={{ left: corrPct, background: corrColor, boxShadow: `0 0 0 3px ${corrColor}22` }}
                />
              </div>
            </div>
            <div className="srow" title="phase1.mono_compatibility">
              <div className="sr-top">
                <span className="sr-l">Mono compatibility</span>
                <span className="sr-v mono">{Math.round(m * 100)}%</span>
              </div>
              <div className="sr-track">
                <div className="f" style={{ width: `${clampPct(m * 100)}%`, background: monoColor }} />
              </div>
            </div>
            {cbBal != null && cbPct && (
              <div className="srow" title="phase1.channel_balance">
                <div className="sr-top">
                  <span className="sr-l">L/R balance</span>
                  <span className="sr-v mono">
                    L {cb?.l_rms_db != null ? cb.l_rms_db.toFixed(1) : '—'} · R{' '}
                    {cb?.r_rms_db != null ? cb.r_rms_db.toFixed(1) : '—'} dB
                  </span>
                </div>
                <div className="sr-track">
                  <span className="mid" />
                  <div className="dot2" style={{ left: cbPct, background: 'var(--accent)' }} />
                </div>
              </div>
            )}
          </div>
        </div>
        {spCells.length > 0 && (
          <div className="sp-bars" title="phase9.spatial">
            {spCells.map((sc) => (
              <div className="spb" key={sc.label} title={sc.path}>
                <span className="spb-l">{sc.label}</span>
                <ScoreBar v={sc.bar} tone="accent" />
                <span className="spb-v mono">{sc.v <= 1 ? sc.v.toFixed(2) : Math.round(sc.v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Visuals (waveform + spectrogram) + structure overlay ─────────────────────
function VizCard({
  kind,
  src,
  structure,
  durationSec,
}: {
  kind: 'wave' | 'spectro';
  src?: string | null | undefined;
  structure: Phase1Structure | undefined;
  durationSec: number | undefined;
}) {
  const [ok, setOk] = useState(true);
  const isWave = kind === 'wave';
  if (!src || !ok) return null;
  const lead = isWave ? 'Amplitude over time' : 'Frequency over time';
  const body = isWave
    ? ' — the overall shape of the track. Read arrangement dynamics and where it peaks or drops out.'
    : ' — lows at the bottom, highs at the top; brighter means louder. Spot harshness or muddy low-end build-ups.';
  const hasSegs = Boolean(structure?.segments && structure.segments.length > 0 && durationSec);
  const withTok = `${src}?t=${encodeURIComponent(getAccessToken() ?? '')}`;
  return (
    <div className="viz" title={lead + body}>
      <div className="viz-hd">
        <span className="l">{isWave ? 'waveform' : 'spectrogram'}</span>
        {hasSegs && <span className="viz-path mono">phase1.structure</span>}
      </div>
      <div className={`viz-img ${isWave ? 'wave' : 'spectro'}`}>
        <img
          src={withTok}
          alt={isWave ? 'waveform' : 'spectrogram'}
          loading="lazy"
          className="viz-real"
          onError={() => setOk(false)}
        />
        {!isWave && (
          <div className="viz-axis">
            <span>20k</span>
            <span>2k</span>
            <span>200</span>
            <span>20 Hz</span>
          </div>
        )}
      </div>
      <StructureStrip structure={structure} durationSec={durationSec} compact />
      <div className="viz-desc">
        <b>{lead}</b>
        {body}
      </div>
    </div>
  );
}

// ── Frequency clashes — phase4.clashes[] ─────────────────────────────────────
function ClashCard({ clashes }: { clashes: Phase4Clash[] | undefined }) {
  if (!clashes || clashes.length === 0) return null;
  return (
    <div className="card">
      <div className="card-hd">
        <span className="t">
          <span className="led" />
          Frequency clashes
        </span>
        <span className="meta">phase4.clashes · {clashes.length} detected</span>
      </div>
      <div className="card-body">
        <div className="clash-list">
          {clashes.map((c, i) => {
            const cc =
              c.severity === 'high' ? 'var(--orange)' : c.severity === 'moderate' ? 'var(--yellow)' : 'var(--muted)';
            return (
              <div className="clash-row" key={i} style={cssVar('--cc', cc)}>
                <div className="clash-top">
                  <span className="clash-dot" />
                  <span className="clash-pair">{c.stems ?? 'Frequency region'}</span>
                  {c.frequency_range && <span className="clash-range mono">{c.frequency_range}</span>}
                  <span className="clash-sev mono">{c.severity ?? '—'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Mix translation — phase9.playback.* + phase9.surround.* ───────────────────
const AR_TRANS_COLOR: Record<string, string> = {
  great: 'var(--green)',
  good: 'var(--accent)',
  fair: 'var(--orange)',
  poor: 'var(--red)',
};
const AR_TRANS_ICON: Record<string, string> = { Headphones: 'headphones', Speakers: 'sound', Mono: 'target' };

function TranslationCard({ phase9 }: { phase9: Phase9Data | undefined }) {
  const pb = phase9?.playback;
  const sr = phase9?.surround;
  const has = Boolean(pb || sr);
  const monoScore = sr?.mono_compatibility != null ? sr.mono_compatibility * 100 : undefined;
  const rate = (s: number | undefined) =>
    s == null ? '—' : s >= 80 ? 'great' : s >= 60 ? 'good' : s >= 40 ? 'fair' : 'poor';
  const systems: { name: string; path: string; score: number | undefined }[] = [
    { name: 'Headphones', path: 'phase9.playback.headphone_score', score: pb?.headphone_score },
    { name: 'Speakers', path: 'phase9.playback.speaker_score', score: pb?.speaker_score },
    { name: 'Mono', path: 'phase9.surround.mono_compatibility', score: monoScore },
  ];
  const note = pb?.analysis?.[0] ?? sr?.analysis?.[0];
  const chips: { k: string; v: string; path: string; tone?: string }[] = [];
  if (pb?.bass_translation)
    chips.push({ k: 'Bass', v: pb.bass_translation, path: 'phase9.playback.bass_translation' });
  if (pb?.crossfeed_safe != null)
    chips.push({
      k: 'Crossfeed',
      v: pb.crossfeed_safe ? 'safe' : 'risky',
      path: 'phase9.playback.crossfeed_safe',
      tone: pb.crossfeed_safe ? 'ok' : 'warn',
    });
  if (sr?.phase_score != null)
    chips.push({ k: 'Phase', v: String(Math.round(sr.phase_score)), path: 'phase9.surround.phase_score' });
  return (
    <div className="card">
      <div className="card-hd">
        <span className="t">
          <span className="led" />
          Mix translation
        </span>
        <span className="meta">phase9.playback · phase9.surround</span>
      </div>
      <div className="card-body">
        {has ? (
          <>
            <div className="trans-line">
              <div className="trans-row">
                {systems.map((sy) => {
                  const rating = rate(sy.score);
                  return (
                    <div
                      className="trans-sys"
                      key={sy.name}
                      style={cssVar('--tc', AR_TRANS_COLOR[rating] ?? 'var(--text-2)')}
                      title={sy.path}
                    >
                      <span className="ts-ic">
                        <Icon name={AR_TRANS_ICON[sy.name] ?? 'sound'} size={13} />
                      </span>
                      <span className="ts-name">{sy.name}</span>
                      <span className="ts-rating">{rating}</span>
                      {sy.score != null && <span className="ts-score">{Math.round(sy.score)}</span>}
                    </div>
                  );
                })}
              </div>
              {note && <div className="trans-note">{note}</div>}
            </div>
            {chips.length > 0 && (
              <div className="trans-chips">
                {chips.map((c) => (
                  <div className="dtile" key={c.k} title={c.path}>
                    <div className="dl">{c.k}</div>
                    <div className={`dv ${c.tone ?? ''}`}>{c.v}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="na">
            <Icon name="info" size={14} />
            Not assessed — the track is too short to predict translation across systems.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Streaming readiness (computed vs phase1 loudness) ────────────────────────
function CellMark({ ok }: { ok: boolean }) {
  return (
    <span className="cell">
      <span className={`ck ${ok ? 'ok' : 'no'}`}>
        <Icon name={ok ? 'check' : 'x'} size={9} />
      </span>
    </span>
  );
}

function StreamingReadiness({ phase1 }: { phase1: Phase1Data | undefined }) {
  const [open, setOpen] = useState(false);
  const lufs = phase1?.lufs;
  const tp = phase1?.true_peak_db ?? phase1?.peak_dbfs;
  const clip = phase1?.clipping_detected === true;
  const rows = PLATFORMS.map((p) => ({
    platform: p.name,
    target: p.target,
    lufsOk: lufs != null && Math.abs(lufs - p.target) <= 1.5,
    tpOk: tp != null && tp <= -1 && !clip,
    clipOk: !clip,
  }));
  const ready = rows.filter((r) => r.lufsOk && r.tpOk && r.clipOk).length;
  return (
    <div className="stream-card">
      <button className="stream-hd" onClick={() => setOpen((o) => !o)}>
        <span className="l">
          <Icon name="sound" size={15} />
          Streaming readiness
        </span>
        <span className="sum">
          <span className={ready === rows.length ? 'ok' : 'no'}>
            {ready}/{rows.length}
          </span>{' '}
          platforms ready · <Icon name="chevron" size={12} />
        </span>
      </button>
      {open && (
        <div className="stream-table fade-up">
          <div className="stream-row head">
            <span>Platform</span>
            <span>LUFS target</span>
            <span>True peak</span>
            <span>No clipping</span>
          </div>
          {rows.map((r, i) => (
            <div className="stream-row" key={i}>
              <span className="plat">{r.platform}</span>
              <span className="cell">
                <span className={`ck ${r.lufsOk ? 'ok' : 'no'}`}>
                  <Icon name={r.lufsOk ? 'check' : 'x'} size={9} />
                </span>
                {r.target} LUFS
              </span>
              <CellMark ok={r.tpOk} />
              <CellMark ok={r.clipOk} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
