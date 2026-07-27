import type { Phase1Data } from '../../../api/types';

// Crest factor on a 2–16 dB scale with zones: <6 over-compressed · 6–11 healthy · >11 very dynamic.
const MIN = 2;
const MAX = 16;
const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - MIN) / (MAX - MIN)) * 100))}%`;

/** Dynamics / punch detail from the full-EMIT phase-1 metrics — the Rev3 crest
 *  GAUGE (squashed / punchy / very-dynamic zones) plus loudness-range + transient
 *  tiles. Maps to phase1.crest_factor · loudness_range_lu · transients.*. */
export function PunchCard({ phase1 }: { phase1: Phase1Data | undefined }) {
  const crest = phase1?.crest_factor;
  const lra = phase1?.loudness_range_lu;
  const tr = phase1?.transients;
  if (crest == null && lra == null && tr == null) return null;

  const verdict = crest == null ? '' : crest < 6 ? 'over-compressed' : crest > 11 ? 'very dynamic' : 'healthy';

  return (
    <div className="card">
      <div className="card-hd">
        <span className="t">
          <span className="led" /> Punch &amp; transients
        </span>
        <span className="meta">phase1.crest_factor · transients</span>
      </div>
      <div className="card-body">
        {crest != null && (
          <div className="punch-vis" title="phase1.crest_factor — peak-above-average headroom">
            <div className="pv-hd">
              <span className="pv-l">Crest factor</span>
              <span className={`pv-verdict ${crest < 6 ? 'warn' : 'ok'}`}>{verdict}</span>
              <span className="pv-v mono">{crest.toFixed(1)} dB</span>
            </div>
            <div className="pv-gauge">
              <div className="pvg-zone squash" style={{ left: 0, width: pos(6) }} />
              <div
                className="pvg-zone ok"
                style={{ left: pos(6), width: `${((11 - 6) / (MAX - MIN)) * 100}%` }}
              />
              <div className="pvg-zone open" style={{ left: pos(11), right: 0 }} />
              <div className="pvg-pin" style={{ left: pos(crest) }} />
            </div>
            <div className="pv-scale">
              <span>squashed</span>
              <span>punchy</span>
              <span>very dynamic</span>
            </div>
          </div>
        )}
        <div className="loud-tiles" style={{ marginTop: 12 }}>
          <div className="dtile" title="phase1.loudness_range_lu">
            <div className="dl">Loudness range</div>
            <div className="dv">
              {lra != null ? lra.toFixed(1) : '—'}
              <small>LU</small>
            </div>
          </div>
          <div className="dtile" title="phase1.transients.transients_per_second">
            <div className="dl">Transients</div>
            <div className="dv">
              {tr?.transients_per_second != null ? tr.transients_per_second.toFixed(1) : '—'}
              <small>/s</small>
            </div>
            {tr?.transient_count != null && <div className="dnote">{tr.transient_count.toLocaleString()} total</div>}
          </div>
          <div className="dtile" title="phase1.transients.avg_transient_strength">
            <div className="dl">Avg strength</div>
            <div className="dv">{tr?.avg_transient_strength != null ? tr.avg_transient_strength.toFixed(2) : '—'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
