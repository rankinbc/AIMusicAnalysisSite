import { useState } from 'react';

import { getAccessToken } from '../../api/fetcher';
import type {
  Phase1Bands,
  Phase1Data,
  Phase2Data,
  Phase3Data,
  Phase4Data,
  Phase4Clash,
  Phase9Data,
} from '../../api/types';
import { fmtBpm, fmtDuration, fmtGenre } from './helpers/format';
import { StreamingCard } from './StreamingCard';

interface TrackInfoTabProps {
  phase1: Phase1Data | undefined;
  phase2: Phase2Data | undefined;
  phase3: Phase3Data | undefined;
  phase4: Phase4Data | undefined;
  phase9: Phase9Data | undefined;
  spectrogramUrl?: string | null | undefined;
  waveformUrl?: string | null | undefined;
}

const BANDS: { key: keyof Phase1Bands; label: string; hz: string }[] = [
  { key: 'sub_bass', label: 'Sub', hz: '20–60' },
  { key: 'bass', label: 'Bass', hz: '60–250' },
  { key: 'low_mid', label: 'Lo-mid', hz: '250–500' },
  { key: 'mid', label: 'Mid', hz: '0.5–2k' },
  { key: 'upper_mid', label: 'Hi-mid', hz: '2–4k' },
  { key: 'presence', label: 'Pres', hz: '4–8k' },
  { key: 'air', label: 'Air', hz: '8–20k' },
];

export function TrackInfoTab({
  phase1,
  phase2,
  phase3,
  phase4,
  phase9,
  spectrogramUrl,
  waveformUrl,
}: TrackInfoTabProps) {
  return (
    <div className="ti-stack">
      <FactsRow phase1={phase1} phase2={phase2} phase3={phase3} />
      <LoudnessCard phase1={phase1} />
      <TonalBalance bands={phase1?.bands} />
      <StereoCard phase1={phase1} />
      <Visuals spectrogramUrl={spectrogramUrl} waveformUrl={waveformUrl} />
      <ClashCard phase4={phase4} />
      <TranslationCard phase9={phase9} />
      <StreamingCard phase1={phase1} />
    </div>
  );
}

function FactsRow({
  phase1,
  phase2,
  phase3,
}: {
  phase1: Phase1Data | undefined;
  phase2: Phase2Data | undefined;
  phase3: Phase3Data | undefined;
}) {
  void phase3;
  const genre = phase2?.genre && phase2.genre !== 'other' ? fmtGenre(phase2.genre) : '—';
  const genreConf = phase2?.confidence != null ? `${Math.round(phase2.confidence * 100)}% confidence` : null;
  const bpm = phase1?.bpm ?? phase2?.bpm;
  const keyConf = phase1?.key_detection_confidence;
  const facts: { label: string; value: string; unit?: string; sub?: string | null }[] = [
    { label: 'Genre', value: genre, sub: genreConf },
    {
      label: 'Duration',
      value: phase1?.duration_seconds != null ? fmtDuration(phase1.duration_seconds) : '—',
    },
    { label: 'Tempo', value: bpm != null ? fmtBpm(bpm) : '—', unit: bpm != null ? 'BPM' : '' },
    {
      label: 'Key',
      value: phase1?.detected_key ?? '—',
      sub: keyConf != null && keyConf < 0.5 ? 'uncertain' : null,
    },
  ];
  return (
    <div className="meta-row">
      {facts.map((f) => (
        <div key={f.label} className="mstat">
          <div className="ml">{f.label}</div>
          <div className="mv">
            {f.value}
            {f.unit && <span className="u">{f.unit}</span>}
          </div>
          {f.sub && <div className="msub">{f.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function LoudnessCard({ phase1 }: { phase1: Phase1Data | undefined }) {
  const lufs = phase1?.lufs;
  const samplePeak = phase1?.peak_dbfs;
  const truePeak = phase1?.true_peak_db;
  const dr = phase1?.loudness_range_lu ?? phase1?.crest_factor;
  const clipped = phase1?.clipped_sample_count ?? 0;
  const truePeakHot = truePeak != null && truePeak > -1;

  const pct = (v: number) => Math.max(0, Math.min(100, ((v + 24) / 24) * 100));
  const lufsPct = lufs != null ? pct(lufs) : 0;
  const targetPct = pct(-14);
  const hot = lufs != null && lufs > -12;

  return (
    <section className="card">
      <div className="card-hd">
        <span className="t">
          <span className="led" /> Loudness &amp; dynamics
        </span>
        <span className="meta">integrated · true-peak</span>
      </div>
      <div className="card-body">
        <div className="loud">
          <div className="loud-meter">
            <div className="lm-scale">
              <div className={`lm-fill${hot ? ' hot' : ''}`} style={{ width: `${lufsPct}%` }} />
              <div className={`lm-val${hot ? ' hot' : ''}`} style={{ left: `${lufsPct}%` }}>
                {lufs != null ? `${lufs.toFixed(1)} LUFS` : '—'}
              </div>
              <div className="lm-tgt" style={{ left: `${targetPct}%` }}>
                <span className="cap">stream −14</span>
              </div>
            </div>
            <div className="lm-ends">
              <span>−24</span>
              <span>integrated loudness</span>
              <span>0</span>
            </div>
          </div>
          <div className="loud-tiles">
            <Dtile label="Sample peak" value={fmtDb(samplePeak)} unit="dBFS" />
            <Dtile
              label="True peak"
              value={fmtDb(truePeak)}
              unit="dBTP"
              tone={truePeakHot ? 'warn' : undefined}
              note={truePeakHot ? 'over 0 — clips on lossy' : undefined}
            />
            <Dtile label="Dynamic range" value={dr != null ? dr.toFixed(1) : '—'} unit="LU" />
            <Dtile
              label="Clipping"
              value={clipped > 0 ? String(clipped) : 'none'}
              unit={clipped > 0 ? 'samples' : ''}
              tone={clipped > 0 ? 'bad' : undefined}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function Dtile({
  label,
  value,
  unit,
  tone,
  note,
}: {
  label: string;
  value: string;
  unit: string;
  tone?: 'ok' | 'warn' | 'bad' | undefined;
  note?: string | undefined;
}) {
  return (
    <div className="dtile">
      <div className="dl">{label}</div>
      <div className={`dv${tone ? ` ${tone}` : ''}`}>
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {note && <div className="dnote">{note}</div>}
    </div>
  );
}

function TonalBalance({ bands }: { bands: Phase1Bands | undefined }) {
  const vals = BANDS.map((b) => {
    const raw = bands?.[b.key];
    const norm = raw != null ? Math.max(0.04, Math.min(1, (raw + 60) / 60)) : 0;
    return { ...b, db: raw, norm };
  });
  return (
    <section className="card">
      <div className="card-hd">
        <span className="t">
          <span className="led" /> Tonal balance
        </span>
        <span className="meta">7-band · relative dB</span>
      </div>
      <div className="card-body">
        <div className="bands">
          {vals.map((b) => (
            <div key={b.key} className="band">
              <span className="bval">{b.db != null ? b.db.toFixed(1) : '—'}</span>
              <div className="bcol">
                <div className="bfill" style={{ height: `${b.norm * 100}%` }} />
              </div>
              <span className="blbl">
                {b.label}
                <br />
                {b.hz}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StereoCard({ phase1 }: { phase1: Phase1Data | undefined }) {
  const width = phase1?.stereo_width ?? 0;
  const corr = phase1?.stereo_correlation ?? 0;
  const mono = phase1?.mono_compatibility ?? 0;
  return (
    <section className="card">
      <div className="card-hd">
        <span className="t">
          <span className="led" /> Stereo field
        </span>
        <span className="meta">goniometer · width · phase</span>
      </div>
      <div className="card-body">
        <div className="stereo">
          <Goniometer width={width} correlation={corr} />
          <div className="stereo-rows">
            <SRow label="Width" value={width.toFixed(2)} frac={Math.max(0, Math.min(1, width))} />
            <SRow
              label="Correlation"
              value={corr.toFixed(2)}
              frac={Math.max(0, Math.min(1, (corr + 1) / 2))}
            />
            <SRow
              label="Mono compatibility"
              value={`${Math.round(mono * 100)}%`}
              frac={Math.max(0, Math.min(1, mono))}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function SRow({ label, value, frac }: { label: string; value: string; frac: number }) {
  return (
    <div className="srow">
      <div className="sr-top">
        <span className="sr-l">{label}</span>
        <span className="sr-v">{value}</span>
      </div>
      <div className="sr-track">
        <div className="f" style={{ width: `${frac * 100}%` }} />
      </div>
    </div>
  );
}

function Goniometer({ width, correlation }: { width: number; correlation: number }) {
  const size = 116;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 8;
  const spread = 0.25 + Math.max(0, Math.min(1, width)) * 0.75;
  const tilt = Math.max(0, Math.min(1, correlation));
  const pts: [number, number][] = [];
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    const r = 0.45 + 0.5 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.9));
    let x = Math.cos(a) * r * spread;
    const y = Math.sin(a) * r;
    x *= 1 - tilt * 0.82;
    pts.push([cx + x * R, cy + y * R]);
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label="Stereo goniometer" style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={R} fill="rgba(0,229,176,.02)" stroke="var(--border-2)" strokeWidth="1" />
      <line x1={cx} y1={cy - R} x2={cx} y2={cy + R} stroke="rgba(255,255,255,.07)" strokeWidth="1" />
      <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke="rgba(255,255,255,.07)" strokeWidth="1" />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.5" fill="var(--cyan)" opacity={0.5 + (i % 5) * 0.1} />
      ))}
    </svg>
  );
}

function Visuals({
  spectrogramUrl,
  waveformUrl,
}: {
  spectrogramUrl?: string | null | undefined;
  waveformUrl?: string | null | undefined;
}) {
  const [specOk, setSpecOk] = useState(true);
  const [waveOk, setWaveOk] = useState(true);
  const withTok = (u: string) => `${u}?t=${encodeURIComponent(getAccessToken() ?? '')}`;
  const showSpec = Boolean(spectrogramUrl) && specOk;
  const showWave = Boolean(waveformUrl) && waveOk;
  if (!showSpec && !showWave) return null;
  return (
    <div className="ti-visuals">
      {showWave && (
        <div className="viz">
          <div className="viz-hd">
            <span className="l">Waveform</span>
          </div>
          <div className="viz-img" style={{ height: 108 }}>
            <img
              src={withTok(waveformUrl!)}
              alt="Waveform overview of the full track"
              loading="lazy"
              className="viz-real"
              onError={() => setWaveOk(false)}
            />
          </div>
        </div>
      )}
      {showSpec && (
        <div className="viz">
          <div className="viz-hd">
            <span className="l">Spectrogram</span>
          </div>
          <div className="viz-img" style={{ height: 176 }}>
            <img
              src={withTok(spectrogramUrl!)}
              alt="Spectrogram of the full track"
              loading="lazy"
              className="viz-real"
              onError={() => setSpecOk(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ClashCard({ phase4 }: { phase4: Phase4Data | undefined }) {
  const clashes = phase4?.clashes ?? [];
  if (clashes.length === 0) return null;
  return (
    <section className="card">
      <div className="card-hd">
        <span className="t">
          <span className="led" /> Frequency clashes
        </span>
        <span className="meta">{clashes.length} detected</span>
      </div>
      <div className="card-body">
        <div className="clash-list">
          {clashes.map((c, i) => (
            <ClashRow key={i} clash={c} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ClashRow({ clash }: { clash: Phase4Clash }) {
  const cc =
    clash.severity === 'high' ? 'var(--red)' : clash.severity === 'moderate' ? 'var(--orange)' : 'var(--muted)';
  return (
    <div className="clash-row" style={{ ['--cc' as string]: cc }}>
      <div className="clash-top">
        <span className="clash-dot" />
        <span className="clash-pair">{clash.stems ?? 'Frequency region'}</span>
        {clash.frequency_range && <span className="clash-range">{clash.frequency_range}</span>}
        <span className="clash-sev">{clash.severity ?? '—'}</span>
      </div>
    </div>
  );
}

function TranslationCard({ phase9 }: { phase9: Phase9Data | undefined }) {
  const pb = phase9?.playback;
  if (!pb) return null;
  const systems: { name: string; score: number | undefined }[] = [
    { name: 'Headphones', score: pb.headphone_score },
    { name: 'Speakers', score: pb.speaker_score },
  ];
  const rate = (s: number | undefined) => (s == null ? '—' : s >= 80 ? 'great' : s >= 60 ? 'good' : 'weak');
  const tone = (s: number | undefined) =>
    s == null ? 'var(--muted)' : s >= 80 ? 'var(--green)' : s >= 60 ? 'var(--cyan)' : 'var(--orange)';
  const note = pb.analysis?.[0];
  return (
    <section className="card">
      <div className="card-hd">
        <span className="t">
          <span className="led" /> Mix translation
        </span>
        <span className="meta">playback systems</span>
      </div>
      <div className="card-body">
        <div className="trans-row">
          {systems.map((sys) => (
            <div key={sys.name} className="trans-sys" style={{ ['--tc' as string]: tone(sys.score) }}>
              <span className="ts-ic">◑</span>
              <span className="ts-name">{sys.name}</span>
              <span className="ts-rating">{rate(sys.score)}</span>
            </div>
          ))}
        </div>
        {note && <div className="trans-note">{note}</div>}
      </div>
    </section>
  );
}

// StreamingCard moved to ./StreamingCard.tsx (story 6.3 — shared with the
// anonymous /analyze report).

function fmtDb(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
}
