export const card = (extra = {}) => ({
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 24,
  ...extra,
});

export const sevColor = (s) =>
  s === 'critical' ? 'var(--red)' : s === 'warning' ? 'var(--orange)' : 'var(--cyan)';

export const sevBg = (s) =>
  s === 'critical' ? 'var(--red-dim)' : s === 'warning' ? 'var(--orange-dim)' : 'var(--cyan-dim)';

export const gradeColor = (g) =>
  g[0] === 'A' ? 'var(--green)' : g[0] === 'B' ? 'var(--cyan)' : g[0] === 'C' ? 'var(--yellow)' : 'var(--orange)';

export const Label = ({ children, style: s }) => (
  <div className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 16, ...s }}>
    {children}
  </div>
);

export const WaveformSVG = ({ color = 'rgba(0,229,176,0.35)', height = 40 }) => {
  const vals = [6,10,18,14,28,24,38,32,24,18,14,22,36,28,20,14,18,26,22,14,18,28,32,26,18,14,22,28,24,18,14,10,18,14,6,10];
  return (
    <svg width={vals.length * 6} height={height} viewBox={`0 0 ${vals.length * 6} ${height}`} fill="none">
      {vals.map((v, i) => {
        const scaled = (v / 38) * height;
        return <rect key={i} x={i * 6} y={(height - scaled) / 2} width="4" height={scaled} rx="2" fill={color} />;
      })}
    </svg>
  );
};

export const EQLoader = ({ count = 10, color = 'var(--cyan)', height = 40 }) => (
  <div style={{ display: 'flex', gap: 4, height, alignItems: 'flex-end' }}>
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} style={{
        width: 5, background: color, borderRadius: '3px 3px 0 0',
        transformOrigin: 'bottom',
        animation: `eq ${0.55 + (i % 4) * 0.12}s ease-in-out infinite`,
        animationDelay: `${i * 0.07}s`,
      }} />
    ))}
  </div>
);
