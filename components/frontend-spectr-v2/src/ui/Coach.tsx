import { useEffect, useMemo, useState } from 'react';

import { useReducedMotion } from '../hooks/useReducedMotion';

/**
 * The Coach — SPECTR's animated robot mascot. This is the canonical, shared
 * avatar; drop `<Coach />` (full helmet, neon visor, EQ-bar mouth, pulsing
 * antenna, glow) or `<CoachMini />` (compact line-art bust) anywhere in the
 * app. Lives in `ui/` so any feature can reuse him without a cross-feature
 * import. Originally authored as `TranceBot` under features/results; that
 * module now re-exports these for back-compat.
 */
interface CoachProps {
  /** Rendered width/height in px (square). */
  size?: number;
  /** Speeds up the visor EQ bars to read as "actively responding". */
  thinking?: boolean;
  /** Outer neon drop-shadow. */
  glow?: boolean;
}

// Story 1.8 / Task 8 / closes story 1.7 deferred D1 — static-frame bars
// when the user prefers reduced motion. The CSS-side blanket freeze in
// global.css cannot reach this JS-driven rAF loop; checking the media
// query here is the only way to honour the OS-level preference.
const STATIC_BARS: number[] = [0.4, 0.55, 0.65, 0.5, 0.4];

export function Coach({ size = 64, thinking = false, glow = true }: CoachProps) {
  const reduceMotion = useReducedMotion();
  const [bars, setBars] = useState<number[]>(() =>
    reduceMotion ? [...STATIC_BARS] : Array.from({ length: 5 }, () => 0.3),
  );
  const uid = useMemo(() => Math.random().toString(36).slice(2, 8), []);

  useEffect(() => {
    if (reduceMotion) {
      setBars([...STATIC_BARS]);
      return;
    }
    let raf = 0;
    const t0 = performance.now() / 1000;
    function frame() {
      const t = performance.now() / 1000 - t0;
      const speed = thinking ? 8 : 2;
      setBars([
        0.3 + (Math.sin(t * speed + 0.2) * 0.5 + 0.5) * 0.65,
        0.3 + (Math.sin(t * speed + 1.1) * 0.5 + 0.5) * 0.65,
        0.3 + (Math.sin(t * speed + 2.0) * 0.5 + 0.5) * 0.65,
        0.3 + (Math.sin(t * speed + 3.3) * 0.5 + 0.5) * 0.65,
        0.3 + (Math.sin(t * speed + 4.7) * 0.5 + 0.5) * 0.65,
      ]);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [thinking, reduceMotion]);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      role="img"
      aria-label="The Coach"
      style={{
        display: 'block',
        filter: glow ? 'drop-shadow(0 0 18px rgba(0,229,176,0.4))' : 'none',
      }}
    >
      <defs>
        <linearGradient id={`coach-helmet-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a2538" />
          <stop offset="0.5" stopColor="#0d1525" />
          <stop offset="1" stopColor="#070a12" />
        </linearGradient>
        <linearGradient id={`coach-armor-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#070a12" />
          <stop offset="0.5" stopColor="#141f34" />
          <stop offset="1" stopColor="#070a12" />
        </linearGradient>
        <linearGradient id={`coach-visor-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="0.5" stopColor="#00e5b0" />
          <stop offset="1" stopColor="#00e5b0" stopOpacity="0.5" />
        </linearGradient>
        <radialGradient id={`coach-cheek-${uid}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#00e5b0" stopOpacity="0.55" />
          <stop offset="1" stopColor="#00e5b0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`coach-horn-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#00e5b0" stopOpacity="0.9" />
          <stop offset="1" stopColor="#00e5b0" stopOpacity="0.2" />
        </linearGradient>
      </defs>

      <path
        d="M8 22 L4 14 L11 18 L14 26 Z"
        fill={`url(#coach-horn-${uid})`}
        stroke="rgba(0,229,176,0.5)"
        strokeWidth="0.8"
      />
      <path
        d="M72 22 L76 14 L69 18 L66 26 Z"
        fill={`url(#coach-horn-${uid})`}
        stroke="rgba(0,229,176,0.5)"
        strokeWidth="0.8"
      />

      <line
        x1="40"
        y1="2"
        x2="40"
        y2="10"
        stroke="#00e5b0"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="40" cy="3" r="2.6" fill="#00e5b0">
        {/* Code-review P15 — SVG SMIL `<animate>` is not covered by
            CSS `prefers-reduced-motion` (it's SMIL, not CSS). Gate
            the antenna pulse on the same hook the rAF visor uses so
            reduced-motion users get a fully static avatar. */}
        {!reduceMotion && (
          <animate
            attributeName="opacity"
            values="0.4;1;0.4"
            dur="1.4s"
            repeatCount="indefinite"
          />
        )}
      </circle>
      <rect
        x="36"
        y="9"
        width="8"
        height="3"
        rx="1"
        fill="#11192a"
        stroke="rgba(0,229,176,0.6)"
        strokeWidth="0.8"
      />

      <path
        d="M14 18 L24 12 L40 10 L56 12 L66 18 L64 22 L58 19 L40 17 L22 19 L16 22 Z"
        fill={`url(#coach-armor-${uid})`}
        stroke="rgba(0,229,176,0.5)"
        strokeWidth="1"
        strokeLinejoin="miter"
      />
      <circle cx="20" cy="20" r="1.2" fill="rgba(0,229,176,0.7)" />
      <circle cx="60" cy="20" r="1.2" fill="rgba(0,229,176,0.7)" />

      <path
        d="M14 22 L24 18 L40 17 L56 18 L66 22 L68 32 L66 48 L60 60 L52 68 L40 70 L28 68 L20 60 L14 48 L12 32 Z"
        fill={`url(#coach-helmet-${uid})`}
        stroke="rgba(0,229,176,0.5)"
        strokeWidth="1.4"
        strokeLinejoin="miter"
      />

      <path
        d="M20 60 L26 55 L40 56 L54 55 L60 60"
        fill="none"
        stroke="rgba(0,229,176,0.32)"
        strokeWidth="0.8"
      />
      <path d="M22 26 L28 22" fill="none" stroke="rgba(0,229,176,0.32)" strokeWidth="0.8" />
      <path d="M58 26 L52 22" fill="none" stroke="rgba(0,229,176,0.32)" strokeWidth="0.8" />

      <rect
        x="4"
        y="30"
        width="9"
        height="20"
        rx="2.5"
        fill="#11192a"
        stroke="rgba(0,229,176,0.55)"
        strokeWidth="1.1"
      />
      <rect
        x="6"
        y="33"
        width="5"
        height="14"
        rx="1.5"
        fill="rgba(0,229,176,0.10)"
        stroke="rgba(0,229,176,0.4)"
        strokeWidth="0.6"
      />
      <circle cx="8.5" cy="40" r="2" fill="#00e5b0" />
      <rect
        x="67"
        y="30"
        width="9"
        height="20"
        rx="2.5"
        fill="#11192a"
        stroke="rgba(167,139,250,0.55)"
        strokeWidth="1.1"
      />
      <rect
        x="69"
        y="33"
        width="5"
        height="14"
        rx="1.5"
        fill="rgba(167,139,250,0.10)"
        stroke="rgba(167,139,250,0.4)"
        strokeWidth="0.6"
      />
      <circle cx="71.5" cy="40" r="2" fill="#a78bfa" />

      <path
        d="M16 32 L26 28 L40 27 L54 28 L64 32 L62 42 L56 46 L40 47 L24 46 L18 42 Z"
        fill="#06151a"
        stroke={`url(#coach-visor-${uid})`}
        strokeWidth="1.4"
        strokeLinejoin="miter"
      />
      <path
        d="M19 33 L28 30 L40 29 L52 30 L61 33"
        fill="none"
        stroke="rgba(0,229,176,0.25)"
        strokeWidth="0.7"
      />

      {bars.map((v, i) => {
        const barH = 11 * v;
        const x = 24 + i * 6.5;
        const y = 38 - barH / 2;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width="3.5"
            height={barH}
            rx="1"
            fill={i === 2 ? '#a78bfa' : '#00e5b0'}
            opacity={0.7 + v * 0.3}
          />
        );
      })}

      <path
        d="M16 48 L22 46 L24 56 L18 58 Z"
        fill={`url(#coach-armor-${uid})`}
        stroke="rgba(0,229,176,0.3)"
        strokeWidth="0.7"
      />
      <path
        d="M64 48 L58 46 L56 56 L62 58 Z"
        fill={`url(#coach-armor-${uid})`}
        stroke="rgba(0,229,176,0.3)"
        strokeWidth="0.7"
      />
      <ellipse cx="20" cy="52" rx="3" ry="3.5" fill={`url(#coach-cheek-${uid})`} />
      <ellipse cx="60" cy="52" rx="3" ry="3.5" fill={`url(#coach-cheek-${uid})`} />

      <rect
        x="30"
        y="54"
        width="20"
        height="10"
        rx="2"
        fill="#06151a"
        stroke="rgba(0,229,176,0.4)"
        strokeWidth="0.9"
      />
      {Array.from({ length: 5 }).map((_, i) => (
        <line
          key={i}
          x1={32 + i * 4}
          y1="56"
          x2={32 + i * 4}
          y2="62"
          stroke="rgba(0,229,176,0.55)"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
      ))}

      <path
        d="M30 64 L34 70 L40 72 L46 70 L50 64"
        fill={`url(#coach-armor-${uid})`}
        stroke="rgba(0,229,176,0.5)"
        strokeWidth="1"
        strokeLinejoin="miter"
      />
      <circle cx="40" cy="70" r="1.3" fill="rgba(0,229,176,0.8)" />
    </svg>
  );
}

interface CoachMiniProps {
  size?: number;
  color?: string;
}

/** Compact line-art bust of the Coach — for avatars, list rows, chips. */
export function CoachMini({ size = 22, color = '#00e5b0' }: CoachMiniProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="The Coach"
      style={{ display: 'block' }}
    >
      <line
        x1="12"
        y1="1"
        x2="12"
        y2="4"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="12" cy="1.5" r="1.2" fill={color} />
      <path
        d="M5 6 L7.5 3.5 L16.5 3.5 L19 6 L20.5 9 L20.5 16 L19 19 L16.5 21.5 L7.5 21.5 L5 19 L3.5 16 L3.5 9 Z"
        fill="#0d1525"
        stroke={color}
        strokeWidth="1.4"
        strokeLinejoin="miter"
      />
      <rect x="1.5" y="10" width="2.5" height="5" rx="0.6" fill={color} opacity="0.85" />
      <rect x="20" y="10" width="2.5" height="5" rx="0.6" fill={color} opacity="0.85" />
      <rect
        x="5"
        y="9"
        width="14"
        height="6"
        rx="1.2"
        fill="#070a12"
        stroke={color}
        strokeWidth="1.1"
      />
      <rect x="6.5" y="10.5" width="11" height="3" rx="0.8" fill={color} />
      <circle cx="9.5" cy="18" r="0.95" fill={color} />
      <circle cx="12" cy="18" r="0.95" fill={color} />
      <circle cx="14.5" cy="18" r="0.95" fill={color} />
    </svg>
  );
}
