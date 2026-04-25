import { useState, useEffect } from 'react';
import { gradeColor } from './primitives';

export default function ScoreRing({ score, grade }) {
  const [active, setActive] = useState(false);
  const r = 58;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const gc = gradeColor(grade);

  useEffect(() => {
    const t = setTimeout(() => setActive(true), 100);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{ position: 'relative', width: 180, height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width="180" height="180" style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
        <circle cx="90" cy="90" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
        <circle
          cx="90" cy="90" r={r}
          fill="none"
          stroke={gc}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={active ? offset : circ}
          style={{
            transition: 'stroke-dashoffset 1.3s cubic-bezier(0.4,0,0.2,1)',
            filter: `drop-shadow(0 0 8px ${gc})`,
          }}
        />
      </svg>
      <div style={{ textAlign: 'center', zIndex: 1 }}>
        <div style={{ fontWeight: 800, fontSize: 52, lineHeight: 1, color: gc, filter: `drop-shadow(0 0 12px ${gc}88)` }}>
          {grade}
        </div>
        <div className="mono" style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>{score} / 100</div>
      </div>
    </div>
  );
}
