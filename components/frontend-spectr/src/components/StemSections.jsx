const BAND_KEYS = ['sub', 'bass', 'low_mid', 'mid', 'high_mid', 'presence', 'air'];
const BAND_LABEL = { sub: 'Sub', bass: 'Bass', low_mid: 'Lo-M', mid: 'Mid', high_mid: 'Hi-M', presence: 'Pres', air: 'Air' };

function bandColor(db) {
  if (db == null) return 'transparent';
  if (db > -6)  return 'rgba(244,63,94,0.35)';
  if (db > -18) return 'rgba(0,229,176,0.25)';
  return 'rgba(80,140,220,0.18)';
}

function tierColor(tier) {
  return tier === 'critical' ? 'var(--red)'
       : tier === 'warning'  ? '#f5a623'
       : 'var(--muted)';
}

function tierBg(tier) {
  return tier === 'critical' ? 'rgba(244,63,94,0.1)'
       : tier === 'warning'  ? 'rgba(245,166,35,0.1)'
       : 'rgba(255,255,255,0.02)';
}

function SectionShell({ title, sub, children }) {
  return (
    <section style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '20px 22px', marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
        <h3 style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.01em' }}>{title}</h3>
        {sub && (
          <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.13em', textTransform: 'uppercase' }}>
            {sub}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

export function PerStemBalanceCard({ perStem }) {
  const roles = Object.keys(perStem ?? {});
  if (roles.length === 0) return null;
  return (
    <SectionShell title="Per-stem balance" sub={`${roles.length} stems`}>
      <div style={{ overflowX: 'auto' }}>
        <table className="mono" style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: 'var(--muted)' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Stem</th>
              <th style={{ textAlign: 'right', padding: '6px 8px' }}>RMS</th>
              <th style={{ textAlign: 'right', padding: '6px 8px' }}>LUFS</th>
              <th style={{ textAlign: 'right', padding: '6px 8px' }}>Width</th>
              {BAND_KEYS.map(b => (
                <th key={b} style={{ textAlign: 'center', padding: '6px 4px' }}>{BAND_LABEL[b]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roles.map(role => {
              const m = perStem[role];
              return (
                <tr key={role} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px', fontWeight: 700, color: 'var(--cyan)', textTransform: 'capitalize' }}>{role}</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>{m.rms_db?.toFixed(1) ?? '—'}</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>{Number.isFinite(m.lufs_integrated) ? m.lufs_integrated.toFixed(1) : '—'}</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>{(m.stereo_width ?? 0).toFixed(2)}</td>
                  {BAND_KEYS.map(b => {
                    const db = m.band_energy_db?.[b];
                    return (
                      <td key={b} style={{ padding: '8px 4px', textAlign: 'center', background: bandColor(db), color: 'var(--text)' }}>
                        {db != null ? db.toFixed(0) : '—'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mono" style={{ marginTop: 10, fontSize: 10, color: 'var(--dim)' }}>
        Cell colors: red &gt; −6 dB · green −6 to −18 · blue &lt; −18
      </div>
    </SectionShell>
  );
}

export function StemClashMatrixCard({ clashes }) {
  if (!clashes || clashes.length === 0) return null;
  // Group by ordered stem pair
  const byPair = new Map();
  for (const c of clashes) {
    const key = [c.stem_a, c.stem_b].sort().join(' × ');
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(c);
  }
  const ordered = [...byPair.entries()].sort((a, b) => {
    const sa = Math.max(...a[1].map(c => c.overlap_severity));
    const sb = Math.max(...b[1].map(c => c.overlap_severity));
    return sb - sa;
  });
  return (
    <SectionShell title="Stem clash matrix" sub={`${ordered.length} pair${ordered.length === 1 ? '' : 's'}`}>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ordered.map(([pair, list]) => {
          const worst = list.reduce((a, b) => a.overlap_severity > b.overlap_severity ? a : b);
          return (
            <li key={pair} style={{
              padding: '10px 14px', borderRadius: 8, background: tierBg(worst.severity_tier),
              border: `1px solid ${worst.severity_tier === 'critical' ? 'rgba(244,63,94,0.3)' : 'var(--border)'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontSize: 13, textTransform: 'capitalize' }}>{pair}</span>
                <span className="mono" style={{
                  fontSize: 10, color: tierColor(worst.severity_tier),
                  letterSpacing: '0.13em', textTransform: 'uppercase', fontWeight: 700,
                }}>
                  {worst.severity_tier}
                </span>
              </div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                {list.map(c => `${c.band} (${Math.round(c.overlap_severity * 100)}%)`).join('  ·  ')}
              </div>
            </li>
          );
        })}
      </ul>
    </SectionShell>
  );
}

export function StemReferenceDeltasCard({ deltas }) {
  if (!deltas) return null;
  const visible = deltas.filter(d => d.severity_tier !== 'info');
  if (visible.length === 0) return null;
  return (
    <SectionShell title="Stem vs reference" sub={`${visible.length} difference${visible.length === 1 ? '' : 's'}`}>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {visible.map((d, i) => (
          <li key={i} style={{
            padding: '8px 14px', borderRadius: 8, background: tierBg(d.severity_tier),
            border: '1px solid var(--border)',
            display: 'flex', alignItems: 'baseline', gap: 12,
          }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--cyan)', textTransform: 'capitalize', minWidth: 70 }}>
              {d.role}
            </span>
            <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.05em' }}>
              {d.metric}
            </span>
            <span style={{ flex: 1, fontSize: 12 }}>{d.interpretation}</span>
            <span className="mono" style={{
              fontSize: 9, color: tierColor(d.severity_tier),
              letterSpacing: '0.13em', textTransform: 'uppercase', fontWeight: 700,
            }}>
              {d.severity_tier}
            </span>
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}
