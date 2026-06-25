import { useEffect, useState } from 'react';

import { useReducedMotion } from '../hooks/useReducedMotion';

/**
 * SpecialistBot — the alternate robot mascot generated for the Claude listen-rack
 * design handoff (domed helmet, side headphone pods, neon visor with a live
 * EQ-bar mouth, pulsing antenna, chin grille). Distinct from the canonical
 * `<Coach />` head in `ui/Coach.tsx`; kept here so either avatar can be reused
 * app-wide. Self-contained — no external CSS required.
 */
interface SpecialistBotProps {
  /** Rendered width/height in px (square). */
  size?: number;
  /** Speeds up the visor EQ bars to read as "actively responding". */
  thinking?: boolean;
  /** Same as `thinking` — kept for API parity. */
  live?: boolean;
  /** Outer neon drop-shadow. */
  glow?: boolean;
}

const STATIC_BARS = [0.45, 0.78, 1, 0.66, 0.5];

export function SpecialistBot({ size = 44, thinking = false, live = false, glow = true }: SpecialistBotProps) {
  const reduceMotion = useReducedMotion();
  const animated = !reduceMotion && size >= 28;
  const [bars, setBars] = useState<number[]>([...STATIC_BARS]);

  useEffect(() => {
    if (!animated) {
      setBars([...STATIC_BARS]);
      return undefined;
    }
    let raf = 0;
    const t0 = performance.now();
    const speed = (thinking || live) ? 7.5 : 3.2;
    const tick = (t: number) => {
      const e = (t - t0) / 1000;
      setBars([0, 1, 2, 3, 4].map((i) =>
        Math.max(0.18, Math.min(1, 0.42 + 0.46 * (0.5 + 0.5 * Math.sin(e * speed + i * 1.25))))));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animated, thinking, live]);

  return (
    <div style={{ width: size, height: size, flexShrink: 0, display: 'grid', placeItems: 'center', filter: glow ? 'drop-shadow(0 0 7px rgba(0,229,176,0.45))' : 'none' }}>
      <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Specialist">
        <defs>
          <radialGradient id="sbGlow" cx="50%" cy="46%" r="54%">
            <stop offset="0%" stopColor="#00e5b0" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#00e5b0" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="sbShell" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0e2030" /><stop offset="100%" stopColor="#081019" />
          </linearGradient>
        </defs>
        {glow && <circle cx="24" cy="23" r="22" fill="url(#sbGlow)" />}
        {/* antenna (SMIL pulse, frozen under reduced motion) */}
        <line x1="24" y1="5.4" x2="24" y2="10.5" stroke="#34e1b0" strokeWidth="1.1" />
        <path d="M24 2.4 l1.8 1.9 -1.8 1.9 -1.8 -1.9 z" fill="#5eead4" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
          {!reduceMotion && (
            <>
              <animate attributeName="opacity" values="0.55;1;0.55" dur="1.8s" repeatCount="indefinite" />
              <animateTransform attributeName="transform" type="scale" values="0.9;1.15;0.9" dur="1.8s" repeatCount="indefinite" additive="sum" />
            </>
          )}
        </path>
        {/* side fins */}
        <path d="M14.5 15.5 L6.5 10.5 L9.5 18.5 Z" fill="#0c1a26" stroke="#34e1b0" strokeWidth="1" strokeLinejoin="round" />
        <path d="M33.5 15.5 L41.5 10.5 L38.5 18.5 Z" fill="#0c1a26" stroke="#34e1b0" strokeWidth="1" strokeLinejoin="round" />
        {/* side headphone pods */}
        <rect x="7" y="22" width="4.6" height="9.4" rx="2.1" fill="#0a1622" stroke="#34e1b0" strokeWidth="1" />
        <circle cx="9.3" cy="26.7" r="1.05" fill="#34e1b0" />
        <rect x="36.4" y="22" width="4.6" height="9.4" rx="2.1" fill="#0a1622" stroke="#34e1b0" strokeWidth="1" />
        <circle cx="38.7" cy="26.7" r="1.05" fill="#e879f9" />
        {/* helmet shell */}
        <path d="M12.8 16.4 Q24 7.8 35.2 16.4 L36.6 24.2 Q36.6 31 30.2 35 L24 38.8 L17.8 35 Q11.4 31 11.4 24.2 Z" fill="url(#sbShell)" stroke="#34e1b0" strokeWidth="1.35" strokeLinejoin="round" />
        <path d="M14.4 18 Q24 13 33.6 18" fill="none" stroke="#34e1b0" strokeWidth="0.9" opacity="0.65" />
        {/* visor */}
        <path d="M16.2 19.4 L31.8 19.4 L29.9 27 L18.1 27 Z" fill="#0a121d" stroke="#a78bfa" strokeWidth="1.1" strokeLinejoin="round" />
        {/* EQ-bar mouth */}
        {bars.map((b, i) => {
          const h = 1.8 + b * 6.2, x = 18.7 + i * 2.35, y = 25.8 - h;
          return <rect key={i} x={x} y={y} width="1.5" height={h} rx="0.5" fill={i === 2 ? '#c4b5fd' : '#34e1b0'} />;
        })}
        {/* chin grille */}
        <g stroke="#34e1b0" strokeWidth="0.9" strokeLinecap="round" opacity="0.85">
          <line x1="21" y1="30.4" x2="21" y2="33.8" /><line x1="23" y1="30.8" x2="23" y2="34.8" />
          <line x1="25" y1="30.8" x2="25" y2="34.8" /><line x1="27" y1="30.4" x2="27" y2="33.8" />
        </g>
      </svg>
    </div>
  );
}
