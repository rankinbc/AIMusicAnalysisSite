/* Story 6.3 — StreamingCard extracted from TrackInfoTab (zero behavior change)
 * so the anonymous /analyze report can show streaming readiness in its
 * always-visible hero (UX-DR27) while the authed Track Info tab keeps it. */
import type { Phase1Data } from '../../api/types';

const PLATFORMS: { name: string; target: number }[] = [
  { name: 'Spotify', target: -14 },
  { name: 'Apple Music', target: -16 },
  { name: 'YouTube', target: -14 },
  { name: 'Tidal', target: -14 },
  { name: 'Amazon Music', target: -14 },
  { name: 'SoundCloud', target: -10 },
  { name: 'Beatport', target: -8 },
];

export function StreamingCard({ phase1 }: { phase1: Phase1Data | undefined }) {
  const lufs = phase1?.lufs;
  const truePeak = phase1?.true_peak_db ?? phase1?.peak_dbfs;
  const clip = phase1?.clipping_detected;
  return (
    <section className="stream-card">
      <div className="stream-hd">
        <span className="l">
          <span className="led" /> Streaming readiness
        </span>
        <span className="mono meta">vs platform targets</span>
      </div>
      <div className="stream-row head">
        <span>Platform</span>
        <span>Target</span>
        <span>Yours</span>
        <span>True peak</span>
      </div>
      {PLATFORMS.map((p) => {
        const lufsOk = lufs != null && Math.abs(lufs - p.target) <= 1.5;
        const tpOk = truePeak != null && truePeak <= -1 && !clip;
        return (
          <div key={p.name} className="stream-row">
            <span className="plat">{p.name}</span>
            <span className="mono cell">{p.target} LUFS</span>
            <span className={`mono cell ${lufsOk ? 'ok' : 'no'}`}>
              {lufs != null ? `${lufs.toFixed(1)}` : '—'}
            </span>
            <span className={`mono cell ${tpOk ? 'ok' : 'no'}`}>
              {truePeak != null ? `${fmtDb(truePeak)}` : '—'}
            </span>
          </div>
        );
      })}
    </section>
  );
}

function fmtDb(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
}
