interface BrandMarkProps {
  size?: number;
  glow?: boolean;
}

/**
 * Story 1.7 / UX-DR4 — bare mark by default (matches the canonical mockup
 * at requirements/claude-design-ui-files/components.jsx:7-17). Pass
 * `glow={true}` to opt into the cyan-bordered container used in the topnav.
 */
export function BrandMark({ size = 22, glow = false }: BrandMarkProps) {
  const inner = Math.round(size * 0.82);
  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'grid',
        placeItems: 'center',
        border: '1px solid rgba(0,229,176,0.4)',
        borderRadius: 6,
        background: 'rgba(0,229,176,0.08)',
        boxShadow: glow
          ? '0 0 12px rgba(0,229,176,0.25), inset 0 0 6px rgba(0,229,176,0.15)'
          : 'none',
        flexShrink: 0,
      }}
    >
      <svg width={inner} height={inner} viewBox="0 0 22 22" fill="none">
        <rect x="3" y="9" width="2.4" height="9" rx="1" fill="#00e5b0" opacity="0.5" />
        <rect x="7" y="5" width="2.4" height="13" rx="1" fill="#00e5b0" opacity="0.85" />
        <rect x="11" y="2" width="2.4" height="16" rx="1" fill="#00e5b0" />
        <rect x="15" y="7" width="2.4" height="11" rx="1" fill="#00e5b0" opacity="0.7" />
      </svg>
    </div>
  );
}
