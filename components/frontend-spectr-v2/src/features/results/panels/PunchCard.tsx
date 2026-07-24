import type { Phase1Data } from '../../../api/types';

/** Dynamics / punch detail from the full-EMIT phase-1 metrics — explains the
 *  dynamics score with crest factor, loudness range, and transient density. */
export function PunchCard({ phase1 }: { phase1: Phase1Data | undefined }) {
  const crest = phase1?.crest_factor;
  const lra = phase1?.loudness_range_lu;
  const tr = phase1?.transients;
  if (crest == null && lra == null && tr == null) return null;

  const tiles: { label: string; value: string; unit: string }[] = [
    { label: 'Crest factor', value: crest != null ? crest.toFixed(1) : '—', unit: 'dB' },
    { label: 'Loudness range', value: lra != null ? lra.toFixed(1) : '—', unit: 'LU' },
    {
      label: 'Transients',
      value: tr?.transients_per_second != null ? tr.transients_per_second.toFixed(1) : '—',
      unit: '/s',
    },
    {
      label: 'Transient strength',
      value: tr?.avg_transient_strength != null ? tr.avg_transient_strength.toFixed(2) : '—',
      unit: '',
    },
  ];

  return (
    <section className="card">
      <div className="card-hd">
        <span className="t">
          <span className="led" /> Punch &amp; transients
        </span>
        <span className="meta">dynamics detail</span>
      </div>
      <div className="card-body">
        <div className="loud-tiles">
          {tiles.map((t) => (
            <div key={t.label} className="dtile">
              <div className="dl">{t.label}</div>
              <div className="dv">
                {t.value}
                {t.unit && <small>{t.unit}</small>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
